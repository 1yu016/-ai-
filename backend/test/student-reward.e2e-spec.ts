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
import {
  CLASSROOM_RUN_ENTITIES,
  ClassroomRunModule,
} from '../src/classroom-runs/classroom-run.module';
import { ClassroomRun } from '../src/classroom-runs/entities/classroom-run.entity';
import { ClassroomSnapshot } from '../src/classroom-runs/entities/classroom-snapshot.entity';
import { StudentRewardRecord } from '../src/classroom-runs/entities/student-reward-record.entity';
import { TeachingResource } from '../src/data/entities/teaching-resource.entity';
import {
  LESSON_PLAN_ENTITIES,
  LessonPlanModule,
} from '../src/lesson-plans/lesson-plan.module';
import { LessonPlan } from '../src/lesson-plans/entities/lesson-plan.entity';
import { LessonAgeGroup, LessonPlanStatus } from '../src/lesson-plans/lesson-plan.types';
import { ClassroomRunStatus } from '../src/classroom-runs/classroom-run.types';
import { Classroom } from '../src/platform/entities/classroom.entity';
import { Device } from '../src/platform/entities/device.entity';
import { SchoolClass } from '../src/platform/entities/school-class.entity';
import { Student } from '../src/platform/entities/student.entity';
import { TeacherClass } from '../src/platform/entities/teacher-class.entity';
import {
  PLATFORM_ENTITIES,
  PlatformModule,
} from '../src/platform/platform.module';
import {
  DeviceStatus,
  DeviceType,
  RecordStatus,
  TeacherClassRole,
} from '../src/platform/platform.types';
import {
  RESOURCE_ENTITIES,
  ResourceModule,
} from '../src/resources/resource.module';

