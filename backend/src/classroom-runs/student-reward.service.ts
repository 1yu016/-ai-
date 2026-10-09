import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { AuthUserType } from '../auth/entities/refresh-token-session.entity';
import { Teacher } from '../auth/entities/teacher.entity';
import { Student } from '../platform/entities/student.entity';
import { ClassroomSnapshotService } from './classroom-snapshot.service';
import {
  ClassroomSnapshotReason,
  TERMINAL_CLASSROOM_RUN_STATUSES,
} from './classroom-run.types';
import { ClassroomRun } from './entities/classroom-run.entity';
import { StudentRewardRecord } from './entities/student-reward-record.entity';
import { ClassGrowthGoal } from './entities/class-growth-goal.entity';
import { ClassCollectiveRewardRecord } from './entities/class-collective-reward-record.entity';
import {
  CreateClassroomRewardDto,
  CreateCollectiveRewardDto,
  CreateGrowthGoalDto,
} from './dto/classroom-run.dto';
import {
  GrowthGoalStatus,
  RewardCategory,
  RewardForm,
  SAFE_PRAISE_TEMPLATES,
  SAFE_REWARD_ANIMATIONS,
} from './reward-system.types';

type RewardView = {
  id: number;
  studentId: number;
  studentName: string | null;
  classId: number;
  classroomRunId: number;
  teacherId: number;
  teacherName: string | null;
  rewardType: string;
  rewardCategory: RewardCategory;
  rewardForms: RewardForm[];
  points: number;
  badgeCode: string | null;
  praiseText: string | null;
  animationKey: string | null;
  stars: number;
  reason: string | null;
  requestId: string;
  revokedAt: Date | null;
  revokeReason: string | null;
  createdAt: Date;
};

@Injectable()
export class StudentRewardService {
  constructor(
    @InjectRepository(StudentRewardRecord)
    private readonly rewards: Repository<StudentRewardRecord>,
    @InjectRepository(ClassroomRun)
    private readonly runs: Repository<ClassroomRun>,
    @InjectRepository(Student)
    private readonly students: Repository<Student>,
    @InjectRepository(Teacher)
    private readonly teachers: Repository<Teacher>,
    @InjectRepository(ClassGrowthGoal)
    private readonly growthGoals: Repository<ClassGrowthGoal>,
    @InjectRepository(ClassCollectiveRewardRecord)
    private readonly collectiveRewards: Repository<ClassCollectiveRewardRecord>,
    private readonly dataSource: DataSource,
    private readonly snapshotService: ClassroomSnapshotService,
  ) {}

