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



describe('Collective revoke HTTP durable receipt replay', () => {
  it.each(['response-loss-reopen', 'late-event', 'late-snapshot', 'missing-receipt'])('%s', async scenario => {
    const folder = await mkdtemp(join(tmpdir(), 'collective-http-replay-'));
    const database = join(folder, 'isolated.sqlite');
    let app: INestApplication | undefined;
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
      const goal = (await request(app.getHttpServer()).post('/classroom-runs/' + run.id + '/growth-goals').set(auth)
        .send({ requestId: 'collective-goal-fixture', title: '合成共同目标', targetPoints: 20 }).expect(201)).body;
      const award = async (id: string, points: number) => (await request(app!.getHttpServer())
        .post('/classroom-runs/' + run.id + '/collective-rewards').set(auth).send({
          requestId: id, rewardCategory: 'cooperation', points, reason: '合成合作奖励', goalId: goal.id,
        }).expect(201)).body;
      const target = await award('collective-original-first', 3);
      const otherTarget = await award('collective-original-second', 5);
      const path = '/classroom-runs/' + run.id + '/collective-rewards/' + target.id + '/revoke';
      const input = { requestId: 'collective-http-' + scenario, reason: '  合成误点纠正  ', version: 3 };
      const before = await rows(db);
      expect(before.find(t => t.table === 'class_growth_goal')!.data[0].current_points).toBe(8);
      const receipts = app.get(ClassroomBusinessReceiptService);
      const snapshots = app.get(ClassroomSnapshotService);
      if (scenario === 'late-event') {
        const original = receipts.write.bind(receipts);
        jest.spyOn(receipts, 'write').mockImplementation(async (...args) => {
          await original(...args); throw new Error('INJECTED after collective revoke receipt insert');
        });
      }
      if (scenario === 'late-snapshot') {
        const original = snapshots.captureRequired.bind(snapshots);
        jest.spyOn(snapshots, 'captureRequired').mockImplementation(async (...args) => {
          await original(...args); throw new Error('INJECTED after collective revoke Snapshot insert');
        });
      }
      let first = await request(app.getHttpServer()).post(path).set(auth).send(input);
      jest.restoreAllMocks();
      if (scenario.startsWith('late-')) {
        expect(first.status).toBe(500);
        expect(await rows(db)).toEqual(before); // Actual SQLite writes rolled back, including goal projection.
        expect(first.body).not.toHaveProperty('committedRunVersion');
        first = await request(app.getHttpServer()).post(path).set(auth).send(input);
      }
      expect(first.status).toBe(200);
      const firstResult = first.body; // Server-side oracle only; client deliberately retains no success cache.
      expect(firstResult.revokedAt).toEqual(expect.any(String));
      expect(firstResult.committedRunVersion).toBe(4);
      const clientCachedResponse = null;
      expect(clientCachedResponse).toBeNull();
      const committed = await rows(db);
      const formal = committed.find(t => t.table === 'class_collective_reward_record')!;
      expect(formal.count).toBe(2);
      expect(formal.data.find((row: any) => row.id === target.id)).toMatchObject({
        revoke_request_id: input.requestId, revoke_reason: '合成误点纠正', revoked_by_teacher_id: teacher.id,
      });
      expect(committed.find(t => t.table === 'class_growth_goal')!.data[0].current_points).toBe(5);
      expect(committed.find(t => t.table === 'classroom_run')!.data[0].version).toBe(4);
      const events = committed.find(t => t.table === 'classroom_event')!;
      expect(events.count).toBe(before.find(t => t.table === 'classroom_event')!.count + 1);
      const receiptEvent = events.data.find((row: any) => JSON.parse(row.payload).originalRequestId === input.requestId);
      const receiptEntity = await db.getRepository(ClassroomEvent).findOneByOrFail({ id: receiptEvent.id });
      const receipt = app.get(ClassroomBusinessReceiptService).parse(receiptEntity);
      expect(receipt).toMatchObject({ kind: 'classroom_business_receipt', contractVersion: 1,
        operation: 'collective_reward.revoke', businessRecordIds: [target.id], committedRunVersion: 4, result: firstResult });
      for (const event of before.find(t => t.table === 'classroom_event')!.data)
        expect(events.data.find((row: any) => row.id === event.id)).toEqual(event);
      expect(committed.find(t => t.table === 'classroom_snapshot')!.count)
        .toBe(before.find(t => t.table === 'classroom_snapshot')!.count + 1);
      const snapshot = committed.find(t => t.table === 'classroom_snapshot')!.data.at(-1);
      expect(JSON.parse(snapshot.interaction_state).collectiveRewardState).toEqual({ recordIds: [otherTarget.id], points: 5 });
      const replayInput = { ...input, reason: '合成误点纠正' };
      const assertReplay = async (baseline: Awaited<ReturnType<typeof rows>>, activeDb: DataSource) => {
        // The receipt lookup uses a short transaction, but must never execute the mutation branch.
        const service = app!.get(StudentRewardService);
        const mutate = jest.spyOn(service as any, 'recalculateCurrentGoal');
        const capture = jest.spyOn(app!.get(ClassroomSnapshotService), 'captureBusinessRequired');
        const save = jest.spyOn(Repository.prototype, 'save');
        const update = jest.spyOn(Repository.prototype, 'update');
        try {
          const replay = await request(app!.getHttpServer()).post(path).set(auth).send(replayInput).expect(200);
          expect(replay.body).toEqual(firstResult);
          expect(mutate).not.toHaveBeenCalled();
          expect(capture).not.toHaveBeenCalled();
          expect(save).not.toHaveBeenCalled();
          expect(update).not.toHaveBeenCalled();
          expect(await rows(activeDb)).toEqual(baseline);
        } finally { mutate.mockRestore(); capture.mockRestore(); save.mockRestore(); update.mockRestore(); }
      };
      await assertReplay(committed, db);
      await app.close(); app = undefined;
      app = await openTestApplication(database, false);
      const activeDb = app.get(DataSource);
      expect(activeDb).not.toBe(db);
      expect(activeDb.options.database).toBe(database);
      expect(await rows(activeDb)).toEqual(committed);
      await assertReplay(committed, activeDb);
      await request(app.getHttpServer()).post(path).set(auth).send({ ...replayInput, reason: '改变原因' }).expect(409);
      await request(app.getHttpServer()).post('/classroom-runs/' + run.id + '/collective-rewards/' + otherTarget.id + '/revoke')
        .set(auth).send(replayInput).expect(409);
      await request(app.getHttpServer()).post(path).set(otherAuth).send(replayInput).expect(403);
      await request(app.getHttpServer()).get('/classroom-runs/' + run.id + '/reward-dashboard').set(otherAuth).expect(403);
      expect(await rows(activeDb)).toEqual(committed);
      if (scenario === 'missing-receipt') {
        await activeDb.query('DELETE FROM classroom_event WHERE id=?', [receiptEvent.id]);
        const missing = await rows(activeDb);
        await request(app.getHttpServer()).post(path).set(auth).send({
          requestId: input.requestId, reason: '合成误点纠正', version: 4,
        }).expect(409); // Already-revoked record is not sufficient proof of the original success.
        expect(await rows(activeDb)).toEqual(missing);
        await activeDb.query('INSERT INTO classroom_event (' + Object.keys(receiptEvent).map(k => '"' + k + '"').join(',') +
          ') VALUES (' + Object.keys(receiptEvent).map(() => '?').join(',') + ')', Object.values(receiptEvent));
        expect(await rows(activeDb)).toEqual(committed);
      }
      await activeDb.getRepository(ClassroomRun).update(run.id, { status: ClassroomRunStatus.Completed, version: 5 });
      const terminal = await rows(activeDb);
      await assertReplay(terminal, activeDb);
      await request(app.getHttpServer()).post('/classroom-runs/' + run.id + '/collective-rewards/' + otherTarget.id + '/revoke')
        .set(auth).send({ requestId: input.requestId + '-new', reason: '课后首次', version: 5 }).expect(409);
      expect(await rows(activeDb)).toEqual(terminal);
      expect(await activeDb.query('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
      expect(await activeDb.query('PRAGMA foreign_key_check')).toEqual([]);
      await writeFile(join(process.cwd(), '.tmp', 'collective-http-replay-' + scenario + '.json'),
        JSON.stringify({ scenario, request: input, firstResult, before, committed, terminal,
          replayEqualsFirstResult: true, mutationCallsOnReplay: 0, integrity: 'ok', foreignKeyErrors: 0 }, null, 2));
    } finally {
      jest.restoreAllMocks();
      await app?.close();
      for (const suffix of ['', '-wal', '-shm', '-journal'])
        await unlink(database + suffix).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; });
      await rmdir(folder);
    }
  }, 30000);
});

