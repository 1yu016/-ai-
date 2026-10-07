import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { Repository } from 'typeorm';
import { ClassroomDirectorSuggestionType } from '../src/ai/dto/classroom-director.dto';
import {
  ClassroomDirectorSuggestion,
  DirectorSuggestionStatus,
} from '../src/ai/entities/classroom-director-suggestion.entity';
import { AuthModule } from '../src/auth/auth.module';
import { Administrator } from '../src/auth/entities/administrator.entity';
import {
  AuthUserType,
  RefreshTokenSession,
} from '../src/auth/entities/refresh-token-session.entity';
import { Teacher, TeacherRole } from '../src/auth/entities/teacher.entity';
import { AVATAR_ENTITIES } from '../src/avatars/avatar.module';
import {
  ClassroomCommandOperation,
  ClassroomCommandSource,
  ClassroomCommandStatus,
} from '../src/classroom-runs/classroom-command.types';
import {
  CLASSROOM_RUN_ENTITIES,
  ClassroomRunModule,
} from '../src/classroom-runs/classroom-run.module';
import {
  ClassroomEventResult,
  ClassroomEventType,
  ClassroomRunStatus,
} from '../src/classroom-runs/classroom-run.types';
import { ClassroomCommandRecord } from '../src/classroom-runs/entities/classroom-command-record.entity';
import { ClassroomEvent } from '../src/classroom-runs/entities/classroom-event.entity';
import {
  ClassroomRollCallRecord,
  RollCallMode,
} from '../src/classroom-runs/entities/classroom-roll-call-record.entity';
import { ClassroomRun } from '../src/classroom-runs/entities/classroom-run.entity';
import {
  AttendanceChangeSource,
  StudentAttendanceChange,
} from '../src/classroom-runs/entities/student-attendance-change.entity';
import { AttendanceStatus } from '../src/classroom-runs/entities/student-attendance-record.entity';
import { StudentQuestionRecord } from '../src/classroom-runs/entities/student-question-record.entity';
import { StudentRewardRecord } from '../src/classroom-runs/entities/student-reward-record.entity';
import { RewardCategory } from '../src/classroom-runs/reward-system.types';
import { TeachingResource } from '../src/data/entities/teaching-resource.entity';
import {
  LESSON_PLAN_ENTITIES,
  LessonPlanModule,
} from '../src/lesson-plans/lesson-plan.module';
import { AuditLog } from '../src/platform/entities/audit-log.entity';
import { SchoolClass } from '../src/platform/entities/school-class.entity';
import { Student } from '../src/platform/entities/student.entity';
import { TeacherClass } from '../src/platform/entities/teacher-class.entity';
import {
  PLATFORM_ENTITIES,
  PlatformModule,
} from '../src/platform/platform.module';
import {
  AuditResult,
  RecordStatus,
  TeacherClassRole,
} from '../src/platform/platform.types';
import {
  RESOURCE_ENTITIES,
  ResourceModule,
} from '../src/resources/resource.module';

