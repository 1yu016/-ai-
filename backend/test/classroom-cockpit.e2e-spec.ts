import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AuthModule } from '../src/auth/auth.module';
import { Teacher } from '../src/auth/entities/teacher.entity';
import { Administrator } from '../src/auth/entities/administrator.entity';
import {
  RefreshTokenSession,
  AuthUserType,
} from '../src/auth/entities/refresh-token-session.entity';
import {
  PlatformModule,
  PLATFORM_ENTITIES,
} from '../src/platform/platform.module';
import { SchoolClass } from '../src/platform/entities/school-class.entity';
import { TeacherClass } from '../src/platform/entities/teacher-class.entity';
import { Classroom } from '../src/platform/entities/classroom.entity';
import { Device } from '../src/platform/entities/device.entity';
import { DeviceBinding } from '../src/platform/entities/device-binding.entity';
import {
  ResourceModule,
  RESOURCE_ENTITIES,
} from '../src/resources/resource.module';
import { TeachingResource } from '../src/data/entities/teaching-resource.entity';
import {
  LessonPlanModule,
  LESSON_PLAN_ENTITIES,
} from '../src/lesson-plans/lesson-plan.module';
import { LessonPlan } from '../src/lesson-plans/entities/lesson-plan.entity';
import { LessonPlanVersion } from '../src/lesson-plans/entities/lesson-plan-version.entity';
import { AVATAR_ENTITIES } from '../src/avatars/avatar.module';
import { CLASSROOM_ENGAGEMENT_ENTITIES } from '../src/classroom-engagement/entities';
import { CLASSROOM_PARTICIPATION_ENTITIES } from '../src/classroom-participation/entities';
import {
  ClassroomRunModule,
  CLASSROOM_RUN_ENTITIES,
} from '../src/classroom-runs/classroom-run.module';
import { ClassroomRun } from '../src/classroom-runs/entities/classroom-run.entity';
import { ClassroomRunStepSnapshot } from '../src/classroom-runs/entities/classroom-run-step-snapshot.entity';
import { ClassroomSnapshotService } from '../src/classroom-runs/classroom-snapshot.service';
import { ClassroomSnapshotReason } from '../src/classroom-runs/classroom-run.types';
import { ScreenLifecycleService } from '../src/classroom-runs/screen-lifecycle.service';

