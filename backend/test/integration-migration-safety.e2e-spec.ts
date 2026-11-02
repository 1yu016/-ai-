import { ChatSession } from '../src/data/entities/chat-session.entity';
import { ChatMessage, ChatMessageRole } from '../src/data/entities/chat-message.entity';
import { CheckIn } from '../src/data/entities/check-in.entity';
import { EmotionEvent } from '../src/data/entities/emotion-event.entity';
import { VisitorMigration } from '../src/data/entities/visitor-migration.entity';
import { LessonRun } from '../src/lesson-plans/entities/lesson-run.entity';
import { LessonRunStatus } from '../src/lesson-plans/lesson-plan.types';
import { OwnerType } from '../src/data/owner.types';
import { UNIFIED_MIGRATIONS } from '../src/migrations/unified-migrations';
import { LegacyFeatureTables2026110200033 } from '../src/migrations/202611020033-LegacyFeatureTables';
import { DataSource } from 'typeorm';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { IntegrationSchemaCompatibility2026110200032 } from '../src/migrations/202611020032-IntegrationSchemaCompatibility';
import { LessonStepActionColumnName2026101200027 } from '../src/migrations/202610120027-LessonStepActionColumnName';

describe('I1 append-only integration migration safety', () => {
  it('repairs only missing fields, retains rows, and permits repeat application', async () => {
    const db = new DataSource({ type: 'better-sqlite3', database: ':memory:' });
    await db.initialize();
    const runner = db.createQueryRunner();
    try {
      await runner.query('CREATE TABLE classroom_run (id integer PRIMARY KEY, status varchar)');
      await runner.query("INSERT INTO classroom_run VALUES (5, 'running')");
      await runner.query('CREATE TABLE student_reward_record (id integer PRIMARY KEY, student_id integer, amount integer)');
      await runner.query('INSERT INTO student_reward_record VALUES (7, 3, 2)');
      const migration = new IntegrationSchemaCompatibility2026110200032();
      await migration.up(runner);
      await migration.up(runner);
      expect(await runner.query('SELECT id,status FROM classroom_run')).toEqual([{ id: 5, status: 'running' }]);
      expect(await runner.query('SELECT id,student_id,amount,revoke_request_id FROM student_reward_record')).toEqual([{ id: 7, student_id: 3, amount: 2, revoke_request_id: null }]);
      expect(await runner.hasColumn('classroom_run', 'break_ends_at')).toBe(true);
      await expect(migration.down()).rejects.toThrow('Forward-only');
    } finally { await runner.release(); await db.destroy(); }
  });

  it('refuses ambiguous action column values rather than silently overwriting', async () => {
    const db = new DataSource({ type: 'better-sqlite3', database: ':memory:' });
    await db.initialize();
    const runner = db.createQueryRunner();
    try {
      await runner.query('CREATE TABLE lesson_step_action (id integer PRIMARY KEY, action_type varchar, actionType varchar)');
      await runner.query("INSERT INTO lesson_step_action VALUES (1, 'reward', 'roll_call')");
      await expect(new LessonStepActionColumnName2026101200027().up(runner)).rejects.toThrow('Conflicting');
      expect(await runner.query('SELECT action_type,actionType FROM lesson_step_action')).toEqual([{ action_type: 'reward', actionType: 'roll_call' }]);
    } finally { await runner.release(); await db.destroy(); }
  });

  it('retains original legacy modules with migration-created tables and preserves existing rows on repeat', async () => {
    const db = new DataSource({ type: 'better-sqlite3', database: ':memory:', synchronize: false,
      migrations: UNIFIED_MIGRATIONS, entities: [ChatSession, ChatMessage, CheckIn, EmotionEvent, VisitorMigration, LessonRun] });
    await db.initialize();
    const runner = db.createQueryRunner();
    try {
      await db.runMigrations({ transaction: 'all' });
      const owner = { ownerType: OwnerType.Teacher, ownerId: 'synthetic-owner' };
      const session = await db.getRepository(ChatSession).save({ ...owner, title: 'Legacy session', lastActiveAt: new Date() });
      await db.getRepository(ChatMessage).save({ ...owner, sessionId: session.id, role: ChatMessageRole.User, content: 'Synthetic question' });
      await db.getRepository(CheckIn).save({ ...owner, checkInAt: new Date() });
      await db.getRepository(EmotionEvent).save({ ...owner, sessionId: session.id, emotion: 'synthetic', intensity: 1 });
      await db.getRepository(VisitorMigration).save({ visitorId: 'synthetic-visitor', teacherId: 'synthetic-owner' });
      await db.getRepository(LessonRun).save({ lessonPlanId: 1, teacherId: 1, status: LessonRunStatus.Running,
        currentStepOrder: 0, lessonTitle: 'Legacy lesson', lessonObjectives: 'Preserve', ageGroup: '5-6',
        stepsSnapshot: '[]', elapsedSeconds: 12, startedAt: new Date() });
      await new LegacyFeatureTables2026110200033().up(runner);
      for (const entity of [ChatSession, ChatMessage, CheckIn, EmotionEvent, VisitorMigration, LessonRun])
        expect(await db.getRepository(entity).count()).toBe(1);
      expect((await db.getRepository(LessonRun).findOneByOrFail({ id: 1 })).elapsedSeconds).toBe(12);
      await expect(db.runMigrations({ transaction: 'all' })).resolves.toEqual([]);
    } finally { await runner.release(); await db.destroy(); }
  });

  it('explicit scripts initialize and verify a new database, repeat safely, and reject untracked schema without changing it', () => {
    const folder = mkdtempSync(join(tmpdir(), 'p5-migrate-safety-'));
    const run = (script: string, database: string) => execFileSync(process.execPath, ['-r', 'ts-node/register/transpile-only', resolve('scripts', script)], {
      cwd: process.cwd(), env: { ...process.env, DATABASE_PATH: database, DB_SYNCHRONIZE: 'false', DB_MIGRATIONS_RUN: 'false' }, encoding: 'utf8', stdio: 'pipe',
    });
    const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
    try {
      const fresh = join(folder, 'fresh.sqlite');
      expect(JSON.parse(run('migrate-database.ts', fresh)).ok).toBe(true);
      const second = JSON.parse(run('migrate-database.ts', fresh));
      expect(second.applied).toEqual([]);
      const before = hash(fresh);
      expect(JSON.parse(run('verify-migrated-database.ts', fresh)).ok).toBe(true);
      expect(hash(fresh)).toBe(before);
      const unknown = join(folder, 'untracked.sqlite');
      const db = new Database(unknown);
      db.exec("CREATE TABLE keep_me (id integer PRIMARY KEY, value text); INSERT INTO keep_me VALUES (1, 'preserve')");
      db.close();
      const original = hash(unknown);
      expect(() => run('migrate-database.ts', unknown)).toThrow();
      expect(hash(unknown)).toBe(original);
    } finally { rmSync(folder, { recursive: true, force: true }); }
  }, 30000);
});
