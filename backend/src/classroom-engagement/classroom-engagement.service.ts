import { rejectLegacyWrite, withRecordIdentity } from '../classroom-runs/legacy-write-boundary';
import { StudentRewardService } from '../classroom-runs/student-reward.service';
import { RewardCategory, RewardForm } from '../classroom-runs/reward-system.types';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, Repository } from 'typeorm';
import { createHash } from 'node:crypto';
import { ClassroomEvent } from '../classroom-runs/entities/classroom-event.entity';
import { TeacherClass } from '../platform/entities/teacher-class.entity';
import { SchoolClass } from '../platform/entities/school-class.entity';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { AuthUserType } from '../auth/entities/refresh-token-session.entity';
import {
  ClassroomRunStatus,
  ClassroomSnapshotReason,
  ClassroomEventType,
  ClassroomEventResult,
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
  HonorType,
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
    private readonly access: PlatformAccessService,
    private readonly snapshots: ClassroomSnapshotService,
    private readonly canonicalRewards: StudentRewardService,
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
    await this.teacherRun(actor, runId, false);
    const points = dto.points ?? 0;
    const flowers = dto.flowerCount ?? 0;
    // Explicit intersection only: no rule expansion, growth conversion,
    // badge-id guessing, truncation or implicit category/reward defaults.
    if (dto.ruleId != null || dto.badgeDefinitionId != null || (dto.classGrowthValue ?? 0) !== 0 ||
        !dto.rewardType || !Object.values(RewardCategory).includes(dto.rewardType as unknown as RewardCategory) ||
        !Number.isInteger(points) || points < 0 || points > 20 ||
        !Number.isInteger(flowers) || flowers < 0 || flowers > 5 || (!points && !flowers) ||
        typeof dto.reason !== 'string' || !dto.reason.trim() || dto.reason.length > 200)
      return rejectLegacyWrite('engagement.award.unmappedFields');
    if (await this.rewards.existsBy({ teacherId: actor.sub, requestId: dto.requestId }))
      return rejectLegacyWrite('engagement.award.legacyRequest');
    const result = await this.canonicalRewards.createReward(actor, runId, {
      requestId: dto.requestId, studentId: dto.studentId,
      rewardCategory: dto.rewardType as unknown as RewardCategory,
      rewardForms: [...(points ? [RewardForm.Points] : []), ...(flowers ? [RewardForm.Flower] : [])],
      ...(flowers ? { stars: flowers } : {}), points, reason: dto.reason,
    });
    const record = withRecordIdentity(result.record, 'canonical', 'reward');
    return { ...record, flowerCount: record.stars, rewardType: record.rewardCategory,
      ...result, record };
  }

  async reverseReward(
    actor: JwtTeacherPayload,
    rewardId: number,
    dto: ReverseRewardDto,
  ) {
    this.requireTeacher(actor); void rewardId; void dto;
    return rejectLegacyWrite('engagement.reverseReward');
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
        ...withRecordIdentity(item, 'legacy_engagement', 'badge'),
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
    try {
      return await this.snapshots.transactionRequired(async manager => {
        const schoolClass = await manager.getRepository(SchoolClass).findOneBy({ id: classId });
        if (!schoolClass) throw new NotFoundException('班级不存在');
        if (actor.schoolId && schoolClass.schoolId && actor.schoolId !== schoolClass.schoolId)
          throw new ForbiddenException('无权访问其他园所数据');
        const administrator = this.access.isAdministrator(actor);
        if (!administrator && !await manager.getRepository(TeacherClass).existsBy({ teacherId: actor.sub, classId }))
          throw new ForbiddenException('无权访问该班级');
        // The revocation path does not share our queue. Keep authorization in
        // the INSERT itself too; a stale WAL read transaction cannot upgrade
        // to a writer after another connection has committed a revocation.
        const inserted: { id: number }[] = await manager.query(`
          INSERT INTO "collective_goal"
            (class_id, title, description, target_value, current_value, status, teacher_id, completed_at)
          SELECT c.id, ?, ?, ?, 0, ?, ?, NULL FROM "class" c
          WHERE c.id = ? AND (? IS NULL OR c.school_id IS NULL OR c.school_id = '' OR c.school_id = ?)
            AND (? = 1 OR EXISTS (SELECT 1 FROM teacher_class tc WHERE tc.class_id = c.id AND tc.teacher_id = ?))
          RETURNING id`, [dto.title.trim(), dto.description?.trim() || null, dto.targetValue,
          CollectiveGoalStatus.Active, actor.sub, classId, actor.schoolId || null, actor.schoolId || null,
          administrator ? 1 : 0, actor.sub]);
        if (!inserted.length) throw new ForbiddenException('无权访问该班级');
        return manager.getRepository(CollectiveGoal).findOneByOrFail({ id: inserted[0].id });
      });
    } catch (error) {
      const code = (error as { driverError?: { code?: string }; code?: string })?.driverError?.code ??
        (error as { code?: string })?.code;
      if (code?.startsWith('SQLITE_BUSY')) throw new ConflictException('班级授权或配置已变化，请刷新后重试');
      throw error;
    }
  }

  async adjustGrowth(
    actor: JwtTeacherPayload,
    classId: number,
    dto: AdjustClassGrowthDto,
  ) {
    this.requireTeacher(actor); await this.access.requireClassAccess(actor, classId); void dto;
    return rejectLegacyWrite('engagement.adjustGrowth');
  }

  async classGrowth(actor: JwtTeacherPayload, classId: number) {
    await this.access.requireClassAccess(actor, classId);
    const [records, goals] = await Promise.all([
      this.growth.find({ where: { classId }, order: { id: 'DESC' } }),
      this.goals.find({ where: { classId }, order: { id: 'DESC' } }),
    ]);
    return { currentValue: records[0]?.balanceAfter ?? 0,
      records: records.map(r => withRecordIdentity(r, 'legacy_engagement', 'growth')),
      goals: goals.map(r => withRecordIdentity(r, 'legacy_engagement', 'goal')) };
  }

  async suggestHonor(
    actor: JwtTeacherPayload,
    runId: number,
    dto: SuggestHonorDto,
  ) {
    await this.teacherRun(actor, runId, false); void dto;
    return rejectLegacyWrite('engagement.suggestHonor');
  }

  async publishHonor(
    actor: JwtTeacherPayload,
    honorId: number,
    dto: PublishHonorDto,
  ) {
    this.requireTeacher(actor); void honorId; void dto;
    return rejectLegacyWrite('engagement.publishHonor');
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

  async startBreak(actor: JwtTeacherPayload, runId: number, dto: StartBreakDto) {
    await this.teacherRun(actor, runId, false);
    const payload = { runId, deviceId: dto.deviceId, configId: dto.configId ?? null,
      type: dto.type ?? null, title: dto.title?.trim() ?? null, durationSeconds: dto.durationSeconds ?? null };
    const result = await this.snapshots.transactionRequired(async manager => {
      const run = await this.breakRunAccess(manager, actor, runId);
      if (run.deviceId !== dto.deviceId) throw new ForbiddenException('当前设备无课堂控制权');
      const replay = await this.readBreakReceipt(manager, actor, runId, dto.requestId, 'start', payload);
      if (replay) return manager.getRepository(BreakRun).findOneByOrFail({ id: replay.breakRunId, classroomRunId: runId });
      // Historical requests remain read-only. Do not manufacture an Event for an old row.
      const duplicate = await manager.getRepository(BreakRun).findOneBy({ teacherId: actor.sub, requestId: dto.requestId });
      if (duplicate) {
        if (duplicate.classroomRunId !== runId) throw new ConflictException('requestId 已用于其他课间');
        return duplicate;
      }
      if (![ClassroomRunStatus.Running, ClassroomRunStatus.Paused].includes(run.status))
        throw new ConflictException('只有运行或暂停中的课堂可以进入课间');
      if (run.version !== dto.version) throw new ConflictException('课堂版本冲突，请刷新后重试');
      if (run.breakStartedAt || run.breakEndsAt ||
          await manager.getRepository(BreakRun).existsBy({ classroomRunId: run.id, status: In([...ACTIVE_BREAK_STATUSES]) }))
        throw new ConflictException('当前课堂已经存在有效课间');
      const config = dto.configId ? await manager.getRepository(BreakConfig).findOneBy({
        id: dto.configId, classId: run.classId, enabled: true,
      }) : null;
      if (dto.configId && !config) throw new BadRequestException('课间配置不存在、已停用或不属于当前班级');
      const type = config?.type ?? dto.type;
      const title = config?.name ?? dto.title?.trim();
      const durationSeconds = config?.durationSeconds ?? dto.durationSeconds;
      if (!type || !title || !durationSeconds) throw new BadRequestException('未选择配置时必须提供课间类型、标题和时长');
      const now = new Date();
      const elapsedSeconds = run.status === ClassroomRunStatus.Running && run.resumedAt
        ? run.elapsedSeconds + Math.max(0, Math.floor((now.getTime() - run.resumedAt.getTime()) / 1000))
        : run.elapsedSeconds;
      const changed = await manager.getRepository(ClassroomRun).update({
        id: run.id, version: dto.version, status: run.status, deviceId: dto.deviceId, teacherId: actor.sub,
      }, { status: ClassroomRunStatus.Paused, elapsedSeconds, pausedAt: now, resumedAt: null, version: run.version + 1 });
      if (changed.affected !== 1) throw new ConflictException('课堂版本冲突，请刷新后重试');
      const repo = manager.getRepository(BreakRun);
      const saved = await repo.save(repo.create({ classroomRunId: run.id, classId: run.classId,
        configId: config?.id ?? null, type, title, durationSeconds, status: BreakRunStatus.Running,
        savedRunStatus: run.status, savedStepIndex: run.currentStepIndex, savedRunVersion: run.version,
        elapsedSeconds: 0, startedAt: now, resumedAt: now, pausedAt: null, endedAt: null,
        teacherId: actor.sub, requestId: dto.requestId, version: 1 }));
      await this.writeBreakReceipt(manager, actor, run, saved, dto.requestId, 'start', payload);
      await this.captureBreakRequired(manager, run, saved, ClassroomSnapshotReason.Timed);
      return saved;
    });
    return this.breakResponse(result);
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
    return this.mutateBreak(actor, id, dto, 'end');
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
    actor: JwtTeacherPayload, id: number, dto: BreakOperationDto, target: BreakRunStatus,
  ) {
    return this.mutateBreak(actor, id, dto, target === BreakRunStatus.Paused ? 'pause' : 'resume');
  }

  private async mutateBreak(
    actor: JwtTeacherPayload, id: number, dto: BreakOperationDto, operation: 'end' | 'pause' | 'resume',
  ) {
    this.requireTeacher(actor);
    const result = await this.snapshots.transactionRequired(async manager => {
      const repo = manager.getRepository(BreakRun);
      const current = await repo.findOneBy({ id });
      if (!current) throw new NotFoundException('课间运行不存在');
      const run = await this.breakRunAccess(manager, actor, current.classroomRunId);
      const payload = { breakRunId: id };
      const replay = await this.readBreakReceipt(manager, actor, run.id, dto.requestId, operation, payload);
      if (replay) return current;
      if (operation === 'end' && !ACTIVE_BREAK_STATUSES.includes(current.status as never)) return current;
      if (operation !== 'end' && TERMINAL_CLASSROOM_RUN_STATUSES.includes(run.status as never))
        throw new ConflictException('已结束课堂不能执行该操作');
      if (current.version !== dto.version) throw new ConflictException('课间版本冲突，请刷新后重试');
      if ((operation === 'pause' && current.status !== BreakRunStatus.Running) ||
          (operation === 'resume' && current.status !== BreakRunStatus.Paused))
        throw new ConflictException('课间状态冲突，请刷新后重试');
      const now = new Date();
      const next = { ...current, version: current.version + 1 };
      if (operation === 'end') {
        next.status = BreakRunStatus.Completed;
        next.elapsedSeconds = this.currentBreakElapsed(current, now);
        next.resumedAt = null;
        next.pausedAt = null;
        next.endedAt = now;
        const restoreStatus = current.savedRunStatus === ClassroomRunStatus.Running
          ? ClassroomRunStatus.Running : ClassroomRunStatus.Paused;
        const changed = !TERMINAL_CLASSROOM_RUN_STATUSES.includes(run.status as never)
          ? await manager.getRepository(ClassroomRun).update(
          { id: run.id, teacherId: actor.sub, version: run.version, status: run.status },
          { status: restoreStatus, currentStepIndex: current.savedStepIndex,
            pausedAt: restoreStatus === ClassroomRunStatus.Paused ? now : null,
            resumedAt: restoreStatus === ClassroomRunStatus.Running ? now : null, version: run.version + 1 },
        ) : { affected: 1 };
        if (changed.affected !== 1) throw new ConflictException('课堂版本冲突，请刷新后重试');
      } else {
        next.status = operation === 'pause' ? BreakRunStatus.Paused : BreakRunStatus.Running;
        next.elapsedSeconds = this.currentBreakElapsed(current, now);
        next.pausedAt = operation === 'pause' ? now : null;
        next.resumedAt = operation === 'resume' ? now : null;
      }
      const changed = await repo.update({ id, version: dto.version, status: current.status }, next);
      if (changed.affected !== 1) throw new ConflictException('课间版本冲突，请刷新后重试');
      await this.writeBreakReceipt(manager, actor, run, next, dto.requestId, operation, payload);
      await this.captureBreakRequired(manager, run, next,
        operation === 'end' ? ClassroomSnapshotReason.Recover : ClassroomSnapshotReason.Timed);
      return next;
    });
    return this.breakResponse(result);
  }

  private async breakRunAccess(manager: EntityManager, actor: JwtTeacherPayload, runId: number) {
    this.requireTeacher(actor);
    const run = await manager.getRepository(ClassroomRun).findOneBy({ id: runId });
    if (!run) throw new NotFoundException('课堂运行不存在');
    if (run.teacherId !== actor.sub) throw new ForbiddenException('无权操作其他教师的课堂');
    const schoolClass = await manager.getRepository(SchoolClass).findOneBy({ id: run.classId });
    if (!schoolClass) throw new NotFoundException('班级不存在');
    if (actor.schoolId && schoolClass.schoolId && actor.schoolId !== schoolClass.schoolId)
      throw new ForbiddenException('无权访问其他园所数据');
    if (!this.access.isAdministrator(actor) && !await manager.getRepository(TeacherClass).existsBy({
      teacherId: actor.sub, classId: run.classId,
    })) throw new ForbiddenException('无权访问该班级');
    return run;
  }

  private breakDigest(operation: string, payload: Record<string, unknown>) {
    return createHash('sha256').update(JSON.stringify({ operation, payload })).digest('hex');
  }

  private async readBreakReceipt(
    manager: EntityManager, actor: JwtTeacherPayload, runId: number, requestId: string,
    operation: string, payload: Record<string, unknown>,
  ): Promise<{ breakRunId: number } | null> {
    const event = await manager.getRepository(ClassroomEvent).findOneBy({
      operatorType: actor.userType, operatorId: actor.sub, requestId,
    });
    if (!event) return null;
    const receipt = this.parseObject(event.payload ?? '');
    if (event.classroomRunId !== runId || event.result !== ClassroomEventResult.Success ||
        receipt.kind !== 'legacy_break_control' || receipt.contractVersion !== 1 ||
        receipt.operation !== operation || receipt.payloadDigest !== this.breakDigest(operation, payload) ||
        typeof receipt.breakRunId !== 'number')
      throw new ConflictException('requestId 已用于不同业务请求');
    return { breakRunId: receipt.breakRunId };
  }

  private async writeBreakReceipt(
    manager: EntityManager, actor: JwtTeacherPayload, run: ClassroomRun, breakRun: BreakRun,
    requestId: string, operation: string, payload: Record<string, unknown>,
  ) {
    const repo = manager.getRepository(ClassroomEvent);
    await repo.save(repo.create({
      classroomRunId: run.id, operatorType: actor.userType, operatorId: actor.sub,
      deviceId: run.deviceId, requestId, result: ClassroomEventResult.Success,
      eventType: operation === 'start' ? ClassroomEventType.BreakStart
        : operation === 'end' ? ClassroomEventType.BreakEnd : ClassroomEventType.Command,
      payload: JSON.stringify({ kind: 'legacy_break_control', contractVersion: 1,
        operation, payloadDigest: this.breakDigest(operation, payload), breakRunId: breakRun.id }),
    }));
  }

  private async captureBreakRequired(
    manager: EntityManager, run: ClassroomRun, breakRun: BreakRun, reason: ClassroomSnapshotReason,
  ) {
    const previous = await this.snapshots.loadLatestValid(run.id, manager);
    await this.snapshots.captureRequired(run.id, reason, true, {
      interactionState: { ...previous?.interactionState, breakRunId: breakRun.id,
        breakStatus: breakRun.status, savedStepIndex: breakRun.savedStepIndex,
        savedRunStatus: breakRun.savedRunStatus,
        ...(breakRun.status === BreakRunStatus.Completed ? { restoredStepIndex: breakRun.savedStepIndex } : {}) },
    }, manager);
  }







  private async rewardResponse(reward: RewardRecord) {
    const [reversal, badge] = await Promise.all([
      this.reversals.findOne({ where: { rewardRecordId: reward.id } }),
      this.studentBadges.findOne({ where: { rewardRecordId: reward.id } }),
    ]);
    return { ...withRecordIdentity(reward, 'legacy_engagement', 'reward'),
      badge: badge ? withRecordIdentity(badge, 'legacy_engagement', 'badge') : null,
      reversal: reversal ? withRecordIdentity(reversal, 'legacy_engagement', 'reward_reversal') : null };
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
      ...withRecordIdentity(honor, 'legacy_engagement', 'honor'),
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