  /**
   * 给 run 内幼儿发奖励。
   * 原子性：RewardRecord 插入 + rewardState 快照更新在同一事务内完成；
   * 幂等 contract：(classroom_run_id, request_id) 唯一。
   *   - 相同 requestId + 相同 payload → 幂等成功，返回第一次的记录与当前 studentTotal，不重复加花；
   *   - 相同 requestId + 不同 payload（studentId/stars/reason 任一不同）→ 409 conflict，不允许伪装成功。
   * 并发兜底：两个相同请求同时通过预检、事务内 INSERT 撞 UNIQUE 时，catch 内重新查询已有记录，
   *   同 payload 同样按幂等成功返回（不再 capture snapshot / 不再 +stars），不同 payload 才抛 409。
   */
  async createReward(
    actor: JwtTeacherPayload,
    runId: number,
    dto: CreateClassroomRewardDto,
  ) {
    this.requireTeacher(actor);
    const run = await this.ownedRun(actor, runId);
    // 幂等预检：双击 / 网络重试（串行情况）。同 payload 直接返回已有结果；不同 payload 视为 conflict。
    const preExisting = await this.rewards.findOne({
      where: { classroomRunId: runId, requestId: dto.requestId },
    });
    if (preExisting) {
      this.assertIdempotentPayload(dto, preExisting);
      return this.idempotentResult(runId, preExisting);
    }
    this.assertActive(run);

    const normalized = this.normalizeReward(dto);
    const stars = normalized.stars;
    const reason = dto.reason?.trim()
      ? this.assertSafeText(dto.reason.trim(), '奖励原因')
      : null;

    try {
      return await this.dataSource.transaction(async (manager) => {
        const runRepo = manager.getRepository(ClassroomRun);
        const current = await runRepo.findOne({ where: { id: runId } });
        if (!current) throw new NotFoundException('课堂运行不存在');
        if (current.teacherId !== actor.sub)
          throw new ForbiddenException('无权操作其他教师的课堂');
        this.assertActive(current);

        const rewardRepo = manager.getRepository(StudentRewardRecord);
        const dup = await rewardRepo.findOne({
          where: { classroomRunId: runId, requestId: dto.requestId },
        });
        if (dup) {
          this.assertIdempotentPayload(dto, dup);
          return this.buildResult(manager, current, dup);
        }

        const student = await manager
          .getRepository(Student)
          .findOne({ where: { id: dto.studentId } });
        if (!student) throw new NotFoundException('学生不存在');
        if (student.classId !== current.classId)
          throw new ForbiddenException('不能给本课堂之外的幼儿发奖励');

        const record = await rewardRepo.save(
          rewardRepo.create({
            studentId: student.id,
            classId: current.classId,
            classroomRunId: current.id,
            teacherId: current.teacherId,
            rewardType: 'flower',
            rewardCategory: normalized.rewardCategory,
            rewardForms: JSON.stringify(normalized.rewardForms),
            points: normalized.points,
            badgeCode: normalized.badgeCode,
            praiseTemplateId: normalized.praiseTemplateId,
            praiseText: normalized.praiseText,
            teacherConfirmedPraise: normalized.teacherConfirmedPraise,
            animationKey: normalized.animationKey,
            stars,
            reason,
            requestId: dto.requestId,
          }),
        );

        // 基于当前最新快照的 rewardState 增量更新，保证 rewardState 与流水同事务提交。
        const previous = await this.snapshotService.loadLatestValid(
          runId,
          manager,
        );
        const rewardState = { ...previous?.rewardState };
        rewardState[student.id] =
          Number(rewardState[student.id] ?? 0) + stars;
        const interactionState = {
          ...previous?.interactionState,
          rewardPresentation: {
            recordId: record.id,
            studentId: student.id,
            displayName: student.nickname || student.name,
            rewardCategory: record.rewardCategory,
            rewardForms: normalized.rewardForms,
            points: record.points,
            stars: record.stars,
            badgeCode: record.badgeCode,
            praiseText: record.praiseText,
            animationKey: record.animationKey,
            createdAt: record.createdAt.toISOString(),
          },
        };
        const captured = await this.snapshotService.capture(
          runId,
          ClassroomSnapshotReason.Reward,
          false,
          { rewardState, interactionState },
          manager,
        );
        const finalState = captured?.rewardState ?? rewardState;
        await this.incrementActiveGoal(manager, current.classId, normalized.points);
        return {
          record: this.serialize(record, student, current, await this.findTeacher(manager, current.teacherId)),
          rewardState: finalState,
          studentTotal: Number(finalState[student.id] ?? 0),
        };
      });
    } catch (error) {
      // 真正并发下唯一约束兜底：取已提交记录，同 payload 幂等返回，不同 payload 视为 conflict。
      if (this.isUniqueViolation(error)) {
        const existing = await this.rewards.findOne({
          where: { classroomRunId: runId, requestId: dto.requestId },
        });
        if (existing) {
          this.assertIdempotentPayload(dto, existing);
          return this.idempotentResult(runId, existing);
        }
      }
      throw error;
    }
  }

