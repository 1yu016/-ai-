import { jest } from '@jest/globals';
import { enterTeachingFixture } from './helpers/teaching-phase-fixture';
import { JwtService } from '@nestjs/jwt';
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
import { PlatformAccessService } from '../src/platform/platform-access.service';
import { DataSource, EntityManager } from 'typeorm';
import { Worker } from 'node:worker_threads';
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
import { ClassroomRunStatus } from '../src/classroom-runs/classroom-run.types';
import { ClassroomRun } from '../src/classroom-runs/entities/classroom-run.entity';
import { TeachingResource } from '../src/data/entities/teaching-resource.entity';
import { LessonPlanModule, LESSON_PLAN_ENTITIES } from '../src/lesson-plans/lesson-plan.module';
import { LessonPlan } from '../src/lesson-plans/entities/lesson-plan.entity';
import { LessonAgeGroup, LessonPlanStatus } from '../src/lesson-plans/lesson-plan.types';
import { PlatformModule, PLATFORM_ENTITIES } from '../src/platform/platform.module';
import { SchoolClass } from '../src/platform/entities/school-class.entity';
import { TeacherClass } from '../src/platform/entities/teacher-class.entity';
import { Student } from '../src/platform/entities/student.entity';
import { Classroom } from '../src/platform/entities/classroom.entity';
import { Device } from '../src/platform/entities/device.entity';
import { DeviceStatus, DeviceType, RecordStatus, TeacherClassRole } from '../src/platform/platform.types';
import { ResourceModule, RESOURCE_ENTITIES } from '../src/resources/resource.module';

const tables = [
  'attendance_record', 'attendance_change_log', 'roll_call_record', 'roll_call_candidate_snapshot',
  'reward_record', 'reward_reversal', 'student_badge', 'class_growth_record', 'honor_record',
  'student_reward_record', 'class_collective_reward_record', 'student_attendance_record',
  'student_attendance_change', 'classroom_roll_call_record', 'classroom_event', 'classroom_snapshot',
  'classroom_run', 'collective_goal', 'class_growth_goal',
];

async function rows(db: DataSource) {
  return Promise.all(tables.map(async table => {
    const data = await db.query(`SELECT * FROM "${table}" ORDER BY id`);
    return { table, count: data.length, digest: createHash('sha256').update(JSON.stringify(data)).digest('hex'), data };
  }));
}

