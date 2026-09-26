import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { AudioService, type UploadedAudioFile } from './audio.service';

function createService(values: Record<string, string> = {}) {
  const config = {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
  return new AudioService(config);
}

function audioFile(): UploadedAudioFile {
  return {
    mimetype: 'audio/mpeg',
    size: 3,
    buffer: Buffer.from('mp3'),
  };
}

describe('AudioService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('fails at startup when speech credentials are missing', () => {
    expect(() => createService()).toThrow('缺少环境变量 VOLC_API_KEY');
  });

  it('returns recognized text from the ASR API', async () => {
    global.fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('{}', {
          status: 200,
          headers: { 'X-Api-Status-Code': '20000000' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { text: '你好呀' } }), {
          status: 200,
          headers: { 'X-Api-Status-Code': '20000000' },
        }),
      );
    const service = createService({
      VOLC_API_KEY: 'api-key',
    });

    await expect(service.asr(audioFile())).resolves.toBe('你好呀');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/submit'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/query'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('rejects unsupported audio types before calling the API', async () => {
    global.fetch = jest.fn<typeof fetch>();
    const service = createService({
      VOLC_API_KEY: 'api-key',
    });
    const file = { ...audioFile(), mimetype: 'text/plain' };

    await expect(service.asr(file)).rejects.toBeInstanceOf(BadRequestException);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns an MP3 data URL from the TTS API', async () => {
    global.fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          [
            'event: 352',
            'data: {"code":0,"message":"","data":"SUQz"}',
            '',
            'event: 152',
            'data: {"code":20000000,"message":"OK","data":null}',
          ].join('\n'),
          { status: 200 },
        ),
      );
    const service = createService({
      VOLC_API_KEY: 'api-key',
    });

    await expect(service.tts('你好')).resolves.toBe(
      'data:audio/mpeg;base64,SUQz',
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v3/tts/unidirectional/sse'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Api-Key': 'api-key',
          'X-Api-Resource-Id': 'seed-tts-2.0',
        }),
      }),
    );
  });
});
