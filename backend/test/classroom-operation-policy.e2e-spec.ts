import { BindingStatus } from '../src/platform/platform.types';
import { AuthUserType } from '../src/auth/entities/refresh-token-session.entity';
import { DeviceBinding } from '../src/platform/entities/device-binding.entity';
import { ClassroomSnapshotService } from '../src/classroom-runs/classroom-snapshot.service';
import { ClassroomSnapshotReason } from '../src/classroom-runs/classroom-run.types';
import { ScreenLifecycleService } from '../src/classroom-runs/screen-lifecycle.service';
import { AttendanceService } from '../src/classroom-runs/attendance.service';
import { AttendanceChangeSource } from '../src/classroom-runs/entities/student-attendance-change.entity';
import { ClassroomRollCallService } from '../src/classroom-runs/classroom-roll-call.service';
import { policyAllowedActions } from '../src/classroom-runs/classroom-operation-policy';
import { StudentRewardService } from '../src/classroom-runs/student-reward.service';
import { ClassroomRunService } from '../src/classroom-runs/classroom-run.service';
import { INestApplication, ValidationPipe } from '@nestjs/common';
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



describe('0.5-4B transaction entry operation policy', () => {
  for (const phase of ['opening', 'paused', 'terminal', 'recovery', 'break', 'teaching']) {
    it(`${phase}: direct/canonical/legacy/CommandBus share policy and reject without business writes`, async () => {
      const folder = await mkdtemp(join(tmpdir(), 'operation-policy-isolated-'));
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


        const binding = await db.getRepository(DeviceBinding).save({ deviceId: device.id, classId: cls.id,
          classroomId: classroom.id, status: BindingStatus.Active, boundByType: AuthUserType.Teacher,
          boundBy: teacher.id, boundAt: new Date() });
        const snapshots = app.get(ClassroomSnapshotService);
        await snapshots.capture(run.id, ClassroomSnapshotReason.Start, true);
        const actor = { sub: teacher.id, userType: AuthUserType.Teacher, schoolId: 'isolated-restart' } as any;
        if (phase === 'opening' || phase === 'paused')
          await app.get(ScreenLifecycleService).createOpening(actor,
            { runId: run.id, deviceId: device.id, bindingId: binding.id, expectedRevision: 0 });
        if (phase === 'paused') await db.getRepository(ClassroomRun).update(run.id, { status: ClassroomRunStatus.Paused });
        if (phase === 'terminal') await db.getRepository(ClassroomRun).update(run.id, { status: ClassroomRunStatus.Completed });
        if (phase === 'recovery') await db.query('UPDATE classroom_snapshot SET checksum=?', ['invalid']);
        if (phase === 'break') await db.getRepository(ClassroomRun).update(run.id,
          { breakStartedAt: new Date(), breakEndsAt: new Date(Date.now() + 600000) });
        const token = (await request(app.getHttpServer()).post('/auth/login')
          .send({ account: teacher.account, password: 'Teacher123!' }).expect(200)).body.access_token;
        const auth = { Authorization: `Bearer ${token}` };
        let sequence = 0;
        const baseline = await rows(db);
        const urls = [
          { path: `/classroom-runs/${run.id}/rewards`, body: { studentId: students[0]!.id, stars: 1, version: 1 } },
          { path: `/classroom-runs/${run.id}/engagement-rewards`, body: { studentId: students[0]!.id, rewardType: 'answer', flowerCount: 1, points: 1, reason: '固定测试原因' } },
          { path: `/classroom-runs/${run.id}/attendance`, body: { studentId: students[0]!.id, status: 'present' } },
          { path: `/classroom-runs/${run.id}/roll-calls`, body: { mode: 'teacher_specified', specifiedStudentId: students[0]!.id, cooldownCount: 0 } },
          ...['reward_student', 'attendance_update', 'random_roll_call', 'speak_text', 'next_step', 'play_resource'].map(operation => ({
            path: '/classroom-commands', body: { runId: run.id, deviceId: device.id, targetDeviceId: device.id, source: 'teacher_panel', expectedVersion: 1,
              operation, parameters: operation === 'reward_student' ? { studentId: students[0]!.id, stars: 1 }
                : operation === 'attendance_update' ? { studentId: students[0]!.id, status: 'present' }
                : operation === 'speak_text' ? { text: '固定测试文字' } : operation === 'play_resource' ? { resourceId: 1 } : {} } })),
        ];
        if (phase !== 'teaching') {
          for (const input of urls) {
            const denied = await request(app.getHttpServer()).post(input.path).set(auth)
              .send({ ...input.body, requestId: `policy-denied-${phase}-${++sequence}` });
            if (denied.status !== 409) throw new Error(JSON.stringify({ input, status: denied.status, body: denied.body }));
            expect(await rows(db)).toEqual(baseline);
          }
          await expect(app.get(AttendanceService).apply(actor, { id: run.id, classId: cls.id }, 'policy-direct-attendance',
            [{ studentId: students[0]!.id, status: 'present' as any }], AttendanceChangeSource.Manual)).rejects.toMatchObject({ status: 409 });
          await expect(app.get(ClassroomRollCallService).execute(actor, run.id, 'policy-direct-rollcall',
            { mode: 'random' as any })).rejects.toMatchObject({ status: 409 });
          expect(await rows(db)).toEqual(baseline);
          if (phase === 'paused') {
            await request(app.getHttpServer()).post('/classroom-commands').set(auth).send({
              requestId: 'policy-safe-stop', runId: run.id, deviceId: device.id, targetDeviceId: device.id,
              source: 'teacher_panel', expectedVersion: 1, operation: 'stop_media' }).expect(201);
            await request(app.getHttpServer()).post(`/classroom-runs/${run.id}/checkpoints`).set(auth)
              .send({ requestId: 'policy-paused-observation', deviceId: device.id, version: 2,
                checkpointType: 'command', playerState: { currentTime: 2 } }).expect(201);
          }
        } else {
          const input = urls[0]!;
          const body = { ...input.body, requestId: 'policy-teaching-reward' };
          const reward = await request(app.getHttpServer()).post(input.path).set(auth).send(body).expect(201);
          let release!: () => void;
          let entered!: () => void;
          const gate = new Promise<void>(resolve => { release = resolve; });
          const ready = new Promise<void>(resolve => { entered = resolve; });
          const blocker = snapshots.transactionRequired(async manager => {
            entered(); await gate;
            await app!.get(ScreenLifecycleService).createOpening(actor,
              { runId: run.id, deviceId: device.id, bindingId: binding.id, expectedRevision: 0 }, manager);
          });
          await ready;
          const pending = app.get(StudentRewardService).createReward(actor, run.id,
            { requestId: 'policy-racing-reward', version: 2, studentId: students[0]!.id, stars: 1 })
            .then(value => ({ value, error: null as any }), error => ({ value: null, error }));
          release(); await blocker;
          const raced = await rows(db);
          expect((await pending).error).toMatchObject({ status: 409 });
          expect(await rows(db)).toEqual(raced); // Lifecycle changed with no Run-version change; policy rechecked inside.
          await db.getRepository(ClassroomRun).update(run.id, { status: ClassroomRunStatus.Completed });
          const committed = await rows(db);
          expect((await request(app.getHttpServer()).post(input.path).set(auth).send(body).expect(201)).body).toEqual(reward.body);
          expect(await rows(db)).toEqual(committed);
        }
        if (phase !== 'recovery' && phase !== 'break') {
          const restored = await app.get(ClassroomRunService).restore(actor, run.id, device.id);
          expect(restored.allowedActions).toEqual(policyAllowedActions({
            runStatus: phase === 'terminal' || phase === 'teaching' ? 'completed' : phase === 'paused' ? 'paused' : 'running',
            opening: phase === 'opening' || phase === 'paused' }));
        }
        expect(await db.query('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
      } finally {
        await app?.close();
        for (const suffix of ['', '-wal', '-shm', '-journal'])
          await unlink(database + suffix).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; });
        await rmdir(folder);
      }
    }, 30000);
  }
});

