import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { TeacherRole } from '../auth/entities/teacher.entity';
import { ResourceReference } from '../resources/entities/resource-reference.entity';
import { ResourceService } from '../resources/resource.service';
import {
  AddLessonStepDto,
  AiLessonPlanDraftOutputDto,
  AiLessonPlanDraftRequestDto,
  ConfirmAiLessonDraftDto,
  CreateLessonPlanDto,
  DeleteLessonStepDto,
  LessonStepDto,
  ListLessonPlansQueryDto,
  ReorderLessonStepsDto,
  SaveLessonStepsDto,
  UpdateLessonPlanDto,
  UpdateLessonRunProgressDto,
  UpdateLessonStepDto,
} from './dto/lesson-plan.dto';
import { LessonAiDraft } from './entities/lesson-ai-draft.entity';
import { LessonPlanVersion } from './entities/lesson-plan-version.entity';
import { LessonPlan } from './entities/lesson-plan.entity';
import { LessonRecoveryPoint } from './entities/lesson-recovery-point.entity';
import { LessonRun } from './entities/lesson-run.entity';
import { LessonStepAction } from './entities/lesson-step-action.entity';
import { LessonStep } from './entities/lesson-step.entity';
import { LessonPlanAiService } from './lesson-plan-ai.service';
import {
  LessonAiDraftStatus,
  LessonPlanStatus,
  LessonPlanType,
  LessonRunStatus,
  LessonStepActionType,
  LessonStepType,
  type LessonStepSnapshot,
} from './lesson-plan.types';

const ALLOWED_ACTION_NAMES: Readonly<
  Record<LessonStepActionType, Set<string>>
