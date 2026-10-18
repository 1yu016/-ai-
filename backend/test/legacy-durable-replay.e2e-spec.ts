import { INestApplication, ValidationPipe } from '@nestjs/common';
import { enterTeachingFixture } from './helpers/teaching-phase-fixture';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { mkdtemp, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { DataSource } from 'typeorm';
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
const legacyTables = tables.slice(0, 9);

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

describe('0.5-3E durable legacy adapters across application/database reopen', () => {
  it('replays committed facts after restart without any new fact, Event, Snapshot, random draw or Run write', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'classroom-3e-receipt-'));
    const database = join(folder, 'isolated.sqlite');
    let app: INestApplication | undefined;
    try {
      app = await openTestApplication(database, true);
      const db = app.get(DataSource);
      const teacher = await db.getRepository(Teacher).findOneByOrFail({ account: 'legacy_restart_teacher' });
      await db.getRepository(Teacher).update(teacher.id, { schoolId: 'isolated-restart' });
      const cls = await db.getRepository(SchoolClass).save({ schoolId: 'isolated-restart', name: '隔离班',
        grade: '小班', ageRange: '3-4', schoolYear: '2026', status: RecordStatus.Active });
      await db.getRepository(TeacherClass).save({ teacherId: teacher.id, classId: cls.id, role: TeacherClassRole.Lead });
      const students = await db.getRepository(Student).save([
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
      const base = `/classroom-runs/${run.id}`;
      await enterTeachingFixture(app, run.id);
      const initial = await rows(db);
      const cases: Array<{ path: string; body: Record<string, any>; response: any; status: number }> = [];
      const write = async (path: string, body: Record<string, any>, status = 201) => {
        const response = (await request(app!.getHttpServer()).post(path).set(auth).send(body).expect(status)).body;
        cases.push({ path, body, response, status });
        return response;
      };
      await write(`${base}/attendance`, { studentId: students[0]!.id, status: 'present', note: '保留审计备注', requestId: 'restart-attendance-1' });
      await write(`${base}/attendance/batch`, { entries: students.map(s => ({ studentId: s.id, status: 'late' })), requestId: 'restart-batch-1' });
      const reward = await write(`${base}/engagement-rewards`, { studentId: students[0]!.id, rewardType: 'answer',
        points: 2, flowerCount: 1, reason: '认真观察', requestId: 'restart-reward-1' });
      await write(`${base}/roll-calls`, { mode: 'teacher_specified', specifiedStudentId: students[0]!.id,
        cooldownCount: 2, requestId: 'restart-call-1' });
      await write(`${base}/rewards/${reward.record.id}/revoke`, { reason: '教师纠正', requestId: 'restart-revoke-1' }, 200);
      // Replay must not revalidate the original candidate or demand an active Run.
      await db.getRepository(Student).update(students[0]!.id, { status: RecordStatus.Disabled });
      await db.getRepository(ClassroomRun).update(run.id, { status: ClassroomRunStatus.Completed, endedAt: new Date() });
      const committed = await rows(db);
      expect(committed.filter(t => legacyTables.includes(t.table))).toEqual(initial.filter(t => legacyTables.includes(t.table)));
      const receiptRows = committed.find(t => t.table === 'classroom_event')!.data.map((r: any) => JSON.parse(r.payload));
      expect(receiptRows).toHaveLength(5);
      expect(receiptRows.every((r: any) => r.kind === 'classroom_business_receipt' && r.contractVersion === 1)).toBe(true);

      await app.close(); app = undefined;
      expect(db.isInitialized).toBe(false);
      // New application, new repositories, empty service queues/caches; same on-disk data.
      // Do NOT synchronize or run a migration on reopen.
      app = await openTestApplication(database, false);
      const reopened = app.get(DataSource);
      expect(reopened).not.toBe(db);
      expect(await rows(reopened)).toEqual(committed);
      for (const c of cases) {
        expect((await request(app.getHttpServer()).post(c.path).set(auth).send(c.body).expect(c.status)).body).toEqual(c.response);
        expect(await rows(reopened)).toEqual(committed);
      }
      for (const [index, delta] of [[0, { status: 'absent' }], [2, { points: 3 }],
        [3, { specifiedStudentId: students[1]!.id }], [4, { reason: '不同撤销原因' }]] as const) {
        const c = cases[index]!;
        await request(app.getHttpServer()).post(c.path).set(auth).send({ ...c.body, ...delta }).expect(409);
        expect(await rows(reopened)).toEqual(committed);
      }
      const batch = cases[1]!;
      expect((await request(app.getHttpServer()).post(batch.path).set(auth)
        .send({ ...batch.body, entries: [...batch.body.entries].reverse() }).expect(201)).body).toEqual(batch.response);
      for (const c of cases.slice(0, 4)) {
        await request(app.getHttpServer()).post(c.path).set(auth)
          .send({ ...c.body, requestId: `${c.body.requestId}-new` }).expect(409);
      }
      expect(await rows(reopened)).toEqual(committed);
    } finally {
      await app?.close();
      // Only exact files in this test-owned mkdtemp folder; no recursive deletion.
      for (const suffix of ['', '-wal', '-shm', '-journal']) {
        await unlink(database + suffix).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; });
      }
      await rmdir(folder);
    }
  }, 30000);
});
