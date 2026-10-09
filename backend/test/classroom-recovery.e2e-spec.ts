import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AuthModule } from '../src/auth/auth.module';
import { Administrator } from '../src/auth/entities/administrator.entity';
import {
  AuthUserType,
  RefreshTokenSession,
} from '../src/auth/entities/refresh-token-session.entity';
import { Teacher } from '../src/auth/entities/teacher.entity';
import {
  CLASSROOM_RUN_ENTITIES,
  ClassroomRunModule,
} from '../src/classroom-runs/classroom-run.module';
import { ClassroomDeviceTransfer } from '../src/classroom-runs/entities/classroom-device-transfer.entity';
import { ClassroomRun } from '../src/classroom-runs/entities/classroom-run.entity';
import { ClassroomSnapshot } from '../src/classroom-runs/entities/classroom-snapshot.entity';
import {
  ResourceAgeGroup,
  ResourceReviewStatus,
  ResourceType,
  TeachingResource,
} from '../src/data/entities/teaching-resource.entity';
import { OwnerType } from '../src/data/owner.types';
import {
  LESSON_PLAN_ENTITIES,
  LessonPlanModule,
} from '../src/lesson-plans/lesson-plan.module';
import { Classroom } from '../src/platform/entities/classroom.entity';
import { DeviceBinding } from '../src/platform/entities/device-binding.entity';
import { Device } from '../src/platform/entities/device.entity';
import { SchoolClass } from '../src/platform/entities/school-class.entity';
import { TeacherClass } from '../src/platform/entities/teacher-class.entity';
import {
  PLATFORM_ENTITIES,
  PlatformModule,
} from '../src/platform/platform.module';
import {
  BindingStatus,
  DeviceStatus,
  DeviceType,
  RecordStatus,
  TeacherClassRole,
} from '../src/platform/platform.types';
import {
  RESOURCE_ENTITIES,
  ResourceModule,
} from '../src/resources/resource.module';

