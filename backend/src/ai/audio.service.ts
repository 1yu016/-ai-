import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

const ASR_SUBMIT_URL =
  'https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit';
const ASR_QUERY_URL =
  'https://openspeech.bytedance.com/api/v3/auc/bigmodel/query';
const TTS_URL =
  'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse';
const ASR_RESOURCE_ID = 'volc.seedasr.auc';
// 与控制台已开通的豆包语音合成模型 2.0 保持一致。
const DEFAULT_TTS_RESOURCE_ID = 'seed-tts-2.0';
const MAX_AUDIO_SIZE = 20 * 1024 * 1024;
const MAX_TTS_CHUNK_BYTES = 900;
const REQUEST_TIMEOUT_MS = 60_000;
const ASR_POLL_INTERVAL_MS = 1_000;

const SUPPORTED_AUDIO_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/ogg',
  'audio/opus',
  'application/ogg',
]);

type AsrResponse = {
  result?: { text?: string };
};

type TtsResponse = {
  code?: number;
  message?: string;
  data?: string | null;
};

export type UploadedAudioFile = {
  buffer: Buffer;
  mimetype: string;
  size: number;
};

@Injectable()
export class AudioService {
  private readonly logger = new Logger(AudioService.name);
  private readonly apiKey: string;
  private readonly ttsResourceId: string;
  private readonly voiceType: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('VOLC_API_KEY')?.trim();

    if (!apiKey) {
      throw new Error(
        '缺少环境变量 VOLC_API_KEY，请在 backend/.env 中配置后再启动服务',
      );
    }

