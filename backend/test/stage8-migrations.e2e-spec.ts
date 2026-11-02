import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { UNIFIED_MIGRATIONS } from '../src/migrations/unified-migrations';

const childQaMigrations = new Set([
  'ChildQaAnswerFields2026101200026',
  'LessonStepActionColumnName2026101200027',
  'ChildQaLessonConfig2026101200028',
  'ChildQaCommandTypes2026101200029',
  'ChildQaAnswerColumnLengths2026101200030',
  'StudentQuestionIndexes2026101200031',
  'IntegrationSchemaCompatibility2026110200032',
  'LegacyFeatureTables2026110200033',
]);

function openDataSource(database: string, migrations = UNIFIED_MIGRATIONS) {
  return new DataSource({
    type: 'better-sqlite3',
    database,
    synchronize: false,
    migrationsRun: false,
    migrations,
  });
}

describe('Stage 8 database migrations', () => {
  it('initializes the complete schema from an empty database and is repeatable', async () => {
    const dataSource = openDataSource(':memory:');
    await dataSource.initialize();
    try {
      const firstRun = await dataSource.runMigrations({ transaction: 'all' });
      expect(firstRun.map((item) => item.name)).toEqual(expect.arrayContaining([...childQaMigrations]));
      for (const table of ['student_question_record', 'student_artwork_record', 'classroom_summary_draft', 'classroom_summary'])
        expect(await dataSource.query(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [table])).toHaveLength(1);
      const questionColumns = await dataSource.query('PRAGMA table_info("student_question_record")') as Array<{ name: string }>;
      expect(questionColumns.map((column) => column.name)).toEqual(expect.arrayContaining(['answer_text', 'answer_status', 'answer_source', 'qa_session_id']));
      const actionColumns = await dataSource.query('PRAGMA table_info("lesson_step_action")') as Array<{ name: string }>;
      expect(actionColumns.map((column) => column.name)).toContain('actionType');
      expect(actionColumns.map((column) => column.name)).not.toContain('action_type');
      await expect(dataSource.runMigrations({ transaction: 'all' })).resolves.toEqual([]);
      expect(await dataSource.query('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    } finally {
      await dataSource.destroy();
    }
  });

  it('upgrades a pre-child-QA Stage 8 database without losing questions, artwork, summaries, or commands', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'stage8-migration-'));
    const databasePath = join(folder, 'legacy.sqlite');
    // This fixture represents the pre-QA Stage 8 release.
    const preQaMigrations = UNIFIED_MIGRATIONS.filter((migration) => !childQaMigrations.has(migration.name));
    const legacy = openDataSource(databasePath, preQaMigrations);
    try {
      await legacy.initialize();
      await legacy.runMigrations({ transaction: 'all' });
      await legacy.query('PRAGMA foreign_keys=OFF');
      await legacy.query(`INSERT INTO student_question_record (id, class_id, classroom_run_id, asr_raw_text, question_text, is_anonymous, teacher_id, request_id, request_hash) VALUES (41, 7, 9, '种子怎么发芽', '种子怎么发芽？', 0, 3, 'legacy-q-1', 'hash-q')`);
      await legacy.query(`INSERT INTO student_artwork_record (id, class_id, classroom_run_id, teacher_id, storage_key, mime_type, original_name) VALUES (51, 7, 9, 3, 'legacy.png', 'image/png', 'legacy.png')`);
      await legacy.query(`INSERT INTO classroom_summary_draft (id, classroom_run_id, teacher_id, classroom_summary, participation, source, status) VALUES (61, 9, 3, '旧总结草稿', '参与良好', 'safe_rules', 'pending')`);
      await legacy.query(`INSERT INTO classroom_summary (id, classroom_run_id, draft_id, teacher_id, classroom_summary, participation, confirmed_at) VALUES (71, 9, 61, 3, '旧正式总结', '参与良好', datetime('now'))`);
      await legacy.query(`INSERT INTO classroom_operation_record (id, request_id, classroom_run_id, request_hash, source, operation, operator_type, operator_id, device_id, expected_version, status) VALUES (81, 'legacy-op-1', 9, 'hash-op', 'teacher_panel', 'next_step', 'teacher', 3, 4, 2, 'success')`);
      await legacy.query(`INSERT INTO lesson_step_action (id, step_id, "action_type", action_name, sort_order) VALUES (91, 1, 'reward', '旧奖励', 0)`);
    } finally {
      if (legacy.isInitialized) await legacy.destroy();
    }

    const upgraded = openDataSource(databasePath);
    try {
      await upgraded.initialize();
      const applied = await upgraded.runMigrations({ transaction: 'all' });
      expect(applied.map((item) => item.name)).toEqual(expect.arrayContaining([...childQaMigrations]));
      expect(await upgraded.query('SELECT id, question_text, answer_text FROM student_question_record WHERE id=41')).toEqual([
        { id: 41, question_text: '种子怎么发芽？', answer_text: null },
      ]);
      expect(await upgraded.query('SELECT id, storage_key FROM student_artwork_record WHERE id=51')).toEqual([{ id: 51, storage_key: 'legacy.png' }]);
      expect(await upgraded.query('SELECT id, classroom_summary FROM classroom_summary_draft WHERE id=61')).toEqual([{ id: 61, classroom_summary: '旧总结草稿' }]);
      expect(await upgraded.query('SELECT id, classroom_summary FROM classroom_summary WHERE id=71')).toEqual([{ id: 71, classroom_summary: '旧正式总结' }]);
      expect(await upgraded.query('SELECT id, operation FROM classroom_operation_record WHERE id=81')).toEqual([{ id: 81, operation: 'next_step' }]);
      expect(await upgraded.query('SELECT id, "actionType" FROM lesson_step_action WHERE id=91')).toEqual([{ id: 91, actionType: 'reward' }]);
      await expect(upgraded.runMigrations({ transaction: 'all' })).resolves.toEqual([]);
      expect(await upgraded.query('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    } finally {
      if (upgraded.isInitialized) await upgraded.destroy();
      await rm(folder, { recursive: true, force: true });
    }
  });
});