  /** 本节课奖励明细（按时间正序）。 */
  async listRunRewards(actor: JwtTeacherPayload, runId: number) {
    this.requireTeacher(actor);
    const run = await this.ownedRun(actor, runId);
    const records = await this.rewards.find({
      where: { classroomRunId: runId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    const [students, teachers] = await Promise.all([
      this.students.find({
        where: { id: In([...new Set(records.map((r) => r.studentId))]) },
      }),
      this.teachers.find({
        where: { id: In([...new Set(records.map((r) => r.teacherId))]) },
      }),
    ]);
    const studentMap = new Map(students.map((s) => [s.id, s]));
    const teacherMap = new Map(teachers.map((t) => [t.id, t]));
    return {
      items: records.map((r) =>
        this.serialize(r, studentMap.get(r.studentId), run, teacherMap.get(r.teacherId)),
      ),
      total: records.length,
      runTitle: run.title,
    };
  }

  /** 撤销一条奖励流水。原记录保留用于审计，快照累计值按原 stars 回退。 */
  async revokeReward(
    actor: JwtTeacherPayload,
    runId: number,
    rewardRecordId: number,
    requestId: string,
    reason?: string,
  ) {
    this.requireTeacher(actor);
    const run = await this.ownedRun(actor, runId);
    this.assertActive(run);
    const normalizedReason = reason?.trim() || null;

    return this.dataSource.transaction(async (manager) => {
      const rewardRepo = manager.getRepository(StudentRewardRecord);
      const repeated = await rewardRepo.findOne({
        where: { revokeRequestId: requestId },
      });
      if (repeated) {
        if (
          repeated.id !== rewardRecordId ||
          repeated.revokeReason !== normalizedReason
        )
          throw new ConflictException('同一 requestId 已用于不同的撤销请求');
        return this.buildResult(manager, run, repeated);
      }

      const record = await rewardRepo.findOne({
        where: { id: rewardRecordId, classroomRunId: runId },
      });
      if (!record) throw new NotFoundException('奖励记录不存在');
      if (record.revokedAt)
        throw new ConflictException('该奖励已经撤销，不能重复撤销');

      record.revokedAt = new Date();
      record.revokedByTeacherId = actor.sub;
      record.revokeRequestId = requestId;
      record.revokeReason = normalizedReason;
      const saved = await rewardRepo.save(record);

      await this.recalculateCurrentGoal(manager, run.classId);

      const previous = await this.snapshotService.loadLatestValid(
        runId,
        manager,
      );
      const rewardState = { ...previous?.rewardState };
      rewardState[record.studentId] = Math.max(
        0,
        Number(rewardState[record.studentId] ?? 0) - record.stars,
      );
      const captured = await this.snapshotService.capture(
        runId,
        ClassroomSnapshotReason.Reward,
        false,
        { rewardState },
        manager,
      );
      const result = await this.buildResult(manager, run, saved);
      return {
        ...result,
        rewardState: captured?.rewardState ?? rewardState,
        studentTotal: Number(
          (captured?.rewardState ?? rewardState)[record.studentId] ?? 0,
        ),
      };
    });
  }

  /** 幂等 contract：同 requestId 重放时校验 payload 是否与首次一致。 */
  private assertIdempotentPayload(
    dto: CreateClassroomRewardDto,
    record: StudentRewardRecord,
  ) {
    const normalized = this.normalizeReward(dto);
    const stars = normalized.stars;
    const reason = dto.reason?.trim()
      ? this.assertSafeText(dto.reason.trim(), '奖励原因')
      : null;
    if (
      record.studentId !== dto.studentId ||
      record.stars !== stars ||
      record.reason !== reason ||
      record.rewardCategory !== normalized.rewardCategory ||
      record.points !== normalized.points ||
      record.rewardForms !== JSON.stringify(normalized.rewardForms) ||
      record.badgeCode !== normalized.badgeCode ||
      record.praiseTemplateId !== normalized.praiseTemplateId ||
      record.praiseText !== normalized.praiseText ||
      record.teacherConfirmedPraise !== normalized.teacherConfirmedPraise ||
      record.animationKey !== normalized.animationKey
    ) {
      throw new ConflictException('同一 requestId 已用于不同的奖励请求');
    }
  }

  private async idempotentResult(runId: number, record: StudentRewardRecord) {
    const run = await this.runs.findOne({ where: { id: runId } });
    const latest = await this.snapshotService.loadLatestValid(runId);
    const student = await this.students.findOne({
      where: { id: record.studentId },
    });
    const teacher = await this.teachers.findOne({
      where: { id: record.teacherId },
    });
    return {
      record: this.serialize(record, student, run ?? null, teacher ?? null),
      rewardState: latest?.rewardState ?? {},
      studentTotal: Number(latest?.rewardState?.[record.studentId] ?? 0),
    };
  }

  private async buildResult(
    manager: EntityManager,
    run: ClassroomRun,
    record: StudentRewardRecord,
  ) {
    const latest = await this.snapshotService.loadLatestValid(run.id, manager);
    const student = await manager
      .getRepository(Student)
      .findOne({ where: { id: record.studentId } });
    const teacher = await this.findTeacher(manager, record.teacherId);
    return {
      record: this.serialize(record, student ?? null, run, teacher),
      rewardState: latest?.rewardState ?? {},
      studentTotal: Number(latest?.rewardState?.[record.studentId] ?? 0),
    };
  }

  private async findTeacher(manager: EntityManager, teacherId: number) {
    return manager.getRepository(Teacher).findOne({ where: { id: teacherId } });
  }

  private serialize(
    record: StudentRewardRecord,
    student: Student | null | undefined,
    run: ClassroomRun | null,
    teacher: Teacher | null | undefined,
  ): RewardView {
    return {
      id: record.id,
      studentId: record.studentId,
      studentName: student?.name ?? null,
      classId: record.classId,
      classroomRunId: record.classroomRunId,
      teacherId: record.teacherId,
      teacherName: teacher?.name ?? null,
      rewardType: record.rewardType,
      rewardCategory: record.rewardCategory,
      rewardForms: this.parseForms(record.rewardForms),
      points: record.points,
      badgeCode: record.badgeCode,
      praiseText: record.praiseText,
      animationKey: record.animationKey,
      stars: record.stars,
      reason: record.reason,
      requestId: record.requestId,
      revokedAt: record.revokedAt,
      revokeReason: record.revokeReason,
      createdAt: record.createdAt,
    };
  }

  private async ownedRun(actor: JwtTeacherPayload, id: number) {
    const run = await this.runs.findOne({ where: { id } });
    if (!run) throw new NotFoundException('课堂运行不存在');
    if (run.teacherId !== actor.sub)
      throw new ForbiddenException('无权操作其他教师的课堂');
    return run;
  }

  private assertActive(run: ClassroomRun) {
    if (
      TERMINAL_CLASSROOM_RUN_STATUSES.includes(
        run.status as (typeof TERMINAL_CLASSROOM_RUN_STATUSES)[number],
      )
    )
      throw new ConflictException('已结束课堂不能继续发奖励');
  }

  private requireTeacher(actor: JwtTeacherPayload) {
    if (actor.userType !== AuthUserType.Teacher)
      throw new ForbiddenException('课堂运行只能由教师操作');
  }

  async createGrowthGoal(
    actor: JwtTeacherPayload,
    runId: number,
    dto: CreateGrowthGoalDto,
  ) {
    this.requireTeacher(actor);
    const run = await this.ownedRun(actor, runId);
    this.assertActive(run);
    const title = this.assertSafeText(dto.title.trim(), '共同目标');
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(ClassGrowthGoal);
      const active = await repository.findOne({
        where: { classId: run.classId, status: GrowthGoalStatus.Active },
      });
      if (active) {
        active.status = GrowthGoalStatus.Archived;
        await repository.save(active);
      }
      return repository.save(repository.create({
        classId: run.classId,
        title,
        targetPoints: dto.targetPoints,
        currentPoints: 0,
        status: GrowthGoalStatus.Active,
        createdByTeacherId: actor.sub,
        completedAt: null,
      }));
    });
  }

  async createCollectiveReward(
    actor: JwtTeacherPayload,
    runId: number,
    dto: CreateCollectiveRewardDto,
  ) {
    this.requireTeacher(actor);
    const run = await this.ownedRun(actor, runId);
    this.assertActive(run);
    const reason = this.assertSafeText(dto.reason.trim(), '集体奖励原因');
    const existing = await this.collectiveRewards.findOne({
      where: { classroomRunId: runId, requestId: dto.requestId },
    });
    if (existing) {
      if (
        existing.rewardCategory !== dto.rewardCategory ||
        existing.points !== dto.points ||
        existing.reason !== reason ||
        existing.goalId !== (dto.goalId ?? null)
      ) throw new ConflictException('同一 requestId 已用于不同的集体奖励请求');
      return existing;
    }
    try {
      return await this.dataSource.transaction(async (manager) => {
        if (dto.goalId) {
          const goal = await manager.getRepository(ClassGrowthGoal).findOne({ where: { id: dto.goalId } });
          if (!goal || goal.classId !== run.classId) throw new ForbiddenException('共同目标不属于本课堂班级');
        }
        const saved = await manager.getRepository(ClassCollectiveRewardRecord).save({
          classroomRunId: run.id, classId: run.classId, teacherId: actor.sub,
          goalId: dto.goalId ?? null, rewardCategory: dto.rewardCategory,
          points: dto.points, reason, requestId: dto.requestId,
          revokedAt: null, revokedByTeacherId: null, revokeRequestId: null, revokeReason: null,
        });
        await this.incrementActiveGoal(manager, run.classId, dto.points, dto.goalId);
        return saved;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const repeated = await this.collectiveRewards.findOne({ where: { classroomRunId: runId, requestId: dto.requestId } });
        if (repeated && repeated.rewardCategory === dto.rewardCategory && repeated.points === dto.points && repeated.reason === reason && repeated.goalId === (dto.goalId ?? null)) return repeated;
        throw new ConflictException('同一 requestId 已用于不同的集体奖励请求');
      }
      throw error;
    }
  }

  async revokeCollectiveReward(actor: JwtTeacherPayload, runId: number, recordId: number, requestId: string, reason: string) {
    this.requireTeacher(actor);
    const run = await this.ownedRun(actor, runId);
    this.assertActive(run);
    const normalizedReason = this.assertSafeText(reason.trim(), '撤销原因');
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(ClassCollectiveRewardRecord);
      const repeated = await repository.findOne({ where: { revokeRequestId: requestId } });
      if (repeated) {
        if (repeated.id !== recordId || repeated.revokeReason !== normalizedReason) throw new ConflictException('同一 requestId 已用于不同的撤销请求');
        return repeated;
      }
      const record = await repository.findOne({ where: { id: recordId, classroomRunId: runId } });
      if (!record) throw new NotFoundException('集体奖励记录不存在');
      if (record.revokedAt) throw new ConflictException('该集体奖励已经撤销');
      record.revokedAt = new Date(); record.revokedByTeacherId = actor.sub;
      record.revokeRequestId = requestId; record.revokeReason = normalizedReason;
      const saved = await repository.save(record);
      await this.recalculateCurrentGoal(manager, run.classId);
      return saved;
    });
  }

