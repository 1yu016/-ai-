import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { AuthUserType } from '../auth/entities/refresh-token-session.entity';
import {
  ClassroomRunStatus,
  ClassroomSnapshotReason,
  TERMINAL_CLASSROOM_RUN_STATUSES,
} from '../classroom-runs/classroom-run.types';
import { ClassroomSnapshotService } from '../classroom-runs/classroom-snapshot.service';
import { ClassroomRun } from '../classroom-runs/entities/classroom-run.entity';
import { PlatformAccessService } from '../platform/platform-access.service';
import { Student } from '../platform/entities/student.entity';
import { RecordStatus } from '../platform/platform.types';
import {
  ACTIVE_BREAK_STATUSES,
  BreakRunStatus,
  CollectiveGoalStatus,
  GrowthEventType,
  HonorStatus,
  HonorType,
  RewardRecordStatus,
  RewardType,
} from './classroom-engagement.types';
import {
  AdjustClassGrowthDto,
  AwardRewardDto,
  BreakOperationDto,
  CreateBadgeDefinitionDto,
  CreateBreakConfigDto,
  CreateCollectiveGoalDto,
  CreateRewardRuleDto,
  PublishHonorDto,
  ReverseRewardDto,
  StartBreakDto,
  SuggestHonorDto,
  UpdateBreakConfigDto,
  UpdateRewardRuleDto,
} from './dto/classroom-engagement.dto';
import {
  BadgeDefinition,
  BreakConfig,
  BreakRun,
  ClassGrowthRecord,
  CollectiveGoal,
  HonorRecord,
  RewardRecord,
  RewardReversal,
  RewardRule,
  StudentBadge,
} from './entities';

type SafeStudent = Pick<
  Student,
  'id' | 'classId' | 'name' | 'nickname' | 'status'
>;

@Injectable()
export class ClassroomEngagementService {
  constructor(
    @InjectRepository(RewardRule)
    private readonly rules: Repository<RewardRule>,
    @InjectRepository(RewardRecord)
    private readonly rewards: Repository<RewardRecord>,
    @InjectRepository(RewardReversal)
    private readonly reversals: Repository<RewardReversal>,
    @InjectRepository(BadgeDefinition)
    private readonly badges: Repository<BadgeDefinition>,
    @InjectRepository(StudentBadge)
    private readonly studentBadges: Repository<StudentBadge>,
    @InjectRepository(ClassGrowthRecord)
    private readonly growth: Repository<ClassGrowthRecord>,
    @InjectRepository(HonorRecord)
    private readonly honors: Repository<HonorRecord>,
    @InjectRepository(CollectiveGoal)
    private readonly goals: Repository<CollectiveGoal>,
    @InjectRepository(BreakConfig)
    private readonly breakConfigs: Repository<BreakConfig>,
    @InjectRepository(BreakRun) private readonly breaks: Repository<BreakRun>,
    @InjectRepository(ClassroomRun)
    private readonly runs: Repository<ClassroomRun>,
    @InjectRepository(Student) private readonly students: Repository<Student>,
    private readonly dataSource: DataSource,
    private readonly access: PlatformAccessService,
    private readonly snapshots: ClassroomSnapshotService,
  ) {}

  async createBadge(actor: JwtTeacherPayload, dto: CreateBadgeDefinitionDto) {
    this.requireTeacher(actor);
    try {
      return await this.badges.save(
        this.badges.create({
          schoolId: actor.schoolId ?? null,
          code: dto.code.trim().toLowerCase(),
          name: dto.name.trim(),
          rewardType: dto.rewardType,
          description: dto.description?.trim() || null,
          iconKey: dto.iconKey?.trim() || null,
          active: true,
          createdBy: actor.sub,
        }),
      );
    } catch (error) {
      if (this.isUniqueViolation(error))
        throw new ConflictException('徽章编码已存在');
      throw error;
    }
  }

  async listBadges(actor: JwtTeacherPayload) {
    return {
      items: await this.badges.find({
        where: actor.schoolId
          ? [{ schoolId: actor.schoolId }, { schoolId: IsNull() }]
          : {},
        order: { id: 'ASC' },
      }),
    };
  }

  async createRule(actor: JwtTeacherPayload, dto: CreateRewardRuleDto) {
    this.requireTeacher(actor);
    await this.validateBadge(actor, dto.badgeDefinitionId, dto.rewardType);
    this.assertRewardForm(dto);
    try {
      return await this.rules.save(
        this.rules.create({
          schoolId: actor.schoolId ?? null,
          name: dto.name.trim(),
          rewardType: dto.rewardType,
          pointsValue: dto.pointsValue ?? 0,
          flowerCount: dto.flowerCount ?? 0,
          classGrowthValue: dto.classGrowthValue ?? 0,
          badgeDefinitionId: dto.badgeDefinitionId ?? null,
          active: true,
          createdBy: actor.sub,
        }),
      );
    } catch (error) {
      if (this.isUniqueViolation(error))
        throw new ConflictException('奖励规则名称已存在');
      throw error;
    }
  }