describe('A2-1 cockpit isolated HTTP projection', () => {
  let app: any,
    db: DataSource,
    run: ClassroomRun,
    actor: any,
    token: string,
    device: Device,
    binding: DeviceBinding;
  const capture = () =>
    app
      .get(ClassroomSnapshotService)
      .capture(run.id, ClassroomSnapshotReason.Start, true);
  const get = () =>
    request(app.getHttpServer())
      .get(`/classroom-runs/${run.id}/cockpit`)
      .set('Authorization', `Bearer ${token}`);
  const digest = async () => {
    const names = await db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    return JSON.stringify(
      await Promise.all(
        names.map(async (r: any) => [
          r.name,
          await db.query(`SELECT * FROM "${r.name}" ORDER BY rowid`),
        ]),
      ),
    );
  };
  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              JWT_ACCESS_SECRET: 'cockpit-isolated-test-secret-long-enough',
              TEST_TEACHER_ACCOUNT: 'cockpit',
              TEST_TEACHER_PASSWORD: 'Teacher123!',
              TEST_TEACHER_NAME: '合成教师',
              CLASSROOM_SUMMARY_AI_ENABLED: 'false',
            }),
          ],
        }),
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          synchronize: true,
          entities: [
            Teacher,
            Administrator,
            RefreshTokenSession,
            TeachingResource,
            ...PLATFORM_ENTITIES,
            ...RESOURCE_ENTITIES,
            ...LESSON_PLAN_ENTITIES,
            ...CLASSROOM_RUN_ENTITIES,
            ...AVATAR_ENTITIES,
            ...CLASSROOM_ENGAGEMENT_ENTITIES,
            ...CLASSROOM_PARTICIPATION_ENTITIES,
          ],
        }),
        AuthModule,
        PlatformModule,
        ResourceModule,
        LessonPlanModule,
        ClassroomRunModule,
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    db = app.get(DataSource);
    const teacher = await db
      .getRepository(Teacher)
      .findOneByOrFail({ account: 'cockpit' });
    await db
      .getRepository(Teacher)
      .update(teacher.id, { schoolId: 'synthetic' });
    actor = {
      sub: teacher.id,
      userType: AuthUserType.Teacher,
      account: teacher.account,
      role: teacher.role,
      tokenVersion: teacher.tokenVersion,
      schoolId: 'synthetic',
    };
    token = app.get(JwtService).sign(actor);
    const cls = await db
      .getRepository(SchoolClass)
      .save({
        schoolId: 'synthetic',
        name: '测试班',
        grade: '小班',
        ageRange: '3-4',
        schoolYear: '2026',
        status: 'active',
      } as any);
    await db
      .getRepository(TeacherClass)
      .save({ teacherId: teacher.id, classId: cls.id, role: 'lead' } as any);
    const room = await db
      .getRepository(Classroom)
      .save({
        schoolId: 'synthetic',
        name: '测试教室',
        status: 'active',
      } as any);
    device = await db
      .getRepository(Device)
      .save({
        schoolId: 'synthetic',
        name: '测试屏',
        deviceCode: 'cockpit-screen',
        type: 'classroom_screen',
        status: 'offline',
      } as any);
    binding = await db
      .getRepository(DeviceBinding)
      .save({
        deviceId: device.id,
        classId: cls.id,
        classroomId: room.id,
        status: 'active',
        boundByType: 'teacher',
        boundBy: teacher.id,
        boundAt: new Date(),
      } as any);
    const plan = await db
      .getRepository(LessonPlan)
      .save({
        teacherId: teacher.id,
        schoolId: 'synthetic',
        title: '原始教案',
        theme: '测试',
        ageGroup: '3-4',
        objectives: '最新目标不可回退',
        estimatedMinutes: 10,
        status: 'draft',
        version: 1,
      } as any);
    run = await db
      .getRepository(ClassroomRun)
      .save({
        lessonPlanId: plan.id,
        lessonPlanVersion: 1,
        teacherId: teacher.id,
        classId: cls.id,
        classroomId: room.id,
        deviceId: device.id,
        title: plan.title,
        status: 'running',
        version: 1,
        startedAt: new Date(),
        currentStepIndex: 0,
      } as any);
    for (const i of [0, 1])
      await db
        .getRepository(ClassroomRunStepSnapshot)
        .save({
          classroomRunId: run.id,
          originalStepId: i + 1,
          stepIndex: i,
          title: `步骤${i}`,
          type: 'introduction',
          content: `学生${i}`,
          teacherTip: `教师${i}`,
          durationSeconds: 60,
        });
    await capture();
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
  });
  it('does not settle an expired break or repair a stale snapshot during GET', async () => {
    await db.getRepository(ClassroomRun).update(run.id, { breakStartedAt: new Date(Date.now() - 120000), breakEndsAt: new Date(Date.now() - 60000), version: 2 });
    const before = await digest();
    const result = await get().expect(200);
    expect(result.body.break.active).toBe(true);
    expect(result.body.recovery).toMatchObject({ manualInterventionRequired: true, warnings: expect.arrayContaining(['SNAPSHOT_MISSING_OR_NOT_CURRENT']) });
    expect(await digest()).toBe(before);
  });
  it('is authorized, private and read-only across repeated GETs; frozen version never falls back', async () => {
    const before = await digest();
    const result = await get().expect(200);
    expect(result.headers['cache-control']).toBe('private, no-store');
    expect(result.body).toMatchObject({
      schemaVersion: 1,
      phase: 'teaching',
      presentation: { delivery: 'unknown', observation: null },
      lesson: {
        frozenVersionAvailable: false,
        currentStep: { studentContent: '学生0', teacherInstruction: '教师0' },
        nextStep: { studentContent: '学生1' },
        totalSteps: 2,
      },
    });
    await get().expect(200);
    expect(await digest()).toBe(before);
    expect((await db.query('PRAGMA integrity_check'))[0].integrity_check).toBe(
      'ok',
    );
  });
  it('freezes version data independently of source plan edits', async () => {
    await db
      .getRepository(LessonPlanVersion)
      .save({
        lessonPlanId: run.lessonPlanId,
        versionNo: 1,
        snapshotJson: JSON.stringify({
          title: '冻结标题',
          objectives: '冻结目标',
        }),
        createdBy: actor.sub,
        createdByType: 'teacher',
        changeSummary: '测试',
      } as any);
    await db
      .getRepository(LessonPlan)
      .update(run.lessonPlanId, {
        title: '新标题',
        objectives: '新目标',
        version: 2,
      });
    expect((await get().expect(200)).body.lesson.frozen).toEqual({
      title: '冻结标题',
      objectives: '冻结目标',
    });
  });
  it('rejects unauthenticated, missing, other teacher and revoked class reads without writes', async () => {
    await request(app.getHttpServer())
      .get(`/classroom-runs/${run.id}/cockpit`)
      .expect(401);
    await request(app.getHttpServer())
      .get('/classroom-runs/999999/cockpit')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    await db
      .getRepository(ClassroomRun)
      .update(run.id, { teacherId: actor.sub + 999 });
    await get().expect(403);
    await db
      .getRepository(ClassroomRun)
      .update(run.id, { teacherId: actor.sub });
    await db.getRepository(TeacherClass).delete({ teacherId: actor.sub });
    const before = await digest();
    await get().expect(403);
    expect(await digest()).toBe(before);
  });
  it.each([
    'opening',
    'paused',
    'completed',
    'cancelled',
    'failed',
    'recovery',
  ])('derives %s without altering lifecycle', async (phase) => {
    if (['opening', 'paused'].includes(phase))
      await app
        .get(ScreenLifecycleService)
        .createOpening(actor, {
          runId: run.id,
          deviceId: device.id,
          bindingId: binding.id,
          expectedRevision: 0,
        });
    if (['paused', 'completed', 'cancelled', 'failed'].includes(phase)) {
      await db
        .getRepository(ClassroomRun)
        .update(run.id, { status: phase as any });
      await capture();
    }
    if (phase === 'recovery')
      await db.query('UPDATE classroom_snapshot SET checksum=?', ['invalid']);
    const before = await digest();
    const result = await get().expect(200);
    expect(result.body.phase).toBe(
      ['completed', 'cancelled', 'failed'].includes(phase) ? 'terminal' : phase,
    );
    expect(await digest()).toBe(before);
  });
  it('ignores stale observation and does not expose arbitrary snapshot fields', async () => {
    await app
      .get(ClassroomSnapshotService)
      .capture(run.id, ClassroomSnapshotReason.Start, true, {
        playerState: { presentationCommandId: 'current' },
      });
    await app
      .get(ClassroomSnapshotService)
      .capture(run.id, ClassroomSnapshotReason.Start, true, {
        playerState: {
          presentationCommandId: 'current',
          presentationRevision: 1,
          observation: {
            presentationCommandId: 'old',
            presentationRevision: 1,
            status: 'playing',
          },
          secret: '/private/file',
        },
      });
    const result = await get().expect(200);
    expect(result.body.presentation.observation).toBeNull();
    expect(JSON.stringify(result.body)).not.toContain('/private/file');
  });
  it('rejects cross-school reads without audit or business writes', async () => {
    await db
      .getRepository(Teacher)
      .update(actor.sub, { schoolId: 'other-school' });
    const before = await digest();
    await get().expect(403);
    expect(await digest()).toBe(before);
  });
  it('bounds Run/Snapshot races and ignores ordinary heartbeat changes', async () => {
    const snapshots = app.get(ClassroomSnapshotService);
    const original = snapshots.loadLatestValid.bind(snapshots);
    const spy = jest
      .spyOn(snapshots, 'loadLatestValid')
      .mockImplementation(async (...args: any[]) => {
        await db
          .getRepository(Device)
          .update(device.id, { lastOnlineAt: new Date() });
        return original(...args);
      });
    await get().expect(200);
    spy.mockRestore();
    const race = jest
      .spyOn(snapshots, 'loadLatestValid')
      .mockImplementation(async (...args: any[]) => {
        await db.query(
          'UPDATE classroom_run SET version=version+1 WHERE id=?',
          [run.id],
        );
        return original(...args);
      });
    expect((await get().expect(409)).body.code).toBe('COCKPIT_STATE_CHANGED');
    expect(race.mock.calls.length).toBeLessThanOrEqual(6);
  });
  it('retries one committed state change and returns only the new coherent projection', async () => {
    const snapshots = app.get(ClassroomSnapshotService);
    const original = snapshots.loadLatestValid.bind(snapshots);
    let changed = false;
    jest
      .spyOn(snapshots, 'loadLatestValid')
      .mockImplementation(async (...args: any[]) => {
        const result = await original(...args);
        if (!changed) {
          changed = true;
          await db
            .getRepository(ClassroomRun)
            .update(run.id, { currentStepIndex: 1, version: 2 });
          await capture();
        }
        return result;
      });
    const result = await get().expect(200);
    expect(result.body.run.version).toBe(2);
    expect(result.body.lesson.currentStep.studentContent).toBe('学生1');
    expect(result.body.versions.snapshotRunVersion).toBe(2);
  });
  it('allows only correlated, validated player feedback', async () => {
    await app
      .get(ClassroomSnapshotService)
      .capture(run.id, ClassroomSnapshotReason.Start, true, {
        playerState: { presentationCommandId: 'current' },
      });
    await app
      .get(ClassroomSnapshotService)
      .capture(run.id, ClassroomSnapshotReason.Start, true, {
        playerObservation: {
          presentationCommandId: 'current',
          presentationRevision: 1,
          status: 'playing',
          currentTime: 2,
          errorCode: '/secret/path',
          arbitrary: 'private',
        },
      });
    const result = await get().expect(200);
    expect(result.body.presentation.observation).toMatchObject({
      status: 'playing',
      currentTime: 2,
    });
    expect(result.body.presentation.observation).not.toHaveProperty(
      'arbitrary',
    );
    expect(result.body.presentation.observation).not.toHaveProperty(
      'errorCode',
    );
  });
});
