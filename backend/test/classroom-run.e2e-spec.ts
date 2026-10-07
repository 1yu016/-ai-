import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import request from 'supertest';
import { In, Repository } from 'typeorm';
import { AuthModule } from '../src/auth/auth.module';
import { Administrator } from '../src/auth/entities/administrator.entity';
import { RefreshTokenSession } from '../src/auth/entities/refresh-token-session.entity';
import { Teacher, TeacherRole } from '../src/auth/entities/teacher.entity';
import { AuthUserType } from '../src/auth/entities/refresh-token-session.entity';
import { AVATAR_ENTITIES } from '../src/avatars/avatar.module';
import { AVATAR_UPLOAD_DIRECTORY } from '../src/avatars/avatar-file.validation';
import {
  AvatarActionName,
  AvatarAssetType,
  AvatarBindingScope,
  AvatarBindingStatus,
  AvatarCategory,
  AvatarCharacterStatus,
  AvatarModelFormat,
  AvatarVersionStatus,
} from '../src/avatars/avatar.types';
import { AvatarAsset } from '../src/avatars/entities/avatar-asset.entity';
import { AvatarBinding } from '../src/avatars/entities/avatar-binding.entity';
import { AvatarCharacter } from '../src/avatars/entities/avatar-character.entity';
import { AvatarVersion } from '../src/avatars/entities/avatar-version.entity';
import {
  CLASSROOM_RUN_ENTITIES,
  ClassroomRunModule,
} from '../src/classroom-runs/classroom-run.module';
import { ClassroomEvent } from '../src/classroom-runs/entities/classroom-event.entity';
import { ClassroomSnapshot } from '../src/classroom-runs/entities/classroom-snapshot.entity';
import { ClassroomRun } from '../src/classroom-runs/entities/classroom-run.entity';
import { ClassroomRunStepSnapshot } from '../src/classroom-runs/entities/classroom-run-step-snapshot.entity';
import { ClassroomCommandRecord } from '../src/classroom-runs/entities/classroom-command-record.entity';
import { Student } from '../src/platform/entities/student.entity';
import { StudentAttendanceRecord } from '../src/classroom-runs/entities/student-attendance-record.entity';
import { StudentAttendanceChange } from '../src/classroom-runs/entities/student-attendance-change.entity';
import { ClassroomRollCallRecord } from '../src/classroom-runs/entities/classroom-roll-call-record.entity';
import {
  ClassroomEventType,
  ClassroomRunStatus,
  ClassroomSnapshotReason,
  isBreakActive,
} from '../src/classroom-runs/classroom-run.types';
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
import { ClassroomMobileModule } from '../src/classroom-mobile/classroom-mobile.module';
import { ClassroomControlSession } from '../src/classroom-mobile/entities/classroom-control-session.entity';

type PlanFixture = { id: number; version: number };

