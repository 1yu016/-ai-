import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import ExcelJS from 'exceljs';
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
import { Device } from '../src/platform/entities/device.entity';
import { AuditLog } from '../src/platform/entities/audit-log.entity';
import { AuditResult, DeviceStatus } from '../src/platform/platform.types';
import { ClassroomRun } from '../src/classroom-runs/entities/classroom-run.entity';
import { ClassroomRunStatus } from '../src/classroom-runs/classroom-run.types';
import {
  PLATFORM_ENTITIES,
  PlatformModule,
} from '../src/platform/platform.module';

async function studentWorkbook(rows: unknown[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('学生导入');
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('Member A stage one platform (e2e)', () => {
  let app: INestApplication;
  let teachers: Repository<Teacher>;
  let administrators: Repository<Administrator>;
  let tickets: Repository<ClassroomTicket>;
  let devices: Repository<Device>;
  let auditLogs: Repository<AuditLog>;
  let runs: Repository<ClassroomRun>;
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
            ClassroomRun,
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
    devices = app.get(getRepositoryToken(Device));
    auditLogs = app.get(getRepositoryToken(AuditLog));
    runs = app.get(getRepositoryToken(ClassroomRun));
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

  it('queries, paginates, enriches and updates classes from persisted data', async () => {
    const filtered = await request(app.getHttpServer())
      .get('/classes?keyword=中一&page=1&pageSize=10&status=active')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(filtered.body.total).toBe(1);
    expect(filtered.body.items[0]).toMatchObject({
      id: classId,
      name: '中一班',
      studentCount: 1,
      teachers: [
        expect.objectContaining({ teacherId, name: '阶段教师', role: 'lead' }),
      ],
    });

    const paged = await request(app.getHttpServer())
      .get('/classes?page=1&pageSize=1')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(paged.body.items).toHaveLength(1);
    expect(paged.body.total).toBeGreaterThanOrEqual(2);

    await request(app.getHttpServer())
      .patch(`/classes/${classId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ grade: '中班更新' })
      .expect(200)
      .expect((response) => {
        expect(response.body.grade).toBe('中班更新');
      });
    await request(app.getHttpServer())
      .get(`/classes/${classId}`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          name: '中一班',
          grade: '中班更新',
          studentCount: 1,
        });
      });

    const teacherClasses = await request(app.getHttpServer())
      .get('/classes?page=1&pageSize=10')
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(200);
    expect(teacherClasses.body.items.map((item: { id: number }) => item.id)).toEqual([
      classId,
    ]);
    await request(app.getHttpServer())
      .get(`/classes/${classId}/classroom-runs?page=1&pageSize=10`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(200)
      .expect({ items: [], total: 0, page: 1, pageSize: 10 });
    await request(app.getHttpServer())
      .get(`/classes/${classId}/classroom-runs`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403);
  });

  it('searches, details, edits and disables students with consent summaries', async () => {
    const created = await request(app.getHttpServer())
      .post('/students')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        classId,
        studentNo: 'S-002',
        name: '小星',
        nickname: '星星',
        gender: '女',
        birthday: '2022-05-02',
      })
      .expect(201);
    expect(created.body).toMatchObject({
      classId,
      className: '中一班',
      studentNo: 'S-002',
      authorizationStatus: 'pending',
      permissions: { photo: false, voice: false, artwork: false },
    });
    expect(created.body).not.toHaveProperty('birthday');

    const byName = await request(app.getHttpServer())
      .get(`/students?classId=${classId}&keyword=小星&page=1&pageSize=20`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(200);
    expect(byName.body.total).toBe(1);
    expect(byName.body.items[0]).toMatchObject({ id: created.body.id, name: '小星' });

    const byStudentNo = await request(app.getHttpServer())
      .get(`/students?classId=${classId}&keyword=S-002&page=1&pageSize=20`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(200);
    expect(byStudentNo.body.total).toBe(1);

    await request(app.getHttpServer())
      .post('/guardian-consents')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        studentId: created.body.id,
        consentType: 'photo',
        status: 'granted',
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/students/${created.body.id}`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ name: '小星星', status: 'disabled' })
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          name: '小星星',
          status: 'disabled',
          authorizationStatus: 'partial',
          permissions: { photo: true, voice: false, artwork: false },
        });
      });

    await request(app.getHttpServer())
      .get(`/students/${created.body.id}`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          id: created.body.id,
          classId,
          className: '中一班',
          name: '小星星',
          gender: '女',
          birthday: '2022-05-02',
          status: 'disabled',
          authorizationStatus: 'partial',
        });
        expect(response.body.consents).toEqual([
          expect.objectContaining({ consentType: 'photo', status: 'granted' }),
        ]);
      });

    await request(app.getHttpServer())
      .get(`/students?classId=${classId}&status=disabled&keyword=S-002`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.total).toBe(1);
        expect(response.body.items[0]).not.toHaveProperty('birthday');
      });

    await request(app.getHttpServer())
      .get(`/students/${created.body.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/students/${created.body.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ name: '越权修改' })
      .expect(403);
  });

  it('previews XLSX imports without writing, reports row errors and confirms idempotently', async () => {
    await request(app.getHttpServer())
      .get(`/classes/${classId}/students/import/template`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(200)
      .expect('Content-Type', /spreadsheetml/);

    await request(app.getHttpServer())
      .post(`/classes/${classId}/students/import/preview`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .attach('file', Buffer.from('学号,姓名\nX-1,错误文件'), {
        filename: 'students.csv',
        contentType: 'text/csv',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/classes/${classId}/students/import/preview`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .attach('file', Buffer.alloc(2 * 1024 * 1024 + 1, 0x50), {
        filename: 'too-large.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(413);

    const invalidHeaders = await studentWorkbook([
      ['昵称'],
      ['缺少必填列'],
    ]);
    await request(app.getHttpServer())
      .post(`/classes/${classId}/students/import/preview`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .attach('file', invalidHeaders, {
        filename: 'missing-columns.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(400);

    const workbook = await studentWorkbook([
      ['学号', '姓名', '昵称', '性别', '生日', '状态'],
      ['IMP-001', '重复甲', '', '', '2021-01-01', '在读'],
      ['IMP-001', '重复乙', '', '', '2021-01-02', '在读'],
      ['S-001', '已有学号', '', '', '2021-02-01', '在读'],
      ['IMP-002', '生日错误', '', '', '2021-02-31', '在读'],
      ['IMP-003', '可导入幼儿', '小可', '女', '2021-03-02', 'active'],
    ]);
    await request(app.getHttpServer())
      .post(`/classes/${classId}/students/import/preview`)
      .set('Authorization', `Bearer ${otherToken}`)
      .attach('file', workbook, {
        filename: 'students.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(403);

    const preview = await request(app.getHttpServer())
      .post(`/classes/${classId}/students/import/preview`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .attach('file', workbook, {
        filename: 'students.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(201);
    expect(preview.body.summary).toEqual({ total: 5, valid: 1, invalid: 4 });
    expect(preview.body.invalidRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ rowNumber: 2, errors: expect.arrayContaining(['文件内学号重复']) }),
      expect.objectContaining({ rowNumber: 4, errors: expect.arrayContaining(['该班级已存在相同学号']) }),
      expect.objectContaining({ rowNumber: 5, errors: expect.arrayContaining(['生日格式应为 YYYY-MM-DD']) }),
    ]));

    const beforeConfirm = await request(app.getHttpServer())
      .get(`/students?classId=${classId}&keyword=IMP-003`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(200);
    expect(beforeConfirm.body.total).toBe(0);

    await request(app.getHttpServer())
      .get(`/classes/${classId}/students/import/${preview.body.sessionId}/errors`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(200)
      .expect('Content-Type', /text\/csv/)
      .expect((response) => {
        expect(response.text).toContain('文件内学号重复');
        expect(response.text).toContain('该班级已存在相同学号');
      });

    const requestId = '894ac385-6d06-449d-bade-a4b0a33c2121';
    const confirmed = await request(app.getHttpServer())
      .post(`/classes/${classId}/students/import/${preview.body.sessionId}/confirm`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ requestId })
      .expect(201);
    expect(confirmed.body).toMatchObject({ created: 1, skipped: 4, replayed: false });

    const replayed = await request(app.getHttpServer())
      .post(`/classes/${classId}/students/import/${preview.body.sessionId}/confirm`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ requestId })
      .expect(201);
    expect(replayed.body).toMatchObject({ created: 1, skipped: 4, replayed: true });

    const afterConfirm = await request(app.getHttpServer())
      .get(`/students?classId=${classId}&keyword=IMP-003`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(200);
    expect(afterConfirm.body.total).toBe(1);
    expect(afterConfirm.body.items[0]).toMatchObject({ studentNo: 'IMP-003', name: '可导入幼儿' });
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
    await request(app.getHttpServer())
      .post(`/devices/${deviceId}/heartbeat`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ deviceCode })
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          id: deviceId,
          status: 'online',
          online: true,
        });
        expect(response.body.lastOnlineAt).toBeTruthy();
      });
    const generated = await request(app.getHttpServer())
      .post('/classroom-tickets')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ deviceId, classroomId, classId, expiresInSeconds: 120 })
      .expect(201);
    expect(generated.body).toMatchObject({
      ticket: expect.any(String),
      expiresAt: expect.any(String),
      deviceCode,
    });
    const persisted = await tickets.findOneByOrFail({
      ticketHash: createHash('sha256')
        .update(generated.body.ticket)
        .digest('hex'),
    });
    expect(persisted.ticketHash).not.toBe(generated.body.ticket);
    await request(app.getHttpServer())
      .post('/classroom-tickets/consume')
      .send({ ticket: generated.body.ticket, deviceCode })
      .expect(401);
    await request(app.getHttpServer())
      .post('/classroom-tickets/consume')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ ticket: generated.body.ticket, deviceCode: 'WRONG-DEVICE' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/classroom-tickets/consume')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ ticket: generated.body.ticket, deviceCode })
      .expect(403);
    await request(app.getHttpServer())
      .post('/classroom-tickets/consume')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ ticket: generated.body.ticket, deviceCode })
      .expect(200)
      .expect({
        classId,
        classroomId,
        deviceId,
        lessonRunId: null,
        deviceCode,
      });
    await request(app.getHttpServer())
      .post('/classroom-tickets/consume')
      .set('Authorization', `Bearer ${teacherToken}`)
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
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ ticket: expiredPlain, deviceCode })
      .expect(400);
  });

  it('shows binding and computed heartbeat state while limiting teachers to their classes', async () => {
    const adminList = await request(app.getHttpServer())
      .get('/devices')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(adminList.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: deviceId,
          online: true,
          binding: expect.objectContaining({
            classId,
            classroomId,
            className: '中一班',
            classroomName: '彩虹教室',
          }),
        }),
      ]),
    );
    const teacherList = await request(app.getHttpServer())
      .get('/devices')
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(200);
    expect(teacherList.body.map((item: { id: number }) => item.id)).toContain(
      deviceId,
    );
    const otherTeacherList = await request(app.getHttpServer())
      .get('/devices')
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);
    expect(
      otherTeacherList.body.map((item: { id: number }) => item.id),
    ).not.toContain(deviceId);
  });

  it('returns protected classroom and device details and denies teacher unbinding', async () => {
    const room = await request(app.getHttpServer())
      .get(`/classrooms/${classroomId}`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(200);
    expect(room.body).toMatchObject({
      id: classroomId,
      bindingCount: 1,
      bindings: [
        expect.objectContaining({
          classId,
          deviceId,
          device: expect.objectContaining({ id: deviceId }),
        }),
      ],
    });
    await request(app.getHttpServer())
      .get(`/classrooms/${classroomId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403);
    const device = await request(app.getHttpServer())
      .get(`/devices/${deviceId}`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(200);
    expect(device.body).toMatchObject({
      id: deviceId,
      binding: expect.objectContaining({ classId, classroomId }),
    });
    await request(app.getHttpServer())
      .get(`/devices/${deviceId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/device-bindings/${device.body.binding.id}`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/devices/${deviceId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.binding.id).toBe(device.body.binding.id);
      });
  });

  it('marks a device offline after its heartbeat timeout', async () => {
    const device = await devices.findOneByOrFail({ id: deviceId });
    device.status = DeviceStatus.Online;
    device.lastOnlineAt = new Date(Date.now() - 10 * 60 * 1000);
    await devices.save(device);
    const response = await request(app.getHttpServer())
      .get('/devices')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(
      response.body.find((item: { id: number }) => item.id === deviceId),
    ).toMatchObject({ status: 'offline', online: false });
  });

  it('invalidates an unused ticket when the classroom has ended', async () => {
    const generated = await request(app.getHttpServer())
      .post('/classroom-tickets')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ deviceId, classroomId, classId, expiresInSeconds: 120 })
      .expect(201);
    const now = new Date();
    await runs.save(
      runs.create({
        lessonPlanId: 999,
        lessonPlanVersion: 1,
        teacherId,
        classId,
        classroomId,
        deviceId,
        avatarVersionId: null,
        avatarCharacterId: null,
        title: '已结束课堂',
        status: ClassroomRunStatus.Completed,
        currentStepIndex: 0,
        startedAt: now,
        pausedAt: null,
        resumedAt: null,
        endedAt: new Date(now.getTime() + 1000),
        breakStartedAt: null,
        breakEndsAt: null,
        elapsedSeconds: 10,
        version: 1,
      }),
    );
    await request(app.getHttpServer())
      .post('/classroom-tickets/consume')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ ticket: generated.body.ticket, deviceCode })
      .expect(400);
  });

  it('prevents disabled devices from heartbeats and classroom ticket generation', async () => {
    await request(app.getHttpServer())
      .patch(`/devices/${deviceId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'disabled' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/devices/${deviceId}/heartbeat`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ deviceCode })
      .expect(409);
    await request(app.getHttpServer())
      .post('/classroom-tickets')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ deviceId, classroomId, classId, expiresInSeconds: 120 })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/devices/${deviceId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'offline' })
      .expect(200);
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

  it('exposes only aggregated dashboard data to administrators', async () => {
    const dashboard = await request(app.getHttpServer())
      .get('/admin/dashboard')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(dashboard.body).toMatchObject({
      teachers: expect.any(Number),
      classes: expect.any(Number),
      students: expect.any(Number),
      devices: {
        total: expect.any(Number),
        online: expect.any(Number),
        offline: expect.any(Number),
      },
      classrooms: {
        today: expect.any(Number),
        active: expect.any(Number),
        abnormal: expect.any(Number),
      },
      resources: { pending: 0, disabled: 0 },
      ai: {
        total: expect.any(Number),
        successRate: expect.any(Number),
        errorRate: expect.any(Number),
      },
      storage: {
        indexedResourceBytes: 0,
        physicalBytes: expect.any(Number),
      },
    });
    expect(JSON.stringify(dashboard.body)).not.toContain('小雨');
    await request(app.getHttpServer())
      .get('/admin/dashboard')
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(403);
  });

  it('keeps audit logs read-only for teachers and masks sensitive fields', async () => {
    await auditLogs.save(
      auditLogs.create({
        actorType: AuthUserType.Administrator,
        actorId: 1,
        action: 'data.export',
        targetType: 'classroom_report',
        targetId: '1',
        result: AuditResult.Success,
        ipAddress: '192.168.12.34',
        metadata: JSON.stringify({
          phone: '13800138000',
          accessToken: 'sensitive-token',
          safeField: '可审计摘要',
        }),
      }),
    );
    const response = await request(app.getHttpServer())
      .get('/audit-logs?action=data.export&page=1&pageSize=20')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(response.body.items[0]).toMatchObject({
      action: 'data.export',
      ipAddress: '192.168.*.*',
      metadata: {
        phone: '***',
        accessToken: '***',
        safeField: '可审计摘要',
      },
    });
    await request(app.getHttpServer())
      .get('/audit-logs')
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/audit-logs/${response.body.items[0].id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });
});
