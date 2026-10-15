import { INestApplication, ValidationPipe } from '@nestjs/common';
import { jest } from '@jest/globals';
import { firstValueFrom } from 'rxjs';
import { ClassroomMobileService } from '../src/classroom-mobile/classroom-mobile.service';
import { ClassroomSnapshotService } from '../src/classroom-runs/classroom-snapshot.service';
import { ClassroomSummary } from '../src/classroom-runs/entities/classroom-summary.entity';
import { ClassroomSummaryAiService } from '../src/classroom-runs/classroom-summary-ai.service';
import { LessonPlanService } from '../src/lesson-plans/lesson-plan.service';
import { LessonPlanAiService } from '../src/lesson-plans/lesson-plan-ai.service';
import { LessonPlan } from '../src/lesson-plans/entities/lesson-plan.entity';
import { LessonPlanVersion } from '../src/lesson-plans/entities/lesson-plan-version.entity';
import { LessonAiDraft } from '../src/lesson-plans/entities/lesson-ai-draft.entity';
import { LessonAiDraftStatus } from '../src/lesson-plans/lesson-plan.types';
import { ResourceReference } from '../src/resources/entities/resource-reference.entity';
import { ScreenLifecycleService } from '../src/classroom-runs/screen-lifecycle.service';
import { ScreenHandoffService } from '../src/classroom-runs/screen-handoff.service';
import type { JwtTeacherPayload } from '../src/auth/auth.types';
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
          status: DeviceStatus.Online,
          lastOnlineAt: new Date(),
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
          status: DeviceStatus.Online,
          lastOnlineAt: new Date(),
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

  it('authoring is durable/idempotent, conflicts atomically, preserves configuration and freezes classroom steps', async () => {
    const body = { title: 'Authoring验收', theme: '自然', ageGroup: '4-5', objectives: '观察',
      estimatedMinutes: 20, status: 'ready', requestId: requestId('authoring'), changeSummary: '完整备课',
      steps: [{ title: '观察', stepType: 'resource', teacherInstruction: '内部指导', studentContent: '观察图片', resourceId: approvedResourceId,
        durationSeconds: 60, actions: [{ actionType: 'avatar_action', actionName: 'wave' }],
        recoveryPoint: { name: '重新观察', trigger: 'manual', recoveryStepOrder: 1 } }] };
    const create = () => request(app.getHttpServer()).post('/lesson-plans/authoring').set(auth()).send(body);
    const [first, retry] = await Promise.all([create(), create()]);
    expect(first.status).toBe(201); expect(retry.status).toBe(201);
    expect(first.body.id).toBe(retry.body.id); expect(first.body.version).toBe(1);
    const versions = app.get<Repository<LessonPlanVersion>>(getRepositoryToken(LessonPlanVersion));
    expect(await versions.count({ where: { lessonPlanId: first.body.id } })).toBe(1);
    expect(first.body.steps[0].actions[0].actionName).toBe('wave');
    expect(first.body.steps[0].recoveryPoint.name).toBe('重新观察');
    const run = await request(app.getHttpServer()).post('/classroom-runs/start').set(auth()).send(startBody(first.body.id)).expect(201);
    const update = (suffix: string) => request(app.getHttpServer()).put(`/lesson-plans/${first.body.id}/authoring`).set(auth())
      .send({ ...body, version: 1, title: suffix, requestId: requestId(suffix) });
    const competing = await Promise.all([update('更新A'), update('更新B')]);
    expect(competing.map(r => r.status).sort()).toEqual([200, 409]);
    const saved = competing.find(r => r.status === 200)!.body;
    expect(saved.version).toBe(2);
    expect(saved.steps[0].actions[0].actionName).toBe('wave');
    expect(saved.steps[0].recoveryPoint.name).toBe('重新观察');
    const frozen = await request(app.getHttpServer()).get(`/classroom-runs/${run.body.id}`).set(auth()).expect(200);
    expect(frozen.body.lessonPlanVersion).toBe(1); expect(frozen.body.title).toBe('Authoring验收');
    expect(frozen.body.steps[0].title).toBe('观察');
    await request(app.getHttpServer()).post(`/classroom-runs/${run.body.id}/cancel`).set(auth())
      .send({ deviceId, version: run.body.version, requestId: requestId('authoring-cancel') }).expect(201);
    // Identical retries still return the original receipt after a newer save.
    expect((await create()).body.version).toBe(1);
  });

  it('rolls back actual database metadata, steps, references and versions after a late write failure', async () => {
    const plan = await createPlan(true, approvedResourceId);
    const before = (await request(app.getHttpServer()).get(`/lesson-plans/${plan.id}`).set(auth())).body;
    const versions = app.get<Repository<LessonPlanVersion>>(getRepositoryToken(LessonPlanVersion));
    const references = app.get<Repository<ResourceReference>>(getRepositoryToken(ResourceReference));
    const counts = [await versions.count(), await references.count()];
    const service = app.get(LessonPlanService);
    const fail = jest.spyOn(service as any, 'createVersion').mockImplementationOnce(async () => { throw new Error('late-write'); });
    try {
      await request(app.getHttpServer()).put(`/lesson-plans/${plan.id}/authoring`).set(auth()).send({
        title: '不能落库', theme: before.theme, ageGroup: before.ageGroup, objectives: before.objectives,
        estimatedMinutes: before.estimatedMinutes, status: before.status, version: before.version,
        requestId: requestId('rollback'),
        steps: before.steps.map((step: any) => ({ title: step.title, stepType: 'teacher_talk',
          teacherInstruction: '回滚测试教师指导', studentContent: '', durationSeconds: step.durationSeconds })) }).expect(500);
      expect(fail).toHaveBeenCalledTimes(1);
    } finally { fail.mockRestore(); }
    const after = (await request(app.getHttpServer()).get(`/lesson-plans/${plan.id}`).set(auth())).body;
    expect(after).toEqual(before);
    expect([await versions.count(), await references.count()]).toEqual(counts);
  });

  it('keeps teacher instructions out of empty student content and treats historical plans as unreviewed', async () => {
    const legacy = await createPlan();
    const old = (await request(app.getHttpServer()).get(`/lesson-plans/${legacy.id}`).set(auth()).expect(200)).body;
    expect(old.steps[0].studentContent).toBeNull();
    expect(old.steps[0].contentReviewRequired).toBe(true);
    const run = await request(app.getHttpServer()).post('/classroom-runs/start').set(auth()).send(startBody(legacy.id)).expect(201);
    expect(run.body.steps[0].content).toBe('');
    const saved = await request(app.getHttpServer()).put(`/lesson-plans/${legacy.id}/authoring`).set(auth()).send({
      title: old.title, theme: old.theme, ageGroup: old.ageGroup, objectives: old.objectives,
      estimatedMinutes: old.estimatedMinutes, status: old.status, version: old.version, requestId: requestId('isolate'),
      steps: [{ title: '明确隔离', stepType: 'teacher_talk', teacherInstruction: '仅老师：检查学生反应', studentContent: '', durationSeconds: 60 }]
    }).expect(200);
    expect(saved.body.steps[0].instruction).toBe('仅老师：检查学生反应');
    expect(saved.body.steps[0].content).toBe('');
    const frozen = (await request(app.getHttpServer()).get(`/classroom-runs/${run.body.id}`).set(auth()).expect(200)).body;
    expect(frozen.steps[0].title).toBe(old.steps[0].title);
    expect(frozen.steps[0].content).toBe('');
    await request(app.getHttpServer()).post(`/classroom-runs/${run.body.id}/cancel`).set(auth())
      .send({ deviceId, version: run.body.version, requestId: requestId('isolate-cancel') }).expect(201);
    const restarted = await request(app.getHttpServer()).post('/classroom-runs/start').set(auth()).send(startBody(legacy.id)).expect(201);
    expect(restarted.body.steps[0].content).toBe('');
    await request(app.getHttpServer()).post(`/classroom-runs/${restarted.body.id}/cancel`).set(auth())
      .send({ deviceId, version: restarted.body.version, requestId: requestId('isolate-cancel2') }).expect(201);
  });

  it('projects explicit student content through run and screen-state, never teacher instructions', async () => {
    const body = { title: '明确学生内容', theme: '数字', ageGroup: '4-5', objectives: '认识数字1',
      estimatedMinutes: 20, status: 'ready', requestId: requestId('nonempty-content'),
      steps: [{ title: '认识1', stepType: 'teacher_talk', teacherInstruction: '内部备注：观察反应',
        studentContent: '小朋友，找一找数字1吧！', durationSeconds: 60 }] };
    const plan = await request(app.getHttpServer()).post('/lesson-plans/authoring').set(auth()).send(body).expect(201);
    const read = await request(app.getHttpServer()).get(`/lesson-plans/${plan.body.id}`).set(auth()).expect(200);
    expect(read.body.steps[0]).toMatchObject({ teacherInstruction: body.steps[0].teacherInstruction,
      studentContent: body.steps[0].studentContent, contentReviewRequired: false });
    const run = await request(app.getHttpServer()).post('/classroom-runs/start').set(auth()).send(startBody(plan.body.id)).expect(201);
    expect(run.body.steps[0].content).toBe(body.steps[0].studentContent);
    const screen = await request(app.getHttpServer()).get(`/classroom-runs/screen-state?deviceId=${deviceId}`).set(auth()).expect(200);
    expect(screen.body.classroomState.steps[0].content).toBe(body.steps[0].studentContent);
    expect(screen.body.classroomState.steps[0].content).not.toContain('内部备注');
    await request(app.getHttpServer()).post(`/classroom-runs/${run.body.id}/cancel`).set(auth())
      .send({ deviceId, version: run.body.version, requestId: requestId('nonempty-cancel') }).expect(201);
  });

  it('keeps legacy step APIs usable without auto-copying instruction into content', async () => {
    const plan = await createPlan(false);
    const save = await request(app.getHttpServer()).put(`/lesson-plans/${plan.id}/steps`).set(auth()).send({
      version: 1, steps: [{ title: '旧客户端', stepType: 'teacher_talk', instruction: '仅教师指导', durationSeconds: 60 }]
    }).expect(200);
    expect(save.body.steps[0].instruction).toBe('仅教师指导');
    expect(save.body.steps[0].content).toBe('');
    const patch = await request(app.getHttpServer()).patch(`/lesson-plans/${plan.id}/steps/${save.body.steps[0].id}`).set(auth())
      .send({ version: save.body.version, instruction: '修改教师指导' }).expect(200);
    expect(patch.body.steps[0].instruction).toBe('修改教师指导');
    expect(patch.body.steps[0].content).toBe('');
    const read = await request(app.getHttpServer()).get(`/lesson-plans/${plan.id}`).set(auth()).expect(200);
    expect(read.body.steps[0].studentContent).toBeNull();
    expect(read.body.steps[0].contentReviewRequired).toBe(true);
  });

  it('copies atomically with an independent unreviewed v1 and rolls back failed copies', async () => {
    const source = await createPlan(true, approvedResourceId);
    const copy = await request(app.getHttpServer()).post(`/lesson-plans/${source.id}/copy`).set(auth()).expect(201);
    expect(copy.body.id).not.toBe(source.id); expect(copy.body.version).toBe(1);
    expect(copy.body.steps[0].contentReviewRequired).toBe(true);
    expect(copy.body.steps[0].studentContent).toBeNull();
    expect(copy.body.steps[0].actions[0].actionName).toBe('wave');
    expect(copy.body.steps[1].recoveryPoint.name).toBe('重新提问');
    const plans = app.get<Repository<LessonPlan>>(getRepositoryToken(LessonPlan));
    const versions = app.get<Repository<LessonPlanVersion>>(getRepositoryToken(LessonPlanVersion));
    const refs = app.get<Repository<ResourceReference>>(getRepositoryToken(ResourceReference));
    expect(await versions.count({ where: { lessonPlanId: copy.body.id } })).toBe(1);
    const before = [await plans.count(), await versions.count(), await refs.count()];
    const fail = jest.spyOn(app.get(LessonPlanService) as any, 'createVersion').mockImplementationOnce(async () => { throw Error('copy rollback'); });
    try { await request(app.getHttpServer()).post(`/lesson-plans/${source.id}/copy`).set(auth()).expect(500); expect(fail).toHaveBeenCalled(); }
    finally { fail.mockRestore(); }
    expect([await plans.count(), await versions.count(), await refs.count()]).toEqual(before);
    expect((await request(app.getHttpServer()).get(`/lesson-plans/${source.id}`).set(auth())).body.version).toBe(source.version);
  });

  it('legacy AI confirmation maps generated prose only to teacher instructions', async () => {
    const repo = app.get<Repository<LessonAiDraft>>(getRepositoryToken(LessonAiDraft));
    const output = { title: '旧AI草稿', theme: '数字', ageGroup: '4-5', domain: '科学', estimatedMinutes: 20,
      teachingObjectives: ['认识1'], introduction: '教师导入提示',
      teachingProcess: [{ title: '引导', stepType: 'teacher_talk', content: '教师内部建议', durationSeconds: 60 }],
      interactiveQuestions: [], extensionActivities: [], assessmentSuggestions: [], resourceRecommendations: [] };
    const draft = await repo.save(repo.create({ teacherId, inputJson: '{}', outputJson: JSON.stringify(output),
      provider: 'test', model: 'test', status: LessonAiDraftStatus.Generated }));
    const response = await request(app.getHttpServer()).post(`/lesson-plans/ai-drafts/${draft.id}/confirm`).set(auth()).send({}).expect(201);
    expect(response.body.steps[0].instruction).toBe('教师导入提示');
    expect(response.body.steps[0].content).toBe('');
    expect(response.body.steps[0].studentContent).toBeNull();
    expect(response.body.steps[1].instruction).toBe('教师内部建议');
  });

  it('2A generates and reads a candidate Draft without changing a real lesson version; failure leaves authoring available', async () => {
    const plan = await createPlan(true, approvedResourceId);
    const before = (await request(app.getHttpServer()).get(`/lesson-plans/${plan.id}`).set(auth())).body;
    const versionRepo = app.get<Repository<LessonPlanVersion>>(getRepositoryToken(LessonPlanVersion));
    const versionsBefore = await versionRepo.count();
    const planRepo = app.get<Repository<LessonPlan>>(getRepositoryToken(LessonPlan));
    const plansBefore = await planRepo.count();
    const ai = app.get(LessonPlanAiService) as any;
    const create = jest.spyOn(ai.openai.chat.completions, 'create');
    create.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ candidates: [{ title: '观察',
      teacherInstructionSuggestion: '老师拿苹果引导观察', studentContentCandidate: '苹果是什么颜色？',
      rationale: '鼓励观察', resourceId: approvedResourceId, durationSecondsSuggestion: 60 }], warnings: [] }) } }], usage: {} });
    const input = { schemaVersion: 2, taskType: 'step_optimization', baseLessonPlanId: plan.id,
      baseVersion: plan.version, targetStepId: before.steps[0].id, theme: before.theme, ageGroup: before.ageGroup,
      domain: '科学', durationMinutes: 20, teachingObjectives: before.objectives, resourceIds: [approvedResourceId] };
    try {
      const generated = await request(app.getHttpServer()).post('/lesson-plans/ai-drafts').set(auth()).send(input).expect(201);
      expect(generated.body.output.schemaVersion).toBe(2);
      expect(generated.body.output.candidates[0].candidateId).toBeTruthy();
      const read = await request(app.getHttpServer()).get(`/lesson-plans/ai-drafts/${generated.body.id}`).set(auth()).expect(200);
      expect(read.body.output).toEqual(generated.body.output);
      const context = JSON.parse(create.mock.calls[0]![0].messages[1].content);
      expect(context.resources[0].resourceId).toBe(approvedResourceId);
      expect(JSON.stringify(context)).not.toContain('absolutePath');
      await request(app.getHttpServer()).post(`/lesson-plans/ai-drafts/${generated.body.id}/confirm`).set(auth()).send({}).expect(409);
      expect((await request(app.getHttpServer()).get(`/lesson-plans/${plan.id}`).set(auth())).body).toEqual(before);
      expect(await versionRepo.count()).toBe(versionsBefore);
      expect(await planRepo.count()).toBe(plansBefore);
      await request(app.getHttpServer()).post('/lesson-plans/ai-drafts').set(auth()).send({ ...input, baseVersion: plan.version + 1 }).expect(409);
      await request(app.getHttpServer()).post('/lesson-plans/ai-drafts').set(auth()).send({ ...input, targetStepId: 999999 }).expect(400);
      await request(app.getHttpServer()).post('/lesson-plans/ai-drafts').set(auth()).send({ ...input, resourceIds: [draftResourceId] }).expect(409);
      expect(create).toHaveBeenCalledTimes(1);
      create.mockResolvedValue({ choices: [{ message: { content: '{"candidates":[{"title":"错误","teacherInstructionSuggestion":"观察","studentContentCandidate":"你是笨蛋","rationale":"建议","durationSecondsSuggestion":60}],"warnings":[]}' } }] });
      await request(app.getHttpServer()).post('/lesson-plans/ai-drafts').set(auth()).send(input).expect(503);
      expect((await request(app.getHttpServer()).get(`/lesson-plans/${plan.id}`).set(auth())).body).toEqual(before);
      create.mockRejectedValue(new Error('provider timeout'));
      await request(app.getHttpServer()).post('/lesson-plans/ai-drafts').set(auth()).send(input).expect(503);
      const manual = await request(app.getHttpServer()).put(`/lesson-plans/${plan.id}/authoring`).set(auth()).send({
        title: before.title, theme: before.theme, ageGroup: before.ageGroup, objectives: before.objectives,
        estimatedMinutes: before.estimatedMinutes, version: plan.version, requestId: requestId('after-ai-failure'),
        steps: [{ title: '人工继续', stepType: 'teacher_talk', teacherInstruction: '人工指导', studentContent: '', durationSeconds: 60 }] }).expect(200);
      expect(manual.body.version).toBe(plan.version + 1);
    } finally { create.mockRestore(); }
  });

  it('2B authoring validates provenance and records it without changing the AI Draft', async () => {
    const plan = await createPlan(true, approvedResourceId);
    const before = (await request(app.getHttpServer()).get(`/lesson-plans/${plan.id}`).set(auth())).body;
    const repo = app.get<Repository<LessonAiDraft>>(getRepositoryToken(LessonAiDraft));
    const output = { schemaVersion: 2, baseLessonPlanId: plan.id, baseVersion: plan.version, targetStepId: before.steps[0].id,
      candidates: [{ candidateId: 'provenance-candidate', teacherInstructionSuggestion: '建议指导', studentContentCandidate: '建议提问', resourceId: approvedResourceId }], warnings: [] };
    const draft = await repo.save(repo.create({ teacherId, inputJson: '{"schemaVersion":2}', outputJson: JSON.stringify(output),
      provider: 'test', model: 'test', status: LessonAiDraftStatus.Generated }));
    const body = { title: before.title, theme: before.theme, ageGroup: before.ageGroup, objectives: before.objectives,
      estimatedMinutes: before.estimatedMinutes, version: plan.version, requestId: requestId('provenance'),
      steps: before.steps.map((s: any) => ({ localStepId: `local-${s.id}`, sourceStepId: s.id, title:s.title, stepType:s.stepType,
        teacherInstruction:'教师指导', studentContent:'教师修订后学生文字', resourceId:s.resourceId, durationSeconds:s.durationSeconds })),
      aiProvenance: [{ draftId:draft.id, candidateId:'provenance-candidate', targetLocalStepId:`local-${before.steps[0].id}`, field:'studentContent', decision:'modified' }] };
    const versions = app.get<Repository<LessonPlanVersion>>(getRepositoryToken(LessonPlanVersion));
    const count = await versions.count();
    await request(app.getHttpServer()).put(`/lesson-plans/${plan.id}/authoring`).set(auth()).send({ ...body,
      aiProvenance:[{...body.aiProvenance[0],candidateId:'forged'}] }).expect(400);
    expect(await versions.count()).toBe(count);
    const foreign = await repo.save(repo.create({ teacherId:teacherId+999, inputJson:'{}',outputJson:JSON.stringify(output),provider:'test',model:'test',status:LessonAiDraftStatus.Generated }));
    await request(app.getHttpServer()).put(`/lesson-plans/${plan.id}/authoring`).set(auth()).send({ ...body,
      aiProvenance:[{...body.aiProvenance[0],draftId:foreign.id}] }).expect(403);
    const saved = await request(app.getHttpServer()).put(`/lesson-plans/${plan.id}/authoring`).set(auth()).send(body).expect(200);
    expect(saved.body.version).toBe(plan.version+1);
    const version = await versions.findOneByOrFail({lessonPlanId:plan.id,versionNo:saved.body.version});
    expect(JSON.parse(version.snapshotJson).aiProvenance[0]).toMatchObject({draftId:draft.id,
      baseVersion:plan.version, sourceStepId:before.steps[0].id, suggestedValue:'建议提问',
      finalValue:'教师修订后学生文字', matchesSuggestion:false, savedStepId:saved.body.steps[0].id});
    expect(await repo.findOneByOrFail({id:draft.id})).toEqual(draft);
    await request(app.getHttpServer()).put(`/lesson-plans/${plan.id}/authoring`).set(auth()).send({ ...body,
      version:saved.body.version, requestId:requestId('stale-provenance') }).expect(409);
    expect(await versions.count()).toBe(count+1);
  });

  it('2C-1 builds read-only evidence with strict permissions and a privacy whitelist', async () => {
    const plan = await createPlan();
    const one = await request(app.getHttpServer()).post('/classroom-runs/start').set(auth()).send(startBody(plan.id)).expect(201);
    const list = () => request(app.getHttpServer()).get(`/lesson-plans/${plan.id}/reference-runs`).set(auth());
    expect((await list()).body.total).toBe(0);
    await request(app.getHttpServer()).post(`/classroom-runs/${one.body.id}/complete`).set(auth())
      .send({deviceId,version:one.body.version,requestId:requestId('evidence-complete')}).expect(201);
    const privacyEvent = await events.save(events.create({classroomRunId:one.body.id,eventType:ClassroomEventType.Pause,
      operatorType:AuthUserType.Teacher,operatorId:teacherId,requestId:requestId('private-event'),result:'success' as any,
      payload:JSON.stringify({studentId:98765,name:'隐私幼儿姓名',photoUrl:'https://private/photo',voiceUrl:'https://private/audio',stepIndex:0})}));
    await events.save(events.create({classroomRunId:one.body.id,eventType:ClassroomEventType.ChangeStep,
      operatorType:AuthUserType.Teacher,operatorId:teacherId,requestId:requestId('failed-event'),result:'failure' as any,payload:'{}'}));
    const rows=(await list().expect(200)).body; expect(rows.total).toBe(1); expect(rows.items[0].runId).toBe(one.body.id);
    const runs=app.get<Repository<ClassroomRun>>(getRepositoryToken(ClassroomRun));
    const summaries=app.get<Repository<ClassroomSummary>>(getRepositoryToken(ClassroomSummary));
    await summaries.save(summaries.create({classroomRunId:one.body.id,draftId:999,teacherId,
      classroomSummary:'隐私幼儿姓名今天回答了问题',participation:'教师确认意见',interestPoints:'[]',commonQuestions:'[]',teachingStrategies:'[]',confirmedAt:new Date()}));
    const versions=app.get<Repository<LessonPlanVersion>>(getRepositoryToken(LessonPlanVersion));
    const runBefore=await runs.findOneByOrFail({id:one.body.id}); const summariesBefore=await summaries.find();
    const versionsBefore=await versions.find(); const eventsBefore=await events.find({where:{classroomRunId:one.body.id}});
    const model=jest.spyOn((app.get(LessonPlanAiService) as any).openai.chat.completions,'create');
    const summaryModel=jest.spyOn(app.get(ClassroomSummaryAiService),'generate');
    const body={baseVersion:plan.version,runIds:[one.body.id]};
    try {
      const pack=(await request(app.getHttpServer()).post(`/lesson-plans/${plan.id}/evidence-pack`).set(auth()).send(body).expect(201)).body;
      expect(pack.sourceManifest[0].runId).toBe(one.body.id);
      expect(pack.safeFacts.runs[0].facts.some((e:any)=>e.evidenceId===`event:${privacyEvent.id}`)).toBe(true);
      const safe=JSON.stringify(pack.safeFacts);
      for(const secret of ['隐私幼儿姓名','studentId','photoUrl','voiceUrl','payload','98765','https://']) expect(safe).not.toContain(secret);
      expect(pack.safeFacts.runs[0].facts.filter((e:any)=>e.type==='change_step')).toHaveLength(0);
      const repeat=(await request(app.getHttpServer()).post(`/lesson-plans/${plan.id}/evidence-pack`).set(auth()).send(body).expect(201)).body;
      expect(repeat.digest).toBe(pack.digest); expect(model).not.toHaveBeenCalled();
      expect(summaryModel).not.toHaveBeenCalled();
      expect(pack.teacherReview[0].formalSummary.classroomSummary).toContain('隐私幼儿姓名');
      expect(JSON.stringify(pack.safeFacts)).not.toContain('隐私幼儿姓名');
      const duplicate=(await request(app.getHttpServer()).post(`/lesson-plans/${plan.id}/evidence-pack`).set(auth()).send({...body,runIds:[one.body.id,one.body.id]}).expect(201)).body;
      expect(duplicate.sourceManifest).toHaveLength(1);
      const savedSummary=await summaries.findOneByOrFail({classroomRunId:one.body.id});
      await summaries.update(savedSummary.id,{classroomSummary:'教师后来更新了总结'});
      const changed=(await request(app.getHttpServer()).post(`/lesson-plans/${plan.id}/evidence-pack`).set(auth()).send(body).expect(201)).body;
      expect(changed.sourceManifest[0].summary.digest).not.toBe(pack.sourceManifest[0].summary.digest);
      await summaries.save(savedSummary);
      await request(app.getHttpServer()).post(`/lesson-plans/${plan.id}/evidence-pack`).set(auth()).send({...body,baseVersion:plan.version+1}).expect(409);
      await request(app.getHttpServer()).post(`/lesson-plans/${plan.id}/evidence-pack`).set(auth()).send({...body,runIds:[one.body.id,999999]}).expect(403);
      await request(app.getHttpServer()).get(`/lesson-plans/${plan.id}/reference-runs`).set('Authorization',`Bearer ${otherToken}`).expect(403);
      expect(await runs.findOneByOrFail({id:one.body.id})).toEqual(runBefore);
      expect(await summaries.find()).toEqual(summariesBefore); expect(await versions.find()).toEqual(versionsBefore);
      expect(await events.find({where:{classroomRunId:one.body.id}})).toEqual(eventsBefore);
    } finally { model.mockRestore(); summaryModel.mockRestore(); }
  });

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
      page: 'idle',
      classroomState: null,
    });
  });

  it('screen isolates terminal history, restores paused, and blocks cross-day activity', async () => {
    const repo = app.get<Repository<ClassroomRun>>(getRepositoryToken(ClassroomRun));
    const plan = await createPlan(true, approvedResourceId);
    const started = await request(app.getHttpServer()).post('/classroom-runs/start').set(auth()).send(startBody(plan.id)).expect(201);
    const id = started.body.id;
    const read = () => request(app.getHttpServer()).get(`/classroom-runs/screen-state?deviceId=${deviceId}`).set(auth());
    await repo.update(id, { status: ClassroomRunStatus.Paused });
    expect((await read().expect(200)).body.classroomState).toMatchObject({ id, status: 'paused' });
    for (const status of [ClassroomRunStatus.Running, ClassroomRunStatus.Paused]) {
      await repo.update(id, { status, startedAt: new Date(Date.now() - 48 * 60 * 60 * 1000) });
      const stale = await read().expect(409);
      expect(stale.body.message).toContain('不是今天');
      expect((await repo.findOneByOrFail({ id })).status).toBe(status);
    }
    await repo.update(id, { startedAt: new Date() });
    const bindings = app.get<Repository<DeviceBinding>>(getRepositoryToken(DeviceBinding));
    const binding = await bindings.findOneByOrFail({ deviceId, status: BindingStatus.Active });
    await bindings.update(binding.id, { classroomId: classroom2Id });
    expect((await read().expect(409)).body.message).toContain('绑定不一致');
    await bindings.update(binding.id, { classroomId: binding.classroomId });
    await app.get<Repository<ClassroomSnapshot>>(getRepositoryToken(ClassroomSnapshot)).update({ classroomRunId: id }, { checksum: 'invalid' });
    expect((await read().expect(200)).body).toMatchObject({ page: 'recovery', classroomState: { manualInterventionRequired: true } });
    for (const status of [ClassroomRunStatus.Completed, ClassroomRunStatus.Cancelled, ClassroomRunStatus.Failed]) {
      await repo.update(id, { status, endedAt: null });
      expect((await read().expect(200)).body).toMatchObject({ page: 'idle', classroomState: null });
      expect((await request(app.getHttpServer()).get(`/classroom-runs/${id}`).set(auth()).expect(200)).body.status).toBe(status);
      await request(app.getHttpServer()).get(`/classroom-runs/${id}/restore?deviceId=${deviceId}`).set(auth()).expect(200);
    }
  });

  it('READY creates no Run or Snapshot, cancels safely, and starts one real Run idempotently', async () => {
    const repo = app.get<Repository<ClassroomRun>>(getRepositoryToken(ClassroomRun));
    const snapshots = app.get<Repository<ClassroomSnapshot>>(getRepositoryToken(ClassroomSnapshot));
    const plan = await createPlan(true, approvedResourceId);
    const url = `/devices/${deviceId}/screen-preparations`;
    const body = { classId, classroomId, lessonPlanId: plan.id, lessonPlanVersion: plan.version, requestId: requestId('ready') };
    const before = [await repo.count(), await snapshots.count(), await events.count()];
    const ready = await request(app.getHttpServer()).post(url).set(auth()).send(body).expect(201);
    expect([await repo.count(), await snapshots.count(), await events.count()]).toEqual(before);
    const screen = await request(app.getHttpServer()).get(`/classroom-runs/screen-state?deviceId=${deviceId}`).set(auth()).expect(200);
    expect(screen.body).toMatchObject({ page: 'ready', classroomState: null, preparation: { preparationId: ready.body.preparationId, welcomeText: '欢迎小朋友，老师准备好后我们一起开始。' } });
    expect(screen.body.preparation).not.toHaveProperty('steps');
    const retry = await request(app.getHttpServer()).post(url).set(auth()).send(body).expect(201);
    expect(retry.body.expiresAt).toBe(ready.body.expiresAt);
    await request(app.getHttpServer()).delete(`${url}/${ready.body.preparationId}?revision=${ready.body.revision}`).set(auth()).expect(200);
    expect((await request(app.getHttpServer()).get(`/classroom-runs/screen-state?deviceId=${deviceId}`).set(auth()).expect(200)).body.page).toBe('idle');
    await request(app.getHttpServer()).post(url).set(auth()).send(body).expect(410);
    const second = await request(app.getHttpServer()).post(url).set(auth()).send({ ...body, requestId: requestId('ready-new') }).expect(201);
    // An old cancel must not remove a newer preparation.
    await request(app.getHttpServer()).delete(`${url}/${ready.body.preparationId}?revision=${ready.body.revision}`).set(auth()).expect(200);
    expect((await request(app.getHttpServer()).get(url).set(auth()).expect(200)).body.preparation.preparationId).toBe(second.body.preparationId);
    await request(app.getHttpServer()).post('/classroom-runs/start').set(auth()).send(startBody(plan.id)).expect(409);
    const start = startBody(plan.id, { preparationId: second.body.preparationId, preparationRevision: second.body.revision });
    const results = await Promise.all([0, 1].map(() => request(app.getHttpServer()).post('/classroom-runs/start').set(auth()).send(start).expect(201)));
    expect(results[0].body.id).toBe(results[1].body.id);
    expect(await repo.count()).toBe(before[0]! + 1);
    expect((await request(app.getHttpServer()).get(url).set(auth()).expect(200)).body.preparation).toBeNull();
    const opening = await request(app.getHttpServer()).get(`/classroom-runs/screen-state?deviceId=${deviceId}`).set(auth()).expect(200);
    expect(opening.body.phase).toBe('opening');
    expect(opening.body.lifecycle).toMatchObject({ runId: results[0].body.id, deviceId, phase: 'opening', revision: 1 });
    const snapshotRepo = app.get<Repository<ClassroomSnapshot>>(getRepositoryToken(ClassroomSnapshot));
    const countBeforeRetry = await snapshotRepo.count({ where: { classroomRunId: results[0].body.id } });
    await request(app.getHttpServer()).post('/classroom-runs/start').set(auth()).send(start).expect(201);
    expect(await snapshotRepo.count({ where: { classroomRunId: results[0].body.id } })).toBe(countBeforeRetry);
    await request(app.getHttpServer()).post(url).set(auth()).send({ ...body, requestId: requestId('ready-over-active') }).expect(409);
    expect((await request(app.getHttpServer()).get(`/classroom-runs/screen-state?deviceId=${deviceId}`).set(auth()).expect(200)).body.page).toBe('classroom');
    await request(app.getHttpServer()).post(`/classroom-runs/${results[0].body.id}/complete`).set(auth()).send({ deviceId, version: results[0].body.version, requestId: requestId('ready-complete') }).expect(201);
  });

  it('opening complete/skip are idempotent projections, with pause priority and GET/SSE parity', async () => {
    const plan = await createPlan();
    const started = await request(app.getHttpServer()).post('/classroom-runs/start').set(auth()).send(startBody(plan.id)).expect(201);
    const id = started.body.id as number;
    const read = () => request(app.getHttpServer()).get(`/classroom-runs/screen-state?deviceId=${deviceId}`).set(auth()).expect(200);
    const opening = (await read()).body;
    const dto = { deviceId, bindingId: opening.lifecycle.bindingId, expectedRevision: 1 };
    const actor = { sub: teacherId, userType: AuthUserType.Teacher, role: TeacherRole.Teacher, schoolId: 'garden-run' } as JwtTeacherPayload;
    const stream = await firstValueFrom(app.get(ClassroomMobileService).screenStream(actor, deviceId));
    expect(stream.type).toBe('screen_state');
    expect(stream.data).toMatchObject({ phase: opening.phase, lifecycle: opening.lifecycle, classroomState: { id } });
    const paused = await request(app.getHttpServer()).post(`/classroom-runs/${id}/pause`).set(auth()).send({ deviceId, version: started.body.version, requestId: requestId('opening-pause') }).expect(201);
    expect((await read()).body).toMatchObject({ phase: 'paused', classroomState: { status: 'paused' }, lifecycle: { phase: 'opening' } });
    const completed = await request(app.getHttpServer()).post(`/classroom-runs/${id}/opening/complete`).set(auth()).send(dto).expect(201);
    expect(completed.body).toMatchObject({ phase: 'teaching', revision: 2 });
    const snapshots = app.get<Repository<ClassroomSnapshot>>(getRepositoryToken(ClassroomSnapshot));
    const count = await snapshots.count({ where: { classroomRunId: id } });
    await request(app.getHttpServer()).post(`/classroom-runs/${id}/opening/skip`).set(auth()).send(dto).expect(201);
    await request(app.getHttpServer()).post(`/classroom-runs/${id}/opening/complete`).set(auth()).send(dto).expect(201);
    expect(await snapshots.count({ where: { classroomRunId: id } })).toBe(count);
    await request(app.getHttpServer()).post(`/classroom-runs/${id}/opening/complete`).set(auth()).send({ ...dto, expectedRevision: 3 }).expect(409);
    const unchanged = await request(app.getHttpServer()).get(`/classroom-runs/${id}`).set(auth()).expect(200);
    expect(unchanged.body).toMatchObject({ status: 'paused', currentStepIndex: 0, version: paused.body.version });
    const resumed = await request(app.getHttpServer()).post(`/classroom-runs/${id}/resume`).set(auth()).send({ deviceId, version: paused.body.version, requestId: requestId('opening-resume') }).expect(201);
    expect((await read()).body.phase).toBe('teaching');
    await request(app.getHttpServer()).post(`/classroom-runs/${id}/complete`).set(auth()).send({ deviceId, version: resumed.body.version, requestId: requestId('opening-end') }).expect(201);
    const second = await request(app.getHttpServer()).post('/classroom-runs/start').set(auth()).send(startBody(plan.id)).expect(201);
    const secondState = (await read()).body;
    await request(app.getHttpServer()).post(`/classroom-runs/${second.body.id}/opening/skip`).set(auth()).send({ deviceId, bindingId: secondState.lifecycle.bindingId, expectedRevision: 1 }).expect(201);
    expect((await read()).body).toMatchObject({ phase: 'teaching', classroomState: { currentStepIndex: 0, status: 'running' } });
    await request(app.getHttpServer()).post(`/classroom-runs/${second.body.id}/complete`).set(auth()).send({ deviceId, version: second.body.version, requestId: requestId('opening-second-end') }).expect(201);
  });

  it('failed opening initialization rolls back Run and snapshot and preserves READY', async () => {
    const plan = await createPlan();
    const url = `/devices/${deviceId}/screen-preparations`;
    const ready = await request(app.getHttpServer()).post(url).set(auth()).send({ classId, classroomId,
      lessonPlanId: plan.id, lessonPlanVersion: plan.version, requestId: requestId('opening-failure-ready') }).expect(201);
    const runs = app.get<Repository<ClassroomRun>>(getRepositoryToken(ClassroomRun));
    const snapshots = app.get<Repository<ClassroomSnapshot>>(getRepositoryToken(ClassroomSnapshot));
    const before = [await runs.count(), await snapshots.count()];
    const stub = jest.spyOn(app.get(ScreenLifecycleService), 'createOpening').mockRejectedValueOnce(new Error('isolated opening initialization failure'));
    try {
      await request(app.getHttpServer()).post('/classroom-runs/start').set(auth()).send(startBody(plan.id, {
        preparationId: ready.body.preparationId, preparationRevision: ready.body.revision,
      })).expect(500);
    } finally { stub.mockRestore(); }
    expect([await runs.count(), await snapshots.count()]).toEqual(before);
    expect((await request(app.getHttpServer()).get(url).set(auth()).expect(200)).body.preparation.preparationId).toBe(ready.body.preparationId);
    await request(app.getHttpServer()).delete(`${url}/${ready.body.preparationId}?revision=${ready.body.revision}`).set(auth()).expect(200);
  });

  it('legacy active Run without lifecycle remains teaching and is never backfilled', async () => {
    const plan = await createPlan();
    const runs = app.get<Repository<ClassroomRun>>(getRepositoryToken(ClassroomRun));
    const run = await runs.save(runs.create({ lessonPlanId: plan.id, lessonPlanVersion: plan.version,
      teacherId, classId, classroomId, deviceId, title: 'legacy', status: ClassroomRunStatus.Running,
      startedAt: new Date(), resumedAt: new Date(), currentStepIndex: 0, elapsedSeconds: 0, version: 1 }));
    await app.get(ClassroomSnapshotService).capture(run.id, ClassroomSnapshotReason.Start, true);
    const screen = await request(app.getHttpServer()).get(`/classroom-runs/screen-state?deviceId=${deviceId}`).set(auth()).expect(200);
    expect(screen.body).toMatchObject({ phase: 'teaching', lifecycle: null, classroomState: { id: run.id, status: 'running' } });
    expect(screen.body.classroomState.interactionState).not.toHaveProperty('screenLifecycle');
    await request(app.getHttpServer()).post(`/classroom-runs/${run.id}/complete`).set(auth()).send({ deviceId, version: 1, requestId: requestId('legacy-end') }).expect(201);
  });

  it('SUMMARY requires observed active handoff, persists static refresh, and READY revokes it permanently', async () => {
    const plan = await createPlan();
    const started = await request(app.getHttpServer()).post('/classroom-runs/start').set(auth()).send(startBody(plan.id)).expect(201);
    const active = (await request(app.getHttpServer()).get(`/classroom-runs/screen-state?deviceId=${deviceId}`).set(auth()).expect(200)).body;
    const handoffId = active.handoff.id;
    const complete = { deviceId, version: started.body.version, requestId: requestId('summary-complete') };
    await request(app.getHttpServer()).post(`/classroom-runs/${started.body.id}/complete`).set(auth()).send(complete).expect(201);
    const read = () => request(app.getHttpServer()).get(`/classroom-runs/screen-state?deviceId=${deviceId}&handoffId=${handoffId}`).set(auth()).expect(200);
    const summary = (await read()).body;
    expect(summary).toMatchObject({ page: 'summary', phase: 'summary', classroomState: null, lifecycle: { phase: 'summary', revision: 2, runId: started.body.id } });
    expect((await request(app.getHttpServer()).get(`/classroom-runs/screen-state?deviceId=${deviceId}`).set(auth()).expect(200)).body.page).toBe('idle');
    await request(app.getHttpServer()).post(`/classroom-runs/${started.body.id}/complete`).set(auth()).send(complete).expect(201);
    expect((await read()).body.lifecycle).toEqual(summary.lifecycle);
    const actor = { sub: teacherId, userType: AuthUserType.Teacher, role: TeacherRole.Teacher, schoolId: 'garden-run' } as JwtTeacherPayload;
    const stream = await firstValueFrom(app.get(ClassroomMobileService).screenStream(actor, deviceId, handoffId));
    expect(stream.data).toMatchObject({ page: 'summary', lifecycle: summary.lifecycle });
    const leases = app.get(ScreenHandoffService);
    expect(leases.resolve(actor, 'tampered-id', deviceId, summary.lifecycle.bindingId)).toBeNull();
    expect(() => leases.resolve({ ...actor, sub: teacherId + 1 }, handoffId, deviceId, summary.lifecycle.bindingId)).toThrow();
    expect(() => leases.resolve(actor, handoffId, deviceId + 1, summary.lifecycle.bindingId)).toThrow();
    const ready = await request(app.getHttpServer()).post(`/devices/${deviceId}/screen-preparations`).set(auth()).send({ classId, classroomId, lessonPlanId: plan.id, lessonPlanVersion: plan.version, requestId: requestId('summary-new-ready') }).expect(201);
    await request(app.getHttpServer()).delete(`/devices/${deviceId}/screen-preparations/${ready.body.preparationId}?revision=${ready.body.revision}`).set(auth()).expect(200);
    expect((await read()).body.page).toBe('idle');
  });

  it('SUMMARY expires, closes, and failed summary creation rolls complete back atomically', async () => {
    const plan = await createPlan();
    const started = await request(app.getHttpServer()).post('/classroom-runs/start').set(auth()).send(startBody(plan.id)).expect(201);
    const active = (await request(app.getHttpServer()).get(`/classroom-runs/screen-state?deviceId=${deviceId}`).set(auth()).expect(200)).body;
    const complete = { deviceId, version: started.body.version, requestId: requestId('summary-rollback') };
    const spy = jest.spyOn(app.get(ScreenLifecycleService), 'createSummary').mockRejectedValueOnce(new Error('isolated summary failure'));
    try { await request(app.getHttpServer()).post(`/classroom-runs/${started.body.id}/complete`).set(auth()).send(complete).expect(500); } finally { spy.mockRestore(); }
    expect((await request(app.getHttpServer()).get(`/classroom-runs/${started.body.id}`).set(auth()).expect(200)).body.status).toBe('running');
    await request(app.getHttpServer()).post(`/classroom-runs/${started.body.id}/complete`).set(auth()).send(complete).expect(201);
    const read = () => request(app.getHttpServer()).get(`/classroom-runs/screen-state?deviceId=${deviceId}&handoffId=${active.handoff.id}`).set(auth()).expect(200);
    const summary = (await read()).body;
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse(summary.lifecycle.expiresAt) + 1);
    try { expect((await read()).body.page).toBe('idle'); } finally { nowSpy.mockRestore(); }
    expect((await read()).body.page).toBe('idle');
    const second = await request(app.getHttpServer()).post('/classroom-runs/start').set(auth()).send(startBody(plan.id)).expect(201);
    const secondActive = (await request(app.getHttpServer()).get(`/classroom-runs/screen-state?deviceId=${deviceId}`).set(auth()).expect(200)).body;
    await request(app.getHttpServer()).post(`/classroom-runs/${second.body.id}/complete`).set(auth()).send({ deviceId, version: second.body.version, requestId: requestId('summary-close-end') }).expect(201);
    const state = (await request(app.getHttpServer()).get(`/classroom-runs/screen-state?deviceId=${deviceId}&handoffId=${secondActive.handoff.id}`).set(auth()).expect(200)).body;
    await request(app.getHttpServer()).post(`/classroom-runs/${second.body.id}/summary/close`).set(auth()).send({ deviceId, bindingId: state.lifecycle.bindingId, expectedRevision: state.lifecycle.revision }).expect(201);
    expect((await request(app.getHttpServer()).get(`/classroom-runs/screen-state?deviceId=${deviceId}&handoffId=${secondActive.handoff.id}`).set(auth()).expect(200)).body.page).toBe('idle');
  });

  it('new Run revokes old summary lease; cancelled/failed never project SUMMARY', async () => {
    const plan = await createPlan();
    const begin = () => request(app.getHttpServer()).post('/classroom-runs/start').set(auth()).send(startBody(plan.id)).expect(201);
    const screen = (id?: string) => request(app.getHttpServer()).get(`/classroom-runs/screen-state?deviceId=${deviceId}${id ? `&handoffId=${id}` : ''}`).set(auth()).expect(200);
    const first = await begin(); const old = (await screen()).body.handoff.id;
    await request(app.getHttpServer()).post(`/classroom-runs/${first.body.id}/complete`).set(auth()).send({ deviceId, version: first.body.version, requestId: requestId('summary-old-end') }).expect(201);
    const second = await begin(); const secondLease = (await screen()).body.handoff.id;
    await request(app.getHttpServer()).post(`/classroom-runs/${second.body.id}/cancel`).set(auth()).send({ deviceId, version: second.body.version, requestId: requestId('summary-cancel') }).expect(201);
    expect((await screen(old)).body.page).toBe('idle');
    expect((await screen(secondLease)).body.page).toBe('idle');
    const third = await begin(); const thirdLease = (await screen()).body.handoff.id;
    await app.get<Repository<ClassroomRun>>(getRepositoryToken(ClassroomRun)).update(third.body.id, { status: ClassroomRunStatus.Failed, endedAt: new Date() });
    await app.get(ClassroomSnapshotService).capture(third.body.id, ClassroomSnapshotReason.Timed, true);
    expect((await screen(thirdLease)).body.page).toBe('idle');
  });

  it('READY expiration releases the target without extending its deadline or creating a Run', async () => {
    const plan = await createPlan();
    const url = `/devices/${deviceId}/screen-preparations`;
    const body = { classId, classroomId, lessonPlanId: plan.id, lessonPlanVersion: plan.version, requestId: requestId('ready-expiry') };
    const ready = await request(app.getHttpServer()).post(url).set(auth()).send(body).expect(201);
    const count = await app.get<Repository<ClassroomRun>>(getRepositoryToken(ClassroomRun)).count();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.parse(ready.body.expiresAt) + 1);
    try {
      expect((await request(app.getHttpServer()).get(url).set(auth()).expect(200)).body.preparation).toBeNull();
      expect((await request(app.getHttpServer()).get(`/classroom-runs/screen-state?deviceId=${deviceId}`).set(auth()).expect(200)).body.page).toBe('idle');
      await request(app.getHttpServer()).post('/classroom-runs/start').set(auth()).send(startBody(plan.id, { preparationId: ready.body.preparationId, preparationRevision: ready.body.revision })).expect(410);
      expect(await app.get<Repository<ClassroomRun>>(getRepositoryToken(ClassroomRun)).count()).toBe(count);
    } finally { clock.mockRestore(); }
    const next = await request(app.getHttpServer()).post(url).set(auth()).send({ ...body, requestId: requestId('ready-after-expiry') }).expect(201);
    await request(app.getHttpServer()).delete(`${url}/${next.body.preparationId}?revision=${next.body.revision}`).set(auth()).expect(200);
  });

  it('READY cannot overwrite another preparation and device faults retain priority', async () => {
    const plan = await createPlan();
    const url = `/devices/${deviceId}/screen-preparations`;
    const body = { classId, classroomId, lessonPlanId: plan.id, lessonPlanVersion: plan.version };
    const responses = await Promise.all([0, 1].map(i => request(app.getHttpServer()).post(url).set(auth()).send({ ...body, requestId: requestId(`ready-race-${i}`) })));
    expect(responses.map(r => r.status).sort()).toEqual([201, 409]);
    const context = responses.find(r => r.status === 201)!.body;
    await request(app.getHttpServer()).delete(`${url}/${context.preparationId}?revision=${context.revision}`).set('Authorization', `Bearer ${otherToken}`).expect(403);
    const devices = app.get<Repository<Device>>(getRepositoryToken(Device));
    await devices.update(deviceId, { status: DeviceStatus.Fault });
    await request(app.getHttpServer()).get(`/classroom-runs/screen-state?deviceId=${deviceId}`).set(auth()).expect(409);
    await devices.update(deviceId, { status: DeviceStatus.Online, lastOnlineAt: new Date() });
    await request(app.getHttpServer()).delete(`${url}/${context.preparationId}?revision=${context.revision}`).set(auth()).expect(200);
  });

  it('two authorized teachers cannot overwrite each other READY contexts', async () => {
    const profile = await request(app.getHttpServer()).get('/auth/profile').set('Authorization', `Bearer ${otherToken}`).expect(200);
    const relation = app.get<Repository<TeacherClass>>(getRepositoryToken(TeacherClass));
    const shared = await relation.save(relation.create({ teacherId: profile.body.teacherId, classId, role: TeacherClassRole.Assistant }));
    const otherAuth = { Authorization: `Bearer ${otherToken}` };
    const firstPlan = await createPlan();
    const otherPlan = await request(app.getHttpServer()).post('/lesson-plans').set(otherAuth).send({ title: '另一位教师的教案', theme: '准备并发', ageGroup: '4-5', objectives: '验证准备归属', estimatedMinutes: 10 }).expect(201);
    const saved = await request(app.getHttpServer()).put(`/lesson-plans/${otherPlan.body.id}/steps`).set(otherAuth).send({ version: 1, steps: [{ title: '互动', stepType: 'teacher_talk', content: '老师的私人提示', durationSeconds: 60 }] }).expect(200);
    const url = `/devices/${deviceId}/screen-preparations`;
    const [first, second] = await Promise.all([
      request(app.getHttpServer()).post(url).set(auth()).send({ classId, classroomId, lessonPlanId: firstPlan.id, lessonPlanVersion: firstPlan.version, requestId: requestId('ready-teacher-one') }),
      request(app.getHttpServer()).post(url).set(otherAuth).send({ classId, classroomId, lessonPlanId: otherPlan.body.id, lessonPlanVersion: saved.body.version, requestId: requestId('ready-teacher-two') }),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const winner = first.status === 201 ? first : second;
    const winnerAuth = first.status === 201 ? auth() : otherAuth;
    const loserAuth = first.status === 201 ? otherAuth : auth();
    await request(app.getHttpServer()).get(url).set(loserAuth).expect(403);
    await request(app.getHttpServer()).delete(`${url}/${winner.body.preparationId}?revision=${winner.body.revision}`).set(loserAuth).expect(403);
    await request(app.getHttpServer()).delete(`${url}/${winner.body.preparationId}?revision=${winner.body.revision}`).set(winnerAuth).expect(200);
    await relation.delete(shared.id);
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
      content: '', // Legacy content has not been explicitly reviewed for student display.
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
    expect(frozen.body.steps[0].content).toBe('');
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

  it('rejects empty plans, foreign classes, wrong bindings, and draft resource binding', async () => {
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
    const draft = await createPlan(false);
    await request(app.getHttpServer())
      .put(`/lesson-plans/${draft.id}/steps`)
      .set(auth())
      .send({
        version: draft.version,
        steps: [
          {
            title: '未审核资源',
            stepType: 'resource',
            content: '未审核资源不能绑定到正式教案',
            durationSeconds: 60,
            resourceId: draftResourceId,
          },
        ],
      })
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
    it('runtime queue edits preserve player and lesson; explicit show tracks its item and survives restore', async () => {
      const plan = await createPlan();
      const original = await request(app.getHttpServer()).get(`/lesson-plans/${plan.id}`).set(auth()).expect(200);
      const started = await request(app.getHttpServer()).post('/classroom-runs/start').set(auth()).send(startBody(plan.id)).expect(201);
      const base = { runId: started.body.id, deviceId, source: 'teacher_panel' };
      const edited = await request(app.getHttpServer()).post('/classroom-commands').set(auth()).send({ ...base,
        requestId: requestId('queue-edit'), expectedVersion: started.body.version, operation: 'update_presentation_queue',
        parameters: { stepIndex: 0, items: [{ id: 'first', kind: 'resource', resourceId: approvedResourceId, enabled: true }, { id: 'avatar', kind: 'avatar', enabled: true }] },
      }).expect(201);
      expect(edited.body.classroomState.interactionState.presentationQueues['0']).toHaveLength(2);
      expect(edited.body.classroomState.playerRecoverySuggestion).toEqual(started.body.playerRecoverySuggestion);
      const shown = await request(app.getHttpServer()).post('/classroom-commands').set(auth()).send({ ...base,
        targetDeviceId: deviceId, requestId: requestId('queue-show'), expectedVersion: edited.body.classroomState.version,
        operation: 'open_resource', parameters: { resourceId: approvedResourceId, presentationItemId: 'first' },
      }).expect(201);
      expect(shown.body.classroomState.playerRecoverySuggestion).toMatchObject({ presentationItemId: 'first', resourceId: approvedResourceId, presentationMode: 'resource' });
      const reordered = await request(app.getHttpServer()).post('/classroom-commands').set(auth()).send({ ...base,
        requestId: requestId('queue-reorder'), expectedVersion: shown.body.classroomState.version, operation: 'update_presentation_queue',
        parameters: { stepIndex: 0, items: [{ id: 'avatar', kind: 'avatar', enabled: true }, { id: 'first', kind: 'resource', resourceId: approvedResourceId, enabled: false }] },
      }).expect(201);
      expect(reordered.body.classroomState.playerRecoverySuggestion).toEqual(shown.body.classroomState.playerRecoverySuggestion);
      const restored = await request(app.getHttpServer()).get(`/classroom-runs/${started.body.id}/restore`).query({ deviceId }).set(auth()).expect(200);
      expect(restored.body.interactionState.presentationQueues['0'][0].id).toBe('avatar');
      expect(restored.body.playerRecoverySuggestion.presentationItemId).toBe('first');
      const unchanged = await request(app.getHttpServer()).get(`/lesson-plans/${plan.id}`).set(auth()).expect(200);
      expect(unchanged.body.steps).toEqual(original.body.steps);
      expect(unchanged.body.version).toBe(original.body.version);
      await request(app.getHttpServer()).post(`/classroom-runs/${started.body.id}/complete`).set(auth())
        .send({ version: reordered.body.classroomState.version, deviceId, requestId: requestId('queue-cleanup') }).expect(201);
    });
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
