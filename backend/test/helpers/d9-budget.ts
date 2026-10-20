import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

export function d9Charge(kind: 'review' | 'generation' | 'tts', characters = 0) {
  if (process.env.D9_REAL_SERVICE_APPROVED !== '16-reviews-2-generation-6-tts-600-chars-no-asr') throw Error('D9_AUTHORIZATION_REQUIRED');
  const root = resolve(process.env.D9_BUDGET_ROOT ?? '');
  if (!root.includes('integration-I1') || !root.includes('.tmp')) throw Error('D9_BUDGET_ROOT_UNSAFE');
  mkdirSync(root, { recursive: true });
  const file = join(root, 'budget.json');
  const counts = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { review: 0, generation: 0, tts: 0, characters: 0 };
  if (counts[kind] >= { review: 16, generation: 2, tts: 6 }[kind] || counts.characters + characters > 600) throw Error('D9_AUTHORIZED_BUDGET_EXHAUSTED');
  counts[kind]++; counts.characters += characters;
  // Single benchmark/test worker only. This ledger is not a multi-process billing lock.
  writeFileSync(file, JSON.stringify(counts, null, 2));
}
