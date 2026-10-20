import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { d7BusinessFacts, D7_FACT_TABLES } from './helpers/d7-business-facts';

(process.env.D7_RECORDED_ROOT ? describe : describe.skip)('D7 recorded real-service evidence (OFFLINE, no paid calls)', () => {
  it('preserves all canonical facts, validates actual SQLite and strict reviewed frames, explicitly accounts for login writes', () => {
    const root = resolve(process.env.D7_RECORDED_ROOT!);
    if (!root.includes('integration-I1') || !root.includes('.tmp')) throw Error('Unsafe evidence root');
    const evidence = JSON.parse(readFileSync(join(root, 'backend-results.json'), 'utf8'));
    const browser = JSON.parse(readFileSync(join(root, 'd7-real-browser.json'), 'utf8'));
    expect(browser.status).toBe('passed');
    expect(evidence.realReviewTrace).toHaveLength(2);
    for (const item of evidence.realReviewTrace) expect(item.result).toEqual({ decision: 'allow', ageAppropriate: true, privacySafe: true, noClassroomAction: true, contextAppropriate: true });
    expect(evidence.realDialogueFrames.at(-1)).toMatchObject({ type: 'done', route: 'question' });
    expect(evidence.authorizedRealServiceCalls).toEqual({ review: 4, generation: 1, tts: 3, asr: 1 });
    expect(d7BusinessFacts(evidence.final)).toEqual(d7BusinessFacts(evidence.baseline));
    expect(browser.audio.events.some((event: { kind: string }) => event.kind === 'playing')).toBe(true);
    expect(browser.audio.final.every((audio: { paused: boolean }) => audio.paused)).toBe(true);
    const database = new Database(join(root, 'acceptance.sqlite'), { readonly: true, fileMustExist: true });
    try {
      const integrity = database.pragma('integrity_check'), foreignKeys = database.pragma('foreign_key_check');
      expect(integrity).toEqual([{ integrity_check: 'ok' }]); expect(foreignKeys).toEqual([]);
      for (const table of D7_FACT_TABLES) {
        const rows = database.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all();
        expect({ count: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') }).toEqual(evidence.final.summaries[table]);
      }
      const differences = Object.keys(evidence.final.summaries).filter(table => JSON.stringify(evidence.final.summaries[table]) !== JSON.stringify(evidence.baseline.summaries[table]));
      expect(differences.sort()).toEqual(['audit_log', 'avatar_usage_log', 'lesson_plan_version', 'refresh_token_session', 'teachers'].sort());
      const audits = database.prepare('SELECT * FROM audit_log ORDER BY id').all();
      writeFileSync(join(root, 'd7-offline-verification.json'), JSON.stringify({ scope: 'offline recorded-live evidence; not a fresh remote-service run', integrity, foreignKeys, factsUnchanged: D7_FACT_TABLES, differences, audits, note: 'lesson_plan_version is synthetic fixture preparation; other differences are browser login and Avatar resolve, NOT dialogue facts' }, null, 2));
    } finally { database.close(); }
  });
});