  async rewardDashboard(actor: JwtTeacherPayload, runId: number) {
    this.requireTeacher(actor);
    const run = await this.ownedRun(actor, runId);
    const [goal, records, collectiveRecords, students] = await Promise.all([
      this.growthGoals.findOne({
        where: [
          { classId: run.classId, status: GrowthGoalStatus.Active },
          { classId: run.classId, status: GrowthGoalStatus.Completed },
        ],
        order: { id: 'DESC' },
      }),
      this.rewards.find({ where: { classId: run.classId }, order: { createdAt: 'DESC', id: 'DESC' } }),
      this.collectiveRewards.find({ where: { classId: run.classId }, order: { createdAt: 'DESC', id: 'DESC' } }),
      this.students.find({ where: { classId: run.classId } }),
    ]);
    const activeRecords = records.filter((record) => !record.revokedAt);
    const activeCollective = collectiveRecords.filter((record) => !record.revokedAt);
    const studentMap = new Map(students.map((student) => [student.id, student]));
    const categoryTotals = Object.values(RewardCategory).reduce<Record<string, number>>((acc, category) => {
      acc[category] = activeRecords.filter((record) => record.rewardCategory === category).reduce((sum, record) => sum + record.points, 0);
      return acc;
    }, {});
    const byCategory = (category: RewardCategory) => this.pickRotatingHonor(activeRecords, studentMap, category);
    const allCandidates = activeRecords.filter((record) => record.points > 0);
    return {
      goal,
      totals: {
        points: activeRecords.reduce((sum, record) => sum + record.points, 0) + activeCollective.reduce((sum, record) => sum + record.points, 0),
        flowers: activeRecords.reduce((sum, record) => sum + record.stars, 0),
        categoryTotals,
      },
      honors: [
        { key: 'today_star', title: '今日小明星', student: this.pickRotatingHonor(allCandidates, studentMap) },
        { key: 'cooperation_star', title: '合作之星', student: byCategory(RewardCategory.Cooperation) },
        { key: 'exploration_star', title: '探索之星', student: byCategory(RewardCategory.Exploration) },
        { key: 'labor_star', title: '劳动之星', student: byCategory(RewardCategory.Labor) },
      ].filter((item) => item.student),
      collectiveRewards: collectiveRecords,
      policy: { negativeRankingEnabled: false, rotation: 'daily_category_rotation' },
    };
  }

