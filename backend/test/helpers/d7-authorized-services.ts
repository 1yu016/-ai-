import { ConfigService } from '@nestjs/config';
import { parseEnv } from 'node:util';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AiService } from '../../src/ai/ai.service';
import { AudioService, type UploadedAudioFile } from '../../src/ai/audio.service';
import { d9Charge } from './d9-budget';

/** Explicit opt-in and a hard logical-call budget. Never prints or copies credential values. */
export function d7AuthorizedServices() {
  const d8 = process.env.D8_REAL_SERVICE_APPROVED === 'two-questions-four-reviews-four-tts-no-asr';
  const d9 = process.env.D9_REAL_SERVICE_APPROVED === '16-reviews-2-generation-6-tts-600-chars-no-asr';
  if (!d8 && !d9 && process.env.D7_REAL_SERVICE_APPROVED !== 'synthetic-budget-v1') return null;
  const source = parseEnv(readFileSync(resolve('.env'), 'utf8'));
  const keys = ['ARK_API_KEY', 'ARK_ENDPOINT_ID', 'VOLC_API_KEY', 'VOLC_TTS_RESOURCE_ID', 'VOLC_TTS_VOICE_TYPE'];
  const values = Object.fromEntries(keys.filter(key => source[key]).map(key => [key, source[key]]));
  const config = new ConfigService({ ...values, AI_REQUEST_TIMEOUT_MS: '30000' });
  const ai = new AiService(config), audio = new AudioService(config);
  const previousRoot = !d8 && process.env.D7_REAL_REUSE_FROM ? resolve(process.env.D7_REAL_REUSE_FROM) : null;
  if (previousRoot && (!previousRoot.includes('integration-I1') || !previousRoot.includes('.tmp'))) throw Error('Unsafe reuse path');
  const previous = previousRoot ? JSON.parse(readFileSync(resolve(previousRoot, 'backend-results.json'), 'utf8')) : null;
  const calls = { review: 0, generation: 0, tts: 0, asr: 0, ...previous?.authorizedRealServiceCalls };
  const reviewTrace: unknown[] = [];
  const charge = (key: keyof typeof calls, limit: number) => { if (calls[key] >= limit) throw Error('D7_AUTHORIZED_TEST_BUDGET_EXHAUSTED'); calls[key]++; };
  return {
    calls,
    reviewTrace,
    ai: {
      reviewClassroomContent: async (input: Record<string, unknown>, signal: AbortSignal) => {
        if (d9) d9Charge('review'); charge('review', 4); const started = Date.now();
        try {
          const result = await ai.reviewClassroomContent(input, signal);
          reviewTrace.push({ stage: input.stage, durationMs: Date.now() - started, result }); return result;
        } catch {
          reviewTrace.push({ stage: input.stage, durationMs: Date.now() - started, error: 'REVIEW_UNAVAILABLE_OR_ABORTED' }); throw Error('REVIEW_UNAVAILABLE_OR_ABORTED');
        }
      },
      streamClassroomDialogue: async function* (...args: Parameters<AiService['streamClassroomDialogue']>) { if (d9) d9Charge('generation'); charge('generation', 2); yield* ai.streamClassroomDialogue(...args); },
    },
    audio: {
      tts: (text: string, signal?: AbortSignal) => { if (d9) d9Charge('tts', text.length); charge('tts', d8 ? 4 : 3); return audio.tts(text, signal); },
      asr: (file: UploadedAudioFile) => { charge('asr', d8 ? 0 : 1); return audio.asr(file); },
    },
  };
}
