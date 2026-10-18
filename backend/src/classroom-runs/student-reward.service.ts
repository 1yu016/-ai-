import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { withRecordIdentity } from './legacy-write-boundary';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { AuthUserType } from '../auth/entities/refresh-token-session.entity';
import { Teacher } from '../auth/entities/teacher.entity';
import { Student } from '../platform/entities/student.entity';
import { TeacherClass } from '../platform/entities/teacher-class.entity';
import { SchoolClass } from '../platform/entities/school-class.entity';
import { RecordStatus } from '../platform/platform.types';
import { ClassroomBusinessReceiptService, type RewardOperation } from './classroom-business-receipt.service';
import { assertRunOperation } from './classroom-operation-context';
import type { ClassroomSnapshotPatch } from './classroom-snapshot.service';
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
    private readonly receipts: ClassroomBusinessReceiptService,
  ) {}

  /** Canonical record + immutable receipt + required projection in one transaction. */
  async createReward(actor: JwtTeacherPayload, runId: number, dto: CreateClassroomRewardDto) {
    const normalized = this.normalizeReward(dto);
    const reason = dto.reason?.trim() ? this.assertSafeText(dto.reason.trim(), '奖励原因') : null;
    const payload = { studentId: dto.studentId, ...normalized, reason };
    return this.writeReward(actor, runId, dto.requestId, 'reward.create', payload, dto.version,
      async (manager, run) => {
        const repo = manager.getRepository(StudentRewardRecord);
        if (await repo.existsBy({ classroomRunId: runId, requestId: dto.requestId }))
          throw new ConflictException('LEGACY_REQUEST_UNVERIFIABLE');
        const student = await manager.getRepository(Student).findOneBy({ id: dto.studentId });
        if (!student) throw new NotFoundException('学生不存在');
        if (student.classId !== run.classId) throw new ForbiddenException('学生不属于本课堂班级');
        if (student.status !== RecordStatus.Active) throw new ConflictException('学生已停用');
        const record = await repo.save(repo.create({
          ...normalized, rewardForms: JSON.stringify(normalized.rewardForms), reason,
          studentId: student.id, classId: run.classId, classroomRunId: run.id,
          teacherId: actor.sub, rewardType: 'flower', requestId: dto.requestId,
          createdAt: await this.rewardTimestamp(manager, run.classId),
        }));
        await this.recalculateCurrentGoal(manager, run.classId);
        const view = this.serialize(record, student, run, await this.findTeacher(manager, actor.sub));
        return { ids: [record.id], presentation: {
          recordId: record.id, studentId: student.id, displayName: student.nickname || student.name,
          rewardCategory: record.rewardCategory, rewardForms: normalized.rewardForms, points: record.points,
          stars: record.stars, badgeCode: record.badgeCode, praiseText: record.praiseText,
          animationKey: record.animationKey, createdAt: record.createdAt.toISOString(),
        }, finish: (rewardState: Record<string, number>) => ({
          record: view, rewardState, studentTotal: rewardState[student.id] ?? 0,
        }) };
      });
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
        withRecordIdentity(this.serialize(r, studentMap.get(r.studentId), run, teacherMap.get(r.teacherId)), 'canonical', 'reward'),
      ),
      total: records.length,
      runTitle: run.title,
    };
  }

  /** Revoke the original canonical record; current student membership is irrelevant. */
  async revokeReward(actor: JwtTeacherPayload, runId: number, rewardRecordId: number,
    requestId: string, reason?: string, expectedVersion?: number) {
    const normalizedReason = reason?.trim() ? this.assertSafeText(reason.trim(), '撤销原因') : null;
    return this.writeReward(actor, runId, requestId, 'reward.revoke',
      { rewardRecordId, reason: normalizedReason }, expectedVersion, async (manager, run) => {
        const repo = manager.getRepository(StudentRewardRecord);
        const record = await repo.findOneBy({ id: rewardRecordId, classroomRunId: runId });
        if (!record) throw new NotFoundException('奖励记录不存在');
        if (record.revokedAt) throw new ConflictException('该奖励已经撤销或旧请求不可验证');
        record.revokedAt = new Date(); record.revokedByTeacherId = actor.sub;
        record.revokeRequestId = requestId; record.revokeReason = normalizedReason;
        await repo.save(record);
        await this.recalculateCurrentGoal(manager, run.classId);
        const student = await manager.getRepository(Student).findOneBy({ id: record.studentId });
        const view = this.serialize(record, student, run, await this.findTeacher(manager, record.teacherId));
        return { ids: [record.id], clearRewardId: record.id,
          finish: (rewardState: Record<string, number>) => ({
            record: view, rewardState, studentTotal: rewardState[record.studentId] ?? 0,
          }) };
      });
  }

  private async writeReward<T extends Record<string, unknown>>(
    actor: JwtTeacherPayload, runId: number, requestId: string, operation: RewardOperation,
    payload: Record<string, unknown>, expectedVersion: number | undefined,
    work: (manager: EntityManager, run: ClassroomRun) => Promise<{
      ids: number[]; finish: (state: Record<string, number>) => T;
      presentation?: Record<string, unknown>; clearRewardId?: number;
    }>,
  ): Promise<T & { committedRunVersion: number }> {
    this.requireTeacher(actor);
    if (!requestId?.length || requestId.length > 100) throw new ConflictException('业务请求标识非法');
    const digest = this.receipts.digest(runId, operation, payload);
    try {
      return await this.snapshotService.transactionRequired(async manager => {
        const repo = manager.getRepository(ClassroomRun);
        const run = await this.requireRewardAccess(manager, actor, runId);
        const replay = await this.receipts.read(manager, actor, runId, requestId, operation, digest);
        if (replay) return replay.result as T & { committedRunVersion: number };
        this.assertActive(run);
        if (expectedVersion !== undefined && run.version !== expectedVersion) throw new ConflictException('课堂版本冲突');
        await assertRunOperation(run, manager, this.snapshotService,
          operation === 'collective_reward.revoke' ? 'collective_reward_revoke'
            : operation === 'reward.revoke' ? 'reward_revoke' : 'reward');
        const changed = await repo.update({ id: runId, version: expectedVersion ?? run.version,
          status: run.status, teacherId: actor.sub }, { version: run.version + 1 });
        if (changed.affected !== 1) throw new ConflictException('课堂版本冲突');
        run.version += 1;
        const written = await work(manager, run);
        const projection = await this.rewardProjection(manager, runId, written.presentation, written.clearRewardId);
        const result = JSON.parse(JSON.stringify({ ...written.finish(projection.rewardState),
          committedRunVersion: run.version })) as T & { committedRunVersion: number };
        await this.receipts.write(manager, actor, run.deviceId, {
          kind: 'classroom_business_receipt', contractVersion: 1, normalizationVersion: 1,
          originalRequestId: requestId, operation, runId, payloadDigest: digest,
          businessRecordIds: written.ids, committedRunVersion: run.version, result,
        });
        await this.snapshotService.captureBusinessRequired(runId, ClassroomSnapshotReason.Reward, false,
          'reward', { interactionState: projection.patch.interactionState }, manager);
        return result;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) throw new ConflictException('奖励请求或撤销标识已被使用');
      throw error;
    }
  }

  private async rewardProjection(manager: EntityManager, runId: number,
    presentation?: Record<string, unknown>, clearRewardId?: number) {
    const records = await manager.getRepository(StudentRewardRecord).find({
      where: { classroomRunId: runId }, order: { id: 'ASC' },
    });
    const rewardState: Record<string, number> = {};
    for (const record of records) rewardState[record.studentId] =
      (rewardState[record.studentId] ?? 0) + (record.revokedAt ? 0 : record.stars);
    const previous = await this.snapshotService.loadLatestValid(runId, manager);
    const interactionState = { ...previous?.interactionState };
    const old = interactionState.rewardPresentation as Record<string, unknown> | undefined;
    if (old) {
      const formal = records.find(r => r.id === old.recordId && !r.revokedAt && r.id !== clearRewardId);
      if (!formal) delete interactionState.rewardPresentation;
      else {
        const student = await manager.getRepository(Student).findOneBy({ id: formal.studentId });
        interactionState.rewardPresentation = {
          recordId: formal.id, studentId: formal.studentId, displayName: student?.nickname || student?.name || '',
          rewardCategory: formal.rewardCategory, rewardForms: this.parseForms(formal.rewardForms),
          points: formal.points, stars: formal.stars, badgeCode: formal.badgeCode, praiseText: formal.praiseText,
          animationKey: formal.animationKey, createdAt: formal.createdAt.toISOString(),
        };
      }
    }
    if (presentation) interactionState.rewardPresentation = presentation;
    const collective = await manager.getRepository(ClassCollectiveRewardRecord).find({
      where: { classroomRunId: runId }, order: { id: 'ASC' },
    });
    interactionState.collectiveRewardState = {
      recordIds: collective.filter(r => !r.revokedAt).map(r => r.id),
      points: collective.reduce((sum, r) => sum + (r.revokedAt ? 0 : r.points), 0),
    };
    const collectivePresentation = interactionState.collectiveRewardPresentation as Record<string, unknown> | undefined;
    if (collectivePresentation) {
      const formal = collective.find(r => r.id === collectivePresentation.recordId && !r.revokedAt);
      if (!formal) delete interactionState.collectiveRewardPresentation;
      else interactionState.collectiveRewardPresentation = { recordId: formal.id,
        points: formal.points, rewardCategory: formal.rewardCategory, reason: formal.reason };
    }
    return { rewardState, patch: { rewardState, interactionState } as ClassroomSnapshotPatch };
  }

  /** Read-only replay guard; unlike Run.get(), this never settles a timed break. */
  async assertRewardReceiptAccess(actor: JwtTeacherPayload, runId: number) {
    await this.requireRewardAccess(this.runs.manager, actor, runId);
  }

  async readCommandReceipt(actor: JwtTeacherPayload, runId: number, requestId: string,
    dto: Omit<CreateClassroomRewardDto, 'studentId'> & { studentId?: number }) {
    await this.assertRewardReceiptAccess(actor, runId);
    const receipt = await this.receipts.findCommitted(this.runs.manager, actor, runId, requestId, 'reward.create');
    if (!receipt) return null;
    // A name-based command must replay its original resolved identity, not resolve today's roster.
    const studentId = dto.studentId ?? (receipt.result.record as { studentId?: number })?.studentId;
    if (!Number.isSafeInteger(studentId) || Number(studentId) < 1) throw new ConflictException('奖励回执身份无效');
    const normalized = this.normalizeReward({ ...dto, studentId: studentId! });
    const reason = dto.reason?.trim() ? this.assertSafeText(dto.reason.trim(), '奖励原因') : null;
    return this.receipts.read(this.runs.manager, actor, runId, requestId, 'reward.create',
      this.receipts.digest(runId, 'reward.create', { studentId, ...normalized, reason }));
  }

  async readRevokeCommandReceipt(actor: JwtTeacherPayload, runId: number, requestId: string,
    rewardRecordId: number, reason?: string) {
    await this.assertRewardReceiptAccess(actor, runId);
    const normalizedReason = reason?.trim() ? this.assertSafeText(reason.trim(), '撤销原因') : null;
    return this.receipts.read(this.runs.manager, actor, runId, requestId, 'reward.revoke',
      this.receipts.digest(runId, 'reward.revoke', { rewardRecordId, reason: normalizedReason }));
  }

  private async requireRewardAccess(manager: EntityManager, actor: JwtTeacherPayload, runId: number) {
    this.requireTeacher(actor);
    const run = await manager.getRepository(ClassroomRun).findOneBy({ id: runId });
    if (!run) throw new NotFoundException('课堂运行不存在');
    if (run.teacherId !== actor.sub) throw new ForbiddenException('无权操作其他教师的课堂');
    const schoolClass = await manager.getRepository(SchoolClass).findOneBy({ id: run.classId });
    const relation = await manager.getRepository(TeacherClass).existsBy({ teacherId: actor.sub, classId: run.classId });
    if (!schoolClass || !relation || (actor.schoolId && schoolClass.schoolId && actor.schoolId !== schoolClass.schoolId))
      throw new ForbiddenException('无权访问本课堂班级');
    return run;
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
    return this.snapshotService.transactionRequired(async (manager) => {
      // complete/transition uses this same snapshot write queue. Re-read only
      // after acquiring it, using the transaction manager for all access checks.
      const current = await this.requireRewardAccess(manager, actor, runId);
      this.assertActive(current);
      const repository = manager.getRepository(ClassGrowthGoal);
      const active = await repository.findOne({
        where: { classId: current.classId, status: GrowthGoalStatus.Active },
      });
      if (active) {
        active.status = GrowthGoalStatus.Archived;
        await repository.save(active);
      }
      return repository.save(repository.create({
        classId: current.classId,
        title,
        targetPoints: dto.targetPoints,
        currentPoints: 0,
        status: GrowthGoalStatus.Active,
        createdByTeacherId: actor.sub,
        createdAt: await this.rewardTimestamp(manager, current.classId, true),
        completedAt: null,
      }));
    });
  }

  async createCollectiveReward(actor: JwtTeacherPayload, runId: number, dto: CreateCollectiveRewardDto) {
    const reason = this.assertSafeText(dto.reason.trim(), '集体奖励原因');
    return this.writeReward(actor, runId, dto.requestId, 'collective_reward.create',
      { rewardCategory: dto.rewardCategory, points: dto.points, reason, goalId: dto.goalId ?? null },
      dto.version, async (manager, run) => {
        const repo = manager.getRepository(ClassCollectiveRewardRecord);
        if (await repo.existsBy({ classroomRunId: runId, requestId: dto.requestId }))
          throw new ConflictException('LEGACY_REQUEST_UNVERIFIABLE');
        if (dto.goalId) {
          const goal = await manager.getRepository(ClassGrowthGoal).findOneBy({ id: dto.goalId, classId: run.classId });
          if (!goal) throw new ForbiddenException('共同目标不属于本课堂班级');
          if (goal.status === GrowthGoalStatus.Archived) throw new ConflictException('共同目标已归档');
          const current = await manager.getRepository(ClassGrowthGoal).findOne({ where: { classId: run.classId }, order: { createdAt: 'DESC', id: 'DESC' } });
          if (current?.id !== goal.id) throw new ConflictException('共同目标不是当前目标');
        }
        const record = await repo.save(repo.create({ classroomRunId: runId, classId: run.classId,
          teacherId: actor.sub, goalId: dto.goalId ?? null, rewardCategory: dto.rewardCategory,
          points: dto.points, reason, requestId: dto.requestId,
          createdAt: await this.rewardTimestamp(manager, run.classId) }));
        await this.recalculateCurrentGoal(manager, run.classId);
        return { ids: [record.id], finish: () => ({ ...record }) };
      });
  }

  async revokeCollectiveReward(actor: JwtTeacherPayload, runId: number, recordId: number,
    requestId: string, reason: string, expectedVersion?: number) {
    const normalizedReason = this.assertSafeText(reason.trim(), '撤销原因');
    return this.writeReward(actor, runId, requestId, 'collective_reward.revoke',
      { recordId, reason: normalizedReason }, expectedVersion, async (manager, run) => {
        const repo = manager.getRepository(ClassCollectiveRewardRecord);
        const record = await repo.findOneBy({ id: recordId, classroomRunId: runId });
        if (!record) throw new NotFoundException('集体奖励记录不存在');
        if (record.revokedAt) throw new ConflictException('该集体奖励已撤销或旧请求不可验证');
        record.revokedAt = new Date(); record.revokedByTeacherId = actor.sub;
        record.revokeRequestId = requestId; record.revokeReason = normalizedReason;
        await repo.save(record);
        await this.recalculateCurrentGoal(manager, run.classId);
        return { ids: [record.id], finish: () => ({ ...record }) };
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
      collectiveRewards: collectiveRecords.map(r => withRecordIdentity(r, 'canonical', 'collective_reward')),
      policy: { negativeRankingEnabled: false, rotation: 'daily_category_rotation' },
    };
  }

  private normalizeReward(dto: CreateClassroomRewardDto) {
    const rewardCategory = dto.rewardCategory ?? RewardCategory.Progress;
    const rewardForms = dto.rewardForms?.length ? [...dto.rewardForms].sort() : [RewardForm.Flower];
    if (!Object.values(RewardCategory).includes(rewardCategory) || rewardForms.length > 5 ||
        new Set(rewardForms).size !== rewardForms.length || rewardForms.some(f => !Object.values(RewardForm).includes(f)) ||
        (dto.stars !== undefined && (!Number.isInteger(dto.stars) || dto.stars < 1 || dto.stars > 5)) ||
        (dto.points !== undefined && (!Number.isInteger(dto.points) || dto.points < 0 || dto.points > 20)))
      throw new ConflictException('奖励参数非法');
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

  /** Explicit millisecond timestamps avoid SQLite datetime() second-boundary loss. */
  private async rewardTimestamp(manager: EntityManager, classId: number, newGoal = false) {
    const goals = manager.getRepository(ClassGrowthGoal);
    const latest = await goals.findOne({ where: { classId }, order: { createdAt: 'DESC', id: 'DESC' } });
    let time = Math.max(Date.now(), latest?.createdAt.getTime() ?? 0);
    if (newGoal) {
      const [personal, collective] = await Promise.all([
        manager.getRepository(StudentRewardRecord).findOne({ where: { classId }, order: { createdAt: 'DESC', id: 'DESC' } }),
        manager.getRepository(ClassCollectiveRewardRecord).findOne({ where: { classId }, order: { createdAt: 'DESC', id: 'DESC' } }),
      ]);
      time = Math.max(time, (personal?.createdAt.getTime() ?? 0) + 1,
        (collective?.createdAt.getTime() ?? 0) + 1, (latest?.createdAt.getTime() ?? 0) + 1);
    }
    return new Date(time);
  }

  /** Growth values are projections too: rebuild canonical windows, including a revoked prior goal. */
  private async recalculateCurrentGoal(manager: EntityManager, classId: number) {
    const repo = manager.getRepository(ClassGrowthGoal);
    const goals = await repo.find({ where: { classId }, order: { createdAt: 'ASC', id: 'ASC' } });
    if (!goals.length) return;
    const personal = await manager.getRepository(StudentRewardRecord).find({ where: { classId } });
    const collective = await manager.getRepository(ClassCollectiveRewardRecord).find({ where: { classId } });
    for (let index = 0; index < goals.length; index++) {
      const goal = goals[index];
      const start = goal.createdAt.getTime();
      const end = goals[index + 1]?.createdAt.getTime() ?? Infinity;
      const within = (date: Date) => date.getTime() >= start && date.getTime() < end;
      const total = personal.reduce((sum, r) => sum + (!r.revokedAt && within(r.createdAt) ? r.points : 0), 0) +
        collective.reduce((sum, r) => sum + (!r.revokedAt &&
          (r.goalId === goal.id || (r.goalId === null && within(r.createdAt))) ? r.points : 0), 0);
      const points = Math.min(goal.targetPoints, total);
      // Historical/archived goals never become a second current active target.
      const status = goal.status === GrowthGoalStatus.Archived ? goal.status :
        index < goals.length - 1 && points !== goal.currentPoints ? GrowthGoalStatus.Archived :
        points >= goal.targetPoints ? GrowthGoalStatus.Completed : GrowthGoalStatus.Active;
      const completedAt = points >= goal.targetPoints ? goal.completedAt ?? new Date() : null;
      if (goal.currentPoints !== points || goal.status !== status ||
          (goal.completedAt?.getTime() ?? null) !== (completedAt?.getTime() ?? null)) {
        goal.currentPoints = points; goal.status = status; goal.completedAt = completedAt;
        await repo.save(goal);
      }
    }
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