  private normalizeReward(dto: CreateClassroomRewardDto) {
    const rewardCategory = dto.rewardCategory ?? RewardCategory.Progress;
    const rewardForms = dto.rewardForms?.length ? [...dto.rewardForms].sort() : [RewardForm.Flower];
    const stars = rewardForms.includes(RewardForm.Flower) ? (dto.stars ?? 1) : (dto.stars ?? 0);
    const points = dto.points ?? (rewardForms.includes(RewardForm.Points) ? Math.max(1, stars) : stars);
    const badgeCode = rewardForms.includes(RewardForm.Badge) ? (dto.badgeCode?.trim() || `${rewardCategory}_badge`) : null;
    const praiseTemplateId = dto.praiseTemplateId?.trim() || null;
    let praiseText = dto.praiseText?.trim() || null;
    if (rewardForms.includes(RewardForm.VoicePraise)) {
      if (praiseTemplateId && SAFE_PRAISE_TEMPLATES[praiseTemplateId]) praiseText = SAFE_PRAISE_TEMPLATES[praiseTemplateId];
      else if (!praiseText || dto.teacherConfirmedPraise !== true)
        throw new ConflictException('语音表扬必须使用安全模板，或由教师确认自定义文本');
      praiseText = this.assertSafeText(praiseText, '语音表扬');
    } else praiseText = null;
    const animationKey = rewardForms.includes(RewardForm.Animation) ? (dto.animationKey ?? 'stars') : null;
    if (animationKey && !SAFE_REWARD_ANIMATIONS.includes(animationKey as (typeof SAFE_REWARD_ANIMATIONS)[number]))
      throw new ConflictException('不支持的奖励动画');
    return { rewardCategory, rewardForms, stars, points, badgeCode, praiseTemplateId, praiseText, teacherConfirmedPraise: Boolean(dto.teacherConfirmedPraise), animationKey };
  }

