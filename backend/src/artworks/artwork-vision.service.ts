import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';
import OpenAI from 'openai';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { AuditService } from '../platform/audit.service';

export const UNSAFE_ARTWORK_INFERENCE = /(?:人脸识别|身份|姓名|住址|家庭|父母|贫困|富裕|心理|抑郁|焦虑|自闭|多动|智力|智商|人格|性格|品行|诊断|天赋|能力差|不聪明|坏孩子|排名|评分|javascript:|https?:\/\/)/i;

type ArtworkObservation = {
  visibleSubject: string;
  colors: string[];
  composition: string;
  visibleElements: string[];
  creativeExpression: string;
  details: string[];
  openQuestion: string;
};

@Injectable()
export class ArtworkVisionService {
  private readonly logger = new Logger(ArtworkVisionService.name);
  private readonly client: OpenAI | null;
  private readonly model: string | null;

  constructor(config: ConfigService, private readonly audit: AuditService) {
    const apiKey = config.get<string>('ARK_API_KEY')?.trim();
    this.model = config.get<string>('ARTWORK_VISION_MODEL')?.trim() || config.get<string>('ARK_ENDPOINT_ID')?.trim() || null;
    this.client = apiKey && this.model ? new OpenAI({
      apiKey,
      baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
      timeout: Number(config.get<string>('ARTWORK_VISION_TIMEOUT_MS') || '30000'),
      maxRetries: 0,
    }) : null;
  }

  async review(actor: JwtTeacherPayload, input: { artworkId: number; path: string; mimeType: string }) {
    if (!this.client || !this.model) throw new ServiceUnavailableException('视觉模型尚未配置');
    const started = Date.now();
    try {
      const encoded = (await readFile(input.path)).toString('base64');
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: '你是幼儿绘画观察助手。只描述图片中直接可见的主题、颜色、构图、元素、创意表达和细节，并提出一个温和开放问题。不得做人脸识别、身份或家庭情况推断，不得作心理、人格、智力、能力、品行判断、诊断、评分或排名。严格输出JSON且不得增加字段：{"visibleSubject":"","colors":[""],"composition":"","visibleElements":[""],"creativeExpression":"","details":[""],"openQuestion":""}',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: '请客观观察这幅作品，生成供教师编辑的评价草稿。' },
              { type: 'image_url', image_url: { url: `data:${input.mimeType};base64,${encoded}` } },
            ],
          },
        ],
        stream: false,
        temperature: 0.2,
        max_tokens: 700,
      });
      const raw = completion.choices[0]?.message?.content?.trim() || '';
      const observation = this.parse(raw);
      const draft = this.toDraft(observation);
      await this.audit.writeAi({ actor, feature: 'artwork_review', provider: 'volcengine_ark', model: this.model, requestId: `artwork:${input.artworkId}`, status: 'success', latencyMs: Date.now() - started, metadata: { artworkId: input.artworkId } });
      return draft;
    } catch (error) {
      this.logger.warn(`绘画视觉分析失败：${error instanceof Error ? error.message : String(error)}`);
      await this.audit.writeAi({ actor, feature: 'artwork_review', provider: 'volcengine_ark', model: this.model, requestId: `artwork:${input.artworkId}`, status: 'failed', latencyMs: Date.now() - started, errorCode: error instanceof Error ? error.name : 'UNKNOWN', metadata: { artworkId: input.artworkId } });
      if (error instanceof BadGatewayException) throw error;
      throw new BadGatewayException('绘画评价生成失败，未保存任何AI评价');
    }
  }

  parse(raw: string): ArtworkObservation {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) throw new BadGatewayException('视觉模型未返回合法JSON');
    const value = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const allowed = ['visibleSubject', 'colors', 'composition', 'visibleElements', 'creativeExpression', 'details', 'openQuestion'];
    if (Object.keys(value).some((key) => !allowed.includes(key))) throw new BadGatewayException('视觉模型返回了越权字段');
    const text = (key: string, max = 300) => typeof value[key] === 'string' ? value[key].trim().slice(0, max) : '';
    const list = (key: string) => Array.isArray(value[key]) ? value[key].filter((item): item is string => typeof item === 'string').map((item) => item.trim().slice(0, 80)).filter(Boolean).slice(0, 8) : [];
    const result: ArtworkObservation = {
      visibleSubject: text('visibleSubject'), colors: list('colors'), composition: text('composition'),
      visibleElements: list('visibleElements'), creativeExpression: text('creativeExpression'), details: list('details'), openQuestion: text('openQuestion'),
    };
    if (!result.visibleSubject || !result.openQuestion || UNSAFE_ARTWORK_INFERENCE.test(JSON.stringify(result)))
      throw new BadGatewayException('视觉模型输出不符合儿童安全规范');
    return result;
  }

  private toDraft(value: ArtworkObservation) {
    const parts = [
      `我看到画面里有${value.visibleSubject}。`,
      value.colors.length ? `你使用了${value.colors.join('、')}这些颜色。` : '',
      value.composition ? `画面安排上，${value.composition}。` : '',
      value.visibleElements.length ? `还能看到${value.visibleElements.join('、')}。` : '',
      value.creativeExpression ? `${value.creativeExpression}。` : '',
      value.details.length ? `细节里有${value.details.join('、')}。` : '',
      value.openQuestion,
    ];
    return parts.filter(Boolean).join('');
  }
}
