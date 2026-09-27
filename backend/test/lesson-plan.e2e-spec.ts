import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AuthModule } from '../src/auth/auth.module';
import { Teacher, TeacherRole } from '../src/auth/entities/teacher.entity';
import { Administrator } from '../src/auth/entities/administrator.entity';
import { RefreshTokenSession } from '../src/auth/entities/refresh-token-session.entity';
import {
  TeachingResource,
  ResourceAgeGroup,
  ResourceReviewStatus,
  ResourceType,
} from '../src/data/entities/teaching-resource.entity';
import { OwnerType } from '../src/data/owner.types';
import { LessonPlan } from '../src/lesson-plans/entities/lesson-plan.entity';
import { LessonRun } from '../src/lesson-plans/entities/lesson-run.entity';
import { LessonStep } from '../src/lesson-plans/entities/lesson-step.entity';
import { LessonPlanModule } from '../src/lesson-plans/lesson-plan.module';
import { PLATFORM_ENTITIES } from '../src/platform/platform.module';
import {
  RESOURCE_ENTITIES,
  ResourceModule,
} from '../src/resources/resource.module';

describe('Lesson plans and runs (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let otherToken: string;
  let teacherId: number;
  let resourceId: number;

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              JWT_SECRET: 'lesson-test-secret-with-enough-characters',
              JWT_EXPIRES_IN: '2h',
              TEST_TEACHER_ACCOUNT: 'lesson_teacher',
              TEST_TEACHER_PASSWORD: 'Teacher123!',
              TEST_TEACHER_NAME: '备课老师',
              GARDEN_SHARED_OWNER_ID: 'garden:shared',
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
            ...RESOURCE_ENTITIES,
            ...PLATFORM_ENTITIES,
            LessonPlan,
            LessonStep,
            LessonRun,
          ],
          synchronize: true,
        }),
        AuthModule,
        ResourceModule,
        LessonPlanModule,
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
    const other = await teachers.save(
      teachers.create({
        account: 'other_teacher',
        passwordHash: await bcrypt.hash('Teacher123!', 4),
        name: '其他老师',
        role: TeacherRole.Teacher,
      }),
    );
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ account: 'lesson_teacher', password: 'Teacher123!' })
      .expect(200);
    const otherLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ account: other.account, password: 'Teacher123!' })
      .expect(200);
    token = login.body.access_token as string;
    teacherId = login.body.teacherId as number;
    otherToken = otherLogin.body.access_token as string;
    const resources = app.get<Repository<TeachingResource>>(
      getRepositoryToken(TeachingResource),
    );
    const saved = await resources.save(
      resources.create({
        title: '春天图片',
        aliases: '[]',
        description: null,
        resourceType: ResourceType.Image,
        category: '图片卡片',
        ageGroup: ResourceAgeGroup.Middle,
        tags: '["春天"]',
        fileUrl: '/uploads/resources/spring.jpg',
        coverUrl: null,
        fileName: 'spring.jpg',
        mimeType: 'image/jpeg',
        fileSize: 100,
        duration: null,
        reviewStatus: ResourceReviewStatus.Pending,
        ownerType: OwnerType.Teacher,
        ownerId: String(teacherId),
        type: null,
        url: null,
      }),
    );
    resourceId = saved.id;
  });

  afterAll(() => app.close());

  it('requires authentication and isolates teacher ownership', async () => {
    await request(app.getHttpServer()).get('/lesson-plans').expect(401);
    const created = await request(app.getHttpServer())
      .post('/lesson-plans')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: '春天在哪里',
        theme: '认识春天',
        ageGroup: '4-5',
        objectives: '观察并表达春天的颜色',
        estimatedMinutes: 25,
        status: 'draft',
      })
      .expect(201);
    await request(app.getHttpServer())
      .get(`/lesson-plans/${created.body.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403);
  });

  it('saves ordered steps, detects version conflicts, and runs the snapshot', async () => {
    const created = await request(app.getHttpServer())
      .post('/lesson-plans')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: '颜色课堂',
        theme: '春天颜色',
        ageGroup: '4-5',
        objectives: '观察颜色',
        estimatedMinutes: 20,
        status: 'ready',
      })
      .expect(201);
    const id = created.body.id as number;
    const saved = await request(app.getHttpServer())
      .put(`/lesson-plans/${id}/steps`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        version: 1,
        steps: [
          {
            sortOrder: 99,
            title: '看图片',
            stepType: 'resource',
            instruction: '请看看图片里有什么颜色。',
            resourceId,
            durationSeconds: 120,
          },
          {
            sortOrder: 5,
            title: '说发现',
            stepType: 'question',
            instruction: '你发现了什么颜色？',
            expectedResponse: '绿色、黄色',
            durationSeconds: 180,
          },
        ],
      })
      .expect(200);
    expect(
      saved.body.steps.map((step: { sortOrder: number }) => step.sortOrder),
    ).toEqual([1, 2]);
    await request(app.getHttpServer())
      .put(`/lesson-plans/${id}/steps`)
      .set('Authorization', `Bearer ${token}`)
      .send({ version: 1, steps: [] })
      .expect(409);
    const started = await request(app.getHttpServer())
      .post(`/lesson-plans/${id}/start`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const again = await request(app.getHttpServer())
      .post(`/lesson-plans/${id}/start`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(again.body.runId).toBe(started.body.runId);
    const runId = started.body.runId as number;
    await request(app.getHttpServer())
      .patch(`/lesson-runs/${runId}/progress`)
      .set('Authorization', `Bearer ${token}`)
      .send({ currentStepOrder: 2 })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/lesson-runs/${runId}/pause`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/lesson-runs/${runId}/progress`)
      .set('Authorization', `Bearer ${token}`)
      .send({ currentStepOrder: 1 })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/lesson-runs/${runId}/resume`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/lesson-runs/${runId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/lesson-runs/${runId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/lesson-runs/${runId}/progress`)
      .set('Authorization', `Bearer ${token}`)
      .send({ currentStepOrder: 1 })
      .expect(409);
  });

  it('rejects empty lessons and foreign private resources', async () => {
    const empty = await request(app.getHttpServer())
      .post('/lesson-plans')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: '空教案',
        theme: '测试',
        ageGroup: '3-4',
        objectives: '测试目标',
        estimatedMinutes: 10,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/lesson-plans/${empty.body.id}/start`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    const other = await request(app.getHttpServer())
      .post('/lesson-plans')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({
        title: '其他教案',
        theme: '测试',
        ageGroup: '3-4',
        objectives: '测试目标',
        estimatedMinutes: 10,
      })
      .expect(201);
    await request(app.getHttpServer())
      .put(`/lesson-plans/${other.body.id}/steps`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({
        version: 1,
        steps: [
          {
            title: '越权资源',
            stepType: 'resource',
            instruction: '打开资源',
            resourceId,
            durationSeconds: 60,
          },
        ],
      })
      .expect(404);
  });
});