describe('Classroom record, summary and report (e2e)', () => {
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
            JWT_ACCESS_SECRET: 'classroom-record-test-secret-long-enough',
            JWT_ACCESS_EXPIRES_IN: '2h',
            JWT_REFRESH_EXPIRES_IN: '30d',
            TEST_TEACHER_ACCOUNT: 'record_teacher',
            TEST_TEACHER_PASSWORD: 'Teacher123!',
            TEST_TEACHER_NAME: '记录老师',
            ARK_API_KEY: 'classroom-record-test-key',
            ARK_ENDPOINT_ID: 'classroom-record-test-model',
            CLASSROOM_SUMMARY_AI_ENABLED: 'false',
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
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    const teachers = app.get<Repository<Teacher>>(getRepositoryToken(Teacher));
    const teacher = await teachers.findOneByOrFail({ account: 'record_teacher' });
    teacher.schoolId = 'garden-record';
    await teachers.save(teacher);
    teacherId = teacher.id;
    const other = await teachers.save(
      teachers.create({
        account: 'record_other',
        passwordHash: await bcrypt.hash('Teacher123!', 4),
        name: '其他老师',
        role: TeacherRole.Teacher,
        schoolId: 'garden-record',
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

    const classes = app.get<Repository<SchoolClass>>(getRepositoryToken(SchoolClass));
    classId = (
      await classes.save(
        classes.create({
          schoolId: 'garden-record',
          name: '星星班',
          grade: '中班',
          ageRange: '4-5',
          schoolYear: '2026',
          status: RecordStatus.Active,
        }),
      )
    ).id;
    await app
      .get<Repository<TeacherClass>>(getRepositoryToken(TeacherClass))
      .save({ teacherId, classId, role: TeacherClassRole.Lead });
    studentId = (
      await app.get<Repository<Student>>(getRepositoryToken(Student)).save({
        classId,
        studentNo: 'R-001',
        name: '小星',
        nickname: null,
        gender: null,
        birthday: null,
        status: RecordStatus.Active,
      })
    ).id;
    const now = Date.now();
    runId = (
      await app.get<Repository<ClassroomRun>>(getRepositoryToken(ClassroomRun)).save({
        lessonPlanId: 1,
        lessonPlanVersion: 1,
        teacherId,
        classId,
        classroomId: 1,
        deviceId: 1,
        avatarVersionId: null,
        avatarCharacterId: null,
        title: '星星探索课',
        status: ClassroomRunStatus.Completed,
        currentStepIndex: 1,
        startedAt: new Date(now - 30_000),
        pausedAt: null,
        resumedAt: null,
        endedAt: new Date(now),
        breakStartedAt: null,
        breakEndsAt: null,
        breakContentType: null,
        breakDurationSeconds: null,
        breakProtectionAt: null,
        breakContext: null,
        elapsedSeconds: 30,
        version: 4,
      })
    ).id;
    await seedTimeline(now);
  });

  afterAll(async () => app?.close());

  async function seedTimeline(now: number) {
    const events = app.get<Repository<ClassroomEvent>>(getRepositoryToken(ClassroomEvent));
    await events.save([
      events.create({
        classroomRunId: runId,
        eventType: ClassroomEventType.Start,
        requestId: 'record-start-1',
        operatorType: AuthUserType.Teacher,
        operatorId: teacherId,
        deviceId: 1,
        payload: '{}',
        result: ClassroomEventResult.Success,
        createdAt: new Date(now - 30_000),
      }),
      events.create({
        classroomRunId: runId,
        eventType: ClassroomEventType.ChangeStep,
        requestId: 'record-step-1',
        operatorType: AuthUserType.Teacher,
        operatorId: teacherId,
        deviceId: 1,
        payload: JSON.stringify({ stepIndex: 1 }),
        result: ClassroomEventResult.Success,
        createdAt: new Date(now - 24_000),
      }),
      events.create({
        classroomRunId: runId,
        eventType: ClassroomEventType.BreakStart,
        requestId: 'record-break-start-1',
        operatorType: AuthUserType.Teacher,
        operatorId: teacherId,
        deviceId: 1,
        payload: JSON.stringify({ durationSeconds: 5 }),
        result: ClassroomEventResult.Success,
        createdAt: new Date(now - 12_000),
      }),
      events.create({
        classroomRunId: runId,
        eventType: ClassroomEventType.BreakEnd,
        requestId: 'record-break-end-1',
        operatorType: AuthUserType.Teacher,
        operatorId: teacherId,
        deviceId: 1,
        payload: JSON.stringify({ restoredStepIndex: 1 }),
        result: ClassroomEventResult.Success,
        createdAt: new Date(now - 7_000),
      }),
      events.create({
        classroomRunId: runId,
        eventType: ClassroomEventType.Complete,
        requestId: 'record-complete-1',
        operatorType: AuthUserType.Teacher,
        operatorId: teacherId,
        deviceId: 1,
        payload: '{}',
        result: ClassroomEventResult.Success,
        createdAt: new Date(now),
      }),
    ]);
    const commands = app.get<Repository<ClassroomCommandRecord>>(
      getRepositoryToken(ClassroomCommandRecord),
    );
    await commands.save(
      commands.create({
        requestId: 'record-media-1',
        classroomRunId: runId,
        requestHash: 'hash-media',
        source: ClassroomCommandSource.Screen,
        operation: ClassroomCommandOperation.OpenResource,
        operatorType: AuthUserType.Teacher,
        operatorId: teacherId,
        deviceId: 1,
        targetDeviceId: 1,
        expectedVersion: 1,
        parametersSummary: JSON.stringify({ resourceId: 9 }),
        status: ClassroomCommandStatus.Success,
        httpStatus: 200,
        failureReason: null,
        responsePayload: '{}',
        executedAt: new Date(now - 22_000),
        createdAt: new Date(now - 22_000),
      }),
    );
    await app
      .get<Repository<StudentAttendanceChange>>(getRepositoryToken(StudentAttendanceChange))
      .save({
        attendanceRecordId: 1,
        classroomRunId: runId,
        classId,
        studentId,
        previousStatus: null,
        nextStatus: AttendanceStatus.Present,
        changedByTeacherId: teacherId,
        source: AttendanceChangeSource.Manual,
        requestId: 'record-attendance-1',
        createdAt: new Date(now - 20_000),
      });
    await app
      .get<Repository<ClassroomRollCallRecord>>(getRepositoryToken(ClassroomRollCallRecord))
      .save({
        requestId: 'record-roll-1',
        classroomRunId: runId,
        classId,
        studentId,
        teacherId,
        mode: RollCallMode.Random,
        groupKey: null,
        eligibleCount: 1,
        createdAt: new Date(now - 18_000),
      });
    await app
      .get<Repository<StudentRewardRecord>>(getRepositoryToken(StudentRewardRecord))
      .save({
        studentId,
        classId,
        classroomRunId: runId,
        teacherId,
        rewardType: 'flower',
        rewardCategory: RewardCategory.Exploration,
        rewardForms: '["flower"]',
        points: 2,
        badgeCode: null,
        praiseTemplateId: 'brave_explore',
        praiseText: '你愿意大胆尝试，真有探索精神！',
        teacherConfirmedPraise: true,
        animationKey: 'stars',
        stars: 1,
        reason: '主动观察',
        requestId: 'record-reward-1',
        revokeRequestId: 'record-reward-revoke-1',
        revokedAt: new Date(now - 10_000),
        revokedByTeacherId: teacherId,
        revokeReason: '误操作',
        createdAt: new Date(now - 16_000),
      });
    await app
      .get<Repository<StudentQuestionRecord>>(getRepositoryToken(StudentQuestionRecord))
      .save({
        studentId,
        classId,
        classroomRunId: runId,
        lessonStepIndex: 1,
        asrRawText: '星星为什么发光',
        teacherCorrectedText: '星星为什么会发光？',
        questionText: '星星为什么会发光？',
        topic: '星星',
        domain: '科学',
        isAnonymous: false,
        teacherId,
        requestId: 'record-question-1',
        requestHash: 'hash-question',
        createdAt: new Date(now - 14_000),
      });
    const suggestions = app.get<Repository<ClassroomDirectorSuggestion>>(
      getRepositoryToken(ClassroomDirectorSuggestion),
    );
    const suggestion = await suggestions.save(
      suggestions.create({
        classroomRunId: runId,
        teacherId,
        type: ClassroomDirectorSuggestionType.Question,
        title: '观察星光',
        originalContent: '请幼儿说说星星像什么。',
        currentContent: '请幼儿说说星星像什么。',
        rationale: '连接生活经验',
        resourceId: null,
        commandOperation: null,
        commandParameters: null,
        status: DirectorSuggestionStatus.Confirmed,
        confirmedRequestId: 'record-director-confirm-1',
        createdAt: new Date(now - 9_000),
      }),
    );
    await app.get<Repository<AuditLog>>(getRepositoryToken(AuditLog)).save({
      actorType: AuthUserType.Teacher,
      actorId: teacherId,
      action: 'classroom_director.confirmed',
      targetType: 'director_suggestion',
      targetId: String(suggestion.id),
      result: AuditResult.Success,
      ipAddress: null,
      metadata: JSON.stringify({ suggestionId: suggestion.id }),
      createdAt: new Date(now - 8_000),
    });
  }

  it('returns one server-ordered timeline with all formal sources', async () => {
    const response = await request(app.getHttpServer())
      .get(`/classroom-runs/${runId}/timeline`)
      .set(auth())
      .expect(200);
    const types = response.body.items.map((item: { type: string }) => item.type);
    expect(types).toEqual(
      expect.arrayContaining([
        'class_start',
        'step_change',
        'resource',
        'attendance',
        'roll_call',
        'reward',
        'reward_revoke',
        'question',
        'break_start',
        'break_end',
        'ai_suggestion',
        'ai_confirmed',
        'class_end',
      ]),
    );
    const times = response.body.items.map((item: { occurredAt: string }) =>
      new Date(item.occurredAt).getTime(),
    );
    expect(times).toEqual([...times].sort((a, b) => a - b));
    const requestKeys = response.body.items
      .filter((item: { requestId?: string }) => item.requestId)
      .map((item: { source: string; type: string; requestId: string }) =>
        `${item.source}:${item.type}:${item.requestId}`,
      );
    expect(new Set(requestKeys).size).toBe(requestKeys.length);
  });

  it('keeps AI draft separate until teacher edits and confirms it', async () => {
    const draftResponse = await request(app.getHttpServer())
      .post(`/classroom-runs/${runId}/summary/draft`)
      .set(auth())
      .send({})
      .expect(201);
    expect(draftResponse.body).toMatchObject({ source: 'safe_rules', status: 'pending' });

    const before = await request(app.getHttpServer())
      .get(`/classroom-runs/${runId}/summary`)
      .set(auth())
      .expect(200);
    expect(before.body.draft).toBeTruthy();
    expect(before.body.formalSummary).toBeNull();

    const content = {
      classroomSummary: '幼儿通过观察和提问探索了星星。',
      participation: '幼儿愿意表达观察结果，并参与课堂互动。',
      interestPoints: ['星星', '夜空'],
      commonQuestions: ['星星为什么会发光？'],
      teachingStrategies: ['下次增加手电筒与遮光材料的观察活动。'],
    };
    const confirmed = await request(app.getHttpServer())
      .post(`/classroom-runs/${runId}/summary/confirm`)
      .set(auth())
      .send(content)
      .expect(201);
    expect(confirmed.body.formalSummary).toMatchObject(content);

    const reopened = await request(app.getHttpServer())
      .get(`/classroom-runs/${runId}/summary`)
      .set(auth())
      .expect(200);
    expect(reopened.body.formalSummary).toMatchObject(content);
  });

  it('blocks unsafe labels, enforces class isolation and exports page-equivalent data', async () => {
    await request(app.getHttpServer())
      .post(`/classroom-runs/${runId}/summary/confirm`)
      .set(auth())
      .send({
        classroomSummary: '这个幼儿不聪明。',
        participation: '参与活动。',
        interestPoints: [],
        commonQuestions: [],
        teachingStrategies: [],
      })
      .expect(400);
    await request(app.getHttpServer())
      .get(`/classroom-runs/${runId}/timeline`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403);
    const report = await request(app.getHttpServer())
      .get(`/classroom-runs/${runId}/report`)
      .set(auth())
      .expect(200);
    expect(report.body.content).toContain(report.body.formalSummary.classroomSummary);
    expect(report.body.content).toContain('星星为什么会发光？');
    expect(report.body.timeline.length).toBeGreaterThan(5);
  });
});