    this.apiKey = apiKey;
    this.ttsResourceId =
      this.configService.get<string>('VOLC_TTS_RESOURCE_ID')?.trim() ||
      DEFAULT_TTS_RESOURCE_ID;
    this.voiceType =
      this.configService.get<string>('VOLC_TTS_VOICE_TYPE')?.trim() ||
      'zh_female_xueayi_saturn_bigtts';
  }

  async asr(file: UploadedAudioFile): Promise<string> {
    this.validateAudio(file);

    try {
      const taskId = randomUUID();
      const deadline = Date.now() + REQUEST_TIMEOUT_MS;
      const headers = {
        'Content-Type': 'application/json',
        'X-Api-Key': this.apiKey,
        'X-Api-Resource-Id': ASR_RESOURCE_ID,
        'X-Api-Request-Id': taskId,
        'X-Api-Sequence': '-1',
      };

      const submitResponse = await fetch(ASR_SUBMIT_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          user: {
            uid: taskId,
          },
          audio: {
            data: file.buffer.toString('base64'),
            format: this.getAudioFormat(file.mimetype),
          },
          request: {
            model_name: 'bigmodel',
            enable_itn: true,
            enable_punc: true,
          },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      const submitStatus = submitResponse.headers.get('x-api-status-code');
      const submitMessage =
        submitResponse.headers.get('x-api-message') || '未知错误';
      const submitLogId = submitResponse.headers.get('x-tt-logid') || '';

      if (!submitResponse.ok || submitStatus !== '20000000') {
        this.logger.error(
          `火山引擎 ASR 提交失败: http=${submitResponse.status}, code=${submitStatus ?? 'unknown'}, message=${submitMessage}, logId=${submitLogId}`,
        );
        throw new BadGatewayException(`语音识别失败：${submitMessage}`);
      }

      while (Date.now() < deadline) {
        const remainingMs = deadline - Date.now();
        const queryResponse = await fetch(ASR_QUERY_URL, {
          method: 'POST',
          headers,
          body: '{}',
          signal: AbortSignal.timeout(Math.max(1, remainingMs)),
        });
        const result = await this.readJson<AsrResponse>(queryResponse);
        const statusCode = queryResponse.headers.get('x-api-status-code');
        const message =
          queryResponse.headers.get('x-api-message') || '未知错误';
        const logId = queryResponse.headers.get('x-tt-logid') || submitLogId;

        if (queryResponse.ok && statusCode === '20000000') {
          const text = result.result?.text?.trim();
          if (!text) {
            throw new BadGatewayException('语音识别成功，但未返回识别文本');
          }
          return text;
        }

        if (statusCode !== '20000001' && statusCode !== '20000002') {
          this.logger.error(
            `火山引擎 ASR 查询失败: http=${queryResponse.status}, code=${statusCode ?? 'unknown'}, message=${message}, logId=${logId}`,
          );
          throw new BadGatewayException(`语音识别失败：${message}`);
        }

        await new Promise((resolve) =>
          setTimeout(resolve, ASR_POLL_INTERVAL_MS),
        );
      }

      throw new GatewayTimeoutException('语音识别超时，请稍后重试');
    } catch (error) {
      this.handleUpstreamError(error, '语音识别');
    }
  }

  async tts(text: string): Promise<string> {
    const normalizedText = text.trim();
    if (!normalizedText) {
      throw new BadRequestException('text 不能为空');
    }

    try {
      const audioChunks: Buffer[] = [];
      for (const chunk of this.splitTtsText(normalizedText)) {
        const requestId = randomUUID();
        const response = await fetch(TTS_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': this.apiKey,
            'X-Api-Resource-Id': this.ttsResourceId,
            'X-Api-Request-Id': requestId,
          },
          body: JSON.stringify({
            user: { uid: 'kid-demo-001' },
            req_params: {
              text: chunk,
              speaker: this.voiceType,
              audio_params: {
                format: 'mp3',
                sample_rate: 24000,
              },
            },
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        audioChunks.push(await this.readTtsAudio(response));
      }

      return `data:audio/mpeg;base64,${Buffer.concat(audioChunks).toString('base64')}`;
    } catch (error) {
      this.handleUpstreamError(error, '语音合成');
    }
  }

  private splitTtsText(text: string): string[] {
    const chunks: string[] = [];
    let current = '';

    for (const character of text) {
      const candidate = current + character;
      if (Buffer.byteLength(candidate, 'utf8') <= MAX_TTS_CHUNK_BYTES) {
        current = candidate;
        continue;
      }

      if (current) chunks.push(current);
      current = character;
    }

    if (current) chunks.push(current);
    return chunks;
  }

  private validateAudio(
    file?: UploadedAudioFile,
  ): asserts file is UploadedAudioFile {
    if (!file) {
      throw new BadRequestException(
        '请使用 multipart/form-data 上传 file 字段',
      );
    }
    if (!file.buffer?.length) {
      throw new BadRequestException('上传的音频文件不能为空');
    }
    if (file.size > MAX_AUDIO_SIZE) {
      throw new BadRequestException('音频文件不能超过 20MB');
    }
    if (!SUPPORTED_AUDIO_TYPES.has(file.mimetype.toLowerCase())) {
      throw new BadRequestException('仅支持 WAV、MP3、OGG 或 OPUS 音频文件');
    }
  }

  private getAudioFormat(mimetype: string): 'wav' | 'mp3' | 'ogg' {
    const normalizedType = mimetype.toLowerCase();
    if (normalizedType.includes('wav')) return 'wav';
    if (normalizedType.includes('ogg') || normalizedType.includes('opus')) {
      return 'ogg';
    }
    return 'mp3';
  }

  private async readJson<T>(response: Response): Promise<T> {
    try {
      return (await response.json()) as T;
    } catch {
      throw new BadGatewayException('火山引擎返回了无法解析的响应');
    }
  }

  private async readTtsAudio(response: Response): Promise<Buffer> {
    const rawResponse = await response.text();
    const audioChunks: Buffer[] = [];
    let lastResult: TtsResponse | undefined;

    for (const rawLine of rawResponse.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;

      const json = line.slice('data:'.length).trim();
      if (!json || json === '[DONE]') continue;

      try {
        const result = JSON.parse(json) as TtsResponse;
        lastResult = result;
        if (result.data) {
          audioChunks.push(Buffer.from(result.data, 'base64'));
        }
      } catch {
        throw new BadGatewayException('火山引擎返回了无法解析的语音数据');
      }
    }

    if (!response.ok || audioChunks.length === 0) {
      const message = lastResult?.message || `HTTP ${response.status}`;
      const logId = response.headers.get('x-tt-logid') || '';
      this.logger.error(
        `火山引擎 TTS 失败: http=${response.status}, code=${lastResult?.code ?? 'unknown'}, message=${message}, logId=${logId}`,
      );
      throw new BadGatewayException(`语音合成失败：${message}`);
    }

    return Buffer.concat(audioChunks);
  }

  private handleUpstreamError(error: unknown, action: string): never {
    if (error instanceof HttpException) {
      throw error;
    }

    this.logger.error(
      `${action}请求异常`,
      error instanceof Error ? error.stack : String(error),
    );
    throw new ServiceUnavailableException(
      `${action}服务暂时不可用，请稍后重试`,
    );
  }
}
