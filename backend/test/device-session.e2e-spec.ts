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
import { DeviceSession } from '../src/device-session/entities/device-session.entity';
import { DeviceSessionModule } from '../src/device-session/device-session.module';
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

describe('Formal Screen device-session (e2e)', () => {
  const database = join(process.cwd(), 'temp-device-session.e2e.sqlite');
  let app: INestApplication;
  let token: string;
  let teacherId: number;
  let classId: number;
  let classroomId: number;
  let deviceId: number;
  let foreignDeviceId: number;
  let resourceId: number;
  let lessonPlanId: number;

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
              JWT_ACCESS_SECRET: 'device-session-test-secret-long-enough',
              JWT_ACCESS_EXPIRES_IN: '2h',
              JWT_REFRESH_EXPIRES_IN: '30d',
              TEST_TEACHER_ACCOUNT: 'device_session_teacher',
              TEST_TEACHER_PASSWORD: 'Teacher123!',
              TEST_TEACHER_NAME: '设备会话测试教师',
              ARK_API_KEY: 'device-session-test-key',
              ARK_ENDPOINT_ID: 'device-session-test-model',
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
            DeviceSession,
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
        DeviceSessionModule,
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

  async function login(account: string, password: string) {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ account, password })
      .expect(200);
    return res.body.access_token as string;
  }

  async function issue(devId: number) {
    const res = await request(app.getHttpServer())
      .post(`/devices/${devId}/device-session`)
      .set(auth())
      .expect(201);
    return res.body as { token: string; deviceId: number; id: number; expiresAt: string };
  }

  beforeAll(async () => {
    await unlink(database).catch(() => undefined);
    app = await createApp();
    const teachers = app.get<Repository<Teacher>>(getRepositoryToken(Teacher));
    const teacher = await teachers.findOneByOrFail({
      account: 'device_session_teacher',
    });
    teacher.schoolId = 'garden-dev';
    await teachers.save(teacher);
    teacherId = teacher.id;
    token = await login('device_session_teacher', 'Teacher123!');

    const classes = app.get<Repository<SchoolClass>>(getRepositoryToken(SchoolClass));
    classId = (
      await classes.save(
        classes.create({
          schoolId: 'garden-dev',
          name: '设备会话测试班',
          grade: '中班',
          ageRange: '4-5',
          schoolYear: '2026',
          status: RecordStatus.Active,
        }),
      )
    ).id;
    const teacherClasses = app.get<Repository<TeacherClass>>(getRepositoryToken(TeacherClass));
    await teacherClasses.save(
      teacherClasses.create({ teacherId, classId, role: TeacherClassRole.Lead }),
    );
    const classrooms = app.get<Repository<Classroom>>(getRepositoryToken(Classroom));
    classroomId = (
      await classrooms.save(
        classrooms.create({
          schoolId: 'garden-dev',
          name: '设备会话测试教室',
          location: '一楼',
          status: RecordStatus.Active,
        }),
      )
    ).id;
    const devices = app.get<Repository<Device>>(getRepositoryToken(Device));
    deviceId = (
      await devices.save(
        devices.create({
          deviceCode: 'DEV-SESSION-1',
          schoolId: 'garden-dev',
          name: '正式大屏',
          type: DeviceType.ClassroomScreen,
          status: DeviceStatus.Online,
          lastOnlineAt: new Date(),
        }),
      )
    ).id;
    const foreignClassId = (
      await classes.save(
        classes.create({
          schoolId: 'garden-other',
          name: '外园班级',
          grade: '小班',
          ageRange: '3-4',
          schoolYear: '2026',
          status: RecordStatus.Active,
        }),
      )
    ).id;
    foreignDeviceId = (
      await devices.save(
        devices.create({
          deviceCode: 'DEV-SESSION-FOREIGN',
          schoolId: 'garden-other',
          name: '外园大屏',
          type: DeviceType.ClassroomScreen,
          status: DeviceStatus.Online,
          lastOnlineAt: new Date(),
        }),
      )
    ).id;
    const bindings = app.get<Repository<DeviceBinding>>(getRepositoryToken(DeviceBinding));
    await bindings.save([
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
      bindings.create({
        deviceId: foreignDeviceId,
        classroomId,
        classId: foreignClassId,
        boundByType: AuthUserType.Teacher,
        boundBy: teacherId,
        boundAt: new Date(),
        unboundAt: null,
        status: BindingStatus.Active,
      }),
    ]);

    const resources = app.get<Repository<TeachingResource>>(getRepositoryToken(TeachingResource));
    resourceId = (
      await resources.save(
        resources.create({
          title: '设备会话测试图片',
          aliases: '[]',
          description: null,
          schoolId: 'garden-dev',
          resourceType: ResourceType.Image,
          category: '图片卡片',
          categoryId: null,
          ageGroup: ResourceAgeGroup.Middle,
          domain: '科学',
          tags: '[]',
          fileUrl: '',
          coverUrl: null,
          fileName: 'device.png',
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
        title: '设备会话课堂',
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
        ],
      })
      .expect(200);
  });

  afterAll(async () => {
    if (app) await app.close();
    await unlink(database).catch(() => undefined);
  });

  const devices = () =>
    app.get<Repository<Device>>(getRepositoryToken(Device));
  const bindings = () =>
    app.get<Repository<DeviceBinding>>(getRepositoryToken(DeviceBinding));
  const sessions = () =>
    app.get<Repository<DeviceSession>>(getRepositoryToken(DeviceSession));
  const setDeviceStatus = async (status: DeviceStatus) => {
    await devices().update(deviceId, {
      status,
      lastOnlineAt: status === DeviceStatus.Online ? new Date() : new Date(Date.now() - 60_000),
    });
  };

  it('1) issue returns a one-time raw token; DB stores only its sha256 hash', async () => {
    const issued = await issue(deviceId);
    expect(issued).toMatchObject({ deviceId, expiresAt: expect.any(String) });
    expect(issued.token).toBeTruthy();
    const row = await sessions().findOneByOrFail({ deviceId });
    expect(row.tokenHash).not.toBe(issued.token);
    const crypto = await import('node:crypto');
    expect(row.tokenHash).toBe(
      crypto.createHash('sha256').update(issued.token).digest('hex'),
    );
  });

  it('2) valid heartbeat flips the device Online and refreshes lastOnlineAt', async () => {
    await devices().update(deviceId, { status: DeviceStatus.Offline });
    const issued = await issue(deviceId);
    const res = await request(app.getHttpServer())
      .post('/device-session/heartbeat')
      .set('x-device-session', issued.token)
      .expect(200);
    expect(res.body).toMatchObject({
      deviceId,
      online: true,
      status: 'online',
      lastOnlineAt: expect.any(String),
    });
    const dev = await devices().findOneByOrFail({ id: deviceId });
    expect(dev.status).toBe(DeviceStatus.Online);
    expect(dev.lastOnlineAt).toBeTruthy();
  });

  it('3) heartbeat rejects a missing or unknown credential with 401', async () => {
    await request(app.getHttpServer())
      .post('/device-session/heartbeat')
      .expect(401);
    await request(app.getHttpServer())
      .post('/device-session/heartbeat')
      .set('x-device-session', 'definitely-not-a-valid-token')
      .expect(401);
  });

  it('4) re-issuing rotates the session and revokes the previous token', async () => {
    const first = await issue(deviceId);
    const second = await issue(deviceId);
    expect(second.token).not.toBe(first.token);
    await request(app.getHttpServer())
      .post('/device-session/heartbeat')
      .set('x-device-session', first.token)
      .expect(401);
    await request(app.getHttpServer())
      .post('/device-session/heartbeat')
      .set('x-device-session', second.token)
      .expect(200);
  });

  it('5) heartbeat fails with 409 once the binding is revoked', async () => {
    await setDeviceStatus(DeviceStatus.Online);
    const issued = await issue(deviceId);
    await bindings().update(
      { deviceId, status: BindingStatus.Active },
      { status: BindingStatus.Unbound, unboundAt: new Date() },
    );
    const res = await request(app.getHttpServer())
      .post('/device-session/heartbeat')
      .set('x-device-session', issued.token)
      .expect(409);
    expect(res.body.message).toContain('撤销');
    await bindings().update(
      { deviceId, status: BindingStatus.Unbound },
      { status: BindingStatus.Active, unboundAt: null },
    );
  });

  it('6) heartbeat fails with 409 for a disabled device and a fault device', async () => {
    await setDeviceStatus(DeviceStatus.Online);
    const issued = await issue(deviceId);
    await setDeviceStatus(DeviceStatus.Disabled);
    const disabled = await request(app.getHttpServer())
      .post('/device-session/heartbeat')
      .set('x-device-session', issued.token)
      .expect(409);
    expect(disabled.body.message).toContain('停用');

    await setDeviceStatus(DeviceStatus.Fault);
    const fault = await request(app.getHttpServer())
      .post('/device-session/heartbeat')
      .set('x-device-session', issued.token)
      .expect(409);
    expect(fault.body.message).toContain('故障');
  });

  it('7) an expired session is revoked and rejected with 410 Gone', async () => {
    await setDeviceStatus(DeviceStatus.Online);
    const issued = await issue(deviceId);
    await sessions().update(issued.id, {
      expiresAt: new Date(Date.now() - 60_000),
    });
    const res = await request(app.getHttpServer())
      .post('/device-session/heartbeat')
      .set('x-device-session', issued.token)
      .expect(410);
    expect(res.body.message).toContain('过期');
  });

  it('8) issue refuses a device with no active binding (409)', async () => {
    const unbound = await devices().save(
      devices().create({
        deviceCode: 'DEV-SESSION-UNBOUND',
        schoolId: 'garden-dev',
        name: '未绑定大屏',
        type: DeviceType.ClassroomScreen,
        status: DeviceStatus.Online,
        lastOnlineAt: new Date(),
      }),
    );
    const res = await request(app.getHttpServer())
      .post(`/devices/${unbound.id}/device-session`)
      .set(auth())
      .expect(409);
    expect(res.body.message).toContain('尚未绑定');
  });

  it('9) teacher cannot issue a session for a device in another school/class (403)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/devices/${foreignDeviceId}/device-session`)
      .set(auth())
      .expect(403);
    expect(res.body.message).toContain('无权访问');
  });

  it('10) start is allowed only while the bound screen is Online', async () => {
    const startBody = () => ({
      lessonPlanId,
      classId,
      classroomId,
      deviceId,
      requestId: requestId('start-online'),
    });
    await setDeviceStatus(DeviceStatus.Online);
    await request(app.getHttpServer())
      .post('/classroom-runs/start')
      .set(auth())
      .send(startBody())
      .expect(201);

    await setDeviceStatus(DeviceStatus.Offline);
    const offline = await request(app.getHttpServer())
      .post('/classroom-runs/start')
      .set(auth())
      .send({ ...startBody(), requestId: requestId('start-offline') })
      .expect(409);
    expect(offline.body.message).toContain('离线');

    await setDeviceStatus(DeviceStatus.Disabled);
    const disabled = await request(app.getHttpServer())
      .post('/classroom-runs/start')
      .set(auth())
      .send({ ...startBody(), requestId: requestId('start-disabled') })
      .expect(409);
    expect(disabled.body.message).toContain('停用');

    await setDeviceStatus(DeviceStatus.Fault);
    const fault = await request(app.getHttpServer())
      .post('/classroom-runs/start')
      .set(auth())
      .send({ ...startBody(), requestId: requestId('start-fault') })
      .expect(409);
    expect(fault.body.message).toContain('故障');
  });
});