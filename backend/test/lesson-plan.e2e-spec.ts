import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AuthModule } from '../src/auth/auth.module';
import { Teacher, TeacherRole } from '../src/auth/entities/teacher.entity';
import { Administrator } from '../src/auth/entities/administrator.entity';
import {
  AuthUserType,
  RefreshTokenSession,
} from '../src/auth/entities/refresh-token-session.entity';
import {
  TeachingResource,
  ResourceAgeGroup,
  ResourceReviewStatus,
  ResourceType,
} from '../src/data/entities/teaching-resource.entity';
import { OwnerType } from '../src/data/owner.types';
import { LessonAiDraft } from '../src/lesson-plans/entities/lesson-ai-draft.entity';
import { LessonPlanVersion } from '../src/lesson-plans/entities/lesson-plan-version.entity';
import { LessonPlan } from '../src/lesson-plans/entities/lesson-plan.entity';
import { LessonStep } from '../src/lesson-plans/entities/lesson-step.entity';
import { LessonPlanAiService } from '../src/lesson-plans/lesson-plan-ai.service';
import {
  LESSON_PLAN_ENTITIES,
  LessonPlanModule,
} from '../src/lesson-plans/lesson-plan.module';
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
  let ai: LessonPlanAiService;
  let plans: Repository<LessonPlan>;
  let versions: Repository<LessonPlanVersion>;
  let steps: Repository<LessonStep>;
  let drafts: Repository<LessonAiDraft>;

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
              ARK_API_KEY: 'lesson-test-key',
              ARK_ENDPOINT_ID: 'lesson-test-model',
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
            ...LESSON_PLAN_ENTITIES,
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
    ai = app.get(LessonPlanAiService);
    plans = app.get(getRepositoryToken(LessonPlan));
    versions = app.get(getRepositoryToken(LessonPlanVersion));
    steps = app.get(getRepositoryToken(LessonStep));
    drafts = app.get(getRepositoryToken(LessonAiDraft));
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

  it('keeps AI output as an unconfirmed draft and creates a plan only after teacher confirmation', async () => {
    const before = await plans.count();
    const generate = jest.spyOn(ai, 'generate').mockResolvedValueOnce({
      output: {
        title: '春天的颜色',
        theme: '春天',
        ageGroup: '4-5' as never,
        domain: '科学',
        estimatedMinutes: 20,
        teachingObjectives: ['观察并表达春天的颜色'],
        introduction: '请小朋友看看春天的图片。',
        teachingProcess: [
          {
            title: '观察图片',
            stepType: 'resource' as never,
            content: '观察图片里有哪些颜色。',
            durationSeconds: 180,
            resourceId,
          },
        ],
        interactiveQuestions: ['你发现了什么颜色？'],
        extensionActivities: ['到户外寻找春天的颜色。'],
        assessmentSuggestions: ['观察幼儿是否愿意表达。'],
        resourceRecommendations: [{ resourceId, reason: '适合观察春天颜色' }],
      },
      provider: 'test-provider',
      model: 'test-model',
      requestId: 'request-1',
      latencyMs: 50,
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      attempts: 1,
    });
    const response = await request(app.getHttpServer())
      .post('/lesson-plans/ai-drafts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        theme: '春天',
        ageGroup: '4-5',
        domain: '科学',
        durationMinutes: 20,
        teachingObjectives: '观察颜色',
        teacherRequirements: '多提问',
        asrText: '让孩子多说一说',
        resourceIds: [resourceId],
      })
      .expect(201);
    expect(response.body.status).toBe('generated');
    expect(await plans.count()).toBe(before);
    await request(app.getHttpServer())
      .get(`/lesson-plans/ai-drafts/${response.body.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403);
    const confirmed = await request(app.getHttpServer())
      .post(`/lesson-plans/ai-drafts/${response.body.id}/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lessonType: 'activity' })
      .expect(201);
    expect(confirmed.body.status).toBe('draft');
    expect(confirmed.body.lessonType).toBe('activity');
    expect(confirmed.body.steps).toHaveLength(2);
    expect(await plans.count()).toBe(before + 1);
    await request(app.getHttpServer())
      .post(`/lesson-plans/ai-drafts/${response.body.id}/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(409);
    expect(
      (await drafts.findOneByOrFail({ id: response.body.id })).status,
    ).toBe('confirmed');
    generate.mockRestore();
  });

  it('rejects inaccessible AI resource ids before calling the model', async () => {
    const generate = jest.spyOn(ai, 'generate');
    await request(app.getHttpServer())
      .post('/lesson-plans/ai-drafts')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({
        theme: '春天',
        ageGroup: '4-5',
        domain: '科学',
        durationMinutes: 20,
        teachingObjectives: '观察颜色',
        resourceIds: [resourceId],
      })
      .expect(404);
    expect(generate).not.toHaveBeenCalled();
    generate.mockRestore();
  });

  it('validates controlled actions and recovery points, then preserves requested ordering', async () => {
    const created = await request(app.getHttpServer())
      .post('/lesson-plans')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: '动作与恢复点',
        theme: '互动',
        lessonType: 'break',
        ageGroup: '4-5',
        domain: '社会',
        objectives: '参与互动',
        estimatedMinutes: 15,
      })
      .expect(201);
    const id = created.body.id as number;
    await request(app.getHttpServer())
      .put(`/lesson-plans/${id}/steps`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        version: 1,
        steps: [
          {
            title: '错误恢复点',
            stepType: 'activity',
            content: '一起拍手。',
            durationSeconds: 60,
            recoveryPoint: {
              name: '返回',
              trigger: 'manual',
              recoveryStepOrder: 2,
            },
          },
        ],
      })
      .expect(400);
    await request(app.getHttpServer())
      .put(`/lesson-plans/${id}/steps`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        version: 1,
        steps: [
          {
            title: '危险动作',
            stepType: 'activity',
            content: '一起拍手。',
            durationSeconds: 60,
            actions: [
              {
                actionType: 'voice_instruction',
                actionName: 'speak',
                content: 'javascript:alert(1)',
              },
            ],
          },
        ],
      })
      .expect(400);
    const saved = await request(app.getHttpServer())
      .put(`/lesson-plans/${id}/steps`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        version: 1,
        steps: [
          {
            title: '第一步',
            stepType: 'activity',
            content: '一起拍手。',
            durationSeconds: 60,
            actions: [
              { actionType: 'avatar_action', actionName: 'clap' },
              {
                actionType: 'reward',
                actionName: 'flower',
                content: '奖励一朵小花',
              },
            ],
            recoveryPoint: {
              name: '重新开始',
              trigger: 'manual',
              recoveryStepOrder: 1,
            },
          },
          {
            title: '第二步',
            stepType: 'question',
            content: '你听到了什么？',
            durationSeconds: 60,
          },
        ],
      })
      .expect(200);
    expect(saved.body.steps[0].actions).toHaveLength(2);
    expect(saved.body.steps[0].recoveryPoint.recoveryStepOrder).toBe(1);
    const ids = saved.body.steps.map((step: { id: number }) => step.id);
    const reordered = await request(app.getHttpServer())
      .put(`/lesson-plans/${id}/steps-order`)
      .set('Authorization', `Bearer ${token}`)
      .send({ version: 2, stepIds: [ids[1], ids[0]] })
      .expect(200);
    expect(
      reordered.body.steps.map((step: { title: string }) => step.title),
    ).toEqual(['第二步', '第一步']);
  });

  it('rolls back batch step changes when version snapshot persistence fails', async () => {
    const created = await request(app.getHttpServer())
      .post('/lesson-plans')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: '事务回滚',
        theme: '测试',
        ageGroup: '3-4',
        objectives: '验证事务',
        estimatedMinutes: 10,
      })
      .expect(201);
    const id = created.body.id as number;
    await request(app.getHttpServer())
      .put(`/lesson-plans/${id}/steps`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        version: 1,
        steps: [
          {
            title: '原步骤',
            stepType: 'introduction',
            content: '原内容',
            durationSeconds: 60,
          },
        ],
      })
      .expect(200);
    await versions.save(
      versions.create({
        lessonPlanId: id,
        versionNo: 3,
        snapshotJson: '{}',
        createdBy: teacherId,
        createdByType: AuthUserType.Teacher,
        changeSummary: '制造版本冲突',
      }),
    );
    await request(app.getHttpServer())
      .put(`/lesson-plans/${id}/steps`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        version: 2,
        steps: [
          {
            title: '不应保存',
            stepType: 'summary',
            content: '新内容',
            durationSeconds: 60,
          },
        ],
      })
      .expect(500);
    expect((await plans.findOneByOrFail({ id })).version).toBe(2);
    expect((await steps.findOneByOrFail({ lessonPlanId: id })).title).toBe(
      '原步骤',
    );
  });
});