describe('Task four classroom run state machine (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let otherToken: string;
  let adminToken: string;
  let teacherId: number;
  let classId: number;
  let foreignClassId: number;
  let classroomId: number;
  let deviceId: number;
  let classroom2Id: number;
  let device2Id: number;
  let approvedResourceId: number;
  let draftResourceId: number;
  let events: Repository<ClassroomEvent>;
  const avatarFiles: string[] = [];

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const requestId = (label: string) =>
    `${label}-${Date.now()}-${Math.random()}`;

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              JWT_ACCESS_SECRET: 'classroom-run-test-secret-long-enough',
              JWT_ACCESS_EXPIRES_IN: '2h',
              JWT_REFRESH_EXPIRES_IN: '30d',
              TEST_TEACHER_ACCOUNT: 'run_teacher',
              TEST_TEACHER_PASSWORD: 'Teacher123!',
              TEST_TEACHER_NAME: '课堂老师',
              ARK_API_KEY: 'classroom-test-key',
              ARK_ENDPOINT_ID: 'classroom-test-model',
            }),
          ],
        }),
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
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
            ClassroomControlSession,
          ],
          synchronize: true,
        }),
        AuthModule,
        PlatformModule,
        ResourceModule,
        LessonPlanModule,
        ClassroomRunModule,
        ClassroomMobileModule,
      ],
    }).compile();
    app = fixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    const teachers = app.get<Repository<Teacher>>(getRepositoryToken(Teacher));
    const teacher = await teachers.findOneByOrFail({ account: 'run_teacher' });
    teacher.schoolId = 'garden-run';
    await teachers.save(teacher);
    teacherId = teacher.id;
    const other = await teachers.save(
      teachers.create({
        account: 'run_other',
        passwordHash: await bcrypt.hash('Teacher123!', 4),
        name: '其他教师',
        role: TeacherRole.Teacher,
        schoolId: 'garden-run',
      }),
    );
    token = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ account: teacher.account, password: 'Teacher123!' })
        .expect(200)
    ).body.access_token as string;
    otherToken = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ account: other.account, password: 'Teacher123!' })
        .expect(200)
    ).body.access_token as string;
    const administrators = app.get<Repository<Administrator>>(
      getRepositoryToken(Administrator),
    );
    await administrators.save(
      administrators.create({
        account: 'run_admin',
        passwordHash: await bcrypt.hash('Admin123!', 4),
        name: '课堂审计管理员',
        schoolId: 'garden-run',
      }),
    );
    adminToken = (
      await request(app.getHttpServer())
        .post('/auth/admin/login')
        .send({ account: 'run_admin', password: 'Admin123!' })
        .expect(200)
    ).body.access_token as string;

    const classes = app.get<Repository<SchoolClass>>(
      getRepositoryToken(SchoolClass),
    );
    const mainClass = await classes.save(
      classes.create({
        schoolId: 'garden-run',
        name: '中一班',
        grade: '中班',
        ageRange: '4-5',
        schoolYear: '2026',
        status: RecordStatus.Active,
      }),
    );
    classId = mainClass.id;
    foreignClassId = (
      await classes.save(
        classes.create({
          schoolId: 'garden-run',
          name: '中二班',
          grade: '中班',
          ageRange: '4-5',
          schoolYear: '2026',
          status: RecordStatus.Active,
        }),
      )
    ).id;
    await app
      .get<Repository<TeacherClass>>(getRepositoryToken(TeacherClass))
      .save(
        app
          .get<Repository<TeacherClass>>(getRepositoryToken(TeacherClass))
          .create({
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
          schoolId: 'garden-run',
          name: '一号教室',
          location: '一楼',
          status: RecordStatus.Active,
        }),
      )
    ).id;
    classroom2Id = (
      await classrooms.save(
        classrooms.create({
          schoolId: 'garden-run',
          name: '二号教室',
          location: '二楼',
          status: RecordStatus.Active,
        }),
      )
    ).id;
    const devices = app.get<Repository<Device>>(getRepositoryToken(Device));
    deviceId = (
      await devices.save(
        devices.create({
          deviceCode: 'RUN-SCREEN-1',
          schoolId: 'garden-run',
          name: '一号大屏',
          type: DeviceType.ClassroomScreen,
          status: DeviceStatus.Offline,
          lastOnlineAt: null,
        }),
      )
    ).id;
    device2Id = (
      await devices.save(
        devices.create({
          deviceCode: 'RUN-SCREEN-2',
          schoolId: 'garden-run',
          name: '二号大屏',
          type: DeviceType.ClassroomScreen,
          status: DeviceStatus.Offline,
          lastOnlineAt: null,
        }),
      )
    ).id;
    const bindings = app.get<Repository<DeviceBinding>>(
      getRepositoryToken(DeviceBinding),
    );
    await bindings.save([
      bindings.create({
        deviceId,
        classroomId,
        classId,
        boundByType: 'teacher' as never,
        boundBy: teacherId,
        boundAt: new Date(),
        unboundAt: null,
        status: BindingStatus.Active,
      }),
      bindings.create({
        deviceId: device2Id,
        classroomId: classroom2Id,
        classId,
        boundByType: 'teacher' as never,
        boundBy: teacherId,
        boundAt: new Date(),
        unboundAt: null,
        status: BindingStatus.Active,
      }),
    ]);

    const resources = app.get<Repository<TeachingResource>>(
      getRepositoryToken(TeachingResource),
    );
    const resourceValues = (status: ResourceReviewStatus, title: string) => ({
      title,
      aliases: '[]',
      description: null,
      schoolId: 'garden-run',
      resourceType: ResourceType.Image,
      category: '图片卡片',
      categoryId: null,
      ageGroup: ResourceAgeGroup.Middle,
      domain: '科学',
      tags: '[]',
      fileUrl: '',
      coverUrl: null,
      fileName: `${title}.png`,
      mimeType: 'image/png',
      fileSize: 100,
      duration: null,
      currentVersionId: null,
      aiTeachingGoals: null,
      aiActivitySuggestions: null,
      reviewStatus: status,
      deletedAt: null,
      ownerType: OwnerType.Teacher,
      ownerId: String(teacherId),
      type: null,
      url: null,
    });
    approvedResourceId = (
      await resources.save(
        resources.create(
          resourceValues(ResourceReviewStatus.Approved, '审核图片'),
        ),
      )
    ).id;
    draftResourceId = (
      await resources.save(
        resources.create(
          resourceValues(ResourceReviewStatus.Draft, '草稿图片'),
        ),
      )
    ).id;
    events = app.get(getRepositoryToken(ClassroomEvent));
  });

  afterAll(async () => {
    for (const path of avatarFiles) await unlink(path).catch(() => undefined);
    await app.close();
  });

  async function seedReadyAvatar(name: string) {
    const characterRepo = app.get<Repository<AvatarCharacter>>(
      getRepositoryToken(AvatarCharacter),
    );
    const versionRepo = app.get<Repository<AvatarVersion>>(
      getRepositoryToken(AvatarVersion),
    );
    const assetRepo = app.get<Repository<AvatarAsset>>(
      getRepositoryToken(AvatarAsset),
    );
    const character = await characterRepo.save(
      characterRepo.create({
        name,
        category: AvatarCategory.TeacherAssistant,
        description: null,
        ownerType: AuthUserType.Teacher,
        ownerId: teacherId,
        schoolId: 'garden-run',
        status: AvatarCharacterStatus.Approved,
        currentVersionId: null,
      }),
    );
    const version = await versionRepo.save(
      versionRepo.create({
        characterId: character.id,
        version: 1,
        engineVersion: 'avatar-engine-1',
        modelFormat: AvatarModelFormat.Glb,
        checksum: 'a'.repeat(64),
        status: AvatarVersionStatus.Ready,
        compatibility: '{}',
      }),
    );
    character.currentVersionId = version.id;
    await characterRepo.save(character);
    const makeAsset = async (
      assetType: AvatarAssetType,
      actionName: AvatarActionName | null,
      suffix: string,
    ) => {
      const filename = `${randomUUID()}-${suffix}`;
      const path = `${AVATAR_UPLOAD_DIRECTORY}/${filename}`;
      const data = Buffer.from(`${name}-${assetType}-${actionName ?? ''}`);
      await writeFile(path, data);
      avatarFiles.push(path);
      return assetRepo.save(
        assetRepo.create({
          versionId: version.id,
          assetType,
          actionName,
          originalName: suffix,
          filePath: filename,
          mimeType:
            assetType === AvatarAssetType.Fallback2d
              ? 'image/png'
              : 'model/gltf-binary',
          fileSize: data.length,
          checksum: createHash('sha256').update(data).digest('hex'),
          metadata: '{}',
        }),
      );
    };
    const model = await makeAsset(AvatarAssetType.Model, null, 'model.glb');
    const fallback = await makeAsset(
      AvatarAssetType.Fallback2d,
      null,
      'fallback.png',
    );
    await makeAsset(
      AvatarAssetType.Animation,
      AvatarActionName.Idle,
      'idle.glb',
    );
    return { character, version, model, fallback };
  }

  async function createPlan(
    withSteps = true,
    resourceId?: number,
  ): Promise<PlanFixture> {
    const created = await request(app.getHttpServer())
      .post('/lesson-plans')
      .set(auth())
      .send({
        title: `课堂教案-${Date.now()}-${Math.random()}`,
        theme: '认识自然',
        ageGroup: '4-5',
        objectives: '观察、表达并参与互动',
        estimatedMinutes: 20,
        status: 'ready',
      })
      .expect(201);
    if (!withSteps) return { id: created.body.id, version: 1 };
    const saved = await request(app.getHttpServer())
      .put(`/lesson-plans/${created.body.id}/steps`)
      .set(auth())
      .send({
        version: 1,
        steps: [
          {
            title: '观察导入',
            stepType: resourceId ? 'resource' : 'introduction',
            content: '观察第一张图片',
            durationSeconds: 60,
            ...(resourceId ? { resourceId } : {}),
            actions: [{ actionType: 'avatar_action', actionName: 'wave' }],
          },
          {
            title: '互动提问',
            stepType: 'question',
            content: '你发现了什么？',
            durationSeconds: 90,
            recoveryPoint: {
              name: '重新提问',
              trigger: 'manual',
              recoveryStepOrder: 1,
            },
          },
        ],
      })
      .expect(200);
    return { id: created.body.id, version: saved.body.version as number };
  }

  function startBody(planId: number, overrides: Record<string, unknown> = {}) {
    return {
      lessonPlanId: planId,
      classId,
      classroomId,
      deviceId,
      requestId: requestId('start'),
      ...overrides,
    };
  }

  it('drives the classroom screen from server state and restores player snapshots', async () => {
    const idle = await request(app.getHttpServer())
      .get(`/classroom-runs/screen-state?deviceId=${deviceId}`)
      .set(auth())
      .expect(200);
    expect(idle.body).toMatchObject({ page: 'idle', deviceId, classroomState: null });

    const plan = await createPlan(true, approvedResourceId);
    const started = await request(app.getHttpServer())
      .post('/classroom-runs/start')
      .set(auth())
      .send(startBody(plan.id))
      .expect(201);
    const classroom = await request(app.getHttpServer())
      .get(`/classroom-runs/screen-state?deviceId=${deviceId}`)
      .set(auth())
      .expect(200);
    expect(classroom.body).toMatchObject({
      page: 'classroom',
      classroomState: { id: started.body.id, status: 'running' },
    });

    const breakStarted = await request(app.getHttpServer())
      .post(`/classroom-runs/${started.body.id}/break`)
      .set(auth())
      .send({
        version: 1,
        deviceId,
        requestId: requestId('screen-break'),
        durationSeconds: 180,
      })
      .expect(201);
    const breakScreen = await request(app.getHttpServer())
      .get(`/classroom-runs/screen-state?deviceId=${deviceId}`)
      .set(auth())
      .expect(200);
    expect(breakScreen.body.page).toBe('break');

    const breakEnded = await request(app.getHttpServer())
      .post(`/classroom-runs/${started.body.id}/break/end`)
      .set(auth())
      .send({
        version: breakStarted.body.version,
        deviceId,
        requestId: requestId('screen-break-end'),
      })
      .expect(200);

    const stepSnapshots = app.get<Repository<ClassroomRunStepSnapshot>>(
      getRepositoryToken(ClassroomRunStepSnapshot),
    );
    await stepSnapshots.update(
      { classroomRunId: started.body.id, stepIndex: 0 },
      { title: '绘画作品展示' },
    );
    const drawing = await request(app.getHttpServer())
      .get(`/classroom-runs/screen-state?deviceId=${deviceId}`)
      .set(auth())
      .expect(200);
    expect(drawing.body.page).toBe('drawing');

    await stepSnapshots.update(
      { classroomRunId: started.body.id, stepIndex: 0 },
      { title: '课堂奖励展示' },
    );
    const reward = await request(app.getHttpServer())
      .get(`/classroom-runs/screen-state?deviceId=${deviceId}`)
      .set(auth())
      .expect(200);
    expect(reward.body.page).toBe('reward');

    await stepSnapshots.update(
      { classroomRunId: started.body.id, stepIndex: 0 },
      { title: '观察导入' },
    );
    const checkpoint = await request(app.getHttpServer())
      .post(`/classroom-runs/${started.body.id}/checkpoints`)
      .set(auth())
      .send({
        version: breakEnded.body.version,
        deviceId,
        requestId: requestId('screen-player'),
        checkpointType: 'command',
        resourceId: approvedResourceId,
        playerState: {
          resourceId: approvedResourceId,
          status: 'paused',
          currentTime: 12.5,
          pageIndex: 2,
          zoom: 1.25,
          volume: 0.6,
          muted: false,
        },
      })
      .expect(201);
    const restored = await request(app.getHttpServer())
      .get(`/classroom-runs/screen-state?deviceId=${deviceId}`)
      .set(auth())
      .expect(200);
    expect(restored.body.classroomState.playerRecoverySuggestion).toMatchObject({
      resourceId: approvedResourceId,
      currentTime: 12.5,
      pageIndex: 2,
      zoom: 1.25,
      volume: 0.6,
      autoPlay: false,
    });

    await request(app.getHttpServer())
      .post(`/classroom-runs/${started.body.id}/complete`)
      .set(auth())
      .send({
        version: checkpoint.body.version,
        deviceId,
        requestId: requestId('screen-complete'),
      })
      .expect(201);
    const summary = await request(app.getHttpServer())
      .get(`/classroom-runs/screen-state?deviceId=${deviceId}`)
      .set(auth())
      .expect(200);
    expect(summary.body).toMatchObject({
      page: 'summary',
      classroomState: { status: 'completed' },
    });
  });

  it('allows administrators to audit but not control an active classroom', async () => {
    const plan = await createPlan(true, approvedResourceId);
    const started = await request(app.getHttpServer())
      .post('/classroom-runs/start')
      .set(auth())
      .send(startBody(plan.id))
      .expect(201);
    await request(app.getHttpServer())
      .post('/classroom-commands')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        requestId: requestId('admin-command-denied'),
        runId: started.body.id,
        deviceId,
        targetDeviceId: deviceId,
        expectedVersion: started.body.version,
        source: 'teacher_panel',
        operation: 'next_step',
      })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/classroom-runs/${started.body.id}/complete`)
      .set(auth())
      .send({
        version: started.body.version,
        deviceId,
        requestId: requestId('admin-command-cleanup'),
      })
      .expect(201);
  });

  it('starts atomically, freezes step snapshots, and enforces ownership', async () => {
    const plan = await createPlan(true, approvedResourceId);
    await request(app.getHttpServer())
      .post('/classroom-runs/start')
      .send(startBody(plan.id))
      .expect(401);
    const started = await request(app.getHttpServer())
      .post('/classroom-runs/start')
      .set(auth())
      .send(startBody(plan.id))
      .expect(201);
    expect(started.body).toMatchObject({
      lessonPlanId: plan.id,
      lessonPlanVersion: plan.version,
      status: 'running',
      currentStepIndex: 0,
      version: 1,
    });
    expect(started.body.steps).toHaveLength(2);
    expect(started.body.steps[0]).toMatchObject({
      content: '观察第一张图片',
      resourceId: approvedResourceId,
      actionConfig: [expect.objectContaining({ actionName: 'wave' })],
    });
    await request(app.getHttpServer())
      .put(`/lesson-plans/${plan.id}/steps`)
      .set(auth())
      .send({
        version: plan.version,
        steps: [
          {
            title: '已修改',
            stepType: 'summary',
            content: '教案后来被修改',
            durationSeconds: 60,
          },
        ],
      })
      .expect(200);
    const frozen = await request(app.getHttpServer())
      .get(`/classroom-runs/${started.body.id}`)
      .set(auth())
      .expect(200);
    expect(frozen.body.steps).toHaveLength(2);
    expect(frozen.body.steps[0].content).toBe('观察第一张图片');
    await request(app.getHttpServer())
      .get(`/classroom-runs/${started.body.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .post(`/classroom-runs/${started.body.id}/complete`)
      .set(auth())
      .send({ version: 1, deviceId, requestId: requestId('complete') })
      .expect(201);
  });

  it('isolates restore snapshots: other teachers cannot read attendance/reward state', async () => {
    const plan = await createPlan();
    const started = await request(app.getHttpServer())
      .post('/classroom-runs/start')
      .set(auth())
      .send(startBody(plan.id))
      .expect(201);
    const runId = started.body.id as number;
    // 教师A写入考勤+奖励快照，确保数据真实存在快照表中
    await request(app.getHttpServer())
      .post(`/classroom-runs/${runId}/checkpoints`)
      .set(auth())
      .send({
        version: 1,
        deviceId,
        requestId: requestId('roll-call'),
        checkpointType: 'roll_call',
        attendanceState: { 1: 'present' },
        rewardState: { 1: 2 },
      })
      .expect(201);
    // 教师B访问 restore：403 拒绝，响应体不含任何快照字段
    const denied = await request(app.getHttpServer())
      .get(`/classroom-runs/${runId}/restore?deviceId=${deviceId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403);
    const deniedBody = JSON.stringify(denied.body);
    expect(deniedBody).not.toContain('attendanceState');
    expect(deniedBody).not.toContain('rewardState');
    expect(deniedBody).not.toContain('present');
    // 教师A本人仍可正常恢复考勤与奖励
    const own = await request(app.getHttpServer())
      .get(`/classroom-runs/${runId}/restore?deviceId=${deviceId}`)
      .set(auth())
      .expect(200);
    expect(own.body.attendanceState).toEqual({ 1: 'present' });
    expect(own.body.rewardState).toEqual({ 1: 2 });
    // 清理：结束课堂，避免占用 class/device 导致后续用例冲突
    await request(app.getHttpServer())
      .post(`/classroom-runs/${runId}/complete`)
      .set(auth())
      .send({ version: 2, deviceId, requestId: requestId('complete') })
      .expect(201);
  });

  it('rejects empty plans, foreign classes, wrong bindings, and draft resources', async () => {
    const empty = await createPlan(false);
    await request(app.getHttpServer())
      .post('/classroom-runs/start')
      .set(auth())
      .send(startBody(empty.id))
      .expect(400);
    const valid = await createPlan();
    await request(app.getHttpServer())
      .post('/classroom-runs/start')
      .set(auth())
      .send(startBody(valid.id, { classId: foreignClassId }))
      .expect(403);
    await request(app.getHttpServer())
      .post('/classroom-runs/start')
      .set(auth())
      .send(startBody(valid.id, { classroomId: classroom2Id }))
      .expect(409);
    const draft = await createPlan(true, draftResourceId);
    await request(app.getHttpServer())
      .post('/classroom-runs/start')
      .set(auth())
      .send(startBody(draft.id))
      .expect(409);
  });

  it('prevents active class/device conflicts and makes start requestId idempotent', async () => {
    const plan = await createPlan();
    const body = startBody(plan.id);
    const first = await request(app.getHttpServer())
      .post('/classroom-runs/start')
      .set(auth())
      .send(body)
      .expect(201);
    const repeated = await request(app.getHttpServer())
      .post('/classroom-runs/start')
      .set(auth())
      .send(body)
      .expect(201);
    expect(repeated.body.id).toBe(first.body.id);
    expect(await events.countBy({ requestId: body.requestId })).toBe(1);
    const another = await createPlan();
    await request(app.getHttpServer())
      .post('/classroom-runs/start')
      .set(auth())
      .send(startBody(another.id))
      .expect(409);
    await request(app.getHttpServer())
      .post(`/classroom-runs/${first.body.id}/cancel`)
      .set(auth())
      .send({ version: 1, deviceId, requestId: requestId('cancel') })
      .expect(201);
  });

  it('enforces legal transitions, pause step protection, idempotency and terminal state', async () => {
    const plan = await createPlan();
    const started = await request(app.getHttpServer())
      .post('/classroom-runs/start')
      .set(auth())
      .send(startBody(plan.id))
      .expect(201);
    const pauseRequestId = requestId('pause');
    const paused = await request(app.getHttpServer())
      .post(`/classroom-runs/${started.body.id}/pause`)
      .set(auth())
      .send({ version: 1, deviceId, requestId: pauseRequestId })
      .expect(201);
    expect(paused.body).toMatchObject({ status: 'paused', version: 2 });
    const repeated = await request(app.getHttpServer())
      .post(`/classroom-runs/${started.body.id}/pause`)
      .set(auth())
      .send({ version: 1, deviceId, requestId: pauseRequestId })
      .expect(201);
    expect(repeated.body.version).toBe(2);
    expect(await events.countBy({ requestId: pauseRequestId })).toBe(1);
    await request(app.getHttpServer())
      .post(`/classroom-runs/${started.body.id}/steps/1`)
      .set(auth())
      .send({ version: 2, deviceId, requestId: requestId('step-paused') })
      .expect(409);
    const resumed = await request(app.getHttpServer())
      .post(`/classroom-runs/${started.body.id}/resume`)
      .set(auth())
      .send({ version: 2, deviceId, requestId: requestId('resume') })
      .expect(201);
    const stepped = await request(app.getHttpServer())
      .post(`/classroom-runs/${started.body.id}/steps/1`)
      .set(auth())
      .send({
        version: resumed.body.version,
        deviceId,
        requestId: requestId('step'),
      })
      .expect(201);
    expect(stepped.body).toMatchObject({ currentStepIndex: 1, version: 4 });
    await request(app.getHttpServer())
      .post(`/classroom-runs/${started.body.id}/steps/9`)
      .set(auth())
      .send({ version: 4, deviceId, requestId: requestId('bad-step') })
      .expect(400);
    const completed = await request(app.getHttpServer())
      .post(`/classroom-runs/${started.body.id}/complete`)
      .set(auth())
      .send({ version: 4, deviceId, requestId: requestId('complete') })
      .expect(201);
    expect(completed.body).toMatchObject({ status: 'completed', version: 5 });
    await request(app.getHttpServer())
      .post(`/classroom-runs/${started.body.id}/pause`)
      .set(auth())
      .send({ version: 5, deviceId, requestId: requestId('terminal') })
      .expect(409);
  });

  it('allows only one concurrent state change through optimistic locking', async () => {
    const plan = await createPlan();
    const started = await request(app.getHttpServer())
      .post('/classroom-runs/start')
      .set(auth())
      .send(
        startBody(plan.id, { classroomId: classroom2Id, deviceId: device2Id }),
      )
      .expect(201);
    const [pause, complete] = await Promise.all([
      request(app.getHttpServer())
        .post(`/classroom-runs/${started.body.id}/pause`)
        .set(auth())
        .send({
          version: 1,
          deviceId: device2Id,
          requestId: requestId('concurrent-pause'),
        }),
      request(app.getHttpServer())
        .post(`/classroom-runs/${started.body.id}/complete`)
        .set(auth())
        .send({
          version: 1,
          deviceId: device2Id,
          requestId: requestId('concurrent-complete'),
        }),
    ]);
    expect([pause.status, complete.status].sort()).toEqual([201, 409]);
    const current = await request(app.getHttpServer())
      .get(`/classroom-runs/${started.body.id}`)
      .set(auth())
      .expect(200);
    if (current.body.status === 'paused')
      await request(app.getHttpServer())
        .post(`/classroom-runs/${started.body.id}/complete`)
        .set(auth())
        .send({
          version: 2,
          deviceId: device2Id,
          requestId: requestId('cleanup-complete'),
        })
        .expect(201);
    const active = await request(app.getHttpServer())
      .get('/classroom-runs/active')
      .set(auth())
      .expect(200);
    expect(active.body).toEqual([]);
  });

  it('applies avatar binding priority, validates voice, snapshots temporary roles and falls back safely', async () => {
    const [systemAvatar, classAvatar, lessonAvatar, temporaryAvatar] =
      await Promise.all([
        seedReadyAvatar('系统角色'),
        seedReadyAvatar('班级角色'),
        seedReadyAvatar('教案角色'),
        seedReadyAvatar('课堂角色'),
      ]);
    await app
      .get<Repository<AvatarBinding>>(getRepositoryToken(AvatarBinding))
      .save({
        scopeType: AvatarBindingScope.System,
        scopeId: 0,
        characterId: systemAvatar.character.id,
        versionId: systemAvatar.version.id,
        createdBy: teacherId,
        status: AvatarBindingStatus.Active,
        cancelledAt: null,
      });

    await request(app.getHttpServer())
      .patch(`/avatars/characters/${classAvatar.character.id}/voice-profile`)
      .set(auth())
      .send({
        provider: 'demo',
        voiceId: 'child-1',
        language: 'zh-CN',
        speed: 2.5,
        volume: 1,
        pitch: 0,
        status: 'active',
        reason: '范围验证',
      })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/avatars/characters/${classAvatar.character.id}/voice-profile`)
      .set(auth())
      .send({
        provider: 'demo',
        voiceId: 'child-1',
        language: 'zh-CN',
        speed: 1.1,
        volume: 0.8,
        pitch: 2,
        status: 'active',
        reason: '设置班级音色',
      })
      .expect(200);

    const plan = await createPlan();
    await request(app.getHttpServer())
      .post(`/avatars/bindings/classes/${classId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({
        characterId: classAvatar.character.id,
        versionId: classAvatar.version.id,
        reason: '越权测试',
      })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/avatars/bindings/classes/${classId}`)
      .set(auth())
      .send({
        characterId: classAvatar.character.id,
        versionId: classAvatar.version.id,
        reason: '班级默认角色',
      })
      .expect(201);
    const classResolved = await request(app.getHttpServer())
      .get(`/avatars/resolve?classId=${classId}`)
      .set(auth())
      .expect(200);
    expect(classResolved.body.character.id).toBe(classAvatar.character.id);

    await request(app.getHttpServer())
      .post(`/avatars/bindings/lesson-plans/${plan.id}`)
      .set(auth())
      .send({
        characterId: lessonAvatar.character.id,
        versionId: lessonAvatar.version.id,
        reason: '教案指定角色',
      })
      .expect(201);
    const lessonResolved = await request(app.getHttpServer())
      .get(`/avatars/resolve?classId=${classId}&lessonPlanId=${plan.id}`)
      .set(auth())
      .expect(200);
    expect(lessonResolved.body.character.id).toBe(lessonAvatar.character.id);

    const started = await request(app.getHttpServer())
      .post('/classroom-runs/start')
      .set(auth())
      .send(startBody(plan.id))
      .expect(201);
    expect(started.body.avatarCharacterId).toBe(lessonAvatar.character.id);
    const pinnedAtStart = await request(app.getHttpServer())
      .get(
        `/avatars/resolve?classroomRunId=${started.body.id}&deviceId=${deviceId}`,
      )
      .set(auth())
      .expect(200);
    expect(pinnedAtStart.body).toMatchObject({
      sourceScope: 'classroom_run',
      character: { id: lessonAvatar.character.id },
      version: { id: lessonAvatar.version.id },
    });
    const changed = await request(app.getHttpServer())
      .post(`/classroom-runs/${started.body.id}/avatar-binding`)
      .set(auth())
      .send({
        characterId: temporaryAvatar.character.id,
        versionId: temporaryAvatar.version.id,
        reason: '课堂临时互动',
        requestId: requestId('avatar-set'),
        deviceId,
        version: 1,
      })
      .expect(201);
    expect(changed.body).toMatchObject({
      avatarCharacterId: temporaryAvatar.character.id,
      avatarVersionId: temporaryAvatar.version.id,
      version: 2,
    });
    const latestSnapshot = await app
      .get<Repository<ClassroomSnapshot>>(getRepositoryToken(ClassroomSnapshot))
      .findOneOrFail({
        where: { classroomRunId: started.body.id },
        order: { snapshotVersion: 'DESC' },
      });
    expect(latestSnapshot.avatarCharacterId).toBe(temporaryAvatar.character.id);

    await unlink(
      `${AVATAR_UPLOAD_DIRECTORY}/${temporaryAvatar.model.filePath}`,
    );
    const twoDimensional = await request(app.getHttpServer())
      .get(
        `/avatars/resolve?classroomRunId=${started.body.id}&deviceId=${deviceId}&actionName=question`,
      )
      .set(auth())
      .expect(200);
    expect(twoDimensional.body).toMatchObject({
      fallbackLevel: 'model_2d',
      renderAsset: { assetType: 'fallback_2d' },
      action: { requested: 'question', effective: 'idle' },
    });

    await unlink(
      `${AVATAR_UPLOAD_DIRECTORY}/${temporaryAvatar.fallback.filePath}`,
    );
    const versionRepo = app.get<Repository<AvatarVersion>>(
      getRepositoryToken(AvatarVersion),
    );
    classAvatar.version.status = AvatarVersionStatus.Disabled;
    lessonAvatar.version.status = AvatarVersionStatus.Disabled;
    await versionRepo.save([classAvatar.version, lessonAvatar.version]);
    const systemFallback = await request(app.getHttpServer())
      .get(
        `/avatars/resolve?classroomRunId=${started.body.id}&deviceId=${deviceId}`,
      )
      .set(auth())
      .expect(200);
    expect(systemFallback.body).toMatchObject({
      fallbackLevel: 'system_character',
      character: { id: systemAvatar.character.id },
    });

    await request(app.getHttpServer())
      .post(`/classroom-runs/${started.body.id}/complete`)
      .set(auth())
      .send({ version: 2, deviceId, requestId: requestId('avatar-complete') })
      .expect(201);
  });

  describe('unified classroom command bus (e2e)', () => {
    it('executes once, replays the first result, and rejects requestId payload changes', async () => {
      const plan = await createPlan();
      const started = await request(app.getHttpServer())
        .post('/classroom-runs/start')
        .set(auth())
        .send(startBody(plan.id))
        .expect(201);
      const rid = requestId('command-next');
      const body = {
        requestId: rid,
        runId: started.body.id,
        deviceId,
        expectedVersion: started.body.version,
        source: 'screen',
        operation: 'next_step',
      };
      const first = await request(app.getHttpServer())
        .post('/classroom-commands')
        .set(auth())
        .send(body)
        .expect(201);
      expect(first.body).toMatchObject({
        status: 'success',
        operation: 'next_step',
        classroomState: { currentStepIndex: 1, version: 2 },
      });
      const replay = await request(app.getHttpServer())
        .post('/classroom-commands')
        .set(auth())
        .send(body)
        .expect(201);
      expect(replay.body).toEqual(first.body);
      const foreignReplay = await request(app.getHttpServer())
        .post('/classroom-commands')
        .set('Authorization', `Bearer ${otherToken}`)
        .send(body)
        .expect(409);
      expect(foreignReplay.body.message).toContain('其他操作者');
      expect(foreignReplay.body.classroomState).toBeUndefined();
      await request(app.getHttpServer())
        .post('/classroom-commands')
        .set(auth())
        .send({ ...body, operation: 'previous_step' })
        .expect(409);
      const records = app.get<Repository<ClassroomCommandRecord>>(
        getRepositoryToken(ClassroomCommandRecord),
      );
      expect(await records.count({ where: { requestId: rid } })).toBe(1);
      await request(app.getHttpServer())
        .post('/classroom-commands')
        .set(auth())
        .send({
          requestId: requestId('command-complete'),
          runId: started.body.id,
          deviceId,
          expectedVersion: 2,
          source: 'screen',
          operation: 'complete_class',
        })
        .expect(201);
    });

    it('returns 409 with the latest classroom state when expectedVersion is stale', async () => {
      const plan = await createPlan();
      const started = await request(app.getHttpServer())
        .post('/classroom-runs/start')
        .set(auth())
        .send(startBody(plan.id))
        .expect(201);
      const conflict = await request(app.getHttpServer())
        .post('/classroom-commands')
        .set(auth())
        .send({
          requestId: requestId('command-stale'),
          runId: started.body.id,
          deviceId,
          expectedVersion: 99,
          source: 'teacher_panel',
          operation: 'next_step',
        })
        .expect(409);
      expect(conflict.body.latestClassroomState).toMatchObject({
        id: started.body.id,
        version: 1,
        currentStepIndex: 0,
      });
      await request(app.getHttpServer())
        .post(`/classroom-runs/${started.body.id}/complete`)
        .set(auth())
        .send({ version: 1, deviceId, requestId: requestId('command-cleanup') })
        .expect(201);
    });

    it('requires an explicit current target device for media operations', async () => {
      // 课堂中临时搜索到的已审核资源可以播放，即使它不是教案步骤的固定资源。
      const plan = await createPlan();
      const started = await request(app.getHttpServer())
        .post('/classroom-runs/start')
        .set(auth())
        .send(startBody(plan.id))
        .expect(201);
      await request(app.getHttpServer())
        .post('/classroom-commands')
        .set(auth())
        .send({
          requestId: requestId('command-media-no-target'),
          runId: started.body.id,
          deviceId,
          expectedVersion: 1,
          source: 'screen',
          operation: 'play_resource',
          parameters: { resourceId: approvedResourceId },
        })
        .expect(400);
      const played = await request(app.getHttpServer())
        .post('/classroom-commands')
        .set(auth())
        .send({
          requestId: requestId('command-media'),
          runId: started.body.id,
          deviceId,
          targetDeviceId: deviceId,
          expectedVersion: 1,
          source: 'screen',
          operation: 'play_resource',
          parameters: { resourceId: approvedResourceId },
        })
        .expect(201);
      expect(played.body).toMatchObject({
        targetDeviceId: deviceId,
        classroomState: { version: 2 },
        result: { delivery: 'accepted', targetDeviceId: deviceId },
      });
      await request(app.getHttpServer())
        .post(`/classroom-runs/${started.body.id}/complete`)
        .set(auth())
        .send({ version: 2, deviceId, requestId: requestId('command-media-cleanup') })
        .expect(201);
    });
  });

  describe('formal attendance and roll call (e2e)', () => {
    it('persists four attendance states, confirmation candidates, fair roll calls and isolation', async () => {
      const studentRepo = app.get<Repository<Student>>(getRepositoryToken(Student));
      const attendanceRepo = app.get<Repository<StudentAttendanceRecord>>(
        getRepositoryToken(StudentAttendanceRecord),
      );
      const changesRepo = app.get<Repository<StudentAttendanceChange>>(
        getRepositoryToken(StudentAttendanceChange),
      );
      const rollRepo = app.get<Repository<ClassroomRollCallRecord>>(
        getRepositoryToken(ClassroomRollCallRecord),
      );
      const suffix = `${Date.now()}-${Math.random()}`;
      const students = await studentRepo.save([
        ['安安', 'present'],
        ['贝贝', 'absent'],
        ['晨晨', 'late'],
        ['朵朵', 'leave'],
      ].map(([name], index) => studentRepo.create({
        classId,
        studentNo: `attendance-${suffix}-${index}`,
        name,
        nickname: `${name}小朋友`,
        gender: null,
        birthday: null,
        status: RecordStatus.Active,
      })));
      const disabled = await studentRepo.save(studentRepo.create({
        classId,
        studentNo: `attendance-${suffix}-disabled`,
        name: '停用幼儿',
        nickname: null,
        gender: null,
        birthday: null,
        status: RecordStatus.Disabled,
      }));
      const plan = await createPlan();
      const started = await request(app.getHttpServer())
        .post('/classroom-runs/start')
        .set(auth())
        .send(startBody(plan.id))
        .expect(201);
      let version = started.body.version as number;
      const attendanceRequestId = requestId('formal-attendance');
      const attendanceBody = {
        requestId: attendanceRequestId,
        runId: started.body.id,
        deviceId,
        expectedVersion: version,
        source: 'teacher_panel',
        operation: 'attendance_update',
        parameters: {
          attendanceSource: 'batch',
          updates: students.map((student, index) => ({
            studentId: student.id,
            status: ['present', 'absent', 'late', 'leave'][index],
          })),
        },
      };
      const marked = await request(app.getHttpServer())
        .post('/classroom-commands')
        .set(auth())
        .send(attendanceBody)
        .expect(201);
      version = marked.body.classroomState.version as number;
      expect(Object.values(marked.body.result.attendanceState).sort()).toEqual(
        ['absent', 'late', 'leave', 'present'],
      );
      const replay = await request(app.getHttpServer())
        .post('/classroom-commands')
        .set(auth())
        .send(attendanceBody)
        .expect(201);
      expect(replay.body).toEqual(marked.body);
      expect(await attendanceRepo.count({ where: { classroomRunId: started.body.id } })).toBe(4);
      expect(await changesRepo.count({ where: { classroomRunId: started.body.id } })).toBe(4);

      const changed = await request(app.getHttpServer())
        .post('/classroom-commands')
        .set(auth())
        .send({
          ...attendanceBody,
          requestId: requestId('formal-attendance-change'),
          expectedVersion: version,
          parameters: { studentId: students[0]!.id, status: 'late' },
        })
        .expect(201);
      version = changed.body.classroomState.version as number;
      const history = await changesRepo.find({
        where: { classroomRunId: started.body.id, studentId: students[0]!.id },
        order: { id: 'ASC' },
      });
      expect(history.map((item) => [item.previousStatus, item.nextStatus])).toEqual([
        [null, 'present'],
        ['present', 'late'],
      ]);

      const beforeVoiceCount = await changesRepo.count();
      const candidates = await request(app.getHttpServer())
        .post(`/classroom-runs/${started.body.id}/attendance/voice-candidates`)
        .set(auth())
        .send({ transcript: '安安到了，晨晨迟到，朵朵请假' })
        .expect(201);
      expect(candidates.body.requiresTeacherConfirmation).toBe(true);
      expect(candidates.body.candidates).toHaveLength(3);
      expect(await changesRepo.count()).toBe(beforeVoiceCount);

      await request(app.getHttpServer())
        .post('/classroom-commands')
        .set(auth())
        .send({
          requestId: requestId('disabled-attendance'),
          runId: started.body.id,
          deviceId,
          expectedVersion: version,
          source: 'teacher_panel',
          operation: 'attendance_update',
          parameters: { studentId: disabled.id, status: 'present' },
        })
        .expect(400);

      const rollRequestId = requestId('fair-random');
      const randomBody = {
        requestId: rollRequestId,
        runId: started.body.id,
        deviceId,
        expectedVersion: version,
        source: 'teacher_panel',
        operation: 'random_roll_call',
      };
      const random = await request(app.getHttpServer())
        .post('/classroom-commands')
        .set(auth())
        .send(randomBody)
        .expect(201);
      version = random.body.classroomState.version as number;
      expect([students[0]!.id, students[2]!.id]).toContain(random.body.result.student.id);
      const randomReplay = await request(app.getHttpServer())
        .post('/classroom-commands')
        .set(auth())
        .send(randomBody)
        .expect(201);
      expect(randomReplay.body.result.recordId).toBe(random.body.result.recordId);
      expect(await rollRepo.count({ where: { requestId: rollRequestId } })).toBe(1);

      await request(app.getHttpServer())
        .post('/classroom-commands')
        .set(auth())
        .send({
          requestId: requestId('absent-specified'),
          runId: started.body.id,
          deviceId,
          expectedVersion: version,
          source: 'teacher_panel',
          operation: 'specified_roll_call',
          parameters: { studentId: students[1]!.id },
        })
        .expect(409);
      const group = await request(app.getHttpServer())
        .post('/classroom-commands')
        .set(auth())
        .send({
          requestId: requestId('group-roll'),
          runId: started.body.id,
          deviceId,
          expectedVersion: version,
          source: 'teacher_panel',
          operation: 'group_roll_call',
          parameters: { studentIds: [students[1]!.id, students[2]!.id], groupKey: '第二组' },
        })
        .expect(201);
      version = group.body.classroomState.version as number;
      expect(group.body.result.student.id).toBe(students[2]!.id);
      expect(group.body.result.rollCallState.lastStudentDisplayName).toBe('晨晨小朋友');

      await request(app.getHttpServer())
        .get(`/classroom-runs/${started.body.id}/attendance`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(403);
      const rollEvents = await events.find({
        where: { classroomRunId: started.body.id, eventType: ClassroomEventType.RollCall },
      });
      expect(rollEvents).toHaveLength(2);
      await request(app.getHttpServer())
        .post(`/classroom-runs/${started.body.id}/complete`)
        .set(auth())
        .send({ version, deviceId, requestId: requestId('formal-cleanup') })
        .expect(201);
    });
  });

  it('joins a live classroom by one-time QR and delivers idempotent mobile commands', async () => {
    const plan = await createPlan(true, approvedResourceId);
    const started = await request(app.getHttpServer())
      .post('/classroom-runs/start')
      .set(auth())
      .send(startBody(plan.id))
      .expect(201);
    const devices = app.get<Repository<Device>>(getRepositoryToken(Device));
    await devices.update(deviceId, {
      status: DeviceStatus.Online,
      lastOnlineAt: new Date(),
    });
    const ticket = await request(app.getHttpServer())
      .post('/classroom-tickets')
      .set(auth())
      .send({ deviceId, classroomId, classId, expiresInSeconds: 120 })
      .expect(201);

    await request(app.getHttpServer())
      .post('/classroom-mobile/join')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ ticket: ticket.body.ticket, deviceCode: ticket.body.deviceCode })
      .expect(403);
    const joined = await request(app.getHttpServer())
      .post('/classroom-mobile/join')
      .set(auth())
      .send({ ticket: ticket.body.ticket, deviceCode: ticket.body.deviceCode })
      .expect(201);
    expect(joined.body.controlSession).toMatchObject({
      classroomRunId: started.body.id,
      targetDeviceId: deviceId,
      token: expect.any(String),
      expiresAt: expect.any(String),
    });
    const rawToken = joined.body.controlSession.token as string;
    const sessions = app.get<Repository<ClassroomControlSession>>(
      getRepositoryToken(ClassroomControlSession),
    );
    const persisted = await sessions.findOneByOrFail({
      tokenHash: createHash('sha256').update(rawToken).digest('hex'),
    });
    expect(persisted.tokenHash).not.toBe(rawToken);

    await request(app.getHttpServer())
      .post('/classroom-mobile/join')
      .set(auth())
      .send({ ticket: ticket.body.ticket, deviceCode: ticket.body.deviceCode })
      .expect(400);

    const state = await request(app.getHttpServer())
      .get('/classroom-mobile/state')
      .set(auth())
      .set('X-Classroom-Control-Session', rawToken)
      .expect(200);
    expect(state.body).toMatchObject({
      controlActive: true,
      screen: { deviceId, online: true },
      classroom: { id: started.body.id, version: started.body.version },
    });

    const requestBody = {
      requestId: requestId('mobile-next'),
      expectedVersion: started.body.version,
      operation: 'next_step',
      targetDeviceId: deviceId,
      issuedAt: new Date().toISOString(),
      ttlMs: 30_000,
    };
    const moved = await request(app.getHttpServer())
      .post('/classroom-mobile/commands')
      .set(auth())
      .set('X-Classroom-Control-Session', rawToken)
      .send(requestBody)
      .expect(201);
    expect(moved.body).toMatchObject({
      deliveryStatus: 'confirmed',
      result: { status: 'success', operation: 'next_step' },
    });
    const replay = await request(app.getHttpServer())
      .post('/classroom-mobile/commands')
      .set(auth())
      .set('X-Classroom-Control-Session', rawToken)
      .send(requestBody)
      .expect(201);
    expect(replay.body.result).toEqual(moved.body.result);

    await request(app.getHttpServer())
      .post('/classroom-mobile/commands')
      .set(auth())
      .set('X-Classroom-Control-Session', rawToken)
      .send({
        ...requestBody,
        requestId: requestId('mobile-expired'),
        expectedVersion: moved.body.result.classroomState.version,
        issuedAt: new Date(Date.now() - 60_000).toISOString(),
        ttlMs: 1000,
      })
      .expect(408);

    await devices.update(deviceId, {
      status: DeviceStatus.Offline,
      lastOnlineAt: new Date(Date.now() - 10 * 60_000),
    });
    await request(app.getHttpServer())
      .post('/classroom-mobile/commands')
      .set(auth())
      .set('X-Classroom-Control-Session', rawToken)
      .send({
        ...requestBody,
        requestId: requestId('mobile-offline'),
        expectedVersion: moved.body.result.classroomState.version,
        operation: 'pause_media',
        issuedAt: new Date().toISOString(),
      })
      .expect(409);

    await devices.update(deviceId, {
      status: DeviceStatus.Online,
      lastOnlineAt: new Date(),
    });
    const completed = await request(app.getHttpServer())
      .post('/classroom-mobile/commands')
      .set(auth())
      .set('X-Classroom-Control-Session', rawToken)
      .send({
        ...requestBody,
        requestId: requestId('mobile-complete'),
        expectedVersion: moved.body.result.classroomState.version,
        operation: 'complete_class',
        issuedAt: new Date().toISOString(),
      })
      .expect(201);
    expect(completed.body.deliveryStatus).toBe('confirmed');
    await request(app.getHttpServer())
      .get('/classroom-mobile/state')
      .set(auth())
      .set('X-Classroom-Control-Session', rawToken)
      .expect(410);
  });

  describe('Stage 7.4 classroom break (e2e)', () => {
    const runRepo = () =>
      app.get<Repository<ClassroomRun>>(getRepositoryToken(ClassroomRun));
    const snapshotRepo = () =>
      app.get<Repository<ClassroomSnapshot>>(getRepositoryToken(ClassroomSnapshot));

    async function startFreshRun() {
      const plan = await createPlan(true, approvedResourceId);
      const started = await request(app.getHttpServer())
        .post('/classroom-runs/start')
        .set(auth())
        .send(startBody(plan.id))
        .expect(201);
      return started.body as {
        id: number;
        version: number;
        status: string;
      };
    }

    async function cleanupRun(id: number, version: number) {
      await request(app.getHttpServer())
        .post(`/classroom-runs/${id}/complete`)
        .set(auth())
        .send({
          version,
          deviceId,
          requestId: requestId('break-cleanup'),
        })
        .expect(201);
    }

    async function startBreak(
      id: number,
      version: number,
      durationSeconds: number,
      rid: string,
    ) {
      return request(app.getHttpServer())
        .post(`/classroom-runs/${id}/break`)
        .set(auth())
        .send({ version, deviceId, requestId: rid, durationSeconds })
        .expect(201);
    }

    it('1) running → start 5-min break: breakStartedAt/breakEndsAt/serverNow correct', async () => {
      const run = await startFreshRun();
      const before = Date.now();
      const res = await startBreak(run.id, run.version, 300, requestId('break'));
      expect(res.body.status).toBe('running');
      expect(res.body.version).toBe(run.version + 1);
      expect(res.body.breakStartedAt).toBeTruthy();
      expect(res.body.breakEndsAt).toBeTruthy();
      expect(res.body.serverNow).toBeTruthy();
      const starts = new Date(res.body.breakStartedAt as string).getTime();
      const ends = new Date(res.body.breakEndsAt as string).getTime();
      expect(ends - starts).toBe(300_000);
      expect(ends).toBeGreaterThanOrEqual(before + 300_000 - 2000);
      expect(new Date(res.body.serverNow as string).getTime()).toBeGreaterThanOrEqual(
        before - 2000,
      );
      await cleanupRun(run.id, res.body.version);
    });

    it('2) prepared run cannot start a break', async () => {
      const plan = await createPlan();
      const prepared = await runRepo().save(
        runRepo().create({
          lessonPlanId: plan.id,
          lessonPlanVersion: plan.version,
          teacherId,
          classId,
          classroomId,
          deviceId,
          title: '预备课堂',
          status: ClassroomRunStatus.Prepared,
          currentStepIndex: 0,
          startedAt: null,
          pausedAt: null,
          resumedAt: null,
          endedAt: null,
          elapsedSeconds: 0,
          version: 1,
          breakStartedAt: null,
          breakEndsAt: null,
        }),
      );
      const res = await request(app.getHttpServer())
        .post(`/classroom-runs/${prepared.id}/break`)
        .set(auth())
        .send({
          version: 1,
          deviceId,
          requestId: requestId('break-prepared'),
          durationSeconds: 180,
        })
        .expect(409);
      expect(res.body.message).toContain('运行中');
      await runRepo().update(prepared.id, {
        status: ClassroomRunStatus.Cancelled,
        endedAt: new Date(),
      });
    });

    it('3) paused run cannot start a break', async () => {
      const run = await startFreshRun();
      const paused = await request(app.getHttpServer())
        .post(`/classroom-runs/${run.id}/pause`)
        .set(auth())
        .send({ version: run.version, deviceId, requestId: requestId('break-pause') })
        .expect(201);
      expect(paused.body.status).toBe('paused');
      await request(app.getHttpServer())
        .post(`/classroom-runs/${run.id}/break`)
        .set(auth())
        .send({
          version: paused.body.version,
          deviceId,
          requestId: requestId('break-while-paused'),
          durationSeconds: 180,
        })
        .expect(409);
      await cleanupRun(run.id, paused.body.version);
    });

    it('4) terminal run cannot start a break', async () => {
      const run = await startFreshRun();
      const done = await request(app.getHttpServer())
        .post(`/classroom-runs/${run.id}/complete`)
        .set(auth())
        .send({ version: run.version, deviceId, requestId: requestId('break-complete') })
        .expect(201);
      expect(done.body.status).toBe('completed');
      await request(app.getHttpServer())
        .post(`/classroom-runs/${run.id}/break`)
        .set(auth())
        .send({
          version: done.body.version,
          deviceId,
          requestId: requestId('break-terminal'),
          durationSeconds: 180,
        })
        .expect(409);
    });

    it('5) same requestId replay is idempotent', async () => {
      const run = await startFreshRun();
      const rid = requestId('break-idem');
      const first = await startBreak(run.id, run.version, 300, rid);
      const second = await request(app.getHttpServer())
        .post(`/classroom-runs/${run.id}/break`)
        .set(auth())
        .send({
          version: first.body.version,
          deviceId,
          requestId: rid,
          durationSeconds: 300,
        })
        .expect(201);
      expect(second.body.version).toBe(first.body.version);
      expect(second.body.breakEndsAt).toBe(first.body.breakEndsAt);
      await cleanupRun(run.id, second.body.version);
    });

    it('6) active break + different start requestId → 409, window not reset', async () => {
      const run = await startFreshRun();
      const first = await startBreak(run.id, run.version, 600, requestId('break-a'));
      const conflict = await request(app.getHttpServer())
        .post(`/classroom-runs/${run.id}/break`)
        .set(auth())
        .send({
          version: first.body.version,
          deviceId,
          requestId: requestId('break-b'),
          durationSeconds: 180,
        })
        .expect(409);
      expect(conflict.body.message).toContain('课间休息');
      const after = await request(app.getHttpServer())
        .get(`/classroom-runs/${run.id}`)
        .set(auth())
        .expect(200);
      expect(after.body.breakEndsAt).toBe(first.body.breakEndsAt);
      await cleanupRun(run.id, first.body.version);
    });

    it('7) early end clears both break fields', async () => {
      const run = await startFreshRun();
      const started = await startBreak(run.id, run.version, 300, requestId('break-end-a'));
      const ended = await request(app.getHttpServer())
        .post(`/classroom-runs/${run.id}/break/end`)
        .set(auth())
        .send({
          version: started.body.version,
          deviceId,
          requestId: requestId('break-end'),
        })
        .expect(200);
      expect(ended.body.breakStartedAt).toBeNull();
      expect(ended.body.breakEndsAt).toBeNull();
      expect(ended.body.version).toBe(started.body.version + 1);
      expect(ended.body.serverNow).toBeTruthy();
      await cleanupRun(run.id, ended.body.version);
    });

    it('8) repeated end-break is idempotent and safe (incl. after natural expiry)', async () => {
      const run = await startFreshRun();
      const started = await startBreak(run.id, run.version, 180, requestId('break-end-b'));
      const rid = requestId('break-end-dup');
      const ended = await request(app.getHttpServer())
        .post(`/classroom-runs/${run.id}/break/end`)
        .set(auth())
        .send({ version: started.body.version, deviceId, requestId: rid })
        .expect(200);
      const replay = await request(app.getHttpServer())
        .post(`/classroom-runs/${run.id}/break/end`)
        .set(auth())
        .send({ version: ended.body.version, deviceId, requestId: rid })
        .expect(200);
      expect(replay.body.version).toBe(ended.body.version);
      // 课间已结束后再 end（新 requestId）：安全幂等，不加版本、不报错
      const again = await request(app.getHttpServer())
        .post(`/classroom-runs/${run.id}/break/end`)
        .set(auth())
        .send({
          version: ended.body.version,
          deviceId,
          requestId: requestId('break-end-again'),
        })
        .expect(200);
      expect(again.body.breakStartedAt).toBeNull();
      expect(again.body.breakEndsAt).toBeNull();
      expect(again.body.version).toBe(ended.body.version);
      await cleanupRun(run.id, ended.body.version);
    });

    it('9) another teacher cannot control this run break', async () => {
      const run = await startFreshRun();
      await request(app.getHttpServer())
        .post(`/classroom-runs/${run.id}/break`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({
          version: run.version,
          deviceId,
          requestId: requestId('break-foreign'),
          durationSeconds: 180,
        })
        .expect(403);
      await cleanupRun(run.id, run.version);
    });

    it('10) wrong device is rejected', async () => {
      const run = await startFreshRun();
      await request(app.getHttpServer())
        .post(`/classroom-runs/${run.id}/break`)
        .set(auth())
        .send({
          version: run.version,
          deviceId: device2Id,
          requestId: requestId('break-device'),
          durationSeconds: 180,
        })
        .expect(403);
      await cleanupRun(run.id, run.version);
    });

    it('11) version conflict is enforced', async () => {
      const run = await startFreshRun();
      await request(app.getHttpServer())
        .post(`/classroom-runs/${run.id}/break`)
        .set(auth())
        .send({
          version: run.version + 5,
          deviceId,
          requestId: requestId('break-version'),
          durationSeconds: 180,
        })
        .expect(409);
      await cleanupRun(run.id, run.version);
    });

    it('12) expired break is settled on read and restores the classroom', async () => {
      const run = await startFreshRun();
      const started = await startBreak(run.id, run.version, 180, requestId('break-expire'));
      const past = new Date(Date.now() - 60_000);
      await runRepo().update(run.id, { breakEndsAt: past });
      const entity = await runRepo().findOneByOrFail({ id: run.id });
      expect(isBreakActive(entity)).toBe(false);
      const read = await request(app.getHttpServer())
        .get(`/classroom-runs/${run.id}`)
        .set(auth())
        .expect(200);
      expect(read.body.breakStartedAt).toBeNull();
      expect(read.body.breakEndsAt).toBeNull();
      expect(read.body.version).toBe(started.body.version + 1);
      await cleanupRun(run.id, read.body.version);
    });

    it('13) new break allowed after the previous one expired', async () => {
      const run = await startFreshRun();
      await startBreak(run.id, run.version, 180, requestId('break-expire-b'));
      await runRepo().update(run.id, { breakEndsAt: new Date(Date.now() - 60_000) });
      const settled = await request(app.getHttpServer())
        .get(`/classroom-runs/${run.id}`)
        .set(auth())
        .expect(200);
      const second = await startBreak(run.id, settled.body.version, 600, requestId('break-new'));
      expect(second.body.version).toBe(settled.body.version + 1);
      const s2 = new Date(second.body.breakStartedAt as string).getTime();
      const e2 = new Date(second.body.breakEndsAt as string).getTime();
      expect(e2 - s2).toBe(600_000);
      await cleanupRun(run.id, second.body.version);
    });

    it('14) step changes and pause are blocked while break is active', async () => {
      const run = await startFreshRun();
      const started = await startBreak(run.id, run.version, 600, requestId('break-guard'));
      const step = await request(app.getHttpServer())
        .post(`/classroom-runs/${run.id}/steps/1`)
        .set(auth())
        .send({
          version: started.body.version,
          deviceId,
          requestId: requestId('break-step'),
        })
        .expect(409);
      expect(step.body.message).toContain('课间休息');
      const pause = await request(app.getHttpServer())
        .post(`/classroom-runs/${run.id}/pause`)
        .set(auth())
        .send({
          version: started.body.version,
          deviceId,
          requestId: requestId('break-pause-guard'),
        })
        .expect(409);
      expect(pause.body.message).toContain('课间休息');
      await cleanupRun(run.id, started.body.version);
    });

    it('15) break_start/break_end events and key snapshots recorded', async () => {
      const run = await startFreshRun();
      const started = await startBreak(run.id, run.version, 300, requestId('break-evt-a'));
      const ended = await request(app.getHttpServer())
        .post(`/classroom-runs/${run.id}/break/end`)
        .set(auth())
        .send({
          version: started.body.version,
          deviceId,
          requestId: requestId('break-evt-b'),
        })
        .expect(200);
      const eventRows = await events.find({
        where: {
          classroomRunId: run.id,
          eventType: In([
            ClassroomEventType.BreakStart,
            ClassroomEventType.BreakEnd,
          ]),
        },
        order: { id: 'ASC' },
      });
      expect(eventRows).toHaveLength(2);
      expect(eventRows[0]!.eventType).toBe(ClassroomEventType.BreakStart);
      expect(eventRows[1]!.eventType).toBe(ClassroomEventType.BreakEnd);
      const snapshots = await snapshotRepo().find({
        where: {
          classroomRunId: run.id,
          reason: In([
            ClassroomSnapshotReason.BreakStart,
            ClassroomSnapshotReason.BreakEnd,
          ]),
        },
        order: { snapshotVersion: 'ASC' },
      });
      expect(snapshots).toHaveLength(2);
      expect(
        snapshots.map((s) => s.reason).sort(),
      ).toEqual(
        [ClassroomSnapshotReason.BreakStart, ClassroomSnapshotReason.BreakEnd].sort(),
      );
      expect(snapshots.every((s) => s.isKey)).toBe(true);
      await cleanupRun(run.id, ended.body.version);
    });
  });
});
