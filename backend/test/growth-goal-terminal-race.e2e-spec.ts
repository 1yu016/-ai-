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
import { StudentRewardService } from '../src/classroom-runs/student-reward.service';
import { ClassroomEvent } from '../src/classroom-runs/entities/classroom-event.entity';
import { ClassroomSnapshotService } from '../src/classroom-runs/classroom-snapshot.service';
import { ClassroomBusinessReceiptService } from '../src/classroom-runs/classroom-business-receipt.service';
import { DataSource, Repository } from 'typeorm';
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




describe('A-06 growth goal terminal boundary', () => {
  it.each(['normal', 'unauthorized', 'terminal-entry', 'terminal-race'])('%s', async scenario => {
    const folder = await mkdtemp(join(tmpdir(), 'a06-growth-goal-'));
    const database = join(folder, 'isolated.sqlite');
    let app: INestApplication | undefined;
    let release: (() => void) | undefined;
    let blocker: Promise<unknown> | undefined;
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

      const path = '/classroom-runs/' + run.id + '/growth-goals';
      const input = { requestId: 'a06-' + scenario, title: '合成课堂目标', targetPoints: 20 };
      const initial = await request(app.getHttpServer()).post(path).set(auth)
        .send({ ...input, requestId: 'a06-baseline' }).expect(201);
      const before = await rows(db);
      let response;
      let terminalCommitted: Awaited<ReturnType<typeof rows>> | undefined;
      let preflightObserved: unknown;
      if (scenario === 'terminal-race') {
        const snapshots = app.get(ClassroomSnapshotService);
        let entered!: () => void;
        const enteredGate = new Promise<void>(resolve => { entered = resolve; });
        const gate = new Promise<void>(resolve => { release = resolve; });
        blocker = snapshots.transactionRequired(async manager => {
          entered();
          await gate;
          // Test-only competing terminal commit, not a replacement complete API.
          await manager.getRepository(ClassroomRun).update(run.id, {
            status: ClassroomRunStatus.Completed, version: 2, endedAt: new Date(),
          });
        });
        await enteredGate;
        let queued!: () => void;
        const queuedGoal = new Promise<void>(resolve => { queued = resolve; });
        const original = snapshots.transactionRequired.bind(snapshots);
        const spy = jest.spyOn(snapshots, 'transactionRequired').mockImplementation(work => {
          queued(); // createGrowthGoal has already completed ownedRun/assertActive.
          return original(work);
        });
        const pending = request(app.getHttpServer()).post(path).set(auth).send(input).then(result => result);
        await queuedGoal;
        preflightObserved = await db.getRepository(ClassroomRun).findOneByOrFail({ id: run.id });
        release!();
        await blocker;
        terminalCommitted = await rows(db);
        response = await pending;
        spy.mockRestore();
      } else {
        if (scenario === 'terminal-entry')
          await db.getRepository(ClassroomRun).update(run.id, { status: ClassroomRunStatus.Completed, version: 2 });
        terminalCommitted = await rows(db);
        response = await request(app.getHttpServer()).post(path)
          .set(scenario === 'unauthorized' ? otherAuth : auth).send(input);
      }
      const after = await rows(db);
      const integrity = await db.query('PRAGMA integrity_check');
      const foreignKeys = await db.query('PRAGMA foreign_key_check');
      await writeFile(join(process.cwd(), '.tmp', 'a06-growth-goal-' + scenario + '.json'),
        JSON.stringify({ scenario, isolatedDatabase: database, initial: initial.body, request: input,
          response: { status: response.status, body: response.body }, preflightObserved,
          before, terminalCommitted, after, integrity, foreignKeys,
          expectedStatus: scenario === 'normal' ? 201 : scenario === 'unauthorized' ? 403 : 409,
          terminalTransition: scenario === 'terminal-race' ? 'controlled manager Run update inside existing queue; not full complete API' : null,
        }, null, 2));
      expect(integrity).toEqual([{ integrity_check: 'ok' }]);
      expect(foreignKeys).toEqual([]);
      if (scenario === 'normal') {
        expect(response.status).toBe(201);
        expect(after.find(t => t.table === 'class_growth_goal')!.count).toBe(2);
        const goals = after.find(t => t.table === 'class_growth_goal')!.data;
        expect(goals.filter((g: any) => g.status === 'active')).toHaveLength(1);
        for (const table of tables.filter(t => t !== 'class_growth_goal'))
          expect(after.find(t => t.table === table)).toEqual(before.find(t => t.table === table));
      } else {
        // Acceptance assertion deliberately remains red if the existing guard is bypassed.
        expect(response.status).toBe(scenario === 'unauthorized' ? 403 : 409);
        expect(after).toEqual(terminalCommitted);
      }
    } finally {
      release?.();
      await blocker;
      jest.restoreAllMocks();
      await app?.close();
      for (const suffix of ['', '-wal', '-shm', '-journal'])
        await unlink(database + suffix).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; });
      await rmdir(folder);
    }
  }, 30000);
});

