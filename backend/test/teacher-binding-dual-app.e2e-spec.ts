import { jest } from '@jest/globals';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { mkdtemp, unlink, rmdir } from 'node:fs/promises';
import { writeTestEvidence as writeFile } from './helpers/test-evidence';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { AuthModule } from '../src/auth/auth.module';
import { Administrator } from '../src/auth/entities/administrator.entity';
import { RefreshTokenSession } from '../src/auth/entities/refresh-token-session.entity';
import { Teacher } from '../src/auth/entities/teacher.entity';
import { AVATAR_ENTITIES } from '../src/avatars/avatar.module';
import { ClassroomEngagementModule } from '../src/classroom-engagement/classroom-engagement.module';
import { CLASSROOM_ENGAGEMENT_ENTITIES } from '../src/classroom-engagement/entities';
import { ClassroomParticipationModule } from '../src/classroom-participation/classroom-participation.module';
import { CLASSROOM_PARTICIPATION_ENTITIES } from '../src/classroom-participation/entities';
import { ClassroomRunModule, CLASSROOM_RUN_ENTITIES } from '../src/classroom-runs/classroom-run.module';
import { TeachingResource } from '../src/data/entities/teaching-resource.entity';
import { LessonPlanModule, LESSON_PLAN_ENTITIES } from '../src/lesson-plans/lesson-plan.module';
import { PlatformModule, PLATFORM_ENTITIES } from '../src/platform/platform.module';
import { SchoolClass } from '../src/platform/entities/school-class.entity';
import { TeacherClass } from '../src/platform/entities/teacher-class.entity';
import { RecordStatus, TeacherClassRole } from '../src/platform/platform.types';
import { ResourceModule, RESOURCE_ENTITIES } from '../src/resources/resource.module';

const tables = [
  'attendance_record', 'attendance_change_log', 'roll_call_record', 'roll_call_candidate_snapshot',
  'reward_record', 'reward_reversal', 'student_badge', 'class_growth_record', 'honor_record',
  'student_reward_record', 'class_collective_reward_record', 'student_attendance_record',
  'student_attendance_change', 'classroom_roll_call_record', 'classroom_event', 'classroom_snapshot',
  'classroom_run', 'collective_goal', 'class_growth_goal', 'teacher_class', 'audit_log',
];

async function rows(db: DataSource) {
  return Promise.all(tables.map(async table => {
    const data = await db.query(`SELECT * FROM "${table}" ORDER BY id`);
    return { table, count: data.length, digest: createHash('sha256').update(JSON.stringify(data)).digest('hex'), data };
  }));
}

async function openTestApplication(database: string, initializeSchema: boolean, journal: 'wal' | 'delete') {
  const module = await Test.createTestingModule({ imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({
      JWT_ACCESS_SECRET: 'legacy-restart-isolated-secret-long-enough', JWT_ACCESS_EXPIRES_IN: '2h',
      JWT_REFRESH_EXPIRES_IN: '30d', TEST_TEACHER_ACCOUNT: 'legacy_restart_teacher',
      TEST_TEACHER_PASSWORD: 'Teacher123!', TEST_TEACHER_NAME: '隔离验收教师',
      ARK_API_KEY: 'isolated-no-model-key', ARK_ENDPOINT_ID: 'isolated-no-model',
      CLASSROOM_SUMMARY_AI_ENABLED: 'false',
    })] }),
    TypeOrmModule.forRoot({ type: 'better-sqlite3', database, synchronize: initializeSchema,
      enableWAL: journal === 'wal', timeout: 0,
      migrationsRun: false,
      entities: [Teacher, Administrator, RefreshTokenSession, TeachingResource, ...PLATFORM_ENTITIES,
        ...RESOURCE_ENTITIES, ...LESSON_PLAN_ENTITIES, ...CLASSROOM_RUN_ENTITIES, ...AVATAR_ENTITIES,
        ...CLASSROOM_PARTICIPATION_ENTITIES, ...CLASSROOM_ENGAGEMENT_ENTITIES] }),
    AuthModule, PlatformModule, ResourceModule, LessonPlanModule, ClassroomRunModule,
    ClassroomParticipationModule, ClassroomEngagementModule,
  ] }).compile();
  const app = module.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
  return app;
}