  private parseForms(value: string): RewardForm[] {
    try { return JSON.parse(value) as RewardForm[]; } catch { return [RewardForm.Flower]; }
  }

  private assertSafeText(value: string, field: string) {
    if (!value) throw new ConflictException(`${field}不能为空`);
    if (/(差生|倒数|最差|笨|失败者|不如别人|没用)/i.test(value))
      throw new ConflictException(`${field}包含不适合幼儿的负面标签`);
    return value;
  }

  private async incrementActiveGoal(manager: EntityManager, classId: number, points: number, requestedGoalId?: number) {
    if (points <= 0) return;
    const repository = manager.getRepository(ClassGrowthGoal);
    const goal = requestedGoalId
      ? await repository.findOne({ where: { id: requestedGoalId, classId } })
      : await repository.findOne({ where: { classId, status: GrowthGoalStatus.Active }, order: { id: 'DESC' } });
    if (!goal || goal.status !== GrowthGoalStatus.Active) return;
    goal.currentPoints = Math.min(goal.targetPoints, goal.currentPoints + points);
    if (goal.currentPoints >= goal.targetPoints) {
      goal.status = GrowthGoalStatus.Completed;
      goal.completedAt = new Date();
    }
    await repository.save(goal);
  }

  private async recalculateCurrentGoal(manager: EntityManager, classId: number) {
    const repository = manager.getRepository(ClassGrowthGoal);
    const goal = await repository.findOne({
      where: [
        { classId, status: GrowthGoalStatus.Active },
        { classId, status: GrowthGoalStatus.Completed },
      ],
      order: { id: 'DESC' },
    });
    if (!goal) return;
    const individual = await manager.getRepository(StudentRewardRecord)
      .createQueryBuilder('r')
      .select('COALESCE(SUM(r.points), 0)', 'total')
      .where('r.class_id = :classId', { classId })
      .andWhere('r.revoked_at IS NULL')
      .andWhere('r.created_at >= :startedAt', { startedAt: goal.createdAt })
      .getRawOne<{ total: number | string }>();
    const collective = await manager.getRepository(ClassCollectiveRewardRecord)
      .createQueryBuilder('r')
      .select('COALESCE(SUM(r.points), 0)', 'total')
      .where('r.class_id = :classId', { classId })
      .andWhere('r.revoked_at IS NULL')
      .andWhere('r.created_at >= :startedAt', { startedAt: goal.createdAt })
      .getRawOne<{ total: number | string }>();
    goal.currentPoints = Math.min(goal.targetPoints, Number(individual?.total ?? 0) + Number(collective?.total ?? 0));
    goal.status = goal.currentPoints >= goal.targetPoints ? GrowthGoalStatus.Completed : GrowthGoalStatus.Active;
    goal.completedAt = goal.status === GrowthGoalStatus.Completed ? (goal.completedAt ?? new Date()) : null;
    await repository.save(goal);
  }