describe('Task five classroom snapshot and recovery (e2e)', () => {
  const database = join(process.cwd(), 'temp-classroom-recovery.e2e.sqlite');
  let app: INestApplication;
  let token: string;
  let teacherId: number;
  let classId: number;
  let classroomId: number;
  let deviceId: number;
  let newDeviceId: number;
  let resourceId: number;
  let lessonPlanId: number;
  let runId: number;

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const requestId = (label: string) =>
    `${label}-${Date.now()}-${Math.random()}`;

  async function createApp() {
    const fixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              JWT_ACCESS_SECRET: 'snapshot-test-secret-long-enough',
              JWT_ACCESS_EXPIRES_IN: '2h',
              JWT_REFRESH_EXPIRES_IN: '30d',
              TEST_TEACHER_ACCOUNT: 'snapshot_teacher',
              TEST_TEACHER_PASSWORD: 'Teacher123!',
              TEST_TEACHER_NAME: '恢复测试教师',
              ARK_API_KEY: 'snapshot-test-key',
              ARK_ENDPOINT_ID: 'snapshot-test-model',
            }),
          ],
        }),
        ScheduleModule.forRoot(),
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database,
          entities: [
            Teacher,
            Administrator,
            RefreshTokenSession,
            TeachingResource,
            ...PLATFORM_ENTITIES,
            ...RESOURCE_ENTITIES,
            ...LESSON_PLAN_ENTITIES,
            ...CLASSROOM_RUN_ENTITIES,
          ],
          synchronize: true,
        }),
        AuthModule,
        PlatformModule,
        ResourceModule,
        LessonPlanModule,
        ClassroomRunModule,
      ],
    }).compile();
    const application = fixture.createNestApplication();
    application.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await application.init();
    return application;
  }

  async function login() {
    token = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ account: 'snapshot_teacher', password: 'Teacher123!' })
        .expect(200)
    ).body.access_token as string;
  }

  beforeAll(async () => {
    await unlink(database).catch(() => undefined);
    app = await createApp();
    const teachers = app.get<Repository<Teacher>>(getRepositoryToken(Teacher));
    const teacher = await teachers.findOneByOrFail({
      account: 'snapshot_teacher',
    });
    teacher.schoolId = 'garden-recovery';
    await teachers.save(teacher);
    teacherId = teacher.id;
    await login();

    const classes = app.get<Repository<SchoolClass>>(
      getRepositoryToken(SchoolClass),
    );
    classId = (
      await classes.save(
        classes.create({
          schoolId: 'garden-recovery',
          name: '恢复测试班',
          grade: '中班',
          ageRange: '4-5',
          schoolYear: '2026',
          status: RecordStatus.Active,
        }),
      )
    ).id;
    const teacherClasses = app.get<Repository<TeacherClass>>(
      getRepositoryToken(TeacherClass),
    );
    await teacherClasses.save(
      teacherClasses.create({
        teacherId,
        classId,
        role: TeacherClassRole.Lead,
      }),
    );
    const classrooms = app.get<Repository<Classroom>>(
      getRepositoryToken(Classroom),
    );
    classroomId = (
      await classrooms.save(
        classrooms.create({
          schoolId: 'garden-recovery',
          name: '恢复测试教室',
          location: '一楼',
          status: RecordStatus.Active,
        }),
      )
    ).id;
    const devices = app.get<Repository<Device>>(getRepositoryToken(Device));
    deviceId = (
      await devices.save(
        devices.create({
          deviceCode: 'RECOVERY-OLD',
          schoolId: 'garden-recovery',
          name: '原课堂大屏',
          type: DeviceType.ClassroomScreen,
          status: DeviceStatus.Online,
          lastOnlineAt: new Date(),
        }),
      )
    ).id;
    newDeviceId = (
      await devices.save(
        devices.create({
          deviceCode: 'RECOVERY-NEW',
          schoolId: 'garden-recovery',
          name: '接管大屏',
          type: DeviceType.ClassroomScreen,
          status: DeviceStatus.Online,
          lastOnlineAt: new Date(),
        }),
      )
    ).id;
    const bindings = app.get<Repository<DeviceBinding>>(
      getRepositoryToken(DeviceBinding),
    );
    await bindings.save(
      bindings.create({
        deviceId,
        classroomId,
        classId,
        boundByType: AuthUserType.Teacher,
        boundBy: teacherId,
        boundAt: new Date(),
        unboundAt: null,
        status: BindingStatus.Active,
      }),
    );
    const resources = app.get<Repository<TeachingResource>>(
      getRepositoryToken(TeachingResource),
    );
    resourceId = (
      await resources.save(
        resources.create({
          title: '恢复测试图片',
          aliases: '[]',
          description: null,
          schoolId: 'garden-recovery',
          resourceType: ResourceType.Image,
          category: '图片卡片',
          categoryId: null,
          ageGroup: ResourceAgeGroup.Middle,
          domain: '科学',
          tags: '[]',
          fileUrl: '',
          coverUrl: null,
          fileName: 'recovery.png',
          mimeType: 'image/png',
          fileSize: 100,
          duration: null,
          currentVersionId: null,
          aiTeachingGoals: null,
          aiActivitySuggestions: null,
          reviewStatus: ResourceReviewStatus.Approved,
          deletedAt: null,
          ownerType: OwnerType.Teacher,
          ownerId: String(teacherId),
          type: null,
          url: null,
        }),
      )
    ).id;
    const plan = await request(app.getHttpServer())
      .post('/lesson-plans')
      .set(auth())
      .send({
        title: '可恢复课堂',
        theme: '观察图片',
        ageGroup: '4-5',
        objectives: '观察并表达',
        estimatedMinutes: 20,
        status: 'ready',
      })
      .expect(201);
    lessonPlanId = plan.body.id as number;
    await request(app.getHttpServer())
      .put(`/lesson-plans/${lessonPlanId}/steps`)
      .set(auth())
      .send({
        version: 1,
        steps: [
          {
            title: '播放图片',
            stepType: 'resource',
            content: '观察图片',
            durationSeconds: 60,
            resourceId,
          },
          {
            title: '交流发现',
            stepType: 'question',
            content: '你看到了什么？',
            durationSeconds: 90,
          },
        ],
      })
      .expect(200);
  });

  afterAll(async () => {
    if (app) await app.close();
    await unlink(database).catch(() => undefined);
  });

  it('persists snapshots across restart and avoids replaying completed resources', async () => {
    const started = await request(app.getHttpServer())
      .post('/classroom-runs/start')
      .set(auth())
      .send({
        lessonPlanId,
        classId,
        classroomId,
        deviceId,
        requestId: requestId('start'),
      })
      .expect(201);
    runId = started.body.id as number;
    expect(started.body.version).toBe(1);
    const runs = app.get<Repository<ClassroomRun>>(
      getRepositoryToken(ClassroomRun),
    );
    await runs.update(runId, { resumedAt: new Date(Date.now() - 5000) });
    const checkpoint = await request(app.getHttpServer())
      .post(`/classroom-runs/${runId}/checkpoints`)
      .set(auth())
      .send({
        version: 1,
        deviceId,
        requestId: requestId('resource-complete'),
        checkpointType: 'resource_completed',
        resourceId,
        playerState: { resourceId, positionSeconds: 60, completed: true },
      })
      .expect(201);
    expect(checkpoint.body.playedResourceIds).toContain(resourceId);
    expect(checkpoint.body.playerRecoverySuggestion.autoPlay).toBe(false);
    expect(checkpoint.body.latestSnapshotVersion).toBe(2);

    await app.close();
    app = await createApp();
    await login();
    const active = await request(app.getHttpServer())
      .get(`/classroom-runs/active?deviceId=${deviceId}`)
      .set(auth())
      .expect(200);
    expect(active.body).toHaveLength(1);
    expect(active.body[0].id).toBe(runId);
    const restored = await request(app.getHttpServer())
      .get(`/classroom-runs/${runId}/restore?deviceId=${deviceId}`)
      .set(auth())
      .expect(200);
    expect(restored.body).toMatchObject({
      status: 'running',
      latestSnapshotVersion: 2,
      manualInterventionRequired: false,
    });
    expect(restored.body.playedResourceIds).toContain(resourceId);
    expect(restored.body.playerRecoverySuggestion.autoPlay).toBe(false);
    expect(restored.body.timing.elapsedSeconds).toBeGreaterThanOrEqual(5);
  });

  it('falls back from a damaged snapshot and performs idempotent recovery', async () => {
    const snapshots = app.get<Repository<ClassroomSnapshot>>(
      getRepositoryToken(ClassroomSnapshot),
    );
    const newest = await snapshots.findOneOrFail({
      where: { classroomRunId: runId },
      order: { snapshotVersion: 'DESC' },
    });
    newest.checksum = '0'.repeat(64);
    await snapshots.save(newest);
    const fallback = await request(app.getHttpServer())
      .get(`/classroom-runs/${runId}/restore?deviceId=${deviceId}`)
      .set(auth())
      .expect(200);
    expect(fallback.body.latestSnapshotVersion).toBe(1);
    const recoverRequestId = requestId('recover');
    const recovered = await request(app.getHttpServer())
      .post(`/classroom-runs/${runId}/recover`)
      .set(auth())
      .send({ version: 2, deviceId, requestId: recoverRequestId })
      .expect(201);
    expect(recovered.body).toMatchObject({
      status: 'running',
      latestSnapshotVersion: 3,
      version: 3,
    });
    const repeated = await request(app.getHttpServer())
      .post(`/classroom-runs/${runId}/recover`)
      .set(auth())
      .send({ version: 2, deviceId, requestId: recoverRequestId })
      .expect(201);
    expect(repeated.body.version).toBe(3);
  });

  it('requires teacher confirmation for an unbound device and revokes the old device', async () => {
    await request(app.getHttpServer())
      .post(`/classroom-runs/${runId}/takeover`)
      .set(auth())
      .send({
        version: 3,
        oldDeviceId: deviceId,
        newDeviceId,
        teacherConfirmed: false,
        reason: '原设备断电',
        requestId: requestId('unauthorized-takeover'),
      })
      .expect(403);
    const takeoverRequestId = requestId('takeover');
    const takeover = await request(app.getHttpServer())
      .post(`/classroom-runs/${runId}/takeover`)
      .set(auth())
      .send({
        version: 3,
        oldDeviceId: deviceId,
        newDeviceId,
        teacherConfirmed: true,
        reason: '教师确认换到备用大屏',
        requestId: takeoverRequestId,
      })
      .expect(201);
    expect(takeover.body).toMatchObject({ deviceId: newDeviceId, version: 4 });
    const repeated = await request(app.getHttpServer())
      .post(`/classroom-runs/${runId}/takeover`)
      .set(auth())
      .send({
        version: 3,
        oldDeviceId: deviceId,
        newDeviceId,
        teacherConfirmed: true,
        reason: '教师确认换到备用大屏',
        requestId: takeoverRequestId,
      })
      .expect(201);
    expect(repeated.body.version).toBe(4);
    expect(
      await app
        .get<Repository<ClassroomDeviceTransfer>>(
          getRepositoryToken(ClassroomDeviceTransfer),
        )
        .countBy({ classroomRunId: runId }),
    ).toBe(1);
    await request(app.getHttpServer())
      .post(`/classroom-runs/${runId}/pause`)
      .set(auth())
      .send({ version: 4, deviceId, requestId: requestId('old-device') })
      .expect(403);
    const oldActive = await request(app.getHttpServer())
      .get(`/classroom-runs/active?deviceId=${deviceId}`)
      .set(auth())
      .expect(200);
    expect(oldActive.body).toEqual([]);
    const paused = await request(app.getHttpServer())
      .post(`/classroom-runs/${runId}/pause`)
      .set(auth())
      .send({
        version: 4,
        deviceId: newDeviceId,
        requestId: requestId('new-device-pause'),
      })
      .expect(201);
    expect(paused.body).toMatchObject({ status: 'paused', version: 5 });
    const pausedRestore = await request(app.getHttpServer())
      .get(`/classroom-runs/${runId}/restore?deviceId=${newDeviceId}`)
      .set(auth())
      .expect(200);
    expect(pausedRestore.body.status).toBe('paused');
    expect(pausedRestore.body.timing.isRunning).toBe(false);
  });

  it('protects terminal runs and returns a safe state when every snapshot is damaged', async () => {
    const completed = await request(app.getHttpServer())
      .post(`/classroom-runs/${runId}/complete`)
      .set(auth())
      .send({
        version: 5,
        deviceId: newDeviceId,
        requestId: requestId('complete'),
      })
      .expect(201);
    expect(completed.body).toMatchObject({ status: 'completed', version: 6 });
    await request(app.getHttpServer())
      .post(`/classroom-runs/${runId}/recover`)
      .set(auth())
      .send({
        version: 6,
        deviceId: newDeviceId,
        requestId: requestId('ended-recover'),
      })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/classroom-runs/${runId}/takeover`)
      .set(auth())
      .send({
        version: 6,
        oldDeviceId: newDeviceId,
        newDeviceId: deviceId,
        teacherConfirmed: true,
        reason: '结束后接管',
        requestId: requestId('ended-takeover'),
      })
      .expect(409);
    const snapshots = app.get<Repository<ClassroomSnapshot>>(
      getRepositoryToken(ClassroomSnapshot),
    );
    await snapshots
      .createQueryBuilder()
      .update(ClassroomSnapshot)
      .set({ checksum: 'f'.repeat(64) })
      .where('classroom_run_id = :runId', { runId })
      .execute();
    const safe = await request(app.getHttpServer())
      .get(`/classroom-runs/${runId}/restore?deviceId=${newDeviceId}`)
      .set(auth())
      .expect(200);
    expect(safe.body).toMatchObject({
      status: 'completed',
      latestSnapshotVersion: null,
      manualInterventionRequired: true,
    });
    expect(
      await app
        .get<Repository<ClassroomRun>>(getRepositoryToken(ClassroomRun))
        .count(),
    ).toBe(1);
  });
});