function deferred() {
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  return { ready, release };
}
async function stage<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error('No deterministic synchronization: ' + label)), 5000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

const cases: { name: string; journal: 'wal' | 'delete' }[] = [
  { name: 'parallel-bind', journal: 'wal' }, { name: 'parallel-role', journal: 'wal' },
  ...(['wal', 'delete'] as const).flatMap(journal => [
    { name: 'bind-holds-unbind', journal }, { name: 'unbind-holds-bind', journal },
    { name: 'goal-holds-revoke', journal },
  ]),
  { name: 'revoke-before-goal-write', journal: 'wal' },
  ...['audit-bind', 'audit-unbind', 'commit-bind', 'commit-unbind'].map(name => ({ name, journal: 'wal' as const })),
];

describe('A-15 two applications / distinct SQLite connections / real HTTP', () => {
  it.each(cases)('$name ($journal)', async ({ name, journal }) => {
    const folder = await mkdtemp(join(tmpdir(), 'a15-dual-app-'));
    const database = join(folder, 'isolated.sqlite');
    const apps: INestApplication[] = [];
    const gates: ReturnType<typeof deferred>[] = [];
    const pending: Promise<unknown>[] = [];
    const timeline: Record<string, unknown>[] = [];
    const requests: { app: string; operation: string; request: unknown; status: number; body: any }[] = [];
    const snapshots: { label: string; rows: Awaited<ReturnType<typeof rows>> }[] = [];
    const failureContext: Record<string, unknown> = { name, journal, database };
    let sequence = 0;
    try {
      apps.push(await openTestApplication(database, true, journal));
      apps.push(await openTestApplication(database, false, journal));
      const [a, b] = apps.map(app => app.get(DataSource));
      const [ra, rb] = [a.createQueryRunner(), b.createQueryRunner()];
      const [ca, cb] = [(a.driver as any).databaseConnection, (b.driver as any).databaseConnection];
      expect(a).not.toBe(b); expect(ra).not.toBe(rb); expect(ca).not.toBe(cb);
      expect(a.options.database).toBe(database); expect(b.options.database).toBe(database);
      const files = await Promise.all([a.query('PRAGMA database_list'), b.query('PRAGMA database_list')]);
      expect(files[0].find((r: any) => r.name === 'main').file).toBe(files[1].find((r: any) => r.name === 'main').file);
      const modes = await Promise.all([a.query('PRAGMA journal_mode'), b.query('PRAGMA journal_mode')]);
      expect(modes).toEqual([[{ journal_mode: journal }], [{ journal_mode: journal }]]);
      const proof = { applications: 2, dataSourcesDistinct: a !== b, queryRunnersDistinct: ra !== rb,
        nativeConnectionsDistinct: ca !== cb, database, files, modes, processId: process.pid,
        processModel: 'two Nest applications, two actual connections, one Node process; not multi-process' };
      failureContext.proof = proof;
      const teacher = await a.getRepository(Teacher).findOneByOrFail({ account: 'legacy_restart_teacher' });
      await a.getRepository(Teacher).update(teacher.id, { schoolId: 'a15-synthetic-school' });
      const cls = await a.getRepository(SchoolClass).save({ schoolId: 'a15-synthetic-school', name: '合成并发班',
        grade: '小班', schoolYear: '2026', status: RecordStatus.Active });
      const hash = await bcrypt.hash('SyntheticAdmin123!', 4);
      const admin = await a.getRepository(Administrator).save({ account: 'a15_admin', passwordHash: hash,
        name: '合成双应用管理员', schoolId: 'a15-synthetic-school' });
      const existing = !['parallel-bind', 'audit-bind', 'commit-bind'].includes(name);
      if (existing) await a.getRepository(TeacherClass).save({ teacherId: teacher.id, classId: cls.id,
        role: TeacherClassRole.Assistant });
      const adminHeaders = await Promise.all(apps.map(async app => {
        const result = await request(app.getHttpServer()).post('/auth/admin/login')
          .send({ account: admin.account, password: 'SyntheticAdmin123!' }).expect(200);
        return { Authorization: 'Bearer ' + result.body.access_token };
      }));
      const teacherLogin = await request(apps[1].getHttpServer()).post('/auth/login')
        .send({ account: teacher.account, password: 'Teacher123!' }).expect(200);
      const teacherHeader = { Authorization: 'Bearer ' + teacherLogin.body.access_token };
      const before = await rows(a);
      failureContext.before = before;
      expect(await rows(b)).toEqual(before);
      const savedSnapshot = async (db: DataSource, label: string) => {
        const data = await rows(db); snapshots.push({ label, rows: data }); return data;
      };
      const send = (which: 0 | 1, operation: 'bind' | 'unbind' | 'goal', role = 'lead') => {
        const http = request(apps[which].getHttpServer());
        const path = '/classes/' + cls.id + (operation === 'bind' ? '/teachers' :
          operation === 'unbind' ? '/teachers/' + teacher.id : '/collective-goals');
        const input = operation === 'bind' ? { teacherId: teacher.id, role } :
          operation === 'goal' ? { title: '合成依赖授权目标', targetValue: 20 } : null;
        const promise = (operation === 'unbind' ? http.delete(path) : http.post(path))
          .set(operation === 'goal' ? teacherHeader : adminHeaders[which]).send(input ?? undefined).then(result => {
            requests.push({ app: which === 0 ? 'A' : 'B', operation,
              request: { method: operation === 'unbind' ? 'DELETE' : 'POST', path, body: input },
              status: result.status, body: result.body });
            timeline.push({ sequence: ++sequence, app: which === 0 ? 'A' : 'B', stage: 'HTTP response',
              operation, status: result.status });
            return result;
          });
        pending.push(promise);
        return promise;
      };
      const sqlGates: ((app: 'A' | 'B', sql: string, parameters: unknown[], when: 'before' | 'after') => Promise<void>)[] = [];
      for (const [index, runner] of [ra, rb].entries()) {
        const label = index === 0 ? 'A' : 'B';
        const original = runner.query.bind(runner);
        jest.spyOn(runner, 'query').mockImplementation(async (...args: any[]) => {
          const sql = String(args[0]).replace(/\s+/g, ' ').trim();
          const relevant = /^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)/i.test(sql) ||
            /"(teacher_class|audit_log|collective_goal)"/i.test(sql);
          const log = (when: string) => { if (relevant) timeline.push({ sequence: ++sequence, app: label,
            stage: when, sql, active: runner.isTransactionActive, depth: (runner as any).transactionDepth }); };
          log('before SQL');
          for (const hook of sqlGates) await hook(label, sql, args[1] ?? [], 'before');
          try {
            const result = await (original as any)(...args);
            log('after SQL');
            for (const hook of sqlGates) await hook(label, sql, args[1] ?? [], 'after');
            return result;
          } catch (error) {
            timeline.push({ sequence: ++sequence, app: label, stage: 'SQL/fault error', sql,
              code: (error as any)?.driverError?.code ?? (error as any)?.code, message: String((error as Error).message) });
            throw error;
          }
        });
      }
      if (name.startsWith('parallel-')) {
        const arrivals = [deferred(), deferred()]; const releases = [deferred(), deferred()];
        gates.push(...releases);
        const seen = new Set<string>();
        sqlGates.push(async (label, sql, _parameters, when) => {
          if (when === 'after' && /^SELECT/i.test(sql) && sql.includes('FROM "teacher_class"') && !seen.has(label)) {
            seen.add(label); const i = label === 'A' ? 0 : 1;
            arrivals[i].release(); await releases[i].ready;
          }
        });
        const first = send(0, 'bind', 'lead');
        const second = send(1, 'bind', 'observer');
        await stage(Promise.all(arrivals.map(g => g.ready)), 'both binding transactions read pre-write state');
        expect(ra.isTransactionActive).toBe(true); expect(rb.isTransactionActive).toBe(true);
        releases[0].release();
        expect((await stage(first, 'A first commit')).status).toBe(201);
        const committedA = await savedSnapshot(a, 'A committed while B retains earlier read snapshot');
        releases[1].release();
        expect((await stage(second, 'B stale write response')).status).toBeGreaterThanOrEqual(400);
        expect(await rows(b)).toEqual(committedA);
        sqlGates.length = 0;
        expect((await send(1, 'bind', 'observer')).status).toBe(201);
      } else if (name === 'bind-holds-unbind' || name === 'unbind-holds-bind' || name === 'goal-holds-revoke') {
        const arrived = deferred(); const release = deferred(); gates.push(release);
        let seen = false;
        const goalFirst = name === 'goal-holds-revoke';
        sqlGates.push(async (label, sql, _parameters, when) => {
          const match = goalFirst ? label === 'B' && sql.includes('INSERT INTO "collective_goal"') :
            label === 'A' && (name === 'bind-holds-unbind' ? /^(INSERT INTO|UPDATE) "teacher_class"/i.test(sql) : /^DELETE FROM "teacher_class"/i.test(sql));
          if (when === 'after' && match && !seen) { seen = true; arrived.release(); await release.ready; }
        });
        const first = goalFirst ? send(1, 'goal') : send(0, name === 'bind-holds-unbind' ? 'bind' : 'unbind');
        await stage(arrived.ready, 'first actual write owns database lock');
        const second = goalFirst ? await send(0, 'unbind') : await send(1, name === 'bind-holds-unbind' ? 'unbind' : 'bind', 'observer');
        expect(second.status).toBeGreaterThanOrEqual(400);
        const failedView = await savedSnapshot(goalFirst ? a : b, 'losing HTTP write rolled back while winner remains uncommitted');
        expect(failedView).toEqual(before);
        release.release();
        expect((await stage(first, 'first writer commit')).status).toBe(name === 'unbind-holds-bind' ? 204 : 201);
        sqlGates.length = 0;
        const retry = goalFirst ? await send(0, 'unbind') : await send(1, name === 'bind-holds-unbind' ? 'unbind' : 'bind', 'observer');
        expect(retry.status).toBe(name === 'unbind-holds-bind' ? 201 : 204);
      } else if (name === 'revoke-before-goal-write') {
        const arrived = deferred(); const release = deferred(); gates.push(release);
        let seen = false;
        sqlGates.push(async (label, sql, _parameters, when) => {
          if (label === 'B' && when === 'before' && sql.includes('INSERT INTO "collective_goal"') && !seen) {
            seen = true; arrived.release(); await release.ready;
          }
        });
        const goal = send(1, 'goal');
        await stage(arrived.ready, 'goal has read permission but not written');
        expect((await send(0, 'unbind')).status).toBe(204);
        const revoked = await savedSnapshot(a, 'real A HTTP revocation committed before goal INSERT');
        release.release();
        expect((await stage(goal, 'stale goal authorization response')).status).toBe(409);
        expect(await rows(b)).toEqual(revoked);
        sqlGates.length = 0;
        expect((await send(1, 'goal')).status).toBe(403);
      } else {
        const op = name.endsWith('bind') && !name.endsWith('unbind') ? 'bind' : 'unbind';
        if (name.startsWith('audit-')) {
          let injected = false;
          sqlGates.push(async (label, sql, parameters, when) => {
            if (label === 'A' && when === 'after' && sql.includes('INSERT INTO "audit_log"') &&
                parameters.includes('teacher_class.' + op) && !injected) {
              injected = true; throw new Error('A15 AFTER actual ' + op + ' audit INSERT');
            }
          });
        } else {
          jest.spyOn(ra, 'commitTransaction').mockImplementationOnce(async () => {
            throw new Error('A15 BEFORE actual A ' + op + ' COMMIT');
          });
        }
        expect((await send(0, op)).status).toBe(500);
        const failed = await savedSnapshot(b, 'other application observes full rollback of failed A mutation');
        expect(failed).toEqual(before);
        sqlGates.length = 0;
        expect((await send(1, op)).status).toBe(op === 'bind' ? 201 : 204);
      }
      jest.restoreAllMocks();
      const after = await rows(a);
      expect(await rows(b)).toEqual(after);
      const integrity = await Promise.all([a.query('PRAGMA integrity_check'), b.query('PRAGMA integrity_check')]);
      const foreignKeys = await Promise.all([a.query('PRAGMA foreign_key_check'), b.query('PRAGMA foreign_key_check')]);
      await writeFile(join(process.cwd(), '.tmp', 'a15-dual-' + name + '-' + journal + '.json'),
        JSON.stringify({ name, journal, proof, requests, timeline, before, snapshots, after, integrity, foreignKeys }, null, 2));
      expect(integrity).toEqual([[{ integrity_check: 'ok' }], [{ integrity_check: 'ok' }]]);
      expect(foreignKeys).toEqual([[], []]);
      const audits = after.find(t => t.table === 'audit_log')!.data.filter((r: any) =>
        !before.find(t => t.table === 'audit_log')!.data.some((old: any) => old.id === r.id));
      const binds = requests.filter(r => r.operation === 'bind' && r.status === 201);
      const unbinds = requests.filter(r => r.operation === 'unbind' && r.status === 204);
      const bindAudits = audits.filter((r: any) => r.action === 'teacher_class.bind');
      const unbindAudits = audits.filter((r: any) => r.action === 'teacher_class.unbind');
      expect(bindAudits.map((r: any) => r.target_id).sort()).toEqual(binds.map(r => String(r.body.id)).sort());
      expect(unbindAudits).toHaveLength(unbinds.length);
      for (const audit of [...bindAudits, ...unbindAudits]) expect(audit.actor_id).toBe(admin.id);
      for (const audit of unbindAudits) {
        expect(audit.target_id).toBe(String(cls.id));
        expect(JSON.parse(audit.metadata).teacherId).toBe(teacher.id);
      }
      const relations = after.find(t => t.table === 'teacher_class')!.data.filter((r: any) =>
        r.teacher_id === teacher.id && r.class_id === cls.id);
      const shouldExist = name.startsWith('parallel-') || ['unbind-holds-bind', 'audit-bind', 'commit-bind'].includes(name);
      expect(relations).toHaveLength(shouldExist ? 1 : 0);
      if (name.startsWith('parallel-') || name === 'unbind-holds-bind') expect(relations[0].role).toBe('observer');
      const goals = after.find(t => t.table === 'collective_goal')!;
      expect(goals.count).toBe(name === 'goal-holds-revoke' ? 1 : 0);
      for (const table of tables.filter(t => !['teacher_class', 'audit_log', 'collective_goal'].includes(t)))
        expect(after.find(t => t.table === table)).toEqual(before.find(t => t.table === table));
    } catch (error) {
      // Keep partial HTTP/SQL evidence even if an assertion or synchronization fails early.
      await writeFile(join(process.cwd(), '.tmp', 'a15-dual-' + name + '-' + journal + '-failure.json'),
        JSON.stringify({ ...failureContext, requests, timeline, snapshots,
          failure: { message: String((error as Error).message), stack: (error as Error).stack } }, null, 2));
      throw error;
    } finally {
      for (const gate of gates) gate.release();
      await Promise.allSettled(pending);
      jest.restoreAllMocks();
      for (const app of apps.reverse()) await app.close();
      for (const suffix of ['', '-wal', '-shm', '-journal'])
        await unlink(database + suffix).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; });
      await rmdir(folder);
    }
  }, 30000);
});

