import Database from 'better-sqlite3';
import { isAbsolute } from 'node:path';
import { UNIFIED_MIGRATIONS } from '../src/migrations/unified-migrations';

// Intentionally does not bootstrap Nest, seed users, run jobs, or execute migrations.
const databasePath = process.env.DATABASE_PATH?.trim();
if (!databasePath || !isAbsolute(databasePath))
  throw new Error('DATABASE_PATH must be an explicit absolute SQLite path');
const database = new Database(databasePath, { readonly: true, fileMustExist: true });
try {
  const integrity = database.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') throw new Error('Database integrity check failed');
  const foreignKeys = database.pragma('foreign_key_check') as unknown[];
  if (foreignKeys.length) throw new Error('Database foreign key violations found');
  const ledger = database.prepare('SELECT name FROM migrations ORDER BY id').all() as Array<{ name: string }>;
  const names = new Set(ledger.map((row) => row.name));
  const pending = UNIFIED_MIGRATIONS.map((migration) => migration.name).filter((name) => !names.has(name));
  if (pending.length) throw new Error('Pending migrations: ' + pending.join(', '));
  for (const [table, expected] of Object.entries({
    student_question_record: ['answer_text', 'answer_status', 'answer_source', 'qa_session_id'],
    lesson_step_action: ['actionType'],
    classroom_run: ['break_started_at', 'break_ends_at'],
    student_reward_record: ['revoke_request_id', 'revoked_at'],
  })) {
    const columns = database.prepare('PRAGMA table_info("' + table + '")').all() as Array<{ name: string }>;
    if (expected.some((name) => !columns.some((column) => column.name === name)))
      throw new Error('Missing expected columns in ' + table);
  }
  console.log(JSON.stringify({ ok: true, databasePath, integrity, migrationCount: ledger.length, foreignKeyViolations: foreignKeys.length }));
} finally {
  database.close();
}
