import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { jest } from '@jest/globals';
import * as bcrypt from 'bcrypt';
import { unlink } from 'node:fs/promises';
import request from 'supertest';
import { Repository } from 'typeorm';
import { ArtworkModule } from '../src/artworks/artwork.module';
import { ArtworkVisionService } from '../src/artworks/artwork-vision.service';
import { StudentArtworkRecord } from '../src/artworks/entities/student-artwork-record.entity';
import { AuthModule } from '../src/auth/auth.module';
import { Administrator } from '../src/auth/entities/administrator.entity';
import { RefreshTokenSession } from '../src/auth/entities/refresh-token-session.entity';
import { AuthUserType } from '../src/auth/entities/refresh-token-session.entity';
import { Teacher, TeacherRole } from '../src/auth/entities/teacher.entity';
import { AVATAR_ENTITIES } from '../src/avatars/avatar.module';
import { CLASSROOM_RUN_ENTITIES, ClassroomRunModule } from '../src/classroom-runs/classroom-run.module';
import { ClassroomRun } from '../src/classroom-runs/entities/classroom-run.entity';
import { ClassroomRunStatus } from '../src/classroom-runs/classroom-run.types';
import { TeachingResource } from '../src/data/entities/teaching-resource.entity';
import { LESSON_PLAN_ENTITIES, LessonPlanModule } from '../src/lesson-plans/lesson-plan.module';
import { Classroom } from '../src/platform/entities/classroom.entity';
import { DeviceBinding } from '../src/platform/entities/device-binding.entity';
import { Device } from '../src/platform/entities/device.entity';
import { GuardianConsent } from '../src/platform/entities/guardian-consent.entity';
import { SchoolClass } from '../src/platform/entities/school-class.entity';
import { Student } from '../src/platform/entities/student.entity';
import { TeacherClass } from '../src/platform/entities/teacher-class.entity';
import { PLATFORM_ENTITIES, PlatformModule } from '../src/platform/platform.module';
import { BindingStatus, ConsentStatus, ConsentType, DeviceStatus, DeviceType, RecordStatus, TeacherClassRole } from '../src/platform/platform.types';
import { RESOURCE_ENTITIES, ResourceModule } from '../src/resources/resource.module';
import { ARTWORK_UPLOAD_DIRECTORY } from '../src/artworks/artwork-file';

