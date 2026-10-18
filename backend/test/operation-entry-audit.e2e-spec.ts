import { BindingStatus } from '../src/platform/platform.types';
import { AuthUserType } from '../src/auth/entities/refresh-token-session.entity';
import { DeviceBinding } from '../src/platform/entities/device-binding.entity';
import { ClassroomSnapshotService } from '../src/classroom-runs/classroom-snapshot.service';
import { ClassroomSnapshotReason } from '../src/classroom-runs/classroom-run.types';
import { ScreenLifecycleService } from '../src/classroom-runs/screen-lifecycle.service';
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



import { ClassroomEngagementService } from '../src/classroom-engagement/classroom-engagement.service';
import { ScreenHandoffService } from '../src/classroom-runs/screen-handoff.service';
import { ClassroomRollCallService } from '../src/classroom-runs/classroom-roll-call.service';

describe('0.5-4E reachable control and feedback entry audit', () => {
  it.each(['opening', 'teaching', 'paused', 'summary', 'recovery', 'break', 'prepared', 'legacy_break'])(
    '%s: advertised phase actions match core control and HTTP observation guards', async phase => {
      const folder = await mkdtemp(join(tmpdir(), 'entry-audit-isolated-'));
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
        void students;
        const binding = await db.getRepository(DeviceBinding).save({ deviceId: device.id, classId: cls.id,
          classroomId: classroom.id, status: BindingStatus.Active, boundByType: AuthUserType.Teacher,
          boundBy: teacher.id, boundAt: new Date() });
        const snapshots = app.get(ClassroomSnapshotService);
        const runs = app.get(ClassroomRunService);
        const actor = { sub: teacher.id, userType: AuthUserType.Teacher, schoolId: 'isolated-restart' } as any;
        await snapshots.capture(run.id, ClassroomSnapshotReason.Start, true);
        if (phase === 'opening' || phase === 'paused') await app.get(ScreenLifecycleService).createOpening(actor,
          { runId: run.id, deviceId: device.id, bindingId: binding.id, expectedRevision: 0 });
        if (phase === 'paused') await db.getRepository(ClassroomRun).update(run.id, { status: ClassroomRunStatus.Paused });
        let handoff: { id: string } | undefined;
        if (phase === 'summary') {
          handoff = app.get(ScreenHandoffService).issueActive(actor, run.id, device.id, binding.id);
          await db.getRepository(ClassroomRun).update(run.id, { status: ClassroomRunStatus.Completed, endedAt: new Date() });
          await app.get(ScreenLifecycleService).createSummary(actor,
            { runId: run.id, deviceId: device.id, bindingId: binding.id, expectedRevision: 0 });
          const screen = await runs.screenState(actor, device.id, handoff.id);
          expect(screen).toMatchObject({ page: 'summary', classroomState: null });
          expect(screen.allowedActions).toEqual(['query', 'prepare', 'start', 'close_summary']);
        }
        if (phase === 'recovery') await db.query('UPDATE classroom_snapshot SET checksum=?', ['invalid']);
        if (phase === 'break') await db.getRepository(ClassroomRun).update(run.id,
          { breakStartedAt: new Date(), breakEndsAt: new Date(Date.now() + 600000) });
        if (phase === 'prepared') await db.getRepository(ClassroomRun).update(run.id, { status: ClassroomRunStatus.Prepared });
        if (phase === 'legacy_break') await app.get(ClassroomEngagementService).startBreak(actor, run.id, {
          deviceId: device.id, version: 1, requestId: 'audit-legacy-start', type: 'water' as any,
          title: '旧课间兼容', durationSeconds: 60,
        });
        const token = (await request(app.getHttpServer()).post('/auth/login')
          .send({ account: teacher.account, password: 'Teacher123!' }).expect(200)).body.access_token;
        const expected = {
          resource_start: phase === 'teaching',
          checkpoint: phase === 'teaching' || phase === 'paused',
          safe_stop: ['teaching', 'paused', 'recovery'].includes(phase),
        };
        for (const operation of ['resource_start', 'checkpoint', 'safe_stop'] as const) {
          const restored = await runs.restore(actor, run.id, device.id);
          expect(restored.allowedActions.includes(operation)).toBe(expected[operation]);
          const before = await rows(db);
          const dto = { deviceId: device.id, version: restored.version, requestId: 'audit-' + operation,
            checkpointType: 'command' as any,
            playerState: operation === 'checkpoint'
              ? { presentationMode: 'resource', presentationCommandId: 'client-forgery', presentationRevision: 999,
                  currentTime: 4, returnPoint: { resourceId: 999 } }
              : { operation: operation === 'safe_stop' ? 'stop_media' : 'set_presentation',
                  presentationMode: 'avatar', presentationCommandId: 'audit-' + operation },
          };
          if (operation === 'checkpoint') {
            const response = await request(app.getHttpServer()).post('/classroom-runs/' + run.id + '/checkpoints')
              .set({ Authorization: 'Bearer ' + token }).send(dto);
            expect(response.status).toBe(expected[operation] ? 201 : 409);
            if (expected[operation]) {
              const latest = await snapshots.loadLatestValid(run.id);
              expect(latest?.playerState.presentationCommandId).not.toBe('client-forgery');
              expect(latest?.playerState.presentationRevision).not.toBe(999);
              expect(latest?.playerState.returnPoint).toBeUndefined();
            }
          } else if (expected[operation]) await runs.checkpointControl(actor, run.id, dto);
          else await expect(runs.checkpointControl(actor, run.id, dto)).rejects.toMatchObject({ status: 409 });
          if (!expected[operation]) expect(await rows(db)).toEqual(before);
        }
        if (phase === 'teaching') {
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
          const current = await db.getRepository(ClassroomRun).findOneByOrFail({ id: run.id });
          const input = { deviceId: device.id, version: current.version, checkpointType: 'command' as any };
          const pending = [
            runs.checkpointControl(actor, run.id, { ...input, requestId: 'audit-race-control', playerState: {
              operation: 'set_presentation', presentationMode: 'avatar', presentationCommandId: 'audit-race-control',
            } }),
            runs.checkpoint(actor, run.id, { ...input, requestId: 'audit-race-feedback', playerState: { currentTime: 8 } }),
            app.get(ClassroomRollCallService).execute(actor, run.id, 'audit-race-rollcall', { mode: 'random' as any }),
          ].map(promise => promise.then(value => ({ value, error: null as any }), error => ({ value: null, error })));
          release(); await blocker;
          const baseline = await rows(db);
          for (const result of await Promise.all(pending)) expect(result.error).toMatchObject({
            status: 409, response: { code: 'CLASSROOM_OPERATION_FORBIDDEN', phase: 'opening' },
          });
          expect(await rows(db)).toEqual(baseline);
          expect((await db.getRepository(ClassroomRun).findOneByOrFail({ id: run.id })).version).toBe(current.version);
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

