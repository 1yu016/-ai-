import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { d7BusinessFacts, D7_FACT_TABLES } from './helpers/d7-business-facts';

(process.env.D8_RECORDED_ROOT ? describe : describe.skip)('D8 saved actual-service evidence, OFFLINE only', () => {
  it('checks all nine facts plus exact legitimate login/usage differences, preserving the failed paid test', () => {
    const root = resolve(process.env.D8_RECORDED_ROOT!);
    if (!root.includes('integration-I1') || !root.includes('.tmp')) throw Error('Unsafe evidence root');
    const evidence = JSON.parse(readFileSync(join(root, 'backend-results.json'), 'utf8'));
    const browser = JSON.parse(readFileSync(join(root, 'd8-browser.json'), 'utf8'));
    expect(browser.status).toBe('passed');
    expect(evidence.authorizedRealServiceCalls).toEqual({ review: 4, generation: 2, tts: 3, asr: 0 });
    expect(evidence.realReviewTrace).toHaveLength(4);
    for (const trace of evidence.realReviewTrace) expect(trace.result).toEqual({ decision: 'allow', ageAppropriate: true, privacySafe: true, noClassroomAction: true, contextAppropriate: true });
    const before = evidence.realScenarioBefore, after = evidence.realScenarioAfter;
    expect(d7BusinessFacts(after)).toEqual(d7BusinessFacts(before));
    const differences = Object.keys(before.summaries).filter(table => JSON.stringify(before.summaries[table]) !== JSON.stringify(after.summaries[table]));
    expect(differences.sort()).toEqual(['audit_log', 'avatar_usage_log', 'refresh_token_session', 'teachers']);
    expect(after.summaries.teachers.count).toBe(before.summaries.teachers.count);
    for (const table of ['audit_log', 'avatar_usage_log', 'refresh_token_session']) expect(after.summaries[table].count).toBe(before.summaries[table].count + 1);
    const db = new Database(join(root, 'acceptance.sqlite'), { readonly: true, fileMustExist: true });
    try {
      expect(db.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
      expect(db.pragma('foreign_key_check')).toEqual([]);
      for (const table of D7_FACT_TABLES) {
        const rows = db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all();
        expect({ count: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') }).toEqual(after.summaries[table]);
      }
      expect(db.prepare('SELECT action FROM audit_log ORDER BY id DESC LIMIT 1').get()).toEqual({ action: 'auth.login' });
      const events = browser.timeline as Array<{ stage: string; atMs: number; durationMs?: number }>;
      const starts = events.filter(e => e.stage === 'submitted');
      const measurements = starts.map((start, index) => {
        const next = starts[index + 1]?.atMs ?? Infinity;
        const span = events.filter(e => e.atMs >= start.atMs && e.atMs < next);
        const playing = span.find(e => e.stage === 'media:playing')!;
        const server = Object.fromEntries(span.filter(e => e.stage.startsWith('server:')).map(e => [e.stage.slice(7), e.durationMs]));
        return { mode: index ? 'followup' : 'first', firstPlayingMs: playing.atMs - start.atMs, server, tts: span.filter(e => e.stage === 'tts-ready').map(e => e.durationMs), avatarAfterPlayingMs: span.find(e => e.stage === 'avatar-speaking')!.atMs - playing.atMs, completePlayingMs: span.find(e => e.stage === 'playback-complete') ? span.find(e => e.stage === 'playback-complete')!.atMs - start.atMs : null };
      });
      writeFileSync(join(root, 'd8-offline-verification.json'), JSON.stringify({ scope: 'offline verification of saved real-service browser run, NOT another paid run', facts: D7_FACT_TABLES, differences, integrity: 'ok', measurements, interrupt: events.find(e => e.stage === 'interrupt-complete') }, null, 2));
    } finally { db.close(); }
  });
});
