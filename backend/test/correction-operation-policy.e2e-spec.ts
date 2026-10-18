import { BindingStatus } from '../src/platform/platform.types';
import { AuthUserType } from '../src/auth/entities/refresh-token-session.entity';
import { DeviceBinding } from '../src/platform/entities/device-binding.entity';
import { ClassroomSnapshotService } from '../src/classroom-runs/classroom-snapshot.service';
import { ClassroomSnapshotReason } from '../src/classroom-runs/classroom-run.types';
import { ScreenLifecycleService } from '../src/classroom-runs/screen-lifecycle.service';
import { AttendanceService } from '../src/classroom-runs/attendance.service';
import { AttendanceChangeSource } from '../src/classroom-runs/entities/student-attendance-change.entity';
import { StudentRewardService } from '../src/classroom-runs/student-reward.service';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { mkdtemp, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
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



import { jest } from '@jest/globals';
import { ClassroomBusinessReceiptService } from '../src/classroom-runs/classroom-business-receipt.service';

describe('0.5-4D existing-fact correction transaction policy', () => {
  it.each(['opening', 'teaching', 'paused', 'break', 'summary', 'completed', 'cancelled', 'failed'])(
    '%s: correction, replay, permissions and atomicity', async phase => {
      const folder = await mkdtemp(join(tmpdir(), 'correction-policy-isolated-'));
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
        const snapshots = app.get(ClassroomSnapshotService);
        await snapshots.capture(run.id, ClassroomSnapshotReason.Start, true);
        const actor = { sub: teacher.id, userType: AuthUserType.Teacher, schoolId: 'isolated-restart' } as any;
        const rewards = app.get(StudentRewardService);
        const attendance = app.get(AttendanceService);
        const personal = await rewards.createReward(actor, run.id, {
          requestId: '4d-seed-personal', studentId: students[0]!.id, stars: 1,
        });
        const collective = await rewards.createCollectiveReward(actor, run.id, {
          requestId: '4d-seed-collective', rewardCategory: 'cooperation', points: 1, reason: '集体合作',
        } as any);
        await attendance.apply(actor, run, '4d-seed-attendance',
          [{ studentId: students[0]!.id, status: 'present' as any }], AttendanceChangeSource.Manual);
        const binding = await db.getRepository(DeviceBinding).save({ deviceId: device.id, classId: cls.id,
          classroomId: classroom.id, status: BindingStatus.Active, boundByType: AuthUserType.Teacher,
          boundBy: teacher.id, boundAt: new Date() });
        if (phase === 'opening' || phase === 'paused') await app.get(ScreenLifecycleService).createOpening(actor,
          { runId: run.id, deviceId: device.id, bindingId: binding.id, expectedRevision: 0 });
        if (phase === 'paused') await db.getRepository(ClassroomRun).update(run.id, { status: ClassroomRunStatus.Paused });
        if (phase === 'break') await db.getRepository(ClassroomRun).update(run.id,
          { breakStartedAt: new Date(), breakEndsAt: new Date(Date.now() + 600000) });
        if (['summary', 'completed', 'cancelled', 'failed'].includes(phase)) {
          await db.getRepository(ClassroomRun).update(run.id,
            { status: (phase === 'summary' ? 'completed' : phase) as ClassroomRunStatus, endedAt: new Date() });
          if (phase === 'summary') await app.get(ScreenLifecycleService).createSummary(actor,
            { runId: run.id, deviceId: device.id, bindingId: binding.id, expectedRevision: 0 });
        }
        const allowed = ['opening', 'teaching', 'paused', 'break'].includes(phase);
        const ops = [
          (who = actor, changed = false) => rewards.revokeReward(who, run.id, personal.record.id,
            '4d-revoke-personal', changed ? '不同原因' : '误点'),
          (who = actor, changed = false) => rewards.revokeCollectiveReward(who, run.id, collective.id,
            '4d-revoke-collective', changed ? '不同原因' : '误点'),
          (who = actor, changed = false) => attendance.apply(who, run, '4d-correct-attendance',
            [{ studentId: students[0]!.id, status: (changed ? 'late' : 'absent') as any }], AttendanceChangeSource.Manual),
        ];
        const results: unknown[] = [];
        const token = (await request(app.getHttpServer()).post('/auth/login')
          .send({ account: teacher.account, password: 'Teacher123!' }).expect(200)).body.access_token;
        const auth = { Authorization: `Bearer ${token}` };
        if (phase === 'teaching') {
          let release!: () => void;
          let signal!: () => void;
          const ready = new Promise<void>(resolve => { signal = resolve; });
          const gate = new Promise<void>(resolve => { release = resolve; });
          const blocker = snapshots.transactionRequired(async manager => {
            signal(); await gate;
            await manager.getRepository(ClassroomRun).update(run.id, { status: ClassroomRunStatus.Completed });
          });
          await ready;
          const pending = attendance.apply(actor, run, '4d-racing-correction',
            [{ studentId: students[0]!.id, status: 'absent' as any }], AttendanceChangeSource.Manual)
            .then(value => ({ value, error: null as any }), error => ({ value: null, error }));
          release(); await blocker;
          const committed = await rows(db);
          expect((await pending).error).toMatchObject({ status: 409 });
          expect(await rows(db)).toEqual(committed);
          await db.getRepository(ClassroomRun).update(run.id, { status: ClassroomRunStatus.Running });
        }
        for (const op of ops) {
          let before = await rows(db);
          await expect(op({ ...actor, sub: teacher.id + 9000 })).rejects.toMatchObject({ status: 403 });
          expect(await rows(db)).toEqual(before);
          if (!allowed) {
            await expect(op()).rejects.toMatchObject({ status: 409 });
            expect(await rows(db)).toEqual(before);
            continue;
          }
          const version = (await db.getRepository(ClassroomRun).findOneByOrFail({ id: run.id })).version;
          if (phase === 'teaching') {
            await expect(rewards.revokeReward(actor, run.id, personal.record.id,
              '4d-stale-version', '误点', version - 1)).rejects.toMatchObject({ status: 409 });
            expect(await rows(db)).toEqual(before);
          }
          // Fault is thrown only AFTER actual required Snapshot persistence in real SQLite.
          const update = Repository.prototype.update;
          const cas = jest.spyOn(Repository.prototype, 'update').mockImplementation(async function(this: Repository<any>, ...args: unknown[]) {
            if (this.metadata.target === ClassroomRun) return { affected: 0, raw: [], generatedMaps: [] };
            return update.apply(this, args as never);
          } as never);
          try { await expect(op()).rejects.toMatchObject({ status: 409 }); }
          finally { cas.mockRestore(); }
          expect(await rows(db)).toEqual(before);
          const original = snapshots.captureRequired.bind(snapshots);
          const receipts = app.get(ClassroomBusinessReceiptService);
          const writeReceipt = receipts.write.bind(receipts);
          const eventFailure = jest.spyOn(receipts, 'write').mockImplementation(async (...args) => {
            await writeReceipt(...args); throw new Error('4D after receipt Event insert');
          });
          try { await expect(op()).rejects.toThrow('4D after receipt Event insert'); }
          finally { eventFailure.mockRestore(); }
          expect(await rows(db)).toEqual(before);
          const spy = jest.spyOn(snapshots, 'captureRequired').mockImplementation(async (...args) => {
            await original(...args); throw new Error('4D late required Snapshot failure');
          });
          try { await expect(op()).rejects.toThrow('4D late required Snapshot failure'); }
          finally { spy.mockRestore(); }
          expect(await rows(db)).toEqual(before);
          const value = await op();
          results.push(value);
          before = await rows(db);
          expect(await op()).toEqual(value);
          expect(await rows(db)).toEqual(before);
          await expect(op(actor, true)).rejects.toMatchObject({ status: 409 });
          expect(await rows(db)).toEqual(before);
        }
        if (allowed) {
          const version = (await db.getRepository(ClassroomRun).findOneByOrFail({ id: run.id })).version;
          const command = { runId: run.id, deviceId: device.id, targetDeviceId: device.id,
            source: 'teacher_panel', expectedVersion: version, operation: 'attendance_update',
            requestId: '4d-command-correction', parameters: { studentId: students[0]!.id, status: 'present' } };
          await request(app.getHttpServer()).post('/classroom-commands').set(auth).send(command).expect(201);
          const afterCommand = await rows(db);
          await request(app.getHttpServer()).post('/classroom-commands').set(auth).send(command).expect(201);
          expect(await rows(db)).toEqual(afterCommand);
          // New/mixed attendance is not a correction and retains normal phase restrictions.
          if (phase !== 'teaching') {
            const before = await rows(db);
            await expect(attendance.apply(actor, run, '4d-mixed-batch', [
              { studentId: students[0]!.id, status: 'present' as any },
              { studentId: students[1]!.id, status: 'present' as any },
            ], AttendanceChangeSource.Batch)).rejects.toMatchObject({ status: 409 });
            expect(await rows(db)).toEqual(before);
          }
          await db.getRepository(ClassroomRun).update(run.id, { status: ClassroomRunStatus.Completed });
          const committed = await rows(db);
          for (let i = 0; i < ops.length; i++) expect(await ops[i]!()).toEqual(results[i]);
          for (const op of ops) await expect(op({ ...actor, sub: teacher.id + 9000 })).rejects.toMatchObject({ status: 403 });
          expect(await rows(db)).toEqual(committed);
          await request(app.getHttpServer()).post(`/classroom-runs/${run.id}/rewards/${personal.record.id}/revoke`).set(auth)
            .send({ requestId: '4d-revoke-personal', reason: '误点' }).expect(200);
          await request(app.getHttpServer()).post(`/classroom-runs/${run.id}/collective-rewards/${collective.id}/revoke`).set(auth)
            .send({ requestId: '4d-revoke-collective', reason: '误点' }).expect(200);
          await request(app.getHttpServer()).post(`/classroom-runs/${run.id}/attendance`).set(auth)
            .send({ requestId: '4d-correct-attendance', studentId: students[0]!.id, status: 'absent' }).expect(201);
          expect(await rows(db)).toEqual(committed);
          await expect(attendance.apply(actor, run, '4d-postclass-new-id',
            [{ studentId: students[0]!.id, status: 'present' as any }], AttendanceChangeSource.Manual))
            .rejects.toMatchObject({ status: 409 });
          expect(await rows(db)).toEqual(committed);
        }
        expect(await db.query('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
        expect(await db.query('PRAGMA foreign_key_check')).toEqual([]);
      } finally {
        await app?.close();
        for (const suffix of ['', '-wal', '-shm', '-journal'])
          await unlink(database + suffix).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; });
        await rmdir(folder);
      }
    }, 30000);
});

