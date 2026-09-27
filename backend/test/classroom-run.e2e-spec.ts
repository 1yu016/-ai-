import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AuthModule } from '../src/auth/auth.module';
import { Administrator } from '../src/auth/entities/administrator.entity';
import { RefreshTokenSession } from '../src/auth/entities/refresh-token-session.entity';
import { Teacher, TeacherRole } from '../src/auth/entities/teacher.entity';
import {
  CLASSROOM_RUN_ENTITIES,
  ClassroomRunModule,
} from '../src/classroom-runs/classroom-run.module';
import { ClassroomEvent } from '../src/classroom-runs/entities/classroom-event.entity';
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

type PlanFixture = { id: number; version: number };

describe('Task four classroom run state machine (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let otherToken: string;
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

  afterAll(() => app.close());

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
});