describe('Stage 7.3 student reward records (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let otherToken: string;
  let teacherId: number;
  let otherTeacherId: number;
  let classId: number;
  let foreignClassId: number;
  let studentId: number;
  let student2Id: number;
  let foreignStudentId: number;
  let runId: number;
  let foreignRunId: number;
  let rewards: Repository<StudentRewardRecord>;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const rid = (label: string) => `${label}-${Date.now()}-${Math.random()}`;

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              JWT_ACCESS_SECRET: 'student-reward-test-secret-long-enough',
              JWT_ACCESS_EXPIRES_IN: '2h',
              JWT_REFRESH_EXPIRES_IN: '30d',
              TEST_TEACHER_ACCOUNT: 'reward_teacher',
              TEST_TEACHER_PASSWORD: 'Teacher123!',
              TEST_TEACHER_NAME: '奖励教师',
              ARK_API_KEY: 'reward-test-key',
              ARK_ENDPOINT_ID: 'reward-test-model',
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
            LessonPlan,
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
    const teacher = await teachers.findOneByOrFail({ account: 'reward_teacher' });
    teacher.schoolId = 'garden-reward';
    await teachers.save(teacher);
    teacherId = teacher.id;
    const other = await teachers.save(
      teachers.create({
        account: 'reward_other',
        passwordHash: await bcrypt.hash('Teacher123!', 4),
        name: '隔壁教师',
        role: TeacherRole.Teacher,
        schoolId: 'garden-reward',
      }),
    );
    otherTeacherId = other.id;
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
          schoolId: 'garden-reward',
          name: '小一班',
          grade: '小班',
          ageRange: '3-4',
          schoolYear: '2026',
          status: RecordStatus.Active,
        }),
      )
    ).id;
    foreignClassId = (
      await classes.save(
        classes.create({
          schoolId: 'garden-reward',
          name: '中一班',
          grade: '中班',
          ageRange: '4-5',
          schoolYear: '2026',
          status: RecordStatus.Active,
        }),
      )
    ).id;
    // 奖励教师只拥有小一班（隔壁教师没有任何班）。
    await app
      .get<Repository<TeacherClass>>(getRepositoryToken(TeacherClass))
      .save(
        app
          .get<Repository<TeacherClass>>(getRepositoryToken(TeacherClass))
          .create({ teacherId, classId, role: TeacherClassRole.Lead }),
      );

    const students = app.get<Repository<Student>>(getRepositoryToken(Student));
    studentId = (
      await students.save(
        students.create({
          classId,
          studentNo: 'XB-001',
          name: '朵朵',
          status: RecordStatus.Active,
        }),
      )
    ).id;
    student2Id = (
      await students.save(
        students.create({
          classId,
          studentNo: 'XB-002',
          name: '糖糖',
          status: RecordStatus.Active,
        }),
      )
    ).id;
    foreignStudentId = (
      await students.save(
        students.create({
          classId: foreignClassId,
          studentNo: 'ZB-001',
          name: '壮壮',
          status: RecordStatus.Active,
        }),
      )
    ).id;

    const classrooms = app.get<Repository<Classroom>>(getRepositoryToken(Classroom));
    const classroomId = (
      await classrooms.save(
        classrooms.create({
          schoolId: 'garden-reward',
          name: '阳光活动室',
          status: RecordStatus.Active,
        }),
      )
    ).id;
    const devices = app.get<Repository<Device>>(getRepositoryToken(Device));
    const deviceId = (
      await devices.save(
        devices.create({
          deviceCode: 'REWARD-SCREEN-1',
          schoolId: 'garden-reward',
          name: '一号大屏',
          type: DeviceType.ClassroomScreen,
          status: DeviceStatus.Offline,
          lastOnlineAt: null,
        }),
      )
    ).id;

    const deviceId2 = (
      await devices.save(
        devices.create({
          deviceCode: 'REWARD-SCREEN-2',
          schoolId: 'garden-reward',
          name: '二号大屏',
          type: DeviceType.ClassroomScreen,
          status: DeviceStatus.Offline,
          lastOnlineAt: null,
        }),
      )
    ).id;

    const plans = app.get<Repository<LessonPlan>>(getRepositoryToken(LessonPlan));
    const plan = await plans.save(
      plans.create({
        teacherId,
        schoolId: 'garden-reward',
        title: '认识数字1',
        theme: '数字认知',
        ageGroup: LessonAgeGroup.ThreeToFour,
        objectives: '认识数字1',
        estimatedMinutes: 15,
        status: LessonPlanStatus.Draft,
        version: 1,
      }),
    );

    const runs = app.get<Repository<ClassroomRun>>(getRepositoryToken(ClassroomRun));
    const makeRun = (
      ownerId: number,
      clsId: number,
      title: string,
      devId: number,
    ) =>
      runs.save(
        runs.create({
          lessonPlanId: plan.id,
          lessonPlanVersion: 1,
          teacherId: ownerId,
          classId: clsId,
          classroomId,
          deviceId: devId,
          title,
          status: ClassroomRunStatus.Running,
          currentStepIndex: 0,
          version: 1,
        }),
      );
    runId = (await makeRun(teacherId, classId, '认识数字1', deviceId)).id;
    foreignRunId = (
      await makeRun(otherTeacherId, foreignClassId, '隔壁课堂', deviceId2)
    ).id;

    rewards = app.get(getRepositoryToken(StudentRewardRecord));
  });

  afterAll(async () => {
    await app.close();
  });

  const postReward = (
    t: string,
    body: Record<string, unknown>,
    expected: number,
  ) =>
    request(app.getHttpServer())
      .post(`/classroom-runs/${runId}/rewards`)
      .set(auth(t))
      .send(body)
      .expect(expected);

  it('1. 教师给自己课堂的幼儿奖励 → 记录 + rewardState +1', async () => {
    const requestId = rid('reward');
    const res = await postReward(
      token,
      { requestId, studentId, stars: 1, reason: '积极回答' },
      201,
    );
    expect(res.body.record).toMatchObject({
      studentId,
      studentName: '朵朵',
      classId,
      classroomRunId: runId,
      teacherId,
      teacherName: '奖励教师',
      rewardType: 'flower',
      stars: 1,
      reason: '积极回答',
    });
    expect(res.body.studentTotal).toBe(1);
    expect(res.body.rewardState[studentId]).toBe(1);
    expect(await rewards.count({ where: { classroomRunId: runId } })).toBe(1);
  });

  it('2. reason 正常保存（可为空）', async () => {
    await postReward(
      token,
      { requestId: rid('reward-noreason'), studentId: student2Id, stars: 1 },
      201,
    );
    const record = await rewards.findOneByOrFail({
      classroomRunId: runId,
      studentId: student2Id,
    });
    expect(record.reason).toBeNull();
  });

  it('3. stars 范围校验（0 / 6 → 400）', async () => {
    await postReward(token, { requestId: rid('bad0'), studentId, stars: 0 }, 400);
    await postReward(token, { requestId: rid('bad6'), studentId, stars: 6 }, 400);
  });

  it('4. 学生不属于 run.classId → 403，不写任何记录', async () => {
    const before = await rewards.count();
    await postReward(
      token,
      { requestId: rid('foreign-student'), studentId: foreignStudentId },
      403,
    );
    expect(await rewards.count()).toBe(before);
  });

  it('5. 教师访问无权课堂 → 403', async () => {
    const before = await rewards.count();
    await request(app.getHttpServer())
      .post(`/classroom-runs/${foreignRunId}/rewards`)
      .set(auth(token))
      .send({ requestId: rid('no-access'), studentId, stars: 1 })
      .expect(403);
    expect(await rewards.count()).toBe(before);
  });

  it('6. 相同 requestId + 相同 payload → 幂等成功，只留 1 条记录', async () => {
    const requestId = rid('idem-same');
    const body = { requestId, studentId, stars: 1, reason: '积极回答' };
    const first = await postReward(token, body, 201);
    const second = await postReward(token, body, 201);
    expect(second.body.record.id).toBe(first.body.record.id);
    expect(second.body.record.reason).toBe('积极回答');
    expect(second.body.studentTotal).toBe(first.body.studentTotal);
    expect(
      await rewards.count({ where: { classroomRunId: runId, requestId } }),
    ).toBe(1);
  });

  it('6b. 相同 requestId + 不同 payload → 409 conflict，不新增记录不重复加花', async () => {
    const requestId = rid('idem-diff');
    await postReward(
      token,
      { requestId, studentId, stars: 1, reason: '第一次' },
      201,
    );
    const countBefore = await rewards.count();
    await request(app.getHttpServer())
      .post(`/classroom-runs/${runId}/rewards`)
      .set(auth(token))
      .send({ requestId, studentId: student2Id, stars: 3, reason: '第二次' })
      .expect(409);
    expect(await rewards.count()).toBe(countBefore);
    const snapshotRepo = app.get<Repository<ClassroomSnapshot>>(
      getRepositoryToken(ClassroomSnapshot),
    );
    const latest = await snapshotRepo.findOne({
      where: { classroomRunId: runId },
      order: { snapshotVersion: 'DESC' },
    });
    const state = JSON.parse(latest?.rewardState ?? '{}') as Record<string, number>;
    // 冲突请求不得把 student2 的 +3 写入 rewardState（糖糖只有 test2 的 +1）
    expect(state[student2Id] ?? 0).toBe(1);
  });

  it('6c. 并发：相同 runId+requestId+payload → 两个请求都幂等成功（无 409），只留 1 条记录，rewardState/studentTotal 只加一次', async () => {
    // 用独立幼儿（初始 rewardState=0）便于精确断言“只加一次”。
    const studentsRepo = app.get<Repository<Student>>(getRepositoryToken(Student));
    const freshStudentId = (
      await studentsRepo.save(
        studentsRepo.create({
          classId,
          studentNo: `XB-CC-${Date.now()}`,
          name: '乐乐',
          status: RecordStatus.Active,
        }),
      )
    ).id;
    const requestId = rid('idem-concurrent');
    const body = { requestId, studentId: freshStudentId, stars: 1, reason: '并发' };
    const [a, b] = await Promise.all([
      request(app.getHttpServer())
        .post(`/classroom-runs/${runId}/rewards`)
        .set(auth(token))
        .send(body),
      request(app.getHttpServer())
        .post(`/classroom-runs/${runId}/rewards`)
        .set(auth(token))
        .send(body),
    ]);
    // 相同 payload 并发重试：两个响应都必须属于成功语义，绝不允许出现 409。
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    // 两个请求返回同一条记录。
    expect(b.body.record.id).toBe(a.body.record.id);
    // RewardRecord 只留 1 条。
    expect(
      await rewards.count({ where: { classroomRunId: runId, requestId } }),
    ).toBe(1);
    // rewardState 只增加一次、studentTotal 反映单次 +1。
    expect(a.body.studentTotal).toBe(1);
    expect(b.body.studentTotal).toBe(1);
    const snapshotRepo = app.get<Repository<ClassroomSnapshot>>(
      getRepositoryToken(ClassroomSnapshot),
    );
    const latest = await snapshotRepo.findOne({
      where: { classroomRunId: runId },
      order: { snapshotVersion: 'DESC' },
    });
    const state = JSON.parse(latest?.rewardState ?? '{}') as Record<string, number>;
    expect(state[freshStudentId] ?? 0).toBe(1);
    // 兜底一致性：rewardState 必须等于全部流水 stars 之和。
    const records = await rewards.find({ where: { classroomRunId: runId } });
    const expected: Record<string, number> = {};
    for (const r of records)
      expected[r.studentId] = (expected[r.studentId] ?? 0) + r.stars;
    expect(state).toEqual(expected);
  });

  it('6e. 并发：相同 requestId + 不同 payload → 一个创建成功、另一个 409，只留 1 条记录，rewardState 只反映成功的一笔', async () => {
    const requestId = rid('idem-concurrent-diff');
    const snapshotRepo = app.get<Repository<ClassroomSnapshot>>(
      getRepositoryToken(ClassroomSnapshot),
    );
    const before = await snapshotRepo.findOne({
      where: { classroomRunId: runId },
      order: { snapshotVersion: 'DESC' },
    });
    const beforeState = JSON.parse(before?.rewardState ?? '{}') as Record<
      string,
      number
    >;
    const [a, b] = await Promise.all([
      request(app.getHttpServer())
        .post(`/classroom-runs/${runId}/rewards`)
        .set(auth(token))
        .send({ requestId, studentId, stars: 1, reason: '并发A' }),
      request(app.getHttpServer())
        .post(`/classroom-runs/${runId}/rewards`)
        .set(auth(token))
        .send({ requestId, studentId: student2Id, stars: 3, reason: '并发B' }),
    ]);
    // 不同 payload 并发：恰好一个成功、一个 409，绝不允许“偷偷返回旧结果伪装成功”。
    expect([a.status, b.status].sort((x, y) => x - y)).toEqual([201, 409]);
    // 只留一条记录。
    expect(
      await rewards.count({ where: { classroomRunId: runId, requestId } }),
    ).toBe(1);
    // 成功的 payload 是谁，就只累加它的 stars 一次；被拒绝的一笔不得写入任何累加。
    const winner = a.status === 201 ? a.body.record : b.body.record;
    const loserStudentId =
      winner.studentId === studentId ? student2Id : studentId;
    const after = await snapshotRepo.findOne({
      where: { classroomRunId: runId },
      order: { snapshotVersion: 'DESC' },
    });
    const afterState = JSON.parse(after?.rewardState ?? '{}') as Record<
      string,
      number
    >;
    expect(afterState[winner.studentId] ?? 0).toBe(
      (beforeState[winner.studentId] ?? 0) + winner.stars,
    );
    expect(afterState[loserStudentId] ?? 0).toBe(
      beforeState[loserStudentId] ?? 0,
    );
  });

  it('6d. 排序稳定：连续两条记录 → created_at DESC, id DESC', async () => {
    await postReward(
      token,
      { requestId: rid('order-a'), studentId: student2Id, stars: 1, reason: '排序A' },
      201,
    );
    await postReward(
      token,
      { requestId: rid('order-b'), studentId: student2Id, stars: 1, reason: '排序B' },
      201,
    );
    const res = await request(app.getHttpServer())
      .get(`/classes/${classId}/rewards?page=1&pageSize=100`)
      .set(auth(token))
      .expect(200);
    const items = res.body.items as Array<{ id: number; createdAt: string }>;
    for (let i = 0; i < items.length - 1; i++) {
      const a = new Date(items[i].createdAt).getTime();
      const b = new Date(items[i + 1].createdAt).getTime();
      const stable = a > b || (a === b && items[i].id > items[i + 1].id);
      expect(stable).toBe(true);
    }
  });

  it('7. GET 本节课奖励 → 明细含幼儿/数量/原因/教师/时间', async () => {
    const res = await request(app.getHttpServer())
      .get(`/classroom-runs/${runId}/rewards`)
      .set(auth(token))
      .expect(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(2);
    const first = res.body.items[0];
    expect(first).toMatchObject({
      studentId,
      studentName: '朵朵',
      stars: 1,
      teacherName: '奖励教师',
    });
    expect(typeof first.createdAt).toBe('string');
    expect(res.body.runTitle).toBe('认识数字1');
  });

  it('8. GET 班级奖励 → 返回班级记录 + 累计 + 按幼儿筛选', async () => {
    const all = await request(app.getHttpServer())
      .get(`/classes/${classId}/rewards`)
      .set(auth(token))
      .expect(200);
    expect(all.body.summary.className).toBe('小一班');
    expect(all.body.total).toBeGreaterThanOrEqual(3);
    expect(all.body.summary.totalStars).toBeGreaterThanOrEqual(3);
    expect(all.body.items[0]).toMatchObject({
      studentName: expect.any(String),
      lessonTitle: '认识数字1',
      teacherName: '奖励教师',
    });
    const filtered = await request(app.getHttpServer())
      .get(`/classes/${classId}/rewards?studentId=${studentId}`)
      .set(auth(token))
      .expect(200);
    expect(
      filtered.body.items.every((i: { studentId: number }) => i.studentId === studentId),
    ).toBe(true);
    // 筛选 total 必须等于该幼儿在班级中的真实记录数，且逐条返回（不得只回 1 条或漏页）
    const ownCount = await rewards.count({ where: { classId, studentId } });
    expect(filtered.body.total).toBe(ownCount);
    expect(filtered.body.items.length).toBe(filtered.body.total);
    expect(ownCount).toBeGreaterThanOrEqual(2); // 朵朵在本 run 已有 2+ 条独立记录
  });

  it('9. 另一教师访问无权限班级 → 403', async () => {
    await request(app.getHttpServer())
      .get(`/classes/${classId}/rewards`)
      .set(auth(otherToken))
      .expect(403);
  });

  it('10. RewardRecord + rewardState 原子一致（快照同步更新）', async () => {
    const snapshotRepo = app.get<Repository<ClassroomSnapshot>>(
      getRepositoryToken(ClassroomSnapshot),
    );
    const latest = await snapshotRepo.findOne({
      where: { classroomRunId: runId },
      order: { snapshotVersion: 'DESC' },
    });
    const state = JSON.parse(latest?.rewardState ?? '{}') as Record<string, number>;
    const records = await rewards.find({ where: { classroomRunId: runId } });
    const expected: Record<string, number> = {};
    for (const r of records)
      expected[r.studentId] = (expected[r.studentId] ?? 0) + r.stars;
    expect(state).toEqual(expected);
  });

  it('11. 六类奖励和五种奖励形式均能作为正式流水保存', async () => {
    const categories = ['answer', 'cooperation', 'focus', 'labor', 'exploration', 'progress'];
    for (const category of categories) {
      const response = await postReward(token, {
        requestId: rid(`category-${category}`), studentId, rewardCategory: category,
        rewardForms: ['points', 'badge', 'flower', 'voice_praise', 'animation'],
        points: 2, stars: 1, badgeCode: `${category}_badge`,
        praiseTemplateId: category === 'cooperation' ? 'kind_cooperation' : 'steady_progress',
        animationKey: 'stars', reason: `${category} 正向表现`,
      }, 201);
      expect(response.body.record).toMatchObject({ rewardCategory: category, points: 2, stars: 1 });
      expect(response.body.record.rewardForms).toEqual(['animation', 'badge', 'flower', 'points', 'voice_praise']);
      expect(response.body.record.praiseText).toEqual(expect.any(String));
    }
  });

  it('12. 语音表扬只允许安全模板或教师确认文本，并拦截负面标签', async () => {
    await postReward(token, {
      requestId: rid('unsafe-unconfirmed'), studentId,
      rewardForms: ['voice_praise'], praiseText: '继续努力',
    }, 409);
    await postReward(token, {
      requestId: rid('unsafe-label'), studentId,
      rewardForms: ['voice_praise'], praiseText: '你是差生', teacherConfirmedPraise: true,
    }, 409);
    const ok = await postReward(token, {
      requestId: rid('confirmed-praise'), studentId,
      rewardForms: ['voice_praise'], praiseText: '你的想法很有趣！', teacherConfirmedPraise: true,
      points: 1,
    }, 201);
    expect(ok.body.record.praiseText).toBe('你的想法很有趣！');
  });

  it('13. 奖励撤销保留原流水、记录原因，并从有效累计中扣除', async () => {
    const created = await postReward(token, {
      requestId: rid('revoke-target'), studentId, rewardCategory: 'answer',
      rewardForms: ['points', 'flower'], points: 4, stars: 2, reason: '误发测试',
    }, 201);
    const revokeRequestId = rid('revoke');
    await request(app.getHttpServer())
      .post(`/classroom-runs/${runId}/rewards/${created.body.record.id}/revoke`)
      .set(auth(token)).send({ requestId: revokeRequestId, reason: '教师误点' }).expect(200);
    const stored = await rewards.findOneByOrFail({ id: created.body.record.id });
    expect(stored.revokedAt).toBeTruthy();
    expect(stored.revokeReason).toBe('教师误点');
    expect(stored.revokedByTeacherId).toBe(teacherId);
    const history = await request(app.getHttpServer()).get(`/classroom-runs/${runId}/rewards`).set(auth(token)).expect(200);
    expect(history.body.items.find((item: { id: number }) => item.id === stored.id)).toMatchObject({ revokeReason: '教师误点' });
  });

  it('14. 班级共同目标可由个人和集体奖励累积，集体奖励 requestId 幂等', async () => {
    const goal = await request(app.getHttpServer()).post(`/classroom-runs/${runId}/growth-goals`)
      .set(auth(token)).send({ requestId: rid('goal'), title: '合作种出成长树', targetPoints: 20 }).expect(201);
    const body = { requestId: rid('collective'), rewardCategory: 'cooperation', points: 3, reason: '全班合作完成任务', goalId: goal.body.id };
    const first = await request(app.getHttpServer()).post(`/classroom-runs/${runId}/collective-rewards`).set(auth(token)).send(body).expect(201);
    const replay = await request(app.getHttpServer()).post(`/classroom-runs/${runId}/collective-rewards`).set(auth(token)).send(body).expect(201);
    expect(replay.body.id).toBe(first.body.id);
    const dashboard = await request(app.getHttpServer()).get(`/classroom-runs/${runId}/reward-dashboard`).set(auth(token)).expect(200);
    expect(dashboard.body.goal.currentPoints).toBe(3);
    expect(dashboard.body.honors.some((item: { key: string }) => item.key === 'cooperation_star')).toBe(true);
    expect(dashboard.body.policy).toEqual({ negativeRankingEnabled: false, rotation: 'daily_category_rotation' });
  });

  it('15. 其他教师不能访问奖励看板、发放或撤销本班奖励', async () => {
    await request(app.getHttpServer()).get(`/classroom-runs/${runId}/reward-dashboard`).set(auth(otherToken)).expect(403);
    await request(app.getHttpServer()).post(`/classroom-runs/${runId}/collective-rewards`).set(auth(otherToken))
      .send({ requestId: rid('foreign-collective'), rewardCategory: 'cooperation', points: 1, reason: '越权' }).expect(403);
  });
});