> = {
  [LessonStepActionType.AvatarAction]: new Set([
    'wave',
    'nod',
    'clap',
    'point',
    'think',
    'celebrate',
    'idle',
  ]),
  [LessonStepActionType.VoiceInstruction]: new Set(['speak']),
  [LessonStepActionType.Reward]: new Set(['flower', 'star', 'applause']),
  [LessonStepActionType.RollCall]: new Set(['random', 'specific']),
};
const UNSAFE_ACTION_CONTENT =
  /(?:javascript:|https?:\/\/|<\/?script|\bfunction\s*\(|=>|window\.|document\.)/i;

type HydratedStep = LessonStep & {
  actions: LessonStepAction[];
  recoveryPoint: LessonRecoveryPoint | null;
};

@Injectable()
export class LessonPlanService {
  constructor(
    @InjectRepository(LessonPlan)
    private readonly plans: Repository<LessonPlan>,
    @InjectRepository(LessonStep)
    private readonly steps: Repository<LessonStep>,
    @InjectRepository(LessonRun) private readonly runs: Repository<LessonRun>,
    @InjectRepository(LessonPlanVersion)
    private readonly versions: Repository<LessonPlanVersion>,
    @InjectRepository(LessonRecoveryPoint)
    private readonly recoveryPoints: Repository<LessonRecoveryPoint>,
    @InjectRepository(LessonStepAction)
    private readonly actions: Repository<LessonStepAction>,
    @InjectRepository(LessonAiDraft)
    private readonly aiDrafts: Repository<LessonAiDraft>,
    private readonly dataSource: DataSource,
    private readonly resources: ResourceService,
    private readonly lessonAi: LessonPlanAiService,
  ) {}

  async create(actor: JwtTeacherPayload, dto: CreateLessonPlanDto) {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(LessonPlan);
      let plan = await repository.save(
        repository.create({
          teacherId: actor.sub,
          schoolId: actor.schoolId ?? null,
          title: dto.title.trim(),
          theme: dto.theme.trim(),
          lessonType: dto.lessonType ?? LessonPlanType.Normal,
          ageGroup: dto.ageGroup,
          domain: dto.domain?.trim() || null,
          objectives: dto.objectives.trim(),
          estimatedMinutes: dto.estimatedMinutes,
          status: dto.status ?? LessonPlanStatus.Draft,
          version: 1,
          currentVersionId: null,
          outlineJson: null,
          deletedAt: null,
        }),
      );
      const version = await this.createVersion(
        manager,
        plan,
        actor,
        '创建教案',
      );
      plan.currentVersionId = version.id;
      plan = await repository.save(plan);
      return plan;
    });
  }

  async list(actor: JwtTeacherPayload, query: ListLessonPlansQueryDto) {
    const builder = this.plans
      .createQueryBuilder('plan')
      .where('plan.deleted_at IS NULL');
    if (actor.role !== TeacherRole.Admin)
      builder.andWhere('plan.teacher_id = :teacherId', {
        teacherId: actor.sub,
      });
    if (query.keyword?.trim())
      builder.andWhere(
        '(plan.title LIKE :keyword OR plan.theme LIKE :keyword)',
        { keyword: `%${this.escapeLike(query.keyword.trim())}%` },
      );
    if (query.ageGroup)
      builder.andWhere('plan.age_group = :ageGroup', {
        ageGroup: query.ageGroup,
      });
    if (query.status)
      builder.andWhere('plan.status = :status', { status: query.status });
    if (query.lessonType)
      builder.andWhere('plan.lesson_type = :lessonType', {
        lessonType: query.lessonType,
      });
    if (query.domain)
      builder.andWhere('plan.domain = :domain', { domain: query.domain });
    const [items, total] = await builder
      .orderBy('plan.updated_at', 'DESC')
      .addOrderBy('plan.id', 'DESC')
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize)
      .getManyAndCount();
    if (items.length) {
      const counts = await this.steps
        .createQueryBuilder('step')
        .select('step.lesson_plan_id', 'lessonPlanId')
        .addSelect('COUNT(step.id)', 'stepCount')
        .where('step.lesson_plan_id IN (:...ids)', {
          ids: items.map((item) => item.id),
        })
        .groupBy('step.lesson_plan_id')
        .getRawMany<{
          lessonPlanId: number | string;
          stepCount: number | string;
        }>();
      const countsByPlan = new Map(
        counts.map((row) => [Number(row.lessonPlanId), Number(row.stepCount)]),
      );
      for (const item of items) item.stepCount = countsByPlan.get(item.id) ?? 0;
    }
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async get(actor: JwtTeacherPayload, id: number) {
    const plan = await this.ownedPlan(actor, id);
    plan.steps = (await this.loadSteps(id)) as LessonStep[];
    return plan;
  }

  async listVersions(actor: JwtTeacherPayload, id: number) {
    await this.ownedPlan(actor, id);
    return this.versions.find({
      where: { lessonPlanId: id },
      order: { versionNo: 'DESC' },
    });
  }

  async update(actor: JwtTeacherPayload, id: number, dto: UpdateLessonPlanDto) {
    await this.ownedPlan(actor, id);
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(LessonPlan);
      const updates: Partial<LessonPlan> = { version: dto.version + 1 };
      if (dto.title !== undefined) updates.title = dto.title.trim();
      if (dto.theme !== undefined) updates.theme = dto.theme.trim();
      if (dto.lessonType !== undefined) updates.lessonType = dto.lessonType;
      if (dto.ageGroup !== undefined) updates.ageGroup = dto.ageGroup;
      if (dto.domain !== undefined) updates.domain = dto.domain.trim() || null;
      if (dto.objectives !== undefined)
        updates.objectives = dto.objectives.trim();
      if (dto.estimatedMinutes !== undefined)
        updates.estimatedMinutes = dto.estimatedMinutes;
      if (dto.status !== undefined) updates.status = dto.status;
      const result = await repo.update(
        { id, version: dto.version, deletedAt: IsNull() },
        updates,
      );
      if (result.affected !== 1) throw this.versionConflict();
      const plan = await repo.findOneByOrFail({ id });
      const version = await this.createVersion(
        manager,
        plan,
        actor,
        dto.changeSummary?.trim() || '更新教案信息',
      );
      plan.currentVersionId = version.id;
      return repo.save(plan);
    });
  }

  async remove(actor: JwtTeacherPayload, id: number) {
    const plan = await this.ownedPlan(actor, id);
    await this.dataSource.transaction(async (manager) => {
      plan.deletedAt = new Date();
      plan.status = LessonPlanStatus.Archived;
      plan.version += 1;
      await manager.getRepository(LessonPlan).save(plan);
      await manager.getRepository(ResourceReference).delete({
        referenceType: 'lesson_plan',
        referenceId: String(id),
      });
    });
  }

  async copy(actor: JwtTeacherPayload, id: number) {
    const source = await this.get(actor, id);
    const copied = await this.create(actor, {
      title: `${source.title}（副本）`,
      theme: source.theme,
      lessonType: source.lessonType,
      ageGroup: source.ageGroup,
      domain: source.domain ?? undefined,
      objectives: source.objectives,
      estimatedMinutes: source.estimatedMinutes,
      status: LessonPlanStatus.Draft,
    });
    if (source.steps.length)
      await this.saveSteps(actor, copied.id, {
        version: copied.version,
        changeSummary: '复制教案步骤',
        steps: source.steps.map((step) => this.stepToDto(step as HydratedStep)),
      });
    return this.get(actor, copied.id);
  }

  async saveSteps(
    actor: JwtTeacherPayload,
    id: number,
    dto: SaveLessonStepsDto,
  ) {
    await this.ownedPlan(actor, id);
    this.validateStepDefinitions(dto.steps);
    await this.validateStepResources(actor, dto.steps);
    return this.dataSource.transaction(async (manager) => {
      const planRepo = manager.getRepository(LessonPlan);
      const current = await planRepo.findOneBy({
        id,
        version: dto.version,
        deletedAt: IsNull(),
      });
      if (!current) throw this.versionConflict();
      const oldSteps = await manager
        .getRepository(LessonStep)
        .find({ where: { lessonPlanId: id } });
      const oldStepIds = oldSteps.map((step) => step.id);
      if (oldStepIds.length) {
        await manager
          .getRepository(LessonStepAction)
          .delete({ stepId: In(oldStepIds) });
        await manager
          .getRepository(LessonRecoveryPoint)
          .delete({ stepId: In(oldStepIds) });
      }
      await manager.getRepository(LessonStep).delete({ lessonPlanId: id });
      await manager.getRepository(ResourceReference).delete({
        referenceType: 'lesson_plan',
        referenceId: String(id),
      });
      const savedSteps: LessonStep[] = [];
      for (let index = 0; index < dto.steps.length; index += 1) {
        const input = dto.steps[index];
        const content = (input.content ?? input.instruction ?? '').trim();
        const step = await manager.getRepository(LessonStep).save(
          manager.getRepository(LessonStep).create({
            lessonPlanId: id,
            sortOrder: index + 1,
            title: input.title.trim(),
            stepType: input.stepType,
            content,
            instruction: content,
            expectedResponse: input.expectedResponse?.trim() || null,
            teacherTip: input.teacherTip?.trim() || null,
            resourceId: input.resourceId ?? null,
            durationSeconds: input.durationSeconds,
          }),
        );
        savedSteps.push(step);
        await this.saveStepConfiguration(manager, current.id, step, input);
      }
      await this.syncResourceReferences(manager, actor, id, dto.steps);
      current.version += 1;
      await planRepo.save(current);
      const version = await this.createVersion(
        manager,
        current,
        actor,
        dto.changeSummary?.trim() || '批量保存步骤',
      );
      current.currentVersionId = version.id;
      await planRepo.save(current);
      return {
        version: current.version,
        steps: await this.loadSteps(id, manager),
      };
    });
  }

  async addStep(actor: JwtTeacherPayload, id: number, dto: AddLessonStepDto) {
    const plan = await this.get(actor, id);
    const { version, ...step } = dto;
    return this.saveSteps(actor, id, {
      version,
      changeSummary: '新增步骤',
      steps: [
        ...plan.steps.map((item) => this.stepToDto(item as HydratedStep)),
        step,
      ],
    });
  }

  async updateStep(
    actor: JwtTeacherPayload,
    planId: number,
    stepId: number,
    dto: UpdateLessonStepDto,
  ) {
    const plan = await this.get(actor, planId);
    const index = plan.steps.findIndex((step) => step.id === stepId);
    if (index < 0) throw new NotFoundException('教案步骤不存在');
    const current = this.stepToDto(plan.steps[index] as HydratedStep);
    const { version, ...updates } = dto;
    const steps = plan.steps.map((step, position) =>
      position === index
        ? ({ ...current, ...updates } as LessonStepDto)
        : this.stepToDto(step as HydratedStep),
    );
    return this.saveSteps(actor, planId, {
      version,
      changeSummary: '编辑步骤',
      steps,
    });
  }

  async deleteStep(
    actor: JwtTeacherPayload,
    planId: number,
    stepId: number,
    dto: DeleteLessonStepDto,
  ) {
    const plan = await this.get(actor, planId);
    if (!plan.steps.some((step) => step.id === stepId))
      throw new NotFoundException('教案步骤不存在');
    return this.saveSteps(actor, planId, {
      version: dto.version,
      changeSummary: '删除步骤',
      steps: plan.steps
        .filter((step) => step.id !== stepId)
        .map((step) => this.stepToDto(step as HydratedStep)),
    });
  }

  async copyStep(
    actor: JwtTeacherPayload,
    planId: number,
    stepId: number,
    dto: DeleteLessonStepDto,
  ) {
    const plan = await this.get(actor, planId);
    const index = plan.steps.findIndex((step) => step.id === stepId);
    if (index < 0) throw new NotFoundException('教案步骤不存在');
    const steps = plan.steps.map((step) =>
      this.stepToDto(step as HydratedStep),
    );
    const copy = { ...steps[index], title: `${steps[index].title}（副本）` };
    steps.splice(index + 1, 0, copy);
    return this.saveSteps(actor, planId, {
      version: dto.version,
      changeSummary: '复制步骤',
      steps,
    });
  }

  async reorderSteps(
    actor: JwtTeacherPayload,
    planId: number,
    dto: ReorderLessonStepsDto,
  ) {
    const plan = await this.get(actor, planId);
    const currentIds = plan.steps.map((step) => step.id).sort((a, b) => a - b);
    const requestedIds = [...dto.stepIds].sort((a, b) => a - b);
    if (
      currentIds.length !== requestedIds.length ||
      currentIds.some((id, index) => id !== requestedIds[index])
    )
      throw new BadRequestException('排序必须包含教案全部步骤且不能重复');
    const byId = new Map(plan.steps.map((step) => [step.id, step]));
    return this.saveSteps(actor, planId, {
      version: dto.version,
      changeSummary: '调整步骤顺序',
      steps: dto.stepIds.map((id) =>
        this.stepToDto(byId.get(id)! as HydratedStep),
      ),
    });
  }

  async generateAiDraft(
    actor: JwtTeacherPayload,
    dto: AiLessonPlanDraftRequestDto,
  ) {
    await Promise.all(
      dto.resourceIds.map((id) => this.resources.getOne(actor, id)),
    );
    try {
      const generated = await this.lessonAi.generate(actor, dto);
      const draft = await this.aiDrafts.save(
        this.aiDrafts.create({
          teacherId: actor.sub,
          schoolId: actor.schoolId ?? null,
          inputJson: JSON.stringify(dto),
          outputJson: JSON.stringify(generated.output),
          provider: generated.provider,
          model: generated.model,
          status: LessonAiDraftStatus.Generated,
          latencyMs: generated.latencyMs,
          promptTokens: generated.promptTokens,
          completionTokens: generated.completionTokens,
          totalTokens: generated.totalTokens,
          errorMessage: null,
          confirmedBy: null,
          confirmedAt: null,
          lessonPlanId: null,
        }),
      );
      return { ...draft, output: generated.output };
    } catch (error) {
      await this.aiDrafts.save(
        this.aiDrafts.create({
          teacherId: actor.sub,
          schoolId: actor.schoolId ?? null,
          inputJson: JSON.stringify(dto),
          outputJson: null,
          provider: this.lessonAi.providerName,
          model: this.lessonAi.modelName,
          status: LessonAiDraftStatus.Failed,
          latencyMs: null,
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
          errorMessage: 'AI生成失败',
          confirmedBy: null,
          confirmedAt: null,
          lessonPlanId: null,
        }),
      );
      throw error;
    }
  }

  async getAiDraft(actor: JwtTeacherPayload, id: number) {
    const draft = await this.ownedAiDraft(actor, id);
    return {
      ...draft,
      output: draft.outputJson ? this.parseAiOutput(draft.outputJson) : null,
    };
  }

  async confirmAiDraft(
    actor: JwtTeacherPayload,
    id: number,
    dto: ConfirmAiLessonDraftDto,
  ) {
    const draft = await this.ownedAiDraft(actor, id);
    if (draft.status !== LessonAiDraftStatus.Generated || !draft.outputJson)
      throw new ConflictException('AI草稿不可确认或已经确认');
    const output = this.parseAiOutput(draft.outputJson);
    const resourceIds = Array.from(
      new Set([
        ...output.teachingProcess
          .map((step) => step.resourceId)
          .filter((resourceId): resourceId is number => resourceId != null),
        ...output.resourceRecommendations.map((item) => item.resourceId),
      ]),
    );
    await Promise.all(
      resourceIds.map((resourceId) => this.resources.getOne(actor, resourceId)),
    );
    const lessonPlanId = await this.dataSource.transaction(async (manager) => {
      const draftRepo = manager.getRepository(LessonAiDraft);
      const claimed = await draftRepo.update(
        { id, teacherId: actor.sub, status: LessonAiDraftStatus.Generated },
        { status: LessonAiDraftStatus.Confirmed },
      );
      if (claimed.affected !== 1)
        throw new ConflictException('AI草稿已被确认，请勿重复操作');
      const planRepo = manager.getRepository(LessonPlan);
      let plan = await planRepo.save(
        planRepo.create({
          teacherId: actor.sub,
          schoolId: actor.schoolId ?? null,
          title: dto.title?.trim() || output.title.trim(),
          theme: output.theme.trim(),
          lessonType: dto.lessonType ?? LessonPlanType.Normal,
          ageGroup: output.ageGroup,
          domain: output.domain.trim(),
          objectives: output.teachingObjectives.join('\n'),
          estimatedMinutes: output.estimatedMinutes,
          status: LessonPlanStatus.Draft,
          version: 1,
          currentVersionId: null,
          outlineJson: JSON.stringify(output),
          deletedAt: null,
        }),
      );
      const stepInputs = this.aiOutputToSteps(output);
      const savedSteps: LessonStep[] = [];
      for (let index = 0; index < stepInputs.length; index += 1) {
        const step = stepInputs[index];
        savedSteps.push(
          await manager.getRepository(LessonStep).save(
            manager.getRepository(LessonStep).create({
              lessonPlanId: plan.id,
              sortOrder: index + 1,
              title: step.title,
              stepType: step.stepType,
              content: step.content,
              instruction: step.content,
              expectedResponse: null,
              teacherTip: null,
              resourceId: step.resourceId ?? null,
              durationSeconds: step.durationSeconds,
            }),
          ),
        );
      }
      await this.syncResourceReferences(manager, actor, plan.id, stepInputs);
      const version = await this.createVersion(
        manager,
        plan,
        actor,
        dto.changeSummary?.trim() || '教师确认AI备课草稿',
      );
      plan.currentVersionId = version.id;
      plan = await planRepo.save(plan);
      draft.confirmedBy = actor.sub;
      draft.confirmedAt = new Date();
      draft.lessonPlanId = plan.id;
      draft.status = LessonAiDraftStatus.Confirmed;
      await draftRepo.save(draft);
      return plan.id;
    });
    return this.get(actor, lessonPlanId);
  }

  async start(actor: JwtTeacherPayload, id: number) {
    const plan = await this.get(actor, id);
    if (plan.status === LessonPlanStatus.Archived)
      throw new BadRequestException('已归档教案不能开始上课');
    if (!plan.steps.length)
      throw new BadRequestException('教案还没有课堂步骤，无法开始上课');
    const existing = await this.runs.findOne({
      where: [
        {
          lessonPlanId: id,
          teacherId: actor.sub,
          status: LessonRunStatus.Running,
        },
        {
          lessonPlanId: id,
          teacherId: actor.sub,
          status: LessonRunStatus.Paused,
        },
      ],
    });
    if (existing) return this.runResponse(existing);
    const snapshots: LessonStepSnapshot[] = [];
    for (const step of plan.steps) {
      const resource = step.resourceId
        ? await this.resources.getOne(actor, step.resourceId)
        : null;
      snapshots.push({
        id: step.id,
        sortOrder: step.sortOrder,
        title: step.title,
        stepType: step.stepType,
        instruction: step.instruction,
        expectedResponse: step.expectedResponse,
        teacherTip: step.teacherTip,
        resourceId: step.resourceId,
        durationSeconds: step.durationSeconds,
        resource: resource as unknown as Record<string, unknown> | null,
      });
    }
    const startedAt = new Date();
    const run = await this.runs.save(
      this.runs.create({
        lessonPlanId: id,
        teacherId: actor.sub,
        status: LessonRunStatus.Running,
        currentStepOrder: 1,
        lessonTitle: plan.title,
        lessonObjectives: plan.objectives,
        ageGroup: plan.ageGroup,
        stepsSnapshot: JSON.stringify(snapshots),
        elapsedSeconds: 0,
        resumedAt: startedAt,
        startedAt,
        endedAt: null,
      }),
    );
    return this.runResponse(run);
  }

  async getRun(actor: JwtTeacherPayload, id: number) {
    return this.runResponse(await this.ownedRun(actor, id));
  }

  async progress(
    actor: JwtTeacherPayload,
    id: number,
    dto: UpdateLessonRunProgressDto,
  ) {
    const run = await this.ownedRun(actor, id);
    if (run.status === LessonRunStatus.Paused)
      throw new ConflictException('课堂暂停中，不能切换环节');
    if (run.status !== LessonRunStatus.Running)
      throw new ConflictException('课堂已结束，不能更新进度');
    const steps = this.parseSnapshots(run);
    if (!steps.some((step) => step.sortOrder === dto.currentStepOrder))
      throw new BadRequestException('课堂步骤不存在');
    if (run.currentStepOrder !== dto.currentStepOrder) {
      run.currentStepOrder = dto.currentStepOrder;
      await this.runs.save(run);
    }
    return this.runResponse(run);
  }

  pause(actor: JwtTeacherPayload, id: number) {
    return this.transition(actor, id, LessonRunStatus.Paused);
  }
  resume(actor: JwtTeacherPayload, id: number) {
    return this.transition(actor, id, LessonRunStatus.Running);
  }
  complete(actor: JwtTeacherPayload, id: number) {
    return this.finish(actor, id, LessonRunStatus.Completed);
  }
  cancel(actor: JwtTeacherPayload, id: number) {
    return this.finish(actor, id, LessonRunStatus.Cancelled);
  }

  private async transition(
    actor: JwtTeacherPayload,
    id: number,
    status: LessonRunStatus,
  ) {
    const run = await this.ownedRun(actor, id);
    if (
      [LessonRunStatus.Completed, LessonRunStatus.Cancelled].includes(
        run.status,
      )
    )
      throw new ConflictException('课堂已经结束');
    if (run.status !== status) {
      if (status === LessonRunStatus.Paused) this.captureElapsed(run);
      if (status === LessonRunStatus.Running) run.resumedAt = new Date();
      run.status = status;
      await this.runs.save(run);
    }
    return this.runResponse(run);
  }

  private async finish(
    actor: JwtTeacherPayload,
    id: number,
    status: LessonRunStatus,
  ) {
    const run = await this.ownedRun(actor, id);
    if (run.status === status) return this.runResponse(run);
    if (
      [LessonRunStatus.Completed, LessonRunStatus.Cancelled].includes(
        run.status,
      )
    )
      throw new ConflictException('课堂已经结束');
    this.captureElapsed(run);
    run.status = status;
    run.endedAt = new Date();
    run.resumedAt = null;
    await this.runs.save(run);
    return this.runResponse(run);
  }

  private validateStepDefinitions(steps: LessonStepDto[]) {
    for (const step of steps) {
      if (!(step.content ?? step.instruction)?.trim())
        throw new BadRequestException('步骤内容不能为空');
      if (step.stepType === LessonStepType.Resource && !step.resourceId)
        throw new BadRequestException('资源步骤必须选择有效资源');
      for (const action of step.actions ?? []) {
        if (!ALLOWED_ACTION_NAMES[action.actionType].has(action.actionName))
          throw new BadRequestException('步骤动作名称不在允许列表中');
        if (action.content && UNSAFE_ACTION_CONTENT.test(action.content))
          throw new BadRequestException('步骤动作内容包含不安全代码或链接');
        if (
          action.actionType === LessonStepActionType.RollCall &&
          action.actionName === 'specific' &&
          !action.targetStudentId
        )
          throw new BadRequestException('指定点名必须选择学生');
      }
      if (
        step.recoveryPoint &&
        step.recoveryPoint.recoveryStepOrder > steps.length
      )
        throw new BadRequestException('恢复点目标步骤超出范围');
    }
  }

  private async validateStepResources(
    actor: JwtTeacherPayload,
    steps: LessonStepDto[],
  ) {
    const ids = Array.from(
      new Set(
        steps
          .map((step) => step.resourceId)
          .filter((id): id is number => id != null),
      ),
    );
    await Promise.all(ids.map((id) => this.resources.getOne(actor, id)));
  }

  private async saveStepConfiguration(
    manager: EntityManager,
    lessonPlanId: number,
    step: LessonStep,
    input: LessonStepDto,
  ) {
    if (input.actions?.length)
      await manager.getRepository(LessonStepAction).save(
        input.actions.map((action, index) =>
          manager.getRepository(LessonStepAction).create({
            stepId: step.id,
            actionType: action.actionType,
            actionName: action.actionName,
            content: action.content?.trim() || null,
            targetStudentId: action.targetStudentId ?? null,
            sortOrder: index + 1,
          }),
        ),
      );
    if (input.recoveryPoint)
      await manager.getRepository(LessonRecoveryPoint).save(
        manager.getRepository(LessonRecoveryPoint).create({
          lessonPlanId,
          stepId: step.id,
          name: input.recoveryPoint.name.trim(),
          trigger: input.recoveryPoint.trigger,
          recoveryStepOrder: input.recoveryPoint.recoveryStepOrder,
          prompt: input.recoveryPoint.prompt?.trim() || null,
          enabled: input.recoveryPoint.enabled ?? true,
        }),
      );
  }

  private async syncResourceReferences(
    manager: EntityManager,
    actor: JwtTeacherPayload,
    lessonPlanId: number,
    steps: Array<Pick<LessonStepDto, 'resourceId'>>,
  ) {
    const repo = manager.getRepository(ResourceReference);
    const ids = Array.from(
      new Set(
        steps
          .map((step) => step.resourceId)
          .filter((id): id is number => id != null),
      ),
    );
    for (const resourceId of ids)
      await repo.save(
        repo.create({
          resourceId,
          referenceType: 'lesson_plan',
          referenceId: String(lessonPlanId),
          createdBy: actor.sub,
        }),
      );
  }

  private async createVersion(
    manager: EntityManager,
    plan: LessonPlan,
    actor: JwtTeacherPayload,
    changeSummary: string,
  ) {
    const steps = await this.loadSteps(plan.id, manager);
    const snapshot = {
      id: plan.id,
      teacherId: plan.teacherId,
      title: plan.title,
      theme: plan.theme,
      lessonType: plan.lessonType,
      ageGroup: plan.ageGroup,
      domain: plan.domain,
      objectives: plan.objectives,
      estimatedMinutes: plan.estimatedMinutes,
      status: plan.status,
      version: plan.version,
      outline: plan.outlineJson ? JSON.parse(plan.outlineJson) : null,
      steps,
    };
    return manager.getRepository(LessonPlanVersion).save(
      manager.getRepository(LessonPlanVersion).create({
        lessonPlanId: plan.id,
        versionNo: plan.version,
        snapshotJson: JSON.stringify(snapshot),
        createdBy: actor.sub,
        createdByType: actor.userType,
        changeSummary,
      }),
    );
  }

  private async loadSteps(
    lessonPlanId: number,
    manager?: EntityManager,
  ): Promise<HydratedStep[]> {
    const stepRepo = manager?.getRepository(LessonStep) ?? this.steps;
    const actionRepo = manager?.getRepository(LessonStepAction) ?? this.actions;
    const recoveryRepo =
      manager?.getRepository(LessonRecoveryPoint) ?? this.recoveryPoints;
    const steps = await stepRepo.find({
      where: { lessonPlanId },
      order: { sortOrder: 'ASC' },
    });
    if (!steps.length) return [];
    const ids = steps.map((step) => step.id);
    const [actions, recoveryPoints] = await Promise.all([
      actionRepo.find({
        where: { stepId: In(ids) },
        order: { sortOrder: 'ASC' },
      }),
      recoveryRepo.find({ where: { stepId: In(ids) } }),
    ]);
    return steps.map((step) =>
      Object.assign(step, {
        actions: actions.filter((action) => action.stepId === step.id),
        recoveryPoint:
          recoveryPoints.find((point) => point.stepId === step.id) ?? null,
      }),
    ) as HydratedStep[];
  }

  private stepToDto(step: HydratedStep): LessonStepDto {
    return {
      title: step.title,
      stepType: step.stepType,
      content: step.content ?? step.instruction,
      expectedResponse: step.expectedResponse ?? undefined,
      teacherTip: step.teacherTip ?? undefined,
      resourceId: step.resourceId ?? undefined,
      durationSeconds: step.durationSeconds,
      actions: step.actions.map((action) => ({
        actionType: action.actionType,
        actionName: action.actionName,
        content: action.content ?? undefined,
        targetStudentId: action.targetStudentId ?? undefined,
      })),
      recoveryPoint: step.recoveryPoint
        ? {
            name: step.recoveryPoint.name,
            trigger: step.recoveryPoint.trigger,
            recoveryStepOrder: step.recoveryPoint.recoveryStepOrder,
            prompt: step.recoveryPoint.prompt ?? undefined,
            enabled: step.recoveryPoint.enabled,
          }
        : undefined,
    };
  }

  private aiOutputToSteps(output: AiLessonPlanDraftOutputDto): LessonStepDto[] {
    const introductionSeconds = Math.min(180, output.estimatedMinutes * 60);
    return [
      {
        title: '课程导入',
        stepType: LessonStepType.Introduction,
        content: output.introduction,
        durationSeconds: introductionSeconds,
      },
      ...output.teachingProcess.map((step) => ({
        title: step.title,
        stepType: step.stepType,
        content: step.content,
        resourceId: step.resourceId,
        durationSeconds: step.durationSeconds,
      })),
    ];
  }

  private parseAiOutput(value: string): AiLessonPlanDraftOutputDto {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      throw new ConflictException('AI草稿数据损坏，不能确认');
    }
    const output = plainToInstance(AiLessonPlanDraftOutputDto, parsed);
    const errors = validateSync(output, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (errors.length) throw new ConflictException('AI草稿格式无效，不能确认');
    if (UNSAFE_ACTION_CONTENT.test(JSON.stringify(output)))
      throw new ConflictException('AI草稿包含不安全代码或链接，不能确认');
    return output;
  }

  private async ownedAiDraft(actor: JwtTeacherPayload, id: number) {
    const draft = await this.aiDrafts.findOneBy({ id });
    if (!draft) throw new NotFoundException('AI草稿不存在');
    if (actor.role !== TeacherRole.Admin && draft.teacherId !== actor.sub)
      throw new ForbiddenException('无权访问该AI草稿');
    return draft;
  }

  private async ownedPlan(actor: JwtTeacherPayload, id: number) {
    const plan = await this.plans.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!plan) throw new NotFoundException('教案不存在');
    if (actor.role !== TeacherRole.Admin && plan.teacherId !== actor.sub)
      throw new ForbiddenException('无权访问该教案');
    if (
      actor.role === TeacherRole.Admin &&
      actor.schoolId &&
      plan.schoolId &&
      actor.schoolId !== plan.schoolId
    )
      throw new ForbiddenException('无权访问其他园所教案');
    return plan;
  }

  private async ownedRun(actor: JwtTeacherPayload, id: number) {
    const run = await this.runs.findOneBy({ id });
    if (!run) throw new NotFoundException('课堂记录不存在');
    if (actor.role !== TeacherRole.Admin && run.teacherId !== actor.sub)
      throw new ForbiddenException('无权操作该课堂');
    return run;
  }

  private versionConflict() {
    return new ConflictException('教案已在其他页面修改，请刷新后重试');
  }

  private parseSnapshots(run: LessonRun): LessonStepSnapshot[] {
    try {
      const value: unknown = JSON.parse(run.stepsSnapshot);
      return Array.isArray(value) ? (value as LessonStepSnapshot[]) : [];
    } catch {
      return [];
    }
  }

  private captureElapsed(run: LessonRun) {
    if (run.status === LessonRunStatus.Running && run.resumedAt) {
      run.elapsedSeconds += Math.max(
        0,
        Math.floor((Date.now() - run.resumedAt.getTime()) / 1000),
      );
      run.resumedAt = null;
    }
  }

  private runResponse(run: LessonRun) {
    const liveSeconds =
      run.status === LessonRunStatus.Running && run.resumedAt
        ? Math.max(0, Math.floor((Date.now() - run.resumedAt.getTime()) / 1000))
        : 0;
    return {
      id: run.id,
      runId: run.id,
      lessonPlanId: run.lessonPlanId,
      teacherId: run.teacherId,
      status: run.status,
      currentStepOrder: run.currentStepOrder,
      lessonTitle: run.lessonTitle,
      lessonObjectives: run.lessonObjectives,
      ageGroup: run.ageGroup,
      steps: this.parseSnapshots(run),
      elapsedSeconds: run.elapsedSeconds + liveSeconds,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      updatedAt: run.updatedAt,
    };
  }

  private escapeLike(value: string) {
    return value.replace(/[\\%_]/g, (match) => `\\${match}`);
  }
}
