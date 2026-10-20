import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { d7BusinessFacts, D7_FACT_TABLES } from './helpers/d7-business-facts';

(process.env.D9_EVIDENCE_ROOT ? describe : describe.skip)('D9 recorded database/performance verification, OFFLINE not browser acceptance', () => {
  it('verifies all canonical facts and extracts measured evidence without converting the failed browser run to passed', () => {
    const root = resolve(process.env.D9_EVIDENCE_ROOT!);
    if (!root.includes('integration-I1') || !root.includes('.tmp')) throw Error('Unsafe evidence root');
    const evidence = JSON.parse(readFileSync(join(root, 'backend-results.json'), 'utf8'));
    const browser = JSON.parse(readFileSync(join(root, 'd8-browser.json'), 'utf8'));
    const before = evidence.realScenarioBefore, after = evidence.realScenarioAfter;
    expect(d7BusinessFacts(after)).toEqual(d7BusinessFacts(before));
    const differences = Object.keys(before.summaries).filter(k => JSON.stringify(before.summaries[k]) !== JSON.stringify(after.summaries[k]));
    expect(differences.sort()).toEqual(['audit_log', 'avatar_usage_log', 'refresh_token_session', 'teachers']);
    expect(after.summaries.teachers.count).toBe(before.summaries.teachers.count);
    for (const table of ['audit_log', 'avatar_usage_log', 'refresh_token_session']) expect(after.summaries[table].count).toBe(before.summaries[table].count + 1);
    const db = new Database(join(root, 'acceptance.sqlite'), { readonly: true, fileMustExist: true });
    try {
      expect(db.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]); expect(db.pragma('foreign_key_check')).toEqual([]);
      for (const table of D7_FACT_TABLES) {
        const rows = db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all();
        expect({ count: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') }).toEqual(after.summaries[table]);
      }
      const timeline = browser.timeline as Array<{ stage: string; atMs: number; durationMs?: number }>;
      const at = (stage: string) => timeline.find(e => e.stage === stage)!.atMs;
      expect(timeline.some(e => e.stage === 'media:playing')).toBe(true);
      writeFileSync(join(root, 'd9-verification.json'), JSON.stringify({ scope: 'OFFLINE database and recorded first-play evidence, NOT another browser/paid run', browserStatus: browser.status, browserFailure: browser.failure, firstPlayingMs: at('media:playing') - at('submitted'), completePlayingMs: at('playback-complete') - at('submitted'), firstServerMetrics: Object.fromEntries(timeline.filter(e => e.stage.startsWith('server:')).map(e => [e.stage.slice(7), e.durationMs])), firstTtsMs: timeline.find(e => e.stage === 'tts-ready')?.durationMs, facts: D7_FACT_TABLES, differences, integrity: 'ok', followup: 'failed in original browser before HTTP; local routing fix separately tested; no fresh paid rerun' }, null, 2));
    } finally { db.close(); }
  });
});