async function openTestApplication(database: string, initializeSchema: boolean) {
  const module = await Test.createTestingModule({ imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({
      JWT_ACCESS_SECRET: 'legacy-restart-isolated-secret-long-enough', JWT_ACCESS_EXPIRES_IN: '2h',
      JWT_REFRESH_EXPIRES_IN: '30d', TEST_TEACHER_ACCOUNT: 'legacy_restart_teacher',
      TEST_TEACHER_PASSWORD: 'Teacher123!', TEST_TEACHER_NAME: '隔离验收教师',
      ARK_API_KEY: 'isolated-no-model-key', ARK_ENDPOINT_ID: 'isolated-no-model',
      CLASSROOM_SUMMARY_AI_ENABLED: 'false',
    })] }),
    TypeOrmModule.forRoot({ type: 'better-sqlite3', database, synchronize: initializeSchema,
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






describe('A-09 legacy goal authorization transaction', () => {
  it.each(['normal', 'unauthorized', 'preflight-revoke', 'insert-revoke', 'create-before-revoke',
    'late-insert-failure', 'teacher-admin', 'admin-cross-school', 'administrator-user',
    'after-complete', 'wal-revoke-first', 'wal-create-first', 'rollback-create-first'])('%s', async scenario => {
    const folder = await mkdtemp(join(tmpdir(), 'a09-goal-auth-'));
    const database = join(folder, 'isolated.sqlite');
    let app: INestApplication | undefined;
    let worker: Worker | undefined;
    try {
      app = await openTestApplication(database, true);
      const db = app.get(DataSource);
      expect(db.options.database).toBe(database);
      const teacher = await db.getRepository(Teacher).findOneByOrFail({ account: 'legacy_restart_teacher' });
      await db.getRepository(Teacher).update(teacher.id, { schoolId: 'isolated-restart' });
      const cls = await db.getRepository(SchoolClass).save({ schoolId: 'isolated-restart', name: '隔离班',
        grade: '小班', ageRange: '3-4', schoolYear: '2026', status: RecordStatus.Active });
      await db.getRepository(TeacherClass).save({ teacherId: teacher.id, classId: cls.id, role: TeacherClassRole.Lead });
      const _students = await db.getRepository(Student).save([
        { classId: cls.id, studentNo: 'ISOLATED-1', name: '隔离一', status: RecordStatus.Active },
        { classId: cls.id, studentNo: 'ISOLATED-2', name: '隔离二', status: RecordStatus.Active },
      ]);
      const classroom = await db.getRepository(Classroom).save({ schoolId: 'isolated-restart', name: '隔离教室', status: RecordStatus.Active });
      const device = await db.getRepository(Device).save({ deviceCode: 'ISOLATED-RECEIPT-SCREEN', schoolId: 'isolated-restart',
        name: '隔离大屏', type: DeviceType.ClassroomScreen, status: DeviceStatus.Offline });
      const plan = await db.getRepository(LessonPlan).save({ teacherId: teacher.id, schoolId: 'isolated-restart',
        title: '隔离持久回执', theme: '事务验收', ageGroup: LessonAgeGroup.ThreeToFour,
        objectives: '只测试，不调用AI', estimatedMinutes: 10, status: LessonPlanStatus.Draft, version: 1 });
      // Isolated fixture only. Classroom lifecycle APIs are regression-tested elsewhere.
      const run = await db.getRepository(ClassroomRun).save({ lessonPlanId: plan.id, lessonPlanVersion: 1,
        teacherId: teacher.id, classId: cls.id, classroomId: classroom.id, deviceId: device.id,
        title: plan.title, status: ClassroomRunStatus.Running, startedAt: new Date(), currentStepIndex: 0, version: 1 });

        const token = (await request(app.getHttpServer()).post('/auth/login')
          .send({ account: teacher.account, password: 'Teacher123!' }).expect(200)).body.access_token;
        const auth = { Authorization: `Bearer ${token}` };
        const other = await db.getRepository(Teacher).save({ account: 'other_synthetic_teacher',
          passwordHash: 'not-used-for-login', name: '隔离无权教师', schoolId: 'other-synthetic-school' });
        const otherToken = app.get(JwtService).sign({ sub: other.id, userType: 'teacher', role: 'teacher', tokenVersion: 0 });
        const otherAuth = { Authorization: `Bearer ${otherToken}` };
      await enterTeachingFixture(app, run.id);



      const path = '/classes/' + cls.id + '/collective-goals';
      const input = { title: '合成授权目标', description: '权限事务专项', targetValue: 20 };
      await request(app.getHttpServer()).post(path).set(auth).send({ ...input, title: '原有目标不应被归档' }).expect(201);
      let chosenAuth = auth;
      if (scenario === 'teacher-admin' || scenario === 'admin-cross-school') {
        await db.getRepository(TeacherClass).delete({ teacherId: teacher.id, classId: cls.id });
        await db.getRepository(Teacher).update(teacher.id, { role: 'admin' as any,
          schoolId: scenario === 'admin-cross-school' ? 'different-school' : 'isolated-restart' });
        chosenAuth = { Authorization: 'Bearer ' + app.get(JwtService).sign({
          sub: teacher.id, userType: 'teacher', role: 'admin', tokenVersion: 0,
          schoolId: scenario === 'admin-cross-school' ? 'different-school' : 'isolated-restart',
        }) };
      }
      if (scenario === 'administrator-user') {
        // Preserve requireTeacher: administrator account type never gained this teacher-only endpoint.
        const service = app.get((await import('../src/classroom-engagement/classroom-engagement.service')).ClassroomEngagementService);
        await expect(service.createGoal({ sub: teacher.id, userType: 'administrator', role: 'admin' } as any, cls.id, input))
          .rejects.toThrow('该操作仅限教师');
      }
      if (scenario === 'after-complete') {
        await request(app.getHttpServer()).post('/classroom-runs/' + run.id + '/complete').set(auth)
          .send({ requestId: 'a09-complete', deviceId: device.id, version: 1 }).expect(201);
      }
      if (['wal-revoke-first', 'wal-create-first', 'rollback-create-first'].includes(scenario)) {
        if (scenario.startsWith('wal-')) await db.query('PRAGMA journal_mode = WAL');
        expect(await db.query('PRAGMA journal_mode')).toEqual([{ journal_mode: scenario.startsWith('wal-') ? 'wal' : 'delete' }]);
        worker = new Worker(`
          const { parentPort, workerData } = require('node:worker_threads');
          const DB = require(workerData.modulePath);
          const db = new DB(workerData.database, { timeout: 0 });
          parentPort.on('message', () => {
            try {
              const result = db.prepare('DELETE FROM teacher_class WHERE teacher_id=? AND class_id=?')
                .run(workerData.teacherId, workerData.classId);
              parentPort.postMessage({ changes: result.changes });
            } catch (error) { parentPort.postMessage({ code: error.code }); }
          });
          parentPort.postMessage({ ready: true });
        `, { eval: true, workerData: { modulePath: join(process.cwd(), 'node_modules/better-sqlite3'),
          database, teacherId: teacher.id, classId: cls.id } });
        await new Promise<void>((resolve, reject) => { worker!.once('message', () => resolve()); worker!.once('error', reject); });
      }
      const revokeOnWorker = () => new Promise<any>((resolve, reject) => {
        worker!.once('message', resolve); worker!.once('error', reject); worker!.postMessage('revoke');
      });
      const before = await rows(db);
      if (scenario === 'preflight-revoke') {
        const access = app.get(PlatformAccessService);
        const original = access.requireClassAccess.bind(access);
        jest.spyOn(access, 'requireClassAccess').mockImplementation(async (...args) => {
          const result = await original(...args);
          await db.getRepository(TeacherClass).delete({ teacherId: teacher.id, classId: cls.id });
          return result;
        });
      }
      const competition: unknown[] = [];
      const originalQuery = EntityManager.prototype.query;
      if (['insert-revoke', 'late-insert-failure', 'wal-revoke-first', 'wal-create-first', 'rollback-create-first'].includes(scenario)) {
        jest.spyOn(EntityManager.prototype, 'query').mockImplementation(async function(this: EntityManager, ...args: any[]) {
          const guardedInsert = String(args[0]).includes('INSERT INTO "collective_goal"');
          if (guardedInsert && scenario === 'insert-revoke')
            await db.getRepository(TeacherClass).delete({ teacherId: teacher.id, classId: cls.id });
          if (guardedInsert && scenario === 'wal-revoke-first') {
            const result = await revokeOnWorker(); competition.push(result); expect(result.changes).toBe(1);
          }
          const result = await (originalQuery as any).apply(this, args);
          if (guardedInsert && scenario === 'late-insert-failure') throw new Error('A09 AFTER actual guarded INSERT');
          if (guardedInsert && scenario.endsWith('-create-first')) {
            const blocked = await revokeOnWorker(); competition.push(blocked);
            expect(blocked.code).toMatch(/^SQLITE_BUSY/);
          }
          return result;
        });
      }
      const response = scenario === 'administrator-user' ? { status: 403, body: { directServiceAssertion: true } } :
        await request(app.getHttpServer()).post(path).set(scenario === 'unauthorized' ? otherAuth : chosenAuth).send(input);
      jest.restoreAllMocks();
      const committed = await rows(db);
      if (scenario === 'create-before-revoke')
        await db.getRepository(TeacherClass).delete({ teacherId: teacher.id, classId: cls.id });
      if (scenario.endsWith('-create-first')) {
        const retry = await revokeOnWorker(); competition.push(retry); expect(retry.changes).toBe(1);
      }
      if (scenario === 'wal-revoke-first')
        await request(app.getHttpServer()).post(path).set(auth).send(input).expect(403);
      const after = await rows(db);
      const integrity = await db.query('PRAGMA integrity_check');
      const foreignKeys = await db.query('PRAGMA foreign_key_check');
      await writeFile(join(process.cwd(), '.tmp', (process.env.GOAL_TEST_EVIDENCE_PREFIX || 'a09v2') + '-goal-' + scenario + '.json'),
        JSON.stringify({ scenario, isolatedDatabase: database, input, response: { status: response.status, body: response.body },
          before, committed, after, competition, relations: await db.getRepository(TeacherClass).find(),
          integrity, foreignKeys }, null, 2));
      const denied = ['unauthorized', 'preflight-revoke', 'insert-revoke', 'admin-cross-school', 'administrator-user'].includes(scenario);
      expect(response.status).toBe(denied ? 403 : scenario === 'late-insert-failure' ? 500 :
        scenario === 'wal-revoke-first' ? 409 : 201);
      expect(integrity).toEqual([{ integrity_check: 'ok' }]);
      expect(foreignKeys).toEqual([]);
      if (denied || scenario === 'late-insert-failure' || scenario === 'wal-revoke-first') {
        expect(committed).toEqual(before);
      } else {
        expect(after.find(t => t.table === 'collective_goal')!.count).toBe(2);
        expect(after.find(t => t.table === 'collective_goal')!.data[0])
          .toEqual(before.find(t => t.table === 'collective_goal')!.data[0]);
        for (const table of tables.filter(t => t !== 'collective_goal'))
          expect(after.find(t => t.table === table)).toEqual(before.find(t => t.table === table));
      }
    } finally {
      jest.restoreAllMocks();
      await worker?.terminate();
      await app?.close();
      for (const suffix of ['', '-wal', '-shm', '-journal'])
        await unlink(database + suffix).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; });
      await rmdir(folder);
    }
  }, 30000);
});