  private pickRotatingHonor(
    records: StudentRewardRecord[],
    students: Map<number, Student>,
    category?: RewardCategory,
  ) {
    const filtered = category ? records.filter((record) => record.rewardCategory === category) : records;
    const ids = [...new Set(filtered.map((record) => record.studentId))].sort((a, b) => a - b);
    if (!ids.length) return null;
    const day = Math.floor(Date.now() / 86_400_000);
    const studentId = ids[day % ids.length];
    const student = students.get(studentId);
    return { studentId, displayName: student?.nickname || student?.name || `幼儿 ${studentId}` };
  }

  private isUniqueViolation(error: unknown): boolean {
    // better-sqlite3 的唯一约束错误经 TypeORM 包装为 QueryFailedError，driver 原错误
    // 同时复制到了顶层（code='SQLITE_CONSTRAINT_UNIQUE'）；这里两层都查，避免驱动封装差异漏判。
    const driverError =
      typeof error === 'object' && error !== null && 'driverError' in error
        ? (error as { driverError?: { code?: unknown } }).driverError
        : null;
    const code =
      (typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : '') ||
      (driverError && 'code' in driverError
        ? String((driverError as { code?: unknown }).code)
        : '');
    return code.includes('CONSTRAINT') || code === '23505';
  }
}
