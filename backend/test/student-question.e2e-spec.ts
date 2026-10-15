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
import { AVATAR_ENTITIES } from '../src/avatars/avatar.module';
import { CLASSROOM_RUN_ENTITIES, ClassroomRunModule } from '../src/classroom-runs/classroom-run.module';
import { ClassroomRun } from '../src/classroom-runs/entities/classroom-run.entity';
import { ClassroomRunStatus } from '../src/classroom-runs/classroom-run.types';
import { OwnerType } from '../src/data/owner.types';
import { ResourceAgeGroup, ResourceReviewStatus, ResourceType, TeachingResource } from '../src/data/entities/teaching-resource.entity';
import { LESSON_PLAN_ENTITIES, LessonPlanModule } from '../src/lesson-plans/lesson-plan.module';
import { PLATFORM_ENTITIES, PlatformModule } from '../src/platform/platform.module';
import { SchoolClass } from '../src/platform/entities/school-class.entity';
import { Student } from '../src/platform/entities/student.entity';
import { TeacherClass } from '../src/platform/entities/teacher-class.entity';
import { RecordStatus, TeacherClassRole } from '../src/platform/platform.types';
import { RESOURCE_ENTITIES, ResourceModule } from '../src/resources/resource.module';

describe('Student question records and question map (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let otherToken: string;
  let teacherId: number;
  let classId: number;
  let runId: number;
  let studentId: number;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({
            JWT_ACCESS_SECRET: 'question-test-secret-long-enough',
            JWT_ACCESS_EXPIRES_IN: '2h',
            JWT_REFRESH_EXPIRES_IN: '30d',
            TEST_TEACHER_ACCOUNT: 'question_teacher',
            TEST_TEACHER_PASSWORD: 'Teacher123!',
            TEST_TEACHER_NAME: '问题老师',
            ARK_API_KEY: 'question-test-key',
            ARK_ENDPOINT_ID: 'question-test-model',
            QUESTION_MAP_AI_ENABLED: 'false',
          })],
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
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    const teachers = app.get<Repository<Teacher>>(getRepositoryToken(Teacher));
    const teacher = await teachers.findOneByOrFail({ account: 'question_teacher' });
    teacher.schoolId = 'garden-question';
    await teachers.save(teacher);
    teacherId = teacher.id;
    const other = await teachers.save(teachers.create({
      account: 'question_other',
      passwordHash: await bcrypt.hash('Teacher123!', 4),
      name: '其他老师',
      role: TeacherRole.Teacher,
      schoolId: 'garden-question',
    }));
    token = (await request(app.getHttpServer()).post('/auth/login').send({ account: teacher.account, password: 'Teacher123!' }).expect(200)).body.access_token as string;
    otherToken = (await request(app.getHttpServer()).post('/auth/login').send({ account: other.account, password: 'Teacher123!' }).expect(200)).body.access_token as string;

    const classes = app.get<Repository<SchoolClass>>(getRepositoryToken(SchoolClass));
    classId = (await classes.save(classes.create({
      schoolId: 'garden-question', name: '探索班', grade: '中班', ageRange: '4-5', schoolYear: '2026', status: RecordStatus.Active,
    }))).id;
    const teacherClasses = app.get<Repository<TeacherClass>>(getRepositoryToken(TeacherClass));
    await teacherClasses.save(teacherClasses.create({ teacherId, classId, role: TeacherClassRole.Lead }));
    const students = app.get<Repository<Student>>(getRepositoryToken(Student));
    studentId = (await students.save(students.create({
      classId, studentNo: 'Q-001', name: '朵朵', nickname: null, gender: null, birthday: null, status: RecordStatus.Active,
    }))).id;
    const runs = app.get<Repository<ClassroomRun>>(getRepositoryToken(ClassroomRun));
    runId = (await runs.save(runs.create({
      lessonPlanId: 1,
      lessonPlanVersion: 1,
      teacherId,
      classId,
      classroomId: 1,
      deviceId: 1,
      avatarVersionId: null,
      avatarCharacterId: null,
      title: '天空探索课',
      status: ClassroomRunStatus.Running,
      currentStepIndex: 0,
      startedAt: new Date(),
      pausedAt: null,
      resumedAt: new Date(),
      endedAt: null,
      breakStartedAt: null,
      breakEndsAt: null,
      breakContentType: null,
      breakDurationSeconds: null,
      breakProtectionAt: null,
      breakContext: null,
      elapsedSeconds: 0,
      version: 1,
    }))).id;
    const resources = app.get<Repository<TeachingResource>>(getRepositoryToken(TeachingResource));
    await resources.save(resources.create({
      title: '科学探索天空图片', aliases: '[]', description: null, schoolId: 'garden-question', resourceType: ResourceType.Image,
      category: '科学探索', categoryId: null, ageGroup: ResourceAgeGroup.Middle, domain: '科学', tags: '["科学探索","天空"]',
      fileUrl: '', coverUrl: null, fileName: 'sky.png', mimeType: 'image/png', fileSize: 100, duration: null,
      currentVersionId: null, aiTeachingGoals: null, aiActivitySuggestions: null, reviewStatus: ResourceReviewStatus.Approved,
      deletedAt: null, ownerType: OwnerType.Teacher, ownerId: String(teacherId), type: null, url: null,
    }));
  });

  afterAll(async () => app.close());

  it('persists, replays and rejects conflicting request ids', async () => {
    const body = {
      requestId: 'question-create-1',
      studentId,
      lessonStepIndex: 0,
      asrRawText: '天为什么是兰色的',
      teacherCorrectedText: '天空为什么是蓝色的？',
      topic: '科学探索',
      domain: '科学',
      isAnonymous: false,
    };
    const created = await request(app.getHttpServer()).post(`/classroom-runs/${runId}/questions`).set(auth()).send(body).expect(201);
    expect(created.body.question).toMatchObject({ questionText: '天空为什么是蓝色的？', asrRawText: '天为什么是兰色的', studentName: '朵朵' });
    const replay = await request(app.getHttpServer()).post(`/classroom-runs/${runId}/questions`).set(auth()).send(body).expect(201);
    expect(replay.body.question.id).toBe(created.body.question.id);
    await request(app.getHttpServer()).post(`/classroom-runs/${runId}/questions`).set(auth()).send({ ...body, asrRawText: '不同问题' }).expect(409);
  });

  it('allows teacher correction and anonymous records', async () => {
    const created = await request(app.getHttpServer()).post(`/classroom-runs/${runId}/questions`).set(auth()).send({
      requestId: 'question-anonymous-1', studentId, questionText: '为什么会下雨', topic: '天气', domain: '科学', isAnonymous: true,
    }).expect(201);
    expect(created.body.question).toMatchObject({ studentId: null, studentName: null, isAnonymous: true });
    const updated = await request(app.getHttpServer()).patch(`/classroom-runs/${runId}/questions/${created.body.question.id}`).set(auth()).send({
      requestId: 'question-update-1', teacherCorrectedText: '为什么天空会下雨？', topic: '科学探索', domain: '科学',
    }).expect(200);
    expect(updated.body.question).toMatchObject({ questionText: '为什么天空会下雨？', topic: '科学探索', domain: '科学' });
  });

  it('paginates, filters, isolates classes and builds a safe question map', async () => {
    const history = await request(app.getHttpServer()).get(`/classes/${classId}/questions?page=1&pageSize=10&topic=科学探索&domain=科学`).set(auth()).expect(200);
    expect(history.body.total).toBe(2);
    const map = await request(app.getHttpServer()).get(`/classes/${classId}/question-map?domain=科学`).set(auth()).expect(200);
    expect(map.body.topics).toEqual(expect.arrayContaining([expect.objectContaining({ name: '科学探索' })]));
    expect(map.body.suggestionSource).toBe('safe_rules');
    expect(map.body.recommendedResources).toEqual(expect.arrayContaining([expect.objectContaining({ title: '科学探索天空图片' })]));
    expect(map.body.safety).toMatchObject({ individualRankingGenerated: false, negativeLabelsGenerated: false });
    expect(JSON.stringify(map.body)).not.toContain('其他班');
    await request(app.getHttpServer()).get(`/classes/${classId}/questions`).set('Authorization', `Bearer ${otherToken}`).expect(403);
    await request(app.getHttpServer()).get(`/classes/${classId}/question-map`).set('Authorization', `Bearer ${otherToken}`).expect(403);
  });
});