  async updateRule(
    actor: JwtTeacherPayload,
    id: number,
    dto: UpdateRewardRuleDto,
  ) {
    this.requireTeacher(actor);
    const rule = await this.ruleForActor(actor, id, false);
    const rewardType = dto.rewardType ?? rule.rewardType;
    const badgeDefinitionId =
      dto.badgeDefinitionId === undefined
        ? rule.badgeDefinitionId
        : dto.badgeDefinitionId;
    await this.validateBadge(actor, badgeDefinitionId ?? undefined, rewardType);
    Object.assign(rule, {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.rewardType !== undefined ? { rewardType: dto.rewardType } : {}),
      ...(dto.pointsValue !== undefined
        ? { pointsValue: dto.pointsValue }
        : {}),
      ...(dto.flowerCount !== undefined
        ? { flowerCount: dto.flowerCount }
        : {}),
      ...(dto.classGrowthValue !== undefined
        ? { classGrowthValue: dto.classGrowthValue }
        : {}),
      ...(dto.badgeDefinitionId !== undefined
        ? { badgeDefinitionId: dto.badgeDefinitionId }
        : {}),
      ...(dto.active !== undefined ? { active: dto.active } : {}),
    });
    this.assertRewardForm(rule);
    return this.rules.save(rule);
  }

  async listRules(actor: JwtTeacherPayload) {
    return {
      items: await this.rules.find({
        where: actor.schoolId
          ? [{ schoolId: actor.schoolId }, { schoolId: IsNull() }]
          : {},
        order: { id: 'ASC' },
      }),
    };
  }

  async award(actor: JwtTeacherPayload, runId: number, dto: AwardRewardDto) {
    const run = await this.teacherRun(actor, runId, true);
    await this.requireStudentInClass(run.classId, dto.studentId);
    const duplicate = await this.rewards.findOne({
      where: { teacherId: actor.sub, requestId: dto.requestId },
    });
    if (duplicate) {
      if (
        duplicate.classroomRunId !== run.id ||
        duplicate.studentId !== dto.studentId
      )
        throw new ConflictException('requestId 已用于其他奖励');
      return this.rewardResponse(duplicate);
    }

    let values: {
      ruleId: number | null;
      rewardType: RewardType;
      points: number;
      flowerCount: number;
      classGrowthValue: number;
      badgeDefinitionId: number | null;
    };
    if (dto.ruleId) {
      const rule = await this.ruleForActor(actor, dto.ruleId, true);
      values = {
        ruleId: rule.id,
        rewardType: rule.rewardType,
        points: rule.pointsValue,
        flowerCount: rule.flowerCount,
        classGrowthValue: rule.classGrowthValue,
        badgeDefinitionId: rule.badgeDefinitionId,
      };
    } else {
      if (!dto.rewardType)
        throw new BadRequestException('未使用规则时必须提供奖励类型');
      await this.validateBadge(actor, dto.badgeDefinitionId, dto.rewardType);
      this.assertRewardForm(dto);
      values = {
        ruleId: null,
        rewardType: dto.rewardType,
        points: dto.points ?? 0,
        flowerCount: dto.flowerCount ?? 0,
        classGrowthValue: dto.classGrowthValue ?? 0,
        badgeDefinitionId: dto.badgeDefinitionId ?? null,
      };
    }

    let reward: RewardRecord;
    try {
      reward = await this.dataSource.transaction(async (manager) => {
        const rewardRepo = manager.getRepository(RewardRecord);
        const repeated = await rewardRepo.findOne({
          where: { teacherId: actor.sub, requestId: dto.requestId },
        });
        if (repeated) {
          if (
            repeated.classroomRunId !== run.id ||
            repeated.studentId !== dto.studentId
          )
            throw new ConflictException('requestId 已用于其他奖励');
          return repeated;
        }
        const saved = await rewardRepo.save(
          rewardRepo.create({
            classroomRunId: run.id,
            classId: run.classId,
            studentId: dto.studentId,
            teacherId: actor.sub,
            ...values,
            reason: dto.reason.trim(),
            status: RewardRecordStatus.Active,
            requestId: dto.requestId,
          }),
        );
        if (values.badgeDefinitionId) {
          await manager.getRepository(StudentBadge).save(
            manager.getRepository(StudentBadge).create({
              studentId: dto.studentId,
              badgeDefinitionId: values.badgeDefinitionId,
              rewardRecordId: saved.id,
              active: true,
              reversedAt: null,
            }),
          );
        }
        if (values.classGrowthValue > 0) {
          await this.appendGrowth(manager, {
            classId: run.classId,
            classroomRunId: run.id,
            rewardRecordId: saved.id,
            delta: values.classGrowthValue,
            eventType: GrowthEventType.Reward,
            reason: dto.reason.trim(),
            teacherId: actor.sub,
            requestId: `reward:${dto.requestId}`,
          });
          await this.advanceGoals(
            manager,
            run.classId,
            values.classGrowthValue,
            actor.sub,
            saved.id,
          );
        }
        return saved;
      });
    } catch (error) {
      const repeated = await this.rewards.findOne({
        where: { teacherId: actor.sub, requestId: dto.requestId },
      });
      if (repeated) return this.rewardResponse(repeated);
      throw error;
    }
    await this.captureReward(run.id, reward);
    return this.rewardResponse(reward);
  }

  async reverseReward(
    actor: JwtTeacherPayload,
    rewardId: number,
    dto: ReverseRewardDto,
  ) {
    this.requireTeacher(actor);
    const byRequest = await this.reversals.findOne({
      where: { teacherId: actor.sub, requestId: dto.requestId },
    });
    if (byRequest && byRequest.rewardRecordId !== rewardId)
      throw new ConflictException('requestId 已用于其他奖励撤销');
    const existingReversal =
      byRequest ??
      (await this.reversals.findOne({ where: { rewardRecordId: rewardId } }));
    if (existingReversal) {
      const existingReward = await this.rewards.findOneByOrFail({
        id: existingReversal.rewardRecordId,
      });
      return this.rewardResponse(existingReward);
    }
    const reward = await this.rewards.findOne({ where: { id: rewardId } });
    if (!reward) throw new NotFoundException('奖励记录不存在');
    const run = await this.teacherRun(actor, reward.classroomRunId, false);
    if (reward.status === RewardRecordStatus.Reversed)
      throw new ConflictException('奖励已经撤销');
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(RewardRecord);
      const current = await repo.findOneByOrFail({ id: reward.id });
      if (current.status === RewardRecordStatus.Reversed)
        throw new ConflictException('奖励已经撤销');
      current.status = RewardRecordStatus.Reversed;
      await repo.save(current);
      await manager.getRepository(RewardReversal).save(
        manager.getRepository(RewardReversal).create({
          rewardRecordId: current.id,
          requestId: dto.requestId,
          teacherId: actor.sub,
          reason: dto.reason.trim(),
        }),
      );
      const studentBadge = await manager
        .getRepository(StudentBadge)
        .findOne({ where: { rewardRecordId: current.id } });
      if (studentBadge) {
        studentBadge.active = false;
        studentBadge.reversedAt = new Date();
        await manager.getRepository(StudentBadge).save(studentBadge);
      }
      if (current.classGrowthValue > 0) {
        await this.appendGrowth(manager, {
          classId: current.classId,
          classroomRunId: current.classroomRunId,
          rewardRecordId: current.id,
          delta: -current.classGrowthValue,
          eventType: GrowthEventType.RewardReversal,
          reason: dto.reason.trim(),
          teacherId: actor.sub,
          requestId: `reverse:${dto.requestId}`,
        });
        await this.advanceGoals(
          manager,
          current.classId,
          -current.classGrowthValue,
          actor.sub,
          current.id,
        );
      }
    });
    const updated = await this.rewards.findOneByOrFail({ id: reward.id });
    await this.captureReward(run.id, updated);
    return this.rewardResponse(updated);
  }

  async listRewards(actor: JwtTeacherPayload, runId: number) {
    await this.readableRun(actor, runId);
    const items = await this.rewards.find({
      where: { classroomRunId: runId },
      order: { id: 'DESC' },
    });
    return {
      items: await Promise.all(items.map((item) => this.rewardResponse(item))),
    };
  }

  async studentBadgeList(actor: JwtTeacherPayload, studentId: number) {
    await this.access.requireStudentAccess(actor, studentId);
    const items = await this.studentBadges.find({
      where: { studentId, active: true },
      order: { id: 'DESC' },
    });
    const definitions = items.length
      ? await this.badges.find({
          where: { id: In(items.map((item) => item.badgeDefinitionId)) },
        })
      : [];
    const byId = new Map(definitions.map((item) => [item.id, item]));
    return {
      items: items.map((item) => ({
        ...item,
        badge: byId.get(item.badgeDefinitionId) ?? null,
      })),
    };
  }

  async createGoal(
    actor: JwtTeacherPayload,
    classId: number,
    dto: CreateCollectiveGoalDto,
  ) {
    this.requireTeacher(actor);
    await this.access.requireClassAccess(actor, classId);
    return this.goals.save(
      this.goals.create({
        classId,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        targetValue: dto.targetValue,
        currentValue: 0,
        status: CollectiveGoalStatus.Active,
        teacherId: actor.sub,
        completedAt: null,
      }),
    );
  }

  async adjustGrowth(
    actor: JwtTeacherPayload,
    classId: number,
    dto: AdjustClassGrowthDto,
  ) {
    this.requireTeacher(actor);
    await this.access.requireClassAccess(actor, classId);
    const duplicate = await this.growth.findOne({
      where: { classId, requestId: dto.requestId },
    });
    if (duplicate) return duplicate;
    if (dto.delta === 0) throw new BadRequestException('成长值调整不能为0');
    const record = await this.dataSource.transaction(async (manager) => {
      const repeated = await manager
        .getRepository(ClassGrowthRecord)
        .findOne({ where: { classId, requestId: dto.requestId } });
      if (repeated) return repeated;
      const saved = await this.appendGrowth(manager, {
        classId,
        classroomRunId: null,
        rewardRecordId: null,
        delta: dto.delta,
        eventType: GrowthEventType.TeacherAdjustment,
        reason: dto.reason.trim(),
        teacherId: actor.sub,
        requestId: dto.requestId,
      });
      await this.advanceGoals(manager, classId, dto.delta, actor.sub, null);
      return saved;
    });
    return record;
  }

  async classGrowth(actor: JwtTeacherPayload, classId: number) {
    await this.access.requireClassAccess(actor, classId);
    const [records, goals] = await Promise.all([
      this.growth.find({ where: { classId }, order: { id: 'DESC' } }),
      this.goals.find({ where: { classId }, order: { id: 'DESC' } }),
    ]);
    return { currentValue: records[0]?.balanceAfter ?? 0, records, goals };
  }

  async suggestHonor(
    actor: JwtTeacherPayload,
    runId: number,
    dto: SuggestHonorDto,
  ) {
    const run = await this.teacherRun(actor, runId, false);
    const duplicate = await this.honors.findOne({
      where: { teacherId: actor.sub, requestId: dto.requestId },
    });
    if (duplicate) {
      if (duplicate.classroomRunId !== run.id || duplicate.type !== dto.type)
        throw new ConflictException('requestId 已用于其他荣誉建议');
      return this.honorResponse(duplicate);
    }
    if (dto.type === HonorType.Collective) {
      const completedGoal = await this.goals.findOne({
        where: { classId: run.classId, status: CollectiveGoalStatus.Completed },
        order: { completedAt: 'DESC' },
      });
      if (!completedGoal)
        throw new ConflictException('班级尚无已完成的共同目标');
      const honor = await this.honors.save(
        this.honors.create({
          classroomRunId: run.id,
          classId: run.classId,
          studentId: null,
          type: dto.type,
          title: `集体荣誉：${completedGoal.title}`,
          dimensions: JSON.stringify({
            goalId: completedGoal.id,
            goalCompleted: true,
            collectiveGrowth: completedGoal.currentValue,
          }),
          status: HonorStatus.Draft,
          teacherId: actor.sub,
          requestId: dto.requestId,
          confirmedBy: null,
          confirmedAt: null,
          cooldownUntil: null,
        }),
      );
      return this.honorResponse(honor);
    }

    const activeRewards = await this.rewards.find({
      where: { classroomRunId: run.id, status: RewardRecordStatus.Active },
    });
    const students = await this.classStudents(run.classId);
    const now = new Date();
    const recent = await this.honors.find({
      where: {
        classId: run.classId,
        type: dto.type,
        status: HonorStatus.Published,
      },
      order: { confirmedAt: 'DESC' },
    });
    const recentCount = new Map<number, number>();
    recent.forEach((item) => {
      if (item.studentId)
        recentCount.set(
          item.studentId,
          (recentCount.get(item.studentId) ?? 0) + 1,
        );
    });
    const candidates = students
      .map((student) => {
        const records = activeRewards.filter(
          (reward) => reward.studentId === student.id,
        );
        const types = new Set(records.map((reward) => reward.rewardType));
        const relevant = records.filter((reward) =>
          this.honorRelevant(dto.type, reward.rewardType),
        ).length;
        const cooling = recent.some(
          (item) =>
            item.studentId === student.id &&
            item.cooldownUntil &&
            item.cooldownUntil > now,
        );
        return {
          student,
          relevant,
          distinctRewardTypes: types.size,
          participationEvents: records.length,
          priorDisplays: recentCount.get(student.id) ?? 0,
          cooling,
        };
      })
      .filter(
        (candidate) =>
          candidate.relevant > 0 &&
          (dto.type !== HonorType.TodayStar ||
            candidate.distinctRewardTypes >= 2),
      );
    if (!candidates.length)
      throw new ConflictException('当前课堂没有满足多维度条件的荣誉候选');
    const available = candidates.filter((candidate) => !candidate.cooling);
    if (!available.length)
      throw new ConflictException(
        '符合条件的幼儿仍在荣誉展示冷却期，请稍后轮换',
      );
    const chosen = [...available].sort(
      (a, b) =>
        a.priorDisplays - b.priorDisplays ||
        b.relevant - a.relevant ||
        b.distinctRewardTypes - a.distinctRewardTypes ||
        b.participationEvents - a.participationEvents ||
        a.student.id - b.student.id,
    )[0];
    const honor = await this.honors.save(
      this.honors.create({
        classroomRunId: run.id,
        classId: run.classId,
        studentId: chosen.student.id,
        type: dto.type,
        title: this.honorTitle(dto.type),
        dimensions: JSON.stringify({
          rewardTypes: chosen.distinctRewardTypes,
          relevantEvents: chosen.relevant,
          participationEvents: chosen.participationEvents,
          rotationApplied: chosen.priorDisplays > 0 || chosen.cooling,
        }),
        status: HonorStatus.Draft,
        teacherId: actor.sub,
        requestId: dto.requestId,
        confirmedBy: null,
        confirmedAt: null,
        cooldownUntil: new Date(
          Date.now() + (dto.cooldownDays ?? 7) * 86_400_000,
        ),
      }),
    );
    return this.honorResponse(honor);
  }

  async publishHonor(
    actor: JwtTeacherPayload,
    honorId: number,
    dto: PublishHonorDto,
  ) {
    this.requireTeacher(actor);
    const honor = await this.honors.findOne({ where: { id: honorId } });
    if (!honor) throw new NotFoundException('荣誉记录不存在');
    await this.teacherRun(actor, honor.classroomRunId, false);
    if (honor.status === HonorStatus.Published)
      return this.honorResponse(honor);
    if (honor.status !== HonorStatus.Draft)
      throw new ConflictException('只有草稿荣誉可以发布');
    honor.status = HonorStatus.Published;
    honor.confirmedBy = actor.sub;
    honor.confirmedAt = new Date();
    if (dto.title) honor.title = dto.title.trim();
    return this.honorResponse(await this.honors.save(honor));
  }

  async listHonors(actor: JwtTeacherPayload, runId: number) {
    await this.readableRun(actor, runId);
    const items = await this.honors.find({
      where: { classroomRunId: runId },
      order: { id: 'DESC' },
    });
    return {
      items: await Promise.all(items.map((item) => this.honorResponse(item))),
    };
  }

  async createBreakConfig(actor: JwtTeacherPayload, dto: CreateBreakConfigDto) {
    this.requireTeacher(actor);
    await this.access.requireClassAccess(actor, dto.classId);
    return this.breakConfigs.save(
      this.breakConfigs.create({
        classId: dto.classId,
        type: dto.type,
        name: dto.name.trim(),
        durationSeconds: dto.durationSeconds,
        instructions: dto.instructions?.trim() || null,
        enabled: true,
        createdBy: actor.sub,
      }),
    );
  }

  async updateBreakConfig(
    actor: JwtTeacherPayload,
    id: number,
    dto: UpdateBreakConfigDto,
  ) {
    this.requireTeacher(actor);
    const config = await this.breakConfigs.findOne({ where: { id } });
    if (!config) throw new NotFoundException('课间配置不存在');
    await this.access.requireClassAccess(actor, config.classId);
    Object.assign(config, {
      ...(dto.type !== undefined ? { type: dto.type } : {}),
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.durationSeconds !== undefined
        ? { durationSeconds: dto.durationSeconds }
        : {}),
      ...(dto.instructions !== undefined
        ? { instructions: dto.instructions.trim() || null }
        : {}),
      ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
    });
    return this.breakConfigs.save(config);
  }

  async listBreakConfigs(actor: JwtTeacherPayload, classId: number) {
    await this.access.requireClassAccess(actor, classId);
    return {
      items: await this.breakConfigs.find({
        where: { classId },
        order: { id: 'ASC' },
      }),
    };
  }

  async startBreak(
    actor: JwtTeacherPayload,
    runId: number,
    dto: StartBreakDto,
  ) {
    const run = await this.teacherRun(actor, runId, true);
    if (
      ![ClassroomRunStatus.Running, ClassroomRunStatus.Paused].includes(
        run.status,
      )
    )
      throw new ConflictException('只有运行或暂停中的课堂可以进入课间');
    if (run.deviceId !== dto.deviceId)
      throw new ForbiddenException('当前设备无课堂控制权');
    const duplicate = await this.breaks.findOne({
      where: { teacherId: actor.sub, requestId: dto.requestId },
    });
    if (duplicate) {
      if (duplicate.classroomRunId !== run.id)
        throw new ConflictException('requestId 已用于其他课间');
      return this.breakResponse(duplicate);
    }
    let config: BreakConfig | null = null;
    if (dto.configId) {
      config = await this.breakConfigs.findOne({
        where: { id: dto.configId, classId: run.classId, enabled: true },
      });
      if (!config)
        throw new BadRequestException('课间配置不存在、已停用或不属于当前班级');
    }
    const type = config?.type ?? dto.type;
    const title = config?.name ?? dto.title?.trim();
    const durationSeconds = config?.durationSeconds ?? dto.durationSeconds;
    if (!type || !title || !durationSeconds)
      throw new BadRequestException('未选择配置时必须提供课间类型、标题和时长');

    await this.snapshots.capture(run.id, ClassroomSnapshotReason.Timed, true, {
      interactionState: {
        enteringBreak: true,
        savedStepIndex: run.currentStepIndex,
        savedStatus: run.status,
      },
    });
    let breakRun: BreakRun;
    try {
      breakRun = await this.dataSource.transaction(async (manager) => {
        const current = await manager
          .getRepository(ClassroomRun)
          .findOne({ where: { id: run.id } });
        if (!current) throw new NotFoundException('课堂运行不存在');
        if (current.teacherId !== actor.sub)
          throw new ForbiddenException('无权操作其他教师的课堂');
        if (current.version !== dto.version)
          throw new ConflictException('课堂版本冲突，请刷新后重试');
        if (current.deviceId !== dto.deviceId)
          throw new ForbiddenException('当前设备无课堂控制权');
        if (
          ![ClassroomRunStatus.Running, ClassroomRunStatus.Paused].includes(
            current.status,
          )
        )
          throw new ConflictException('课堂当前不能进入课间');
        const active = await manager.getRepository(BreakRun).findOne({
          where: {
            classroomRunId: run.id,
            status: In([...ACTIVE_BREAK_STATUSES]),
          },
        });
        if (active) throw new ConflictException('当前课堂已经存在有效课间');
        const now = new Date();
        const elapsed =
          current.status === ClassroomRunStatus.Running && current.resumedAt
            ? current.elapsedSeconds +
              Math.max(
                0,
                Math.floor(
                  (now.getTime() - current.resumedAt.getTime()) / 1000,
                ),
              )
            : current.elapsedSeconds;
        const savedStatus = current.status;
        const savedVersion = current.version;
        await manager.getRepository(ClassroomRun).update(
          { id: current.id, version: current.version },
          {
            status: ClassroomRunStatus.Paused,
            elapsedSeconds: elapsed,
            pausedAt: now,
            resumedAt: null,
            version: current.version + 1,
          },
        );
        return manager.getRepository(BreakRun).save(
          manager.getRepository(BreakRun).create({
            classroomRunId: current.id,
            classId: current.classId,
            configId: config?.id ?? null,
            type,
            title,
            durationSeconds,
            status: BreakRunStatus.Running,
            savedRunStatus: savedStatus,
            savedStepIndex: current.currentStepIndex,
            savedRunVersion: savedVersion,
            elapsedSeconds: 0,
            startedAt: now,
            resumedAt: now,
            pausedAt: null,
            endedAt: null,
            teacherId: actor.sub,
            requestId: dto.requestId,
            version: 1,
          }),
        );
      });
    } catch (error) {
      const repeated = await this.breaks.findOne({
        where: { teacherId: actor.sub, requestId: dto.requestId },
      });
      if (repeated) return this.breakResponse(repeated);
      if (this.isUniqueViolation(error))
        throw new ConflictException('当前课堂已经存在有效课间');
      throw error;
    }
    await this.snapshots.capture(run.id, ClassroomSnapshotReason.Timed, true, {
      interactionState: {
        breakRunId: breakRun.id,
        breakStatus: breakRun.status,
      },
    });
    return this.breakResponse(breakRun);
  }

  async pauseBreak(
    actor: JwtTeacherPayload,
    id: number,
    dto: BreakOperationDto,
  ) {
    return this.changeBreakStatus(actor, id, dto, BreakRunStatus.Paused);
  }

  async resumeBreak(
    actor: JwtTeacherPayload,
    id: number,
    dto: BreakOperationDto,
  ) {
    return this.changeBreakStatus(actor, id, dto, BreakRunStatus.Running);
  }

  async endBreak(actor: JwtTeacherPayload, id: number, dto: BreakOperationDto) {
    this.requireTeacher(actor);
    const breakRun = await this.breaks.findOne({ where: { id } });
    if (!breakRun) throw new NotFoundException('课间运行不存在');
    const run = await this.teacherRun(actor, breakRun.classroomRunId, false);
    if (
      ![BreakRunStatus.Running, BreakRunStatus.Paused].includes(breakRun.status)
    )
      return this.breakResponse(breakRun);
    if (breakRun.version !== dto.version)
      throw new ConflictException('课间版本冲突，请刷新后重试');
    await this.dataSource.transaction(async (manager) => {
      const currentBreak = await manager
        .getRepository(BreakRun)
        .findOneByOrFail({ id });
      const currentRun = await manager
        .getRepository(ClassroomRun)
        .findOneByOrFail({ id: run.id });
      if (currentBreak.version !== dto.version)
        throw new ConflictException('课间版本冲突，请刷新后重试');
      const now = new Date();
      currentBreak.elapsedSeconds = this.currentBreakElapsed(currentBreak, now);
      currentBreak.status = BreakRunStatus.Completed;
      currentBreak.resumedAt = null;
      currentBreak.pausedAt = null;
      currentBreak.endedAt = now;
      currentBreak.version += 1;
      await manager.getRepository(BreakRun).save(currentBreak);
      if (
        !TERMINAL_CLASSROOM_RUN_STATUSES.includes(currentRun.status as never)
      ) {
        const restoreStatus =
          currentBreak.savedRunStatus === ClassroomRunStatus.Running
            ? ClassroomRunStatus.Running
            : ClassroomRunStatus.Paused;
        await manager.getRepository(ClassroomRun).update(
          { id: currentRun.id, version: currentRun.version },
          {
            status: restoreStatus,
            currentStepIndex: currentBreak.savedStepIndex,
            pausedAt: restoreStatus === ClassroomRunStatus.Paused ? now : null,
            resumedAt:
              restoreStatus === ClassroomRunStatus.Running ? now : null,
            version: currentRun.version + 1,
          },
        );
      }
    });
    const updated = await this.breaks.findOneByOrFail({ id });
    await this.snapshots.capture(
      run.id,
      ClassroomSnapshotReason.Recover,
      true,
      {
        interactionState: {
          breakRunId: updated.id,
          breakStatus: updated.status,
          restoredStepIndex: updated.savedStepIndex,
        },
      },
    );
    return this.breakResponse(updated);
  }

  async activeBreak(actor: JwtTeacherPayload, runId: number) {
    await this.readableRun(actor, runId);
    const active = await this.breaks.findOne({
      where: { classroomRunId: runId, status: In([...ACTIVE_BREAK_STATUSES]) },
      order: { id: 'DESC' },
    });
    return active ? this.breakResponse(active) : null;
  }

  async getBreak(actor: JwtTeacherPayload, id: number) {
    const breakRun = await this.breaks.findOne({ where: { id } });
    if (!breakRun) throw new NotFoundException('课间运行不存在');
    await this.readableRun(actor, breakRun.classroomRunId);
    return this.breakResponse(breakRun);
  }

  private async changeBreakStatus(
    actor: JwtTeacherPayload,
    id: number,
    dto: BreakOperationDto,
    target: BreakRunStatus,
  ) {
    this.requireTeacher(actor);
    const breakRun = await this.breaks.findOne({ where: { id } });
    if (!breakRun) throw new NotFoundException('课间运行不存在');
    await this.teacherRun(actor, breakRun.classroomRunId, true);
    if (breakRun.version !== dto.version)
      throw new ConflictException('课间版本冲突，请刷新后重试');
    if (
      target === BreakRunStatus.Paused &&
      breakRun.status !== BreakRunStatus.Running
    )
      throw new ConflictException('只有进行中的课间可以暂停');
    if (
      target === BreakRunStatus.Running &&
      breakRun.status !== BreakRunStatus.Paused
    )
      throw new ConflictException('只有暂停的课间可以恢复');
    const now = new Date();
    if (target === BreakRunStatus.Paused) {
      breakRun.elapsedSeconds = this.currentBreakElapsed(breakRun, now);
      breakRun.pausedAt = now;
      breakRun.resumedAt = null;
    } else {
      breakRun.pausedAt = null;
      breakRun.resumedAt = now;
    }
    breakRun.status = target;
    breakRun.version += 1;
    return this.breakResponse(await this.breaks.save(breakRun));
  }

  private async appendGrowth(
    manager: EntityManager,
    input: {
      classId: number;
      classroomRunId: number | null;
      rewardRecordId: number | null;
      delta: number;
      eventType: GrowthEventType;
      reason: string;
      teacherId: number;
      requestId: string;
    },
  ) {
    const repo = manager.getRepository(ClassGrowthRecord);
    const latest = await repo.findOne({
      where: { classId: input.classId },
      order: { id: 'DESC' },
    });
    return repo.save(
      repo.create({
        ...input,
        goalId: null,
        balanceAfter: Math.max(0, (latest?.balanceAfter ?? 0) + input.delta),
      }),
    );
  }

  private async advanceGoals(
    manager: EntityManager,
    classId: number,
    delta: number,
    teacherId: number,
    rewardRecordId: number | null,
  ) {
    const repo = manager.getRepository(CollectiveGoal);
    const goals = await repo.find({
      where: {
        classId,
        status: In([
          CollectiveGoalStatus.Active,
          CollectiveGoalStatus.Completed,
        ]),
      },
    });
    for (const goal of goals) {
      const before = goal.currentValue;
      goal.currentValue = Math.max(0, goal.currentValue + delta);
      const completed = goal.currentValue >= goal.targetValue;
      if (completed && goal.status !== CollectiveGoalStatus.Completed) {
        goal.status = CollectiveGoalStatus.Completed;
        goal.completedAt = new Date();
        const latest = await manager
          .getRepository(ClassGrowthRecord)
          .findOne({ where: { classId }, order: { id: 'DESC' } });
        await manager.getRepository(ClassGrowthRecord).save(
          manager.getRepository(ClassGrowthRecord).create({
            classId,
            classroomRunId: null,
            rewardRecordId,
            goalId: goal.id,
            delta: 0,
            balanceAfter: latest?.balanceAfter ?? 0,
            eventType: GrowthEventType.GoalCompleted,
            reason: `共同目标“${goal.title}”完成`,
            teacherId,
            requestId: `goal-completed:${goal.id}:${rewardRecordId ?? Date.now()}`,
          }),
        );
      } else if (
        !completed &&
        goal.status === CollectiveGoalStatus.Completed &&
        delta < 0
      ) {
        goal.status = CollectiveGoalStatus.Active;
        goal.completedAt = null;
      }
      if (
        goal.currentValue !== before ||
        goal.status === CollectiveGoalStatus.Completed
      )
        await repo.save(goal);
    }
  }

  private async captureReward(runId: number, reward: RewardRecord) {
    const active = await this.rewards.find({
      where: { classroomRunId: runId, status: RewardRecordStatus.Active },
    });
    await this.snapshots.capture(runId, ClassroomSnapshotReason.Reward, false, {
      rewardState: {
        lastRewardId: reward.id,
        activeRewardCount: active.length,
        flowerCount: active.reduce((sum, item) => sum + item.flowerCount, 0),
        classGrowthValue: active.reduce(
          (sum, item) => sum + item.classGrowthValue,
          0,
        ),
      },
    });
  }

  private async rewardResponse(reward: RewardRecord) {
    const [reversal, badge] = await Promise.all([
      this.reversals.findOne({ where: { rewardRecordId: reward.id } }),
      this.studentBadges.findOne({ where: { rewardRecordId: reward.id } }),
    ]);
    return { ...reward, badge, reversal };
  }

  private async honorResponse(honor: HonorRecord) {
    const student = honor.studentId
      ? await this.students
          .createQueryBuilder('student')
          .select(['student.id', 'student.name', 'student.nickname'])
          .where('student.id = :id', { id: honor.studentId })
          .getOne()
      : null;
    return {
      ...honor,
      dimensions: this.parseObject(honor.dimensions),
      student,
    };
  }

  private honorRelevant(type: HonorType, reward: RewardType) {
    if (type === HonorType.TodayStar) return true;
    if (type === HonorType.CooperationStar)
      return (
        reward === RewardType.Cooperation || reward === RewardType.Progress
      );
    if (type === HonorType.ExplorationStar)
      return reward === RewardType.Exploration || reward === RewardType.Answer;
    if (type === HonorType.LaborStar)
      return reward === RewardType.Labor || reward === RewardType.Cooperation;
    return false;
  }

  private honorTitle(type: HonorType) {
    return {
      [HonorType.TodayStar]: '今日之星',
      [HonorType.CooperationStar]: '合作之星',
      [HonorType.ExplorationStar]: '探索之星',
      [HonorType.LaborStar]: '劳动之星',
      [HonorType.Collective]: '集体荣誉',
    }[type];
  }

  private async validateBadge(
    actor: JwtTeacherPayload,
    badgeId: number | undefined,
    rewardType: RewardType,
  ) {
    if (!badgeId) return;
    const badge = await this.badges.findOne({
      where: { id: badgeId, active: true },
    });
    if (!badge) throw new BadRequestException('徽章不存在或已停用');
    if (actor.schoolId && badge.schoolId && badge.schoolId !== actor.schoolId)
      throw new ForbiddenException('无权使用其他园所的徽章');
    if (badge.rewardType !== rewardType)
      throw new BadRequestException('徽章与奖励类型不一致');
  }

  private assertRewardForm(value: {
    pointsValue?: number;
    points?: number;
    flowerCount?: number;
    classGrowthValue?: number;
    badgeDefinitionId?: number | null;
  }) {
    if (
      (value.pointsValue ?? value.points ?? 0) <= 0 &&
      (value.flowerCount ?? 0) <= 0 &&
      (value.classGrowthValue ?? 0) <= 0 &&
      !value.badgeDefinitionId
    )
      throw new BadRequestException(
        '奖励至少需要积分、徽章、小红花或班级成长值之一',
      );
  }

  private async ruleForActor(
    actor: JwtTeacherPayload,
    id: number,
    activeOnly: boolean,
  ) {
    const rule = await this.rules.findOne({
      where: { id, ...(activeOnly ? { active: true } : {}) },
    });
    if (!rule) throw new NotFoundException('奖励规则不存在');
    if (actor.schoolId && rule.schoolId && actor.schoolId !== rule.schoolId)
      throw new ForbiddenException('无权使用其他园所的奖励规则');
    return rule;
  }

  private async requireStudentInClass(classId: number, studentId: number) {
    const exists = await this.students.exists({
      where: { id: studentId, classId, status: RecordStatus.Active },
    });
    if (!exists) throw new BadRequestException('学生不属于当前班级或已停用');
  }

  private async classStudents(classId: number): Promise<SafeStudent[]> {
    return this.students
      .createQueryBuilder('student')
      .select([
        'student.id',
        'student.classId',
        'student.name',
        'student.nickname',
        'student.status',
      ])
      .where('student.classId = :classId', { classId })
      .andWhere('student.status = :status', { status: RecordStatus.Active })
      .orderBy('student.id', 'ASC')
      .getMany();
  }

  private async teacherRun(
    actor: JwtTeacherPayload,
    runId: number,
    requireActive: boolean,
  ) {
    this.requireTeacher(actor);
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException('课堂运行不存在');
    if (run.teacherId !== actor.sub)
      throw new ForbiddenException('无权操作其他教师的课堂');
    await this.access.requireClassAccess(actor, run.classId);
    if (
      requireActive &&
      TERMINAL_CLASSROOM_RUN_STATUSES.includes(run.status as never)
    )
      throw new ConflictException('已结束课堂不能执行该操作');
    return run;
  }

  private async readableRun(actor: JwtTeacherPayload, runId: number) {
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException('课堂运行不存在');
    await this.access.requireClassAccess(actor, run.classId);
    if (!this.access.isAdministrator(actor) && run.teacherId !== actor.sub)
      throw new ForbiddenException('无权查询其他教师的课堂');
    return run;
  }

  private requireTeacher(actor: JwtTeacherPayload) {
    if (actor.userType !== AuthUserType.Teacher)
      throw new ForbiddenException('该操作仅限教师');
  }

  private currentBreakElapsed(breakRun: BreakRun, at = new Date()) {
    if (breakRun.status !== BreakRunStatus.Running || !breakRun.resumedAt)
      return breakRun.elapsedSeconds;
    return (
      breakRun.elapsedSeconds +
      Math.max(
        0,
        Math.floor((at.getTime() - breakRun.resumedAt.getTime()) / 1000),
      )
    );
  }

  private breakResponse(breakRun: BreakRun) {
    const elapsedSeconds = this.currentBreakElapsed(breakRun);
    return {
      ...breakRun,
      elapsedSeconds,
      remainingSeconds: Math.max(0, breakRun.durationSeconds - elapsedSeconds),
      recoverable: [BreakRunStatus.Running, BreakRunStatus.Paused].includes(
        breakRun.status,
      ),
    };
  }

  private parseObject(value: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  private isUniqueViolation(error: unknown) {
    return error instanceof Error && /unique|constraint/i.test(error.message);
  }
}
