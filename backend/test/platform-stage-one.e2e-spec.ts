import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AuthModule } from '../src/auth/auth.module';
import { Administrator } from '../src/auth/entities/administrator.entity';
import {
  AuthUserType,
  RefreshTokenSession,
} from '../src/auth/entities/refresh-token-session.entity';
import {
  AccountStatus,
  Teacher,
  TeacherRole,
} from '../src/auth/entities/teacher.entity';
import { ClassroomTicket } from '../src/platform/entities/classroom-ticket.entity';
import {
  PLATFORM_ENTITIES,
  PlatformModule,
} from '../src/platform/platform.module';

describe('Member A stage one platform (e2e)', () => {
  let app: INestApplication;
  let teachers: Repository<Teacher>;
  let administrators: Repository<Administrator>;
  let tickets: Repository<ClassroomTicket>;
  let jwt: JwtService;
  let adminToken: string;
  let globalAdminToken: string;
  let teacherToken: string;
  let otherToken: string;
  let teacherId: number;
  let otherTeacherId: number;
  let classId: number;
  let classroomId: number;
  let deviceId: number;
  let deviceCode: string;

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              JWT_ACCESS_SECRET: 'stage-one-test-secret-with-enough-characters',
              JWT_ACCESS_EXPIRES_IN: '15m',
              JWT_REFRESH_EXPIRES_IN: '30d',
              TEST_TEACHER_ACCOUNT: 'stage_teacher',
              TEST_TEACHER_PASSWORD: 'Teacher123!',
              TEST_TEACHER_NAME: '阶段教师',
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
            ...PLATFORM_ENTITIES,
          ],
          synchronize: true,
        }),
        AuthModule,
        PlatformModule,
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
    teachers = app.get(getRepositoryToken(Teacher));
    administrators = app.get(getRepositoryToken(Administrator));
    tickets = app.get(getRepositoryToken(ClassroomTicket));
    jwt = app.get(JwtService);

    await administrators.save(
      administrators.create({
        account: 'stage_admin',
        passwordHash: await bcrypt.hash('Admin123!', 4),
        name: '测试管理员',
        schoolId: 'garden-1',
      }),
    );
    const teacher = await teachers.findOneByOrFail({
      account: 'stage_teacher',
    });
    teacher.schoolId = 'garden-1';
    await teachers.save(teacher);
    teacherId = teacher.id;
    const otherTeacher = await teachers.save(
      teachers.create({
        account: 'other_stage_teacher',
        passwordHash: await bcrypt.hash('Teacher123!', 4),
        name: '其他教师',
        role: TeacherRole.Teacher,
        schoolId: 'garden-1',
      }),
    );
    otherTeacherId = otherTeacher.id;
    await teachers.save(
      teachers.create({
        account: 'disabled_teacher',
        passwordHash: await bcrypt.hash('Teacher123!', 4),
        name: '停用教师',
        role: TeacherRole.Teacher,
        status: AccountStatus.Disabled,
      }),
    );
    await administrators.save(
      administrators.create({
        account: 'global_stage_admin',
        passwordHash: await bcrypt.hash('GlobalAdmin123!', 4),
        name: '全局测试管理员',
        schoolId: null,
      }),
    );

    const adminLogin = await request(app.getHttpServer())
      .post('/auth/admin/login')
      .send({ account: 'stage_admin', password: 'Admin123!' })
      .expect(200);
    adminToken = adminLogin.body.access_token;
    const globalAdminLogin = await request(app.getHttpServer())
      .post('/auth/admin/login')
      .send({ account: 'global_stage_admin', password: 'GlobalAdmin123!' })
      .expect(200);
    globalAdminToken = globalAdminLogin.body.access_token;
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ account: 'stage_teacher', password: 'Teacher123!' })
      .expect(200);
    teacherToken = login.body.access_token;
    const otherLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ account: 'other_stage_teacher', password: 'Teacher123!' })
      .expect(200);
    otherToken = otherLogin.body.access_token;
  });

  afterAll(() => app.close());

  it('supports teacher/admin login and rejects wrong or disabled accounts without revealing which failed', async () => {
    const admin = await request(app.getHttpServer())
      .post('/auth/admin/login')
      .send({ account: 'stage_admin', password: 'Admin123!' })
      .expect(200);
    expect(admin.body).toMatchObject({
      userType: 'administrator',
      administratorId: expect.any(Number),
      access_token: expect.any(String),
      refresh_token: expect.any(String),
    });
    const wrong = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ account: 'missing', password: 'wrong' })
      .expect(401);
    const disabled = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ account: 'disabled_teacher', password: 'Teacher123!' })
      .expect(401);
    expect(wrong.body.message).toBe(disabled.body.message);
  });

  it('rotates refresh tokens, rejects replay, and invalidates access tokens after logout', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        account: 'stage_teacher',
        password: 'Teacher123!',
        deviceInfo: 'e2e',
      })
      .expect(200);
    const rotated = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: login.body.refresh_token })
      .expect(200);
    expect(rotated.body.refresh_token).not.toBe(login.body.refresh_token);
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: login.body.refresh_token })
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${rotated.body.access_token}`)
      .send({ refreshToken: rotated.body.refresh_token })
      .expect(204);
    await request(app.getHttpServer())
      .get('/auth/profile')
      .set('Authorization', `Bearer ${rotated.body.access_token}`)
      .expect(401);
    const relogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ account: 'stage_teacher', password: 'Teacher123!' })
      .expect(200);
    teacherToken = relogin.body.access_token;
  });

  it('rejects an expired access token', async () => {
    const teacher = await teachers.findOneByOrFail({ id: teacherId });
    const expired = await jwt.signAsync(
      {
        sub: teacher.id,
        account: teacher.account,
        name: teacher.name,
        role: teacher.role,
        userType: AuthUserType.Teacher,
        tokenVersion: teacher.tokenVersion,
      },
      { expiresIn: -1 },
    );
    await request(app.getHttpServer())
      .get('/auth/profile')
      .set('Authorization', `Bearer ${expired}`)
      .expect(401);
  });

  it('rejects refresh and access tokens after the account is disabled', async () => {
    const account = 'disabled_after_login';
    const teacher = await teachers.save(
      teachers.create({
        account,
        passwordHash: await bcrypt.hash('Teacher123!', 4),
        name: '登录后停用教师',
        role: TeacherRole.Teacher,
        schoolId: 'garden-1',
      }),
    );
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ account, password: 'Teacher123!' })
      .expect(200);
    teacher.status = AccountStatus.Disabled;
    await teachers.save(teacher);
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: login.body.refresh_token })
      .expect(401);
    await request(app.getHttpServer())
      .get('/auth/profile')
      .set('Authorization', `Bearer ${login.body.access_token}`)
      .expect(401);
  });

  it('creates classes as admin and enforces teacher-class isolation', async () => {
    const created = await request(app.getHttpServer())
      .post('/classes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: '中一班',
        grade: '中班',
        ageRange: '4-5岁',
        schoolYear: '2026-2027',
      })
      .expect(201);
    classId = created.body.id;
    await request(app.getHttpServer())
      .post(`/classes/${classId}/teachers`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ teacherId, role: 'lead' })
      .expect(201);
    await request(app.getHttpServer())
      .get(`/classes/${classId}`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/classes/${classId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/students?classId=${classId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403);

    const otherClass = await request(app.getHttpServer())
      .post('/classes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: '中二班',
        grade: '中班',
        ageRange: '4-5岁',
        schoolYear: '2026-2027',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/classes/${otherClass.body.id}/teachers`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ teacherId: otherTeacherId, role: 'lead' })
      .expect(201);
    await request(app.getHttpServer())
      .get(`/classes/${otherClass.body.id}`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/students?classId=${otherClass.body.id}`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(403);
  });

  it('synchronizes students idempotently and omits birthday from normal queries', async () => {
    const payload = {
      classId,
      students: [
        {
          studentNo: 'S-001',
          name: '小雨',
          nickname: '雨雨',
          birthday: '2022-04-01',
        },
      ],
    };
    await request(app.getHttpServer())
      .post('/students/sync')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send(payload)
      .expect(201)
      .expect({ created: 1, updated: 0, unchanged: 0 });
    await request(app.getHttpServer())
      .post('/students/sync')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send(payload)
      .expect(201)
      .expect({ created: 0, updated: 0, unchanged: 1 });
    const list = await request(app.getHttpServer())
      .get(`/students?classId=${classId}`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).not.toHaveProperty('birthday');
  });

  it('prevents duplicate active device bindings', async () => {
    const classroom = await request(app.getHttpServer())
      .post('/classrooms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '彩虹教室', location: '一楼' })
      .expect(201);
    classroomId = classroom.body.id;
    deviceCode = 'SCREEN-E2E-001';
    const device = await request(app.getHttpServer())
      .post('/devices')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ deviceCode, name: '一号大屏', type: 'classroom_screen' })
      .expect(201);
    deviceId = device.body.id;
    const binding = await request(app.getHttpServer())
      .post('/device-bindings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ deviceId, classroomId, classId })
      .expect(201);
    await request(app.getHttpServer())
      .post('/device-bindings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ deviceId, classroomId, classId })
      .expect(409);
    await request(app.getHttpServer())
      .delete(`/device-bindings/${binding.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);
    await request(app.getHttpServer())
      .post('/device-bindings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ deviceId, classroomId, classId })
      .expect(201);
  });

  it('rejects cross-school bindings and cross-school unbinding', async () => {
    const foreignClass = await request(app.getHttpServer())
      .post('/classes')
      .set('Authorization', `Bearer ${globalAdminToken}`)
      .send({
        name: '外园班级',
        schoolYear: '2026-2027',
        schoolId: 'garden-2',
      })
      .expect(201);
    const foreignRoom = await request(app.getHttpServer())
      .post('/classrooms')
      .set('Authorization', `Bearer ${globalAdminToken}`)
      .send({ name: '外园教室', schoolId: 'garden-2' })
      .expect(201);
    const foreignDevice = await request(app.getHttpServer())
      .post('/devices')
      .set('Authorization', `Bearer ${globalAdminToken}`)
      .send({
        deviceCode: 'SCREEN-E2E-FOREIGN',
        name: '外园大屏',
        type: 'classroom_screen',
        schoolId: 'garden-2',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/device-bindings')
      .set('Authorization', `Bearer ${globalAdminToken}`)
      .send({
        deviceId: foreignDevice.body.id,
        classroomId,
        classId: foreignClass.body.id,
      })
      .expect(409);
    const foreignBinding = await request(app.getHttpServer())
      .post('/device-bindings')
      .set('Authorization', `Bearer ${globalAdminToken}`)
      .send({
        deviceId: foreignDevice.body.id,
        classroomId: foreignRoom.body.id,
        classId: foreignClass.body.id,
      })
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/device-bindings/${foreignBinding.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(403);
  });

  it('enforces ticket expiry, one-time use and device matching', async () => {
    const generated = await request(app.getHttpServer())
      .post('/classroom-tickets')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ deviceId, classroomId, classId, expiresInSeconds: 120 })
      .expect(201);
    await request(app.getHttpServer())
      .post('/classroom-tickets/consume')
      .send({ ticket: generated.body.ticket, deviceCode: 'WRONG-DEVICE' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/classroom-tickets/consume')
      .send({ ticket: generated.body.ticket, deviceCode })
      .expect(200)
      .expect({ classId, classroomId, deviceId, lessonRunId: null });
    await request(app.getHttpServer())
      .post('/classroom-tickets/consume')
      .send({ ticket: generated.body.ticket, deviceCode })
      .expect(400);

    const expiredPlain = 'expired-e2e-ticket';
    await tickets.save(
      tickets.create({
        ticketHash: createHash('sha256').update(expiredPlain).digest('hex'),
        classId,
        classroomId,
        deviceId,
        lessonRunId: null,
        expiresAt: new Date(Date.now() - 1000),
        usedAt: null,
        isUsed: false,
        createdBy: teacherId,
      }),
    );
    await request(app.getHttpServer())
      .post('/classroom-tickets/consume')
      .send({ ticket: expiredPlain, deviceCode })
      .expect(400);
  });

  it('stores and revokes photo, voice and artwork consent after class permission checks', async () => {
    const students = await request(app.getHttpServer())
      .get(`/students?classId=${classId}`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(200);
    const studentId = students.body.items[0].id;
    for (const consentType of ['photo', 'voice', 'artwork']) {
      await request(app.getHttpServer())
        .post('/guardian-consents')
        .set('Authorization', `Bearer ${teacherToken}`)
        .send({
          studentId,
          consentType,
          status: 'granted',
          note: '纸质授权已核对',
        })
        .expect(201);
      const revoked = await request(app.getHttpServer())
        .post('/guardian-consents')
        .set('Authorization', `Bearer ${teacherToken}`)
        .send({ studentId, consentType, status: 'revoked' })
        .expect(201);
      expect(revoked.body.revokedAt).toBeTruthy();
    }
    const list = await request(app.getHttpServer())
      .get(`/guardian-consents?studentId=${studentId}`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(200);
    expect(list.body).toHaveLength(3);
    expect(
      list.body.map((item: { consentType: string }) => item.consentType),
    ).toEqual(['artwork', 'photo', 'voice']);
    expect(
      list.body.every(
        (item: { status: string; revokedAt: string | null }) =>
          item.status === 'revoked' && Boolean(item.revokedAt),
      ),
    ).toBe(true);
    await request(app.getHttpServer())
      .get(`/guardian-consents?studentId=${studentId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403);
  });

  it('keeps credentials and tokens out of operation logs', async () => {
    const logs = await request(app.getHttpServer())
      .get('/audit-logs?page=1&pageSize=100')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const serialized = JSON.stringify(logs.body);
    expect(serialized).not.toContain('Teacher123!');
    expect(serialized).not.toContain('Admin123!');
    expect(serialized).not.toContain('GlobalAdmin123!');
    expect(serialized).not.toContain('access_token');
    expect(serialized).not.toContain('refresh_token');
  });
});