describe('student artwork review (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let otherToken: string;
  let teacherId: number;
  let classId: number;
  let runId: number;
  let studentId: number;
  let deviceId: number;
  const createdKeys: string[] = [];
  const png = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]);
  const jpg = Buffer.from([0xff,0xd8,0xff,0xdb,0,0,0,0]);
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({ JWT_ACCESS_SECRET: 'artwork-secret-long-enough', JWT_ACCESS_EXPIRES_IN: '2h', JWT_REFRESH_EXPIRES_IN: '30d', TEST_TEACHER_ACCOUNT: 'artwork_teacher', TEST_TEACHER_PASSWORD: 'Teacher123!', TEST_TEACHER_NAME: '美术老师', ARK_API_KEY: 'test', ARK_ENDPOINT_ID: 'test-model' })] }),
        TypeOrmModule.forRoot({ type: 'better-sqlite3', database: ':memory:', entities: [Teacher, Administrator, RefreshTokenSession, TeachingResource, ...PLATFORM_ENTITIES, ...RESOURCE_ENTITIES, ...LESSON_PLAN_ENTITIES, ...CLASSROOM_RUN_ENTITIES, ...AVATAR_ENTITIES, StudentArtworkRecord], synchronize: true }),
        AuthModule, PlatformModule, ResourceModule, LessonPlanModule, ClassroomRunModule, ArtworkModule,
      ],
    }).overrideProvider(ArtworkVisionService).useValue({ review: jest.fn().mockResolvedValue('我看到画面里有一棵绿色的树。你愿意说说树旁边发生了什么吗？') }).compile();
    app = fixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    const teachers = app.get<Repository<Teacher>>(getRepositoryToken(Teacher));
    const teacher = await teachers.findOneByOrFail({ account: 'artwork_teacher' });
    teacher.schoolId = 'garden-art'; await teachers.save(teacher); teacherId = teacher.id;
    const other = await teachers.save(teachers.create({ account: 'artwork_other', passwordHash: await bcrypt.hash('Teacher123!', 4), name: '其他老师', role: TeacherRole.Teacher, schoolId: 'garden-art' }));
    token = (await request(app.getHttpServer()).post('/auth/login').send({ account: teacher.account, password: 'Teacher123!' }).expect(200)).body.access_token as string;
    otherToken = (await request(app.getHttpServer()).post('/auth/login').send({ account: other.account, password: 'Teacher123!' }).expect(200)).body.access_token as string;

    const classes = app.get<Repository<SchoolClass>>(getRepositoryToken(SchoolClass));
    classId = (await classes.save(classes.create({ schoolId: 'garden-art', name: '彩虹班', grade: '中班', ageRange: '4-5', schoolYear: '2026', status: RecordStatus.Active }))).id;
    await app.get<Repository<TeacherClass>>(getRepositoryToken(TeacherClass)).save({ teacherId, classId, role: TeacherClassRole.Lead });
    const students = app.get<Repository<Student>>(getRepositoryToken(Student));
    studentId = (await students.save(students.create({ classId, studentNo: 'ART-1', name: '朵朵', nickname: null, gender: null, birthday: null, status: RecordStatus.Active }))).id;
    const classroom = await app.get<Repository<Classroom>>(getRepositoryToken(Classroom)).save({ schoolId: 'garden-art', name: '美术教室', roomCode: 'ART', location: null, status: RecordStatus.Active });
    const device = await app.get<Repository<Device>>(getRepositoryToken(Device)).save({ schoolId: 'garden-art', deviceCode: 'screen-art', name: '美术大屏', type: DeviceType.ClassroomScreen, status: DeviceStatus.Active, lastOnlineAt: new Date() }); deviceId = device.id;
    await app.get<Repository<DeviceBinding>>(getRepositoryToken(DeviceBinding)).save({ deviceId, classroomId: classroom.id, classId, boundByType: AuthUserType.Teacher, boundBy: teacherId, boundAt: new Date(), status: BindingStatus.Active, unboundAt: null });
    runId = (await app.get<Repository<ClassroomRun>>(getRepositoryToken(ClassroomRun)).save({ lessonPlanId: 1, lessonPlanVersion: 1, teacherId, classId, classroomId: classroom.id, deviceId, avatarVersionId: null, avatarCharacterId: null, title: '画春天', status: ClassroomRunStatus.Running, currentStepIndex: 0, startedAt: new Date(), pausedAt: null, resumedAt: new Date(), endedAt: null, breakStartedAt: null, breakEndsAt: null, breakContentType: null, breakDurationSeconds: null, breakProtectionAt: null, breakContext: null, elapsedSeconds: 0, version: 1 })).id;
  });

  afterAll(async () => {
    for (const key of createdKeys) await unlink(`${ARTWORK_UPLOAD_DIRECTORY}/${key}`).catch(() => undefined);
    if (app) await app.close();
  });

  it('blocks upload until both photo and artwork consents are granted', async () => {
    await request(app.getHttpServer()).post(`/classroom-runs/${runId}/artworks`).set(auth()).field('studentId', studentId).attach('file', png, { filename: 'no-consent.png', contentType: 'image/png' }).expect(403);
    const repo = app.get<Repository<GuardianConsent>>(getRepositoryToken(GuardianConsent));
    await repo.save([{ studentId, consentType: ConsentType.Photo, status: ConsentStatus.Granted, consentedAt: new Date(), revokedAt: null, note: null }, { studentId, consentType: ConsentType.Artwork, status: ConsentStatus.Granted, consentedAt: new Date(), revokedAt: null, note: null }]);
  });

  it('accepts real PNG/JPG and rejects disguised or oversized files without records', async () => {
    const first = await request(app.getHttpServer()).post(`/classroom-runs/${runId}/artworks`).set(auth()).field('studentId', studentId).field('lessonStepIndex', 0).attach('file', png, { filename: 'tree.png', contentType: 'image/png' }).expect(201);
    expect(first.body.artwork).toMatchObject({ studentId, classId, mimeType: 'image/png', confirmedAt: null });
    const second = await request(app.getHttpServer()).post(`/classroom-runs/${runId}/artworks`).set(auth()).field('studentId', studentId).attach('file', jpg, { filename: 'sun.jpg', contentType: 'image/jpeg' }).expect(201);
    const repo = app.get<Repository<StudentArtworkRecord>>(getRepositoryToken(StudentArtworkRecord));
    createdKeys.push((await repo.findOneByOrFail({ id: first.body.artwork.id })).storageKey, (await repo.findOneByOrFail({ id: second.body.artwork.id })).storageKey);
    const before = await repo.count();
    await request(app.getHttpServer()).post(`/classroom-runs/${runId}/artworks`).set(auth()).field('studentId', studentId).attach('file', Buffer.from('not png'), { filename: 'fake.png', contentType: 'image/png' }).expect(400);
    await request(app.getHttpServer()).post(`/classroom-runs/${runId}/artworks`).set(auth()).field('studentId', studentId).attach('file', Buffer.alloc(10 * 1024 * 1024 + 1), { filename: 'huge.png', contentType: 'image/png' }).expect(400);
    expect(await repo.count()).toBe(before);
  });

  it('keeps AI output as draft, permits teacher editing, and delivers only after confirmation', async () => {
    const repo = app.get<Repository<StudentArtworkRecord>>(getRepositoryToken(StudentArtworkRecord));
    const artwork = await repo.findOneByOrFail({ originalName: 'tree.png' });
    const reviewed = await request(app.getHttpServer()).post('/ai/artwork-review').set(auth()).send({ artworkId: artwork.id }).expect(200);
    expect(reviewed.body.aiDraft).toContain('绿色的树');
    expect((await repo.findOneByOrFail({ id: artwork.id })).confirmedAt).toBeNull();
    await request(app.getHttpServer()).post(`/artworks/${artwork.id}/deliver`).set(auth()).send({ requestId: 'artwork-before-confirm', deviceId, targetDeviceId: deviceId, expectedVersion: 1, source: 'teacher_panel' }).expect(409);
    await request(app.getHttpServer()).post(`/artworks/${artwork.id}/confirm`).set(auth()).send({ teacherComment: '这个孩子心理焦虑' }).expect(400);
    const confirmed = await request(app.getHttpServer()).post(`/artworks/${artwork.id}/confirm`).set(auth()).send({ teacherComment: '我看到绿色的树和暖暖的太阳，你愿意介绍画里的故事吗？' }).expect(200);
    expect(confirmed.body.confirmedAt).toBeTruthy();
    const delivered = await request(app.getHttpServer()).post(`/artworks/${artwork.id}/deliver`).set(auth()).send({ requestId: 'artwork-deliver-1', deviceId, targetDeviceId: deviceId, expectedVersion: 1, source: 'teacher_panel' }).expect(200);
    expect(delivered.body.speech.result.playerState).toMatchObject({ artworkId: artwork.id, artworkComment: expect.stringContaining('绿色的树') });
    const replay = await request(app.getHttpServer()).post(`/artworks/${artwork.id}/deliver`).set(auth()).send({ requestId: 'artwork-deliver-1', deviceId, targetDeviceId: deviceId, expectedVersion: 1, source: 'teacher_panel' }).expect(200);
    expect(replay.body.speech.requestId).toBe('artwork-deliver-1:tts');
  });

  it('isolates other teachers and exposes authenticated lists/files', async () => {
    const repo = app.get<Repository<StudentArtworkRecord>>(getRepositoryToken(StudentArtworkRecord));
    const artwork = await repo.findOneByOrFail({ originalName: 'tree.png' });
    await request(app.getHttpServer()).get(`/artworks/${artwork.id}/file`).set(auth()).expect(200).expect('Content-Type', /image\/png/);
    await request(app.getHttpServer()).get(`/classroom-runs/${runId}/artworks`).set(auth()).expect(200).expect((response) => { expect(response.body.total).toBe(2); });
    await request(app.getHttpServer()).get(`/classes/${classId}/artworks`).set('Authorization', `Bearer ${otherToken}`).expect(403);
    await request(app.getHttpServer()).post(`/artworks/${artwork.id}/confirm`).set('Authorization', `Bearer ${otherToken}`).send({ teacherComment: '不能修改' }).expect(403);
  });
});
