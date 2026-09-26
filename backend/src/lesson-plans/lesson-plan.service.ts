import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { TeacherRole } from '../auth/entities/teacher.entity';
import { ResourceService } from '../resources/resource.service';
import type { CreateLessonPlanDto, LessonStepDto, ListLessonPlansQueryDto, SaveLessonStepsDto, UpdateLessonPlanDto, UpdateLessonRunProgressDto } from './dto/lesson-plan.dto';
import { LessonPlan } from './entities/lesson-plan.entity';
import { LessonRun } from './entities/lesson-run.entity';
import { LessonStep } from './entities/lesson-step.entity';
import { LessonPlanStatus, LessonRunStatus, LessonStepType, type LessonStepSnapshot } from './lesson-plan.types';

@Injectable()
export class LessonPlanService {
  constructor(
    @InjectRepository(LessonPlan) private readonly plans: Repository<LessonPlan>,
    @InjectRepository(LessonStep) private readonly steps: Repository<LessonStep>,
    @InjectRepository(LessonRun) private readonly runs: Repository<LessonRun>,
    private readonly dataSource: DataSource,
    private readonly resources: ResourceService,
  ) {}

  async create(actor: JwtTeacherPayload, dto: CreateLessonPlanDto) {
    return this.plans.save(this.plans.create({ ...dto, title: dto.title.trim(), theme: dto.theme.trim(), objectives: dto.objectives.trim(), teacherId: actor.sub }));
  }

  async list(actor: JwtTeacherPayload, query: ListLessonPlansQueryDto) {
    const builder = this.plans.createQueryBuilder('plan');
    if (actor.role !== TeacherRole.Admin) builder.where('plan.teacher_id = :teacherId', { teacherId: actor.sub });
    if (query.keyword?.trim()) builder.andWhere('(plan.title LIKE :keyword OR plan.theme LIKE :keyword)', { keyword: `%${query.keyword.trim()}%` });
    if (query.ageGroup) builder.andWhere('plan.age_group = :ageGroup', { ageGroup: query.ageGroup });
    if (query.status) builder.andWhere('plan.status = :status', { status: query.status });
    const [items, total] = await builder.orderBy('plan.updated_at', 'DESC').skip((query.page - 1) * query.pageSize).take(query.pageSize).getManyAndCount();
    if (items.length) {
      const counts = await this.steps.createQueryBuilder('step')
        .select('step.lesson_plan_id', 'lessonPlanId')
        .addSelect('COUNT(step.id)', 'stepCount')
        .where('step.lesson_plan_id IN (:...ids)', { ids: items.map((item) => item.id) })
        .groupBy('step.lesson_plan_id')
        .getRawMany<{ lessonPlanId: number | string; stepCount: number | string }>();
      const countsByPlan = new Map(counts.map((row) => [Number(row.lessonPlanId), Number(row.stepCount)]));
      for (const item of items) item.stepCount = countsByPlan.get(item.id) ?? 0;
    }
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async get(actor: JwtTeacherPayload, id: number) {
    const plan = await this.ownedPlan(actor, id);
    plan.steps = await this.steps.find({ where: { lessonPlanId: id }, order: { sortOrder: 'ASC' } });
    return plan;
  }

  async update(actor: JwtTeacherPayload, id: number, dto: UpdateLessonPlanDto) {
    const plan = await this.ownedPlan(actor, id);
    this.assertVersion(plan, dto.version);
    const { version: _version, ...updates } = dto;
    Object.assign(plan, updates, { version: plan.version + 1 });
    return this.plans.save(plan);
  }

  async remove(actor: JwtTeacherPayload, id: number) {
    const plan = await this.ownedPlan(actor, id);
    await this.plans.remove(plan);
  }

  async copy(actor: JwtTeacherPayload, id: number) {
    const source = await this.get(actor, id);
    const copied = await this.plans.save(this.plans.create({ teacherId: actor.sub, title: `${source.title}（副本）`, theme: source.theme, ageGroup: source.ageGroup, objectives: source.objectives, estimatedMinutes: source.estimatedMinutes, status: LessonPlanStatus.Draft }));
    if (source.steps.length) await this.steps.save(source.steps.map((step) => this.steps.create({ lessonPlanId: copied.id, sortOrder: step.sortOrder, title: step.title, stepType: step.stepType, instruction: step.instruction, expectedResponse: step.expectedResponse, teacherTip: step.teacherTip, resourceId: step.resourceId, durationSeconds: step.durationSeconds })));
    return this.get(actor, copied.id);
  }

  async saveSteps(actor: JwtTeacherPayload, id: number, dto: SaveLessonStepsDto) {
    const plan = await this.ownedPlan(actor, id);
    this.assertVersion(plan, dto.version);
    await this.validateStepResources(actor, dto.steps);
    return this.dataSource.transaction(async (manager) => {
      const planRepo = manager.getRepository(LessonPlan);
      const current = await planRepo.findOneBy({ id });
      if (!current || current.version !== dto.version) throw new ConflictException('教案已在其他页面修改，请刷新后重试');
      await manager.getRepository(LessonStep).delete({ lessonPlanId: id });
      const entities = dto.steps.map((step, index) => manager.getRepository(LessonStep).create({ lessonPlanId: id, sortOrder: index + 1, title: step.title.trim(), stepType: step.stepType, instruction: step.instruction.trim(), expectedResponse: step.expectedResponse?.trim() || null, teacherTip: step.teacherTip?.trim() || null, resourceId: step.resourceId ?? null, durationSeconds: step.durationSeconds }));
      if (entities.length) await manager.getRepository(LessonStep).save(entities);
      current.version += 1;
      await planRepo.save(current);
      return { version: current.version, steps: entities };
    });
  }

  async start(actor: JwtTeacherPayload, id: number) {
    const plan = await this.get(actor, id);
    if (plan.status === LessonPlanStatus.Archived) throw new BadRequestException('已归档教案不能开始上课');
    if (!plan.steps.length) throw new BadRequestException('教案还没有课堂步骤，无法开始上课');
    const existing = await this.runs.findOne({ where: [{ lessonPlanId: id, teacherId: actor.sub, status: LessonRunStatus.Running }, { lessonPlanId: id, teacherId: actor.sub, status: LessonRunStatus.Paused }] });
    if (existing) return this.runResponse(existing);
    const snapshots: LessonStepSnapshot[] = [];
    for (const step of plan.steps) {
      const resource = step.resourceId ? await this.resources.getOne(actor.sub, step.resourceId) : null;
      snapshots.push({ id: step.id, sortOrder: step.sortOrder, title: step.title, stepType: step.stepType, instruction: step.instruction, expectedResponse: step.expectedResponse, teacherTip: step.teacherTip, resourceId: step.resourceId, durationSeconds: step.durationSeconds, resource: resource as unknown as Record<string, unknown> | null });
    }
    const startedAt = new Date();
    const run = await this.runs.save(this.runs.create({ lessonPlanId: id, teacherId: actor.sub, status: LessonRunStatus.Running, currentStepOrder: 1, lessonTitle: plan.title, lessonObjectives: plan.objectives, ageGroup: plan.ageGroup, stepsSnapshot: JSON.stringify(snapshots), elapsedSeconds: 0, resumedAt: startedAt, startedAt, endedAt: null }));
    return this.runResponse(run);
  }

  async getRun(actor: JwtTeacherPayload, id: number) { return this.runResponse(await this.ownedRun(actor, id)); }

  async progress(actor: JwtTeacherPayload, id: number, dto: UpdateLessonRunProgressDto) {
    const run = await this.ownedRun(actor, id);
    if (run.status === LessonRunStatus.Paused) throw new ConflictException('课堂暂停中，不能切换环节');
    if (run.status !== LessonRunStatus.Running) throw new ConflictException('课堂已结束，不能更新进度');
    const steps = this.parseSnapshots(run);
    if (!steps.some((step) => step.sortOrder === dto.currentStepOrder)) throw new BadRequestException('课堂步骤不存在');
    if (run.currentStepOrder !== dto.currentStepOrder) { run.currentStepOrder = dto.currentStepOrder; await this.runs.save(run); }
    return this.runResponse(run);
  }

  pause(actor: JwtTeacherPayload, id: number) { return this.transition(actor, id, LessonRunStatus.Paused); }
  resume(actor: JwtTeacherPayload, id: number) { return this.transition(actor, id, LessonRunStatus.Running); }
  complete(actor: JwtTeacherPayload, id: number) { return this.finish(actor, id, LessonRunStatus.Completed); }
  cancel(actor: JwtTeacherPayload, id: number) { return this.finish(actor, id, LessonRunStatus.Cancelled); }

  private async transition(actor: JwtTeacherPayload, id: number, status: LessonRunStatus) {
    const run = await this.ownedRun(actor, id);
    if ([LessonRunStatus.Completed, LessonRunStatus.Cancelled].includes(run.status)) throw new ConflictException('课堂已经结束');
    if (run.status !== status) {
      if (status === LessonRunStatus.Paused) this.captureElapsed(run);
      if (status === LessonRunStatus.Running) run.resumedAt = new Date();
      run.status = status;
      await this.runs.save(run);
    }
    return this.runResponse(run);
  }
  private async finish(actor: JwtTeacherPayload, id: number, status: LessonRunStatus) {
    const run = await this.ownedRun(actor, id);
    if (run.status === status) return this.runResponse(run);
    if ([LessonRunStatus.Completed, LessonRunStatus.Cancelled].includes(run.status)) throw new ConflictException('课堂已经结束');
    this.captureElapsed(run); run.status = status; run.endedAt = new Date(); run.resumedAt = null; await this.runs.save(run); return this.runResponse(run);
  }
  private async validateStepResources(actor: JwtTeacherPayload, steps: LessonStepDto[]) {
    for (const step of steps) {
      if (step.stepType === LessonStepType.Resource && !step.resourceId) throw new BadRequestException('资源步骤必须选择有效资源');
      if (step.resourceId) await this.resources.getOne(actor.sub, step.resourceId);
    }
  }
  private async ownedPlan(actor: JwtTeacherPayload, id: number) {
    const plan = await this.plans.findOneBy({ id });
    if (!plan) throw new NotFoundException('教案不存在');
    if (actor.role !== TeacherRole.Admin && plan.teacherId !== actor.sub) throw new ForbiddenException('无权访问该教案');
    return plan;
  }
  private async ownedRun(actor: JwtTeacherPayload, id: number) {
    const run = await this.runs.findOneBy({ id });
    if (!run) throw new NotFoundException('课堂记录不存在');
    if (actor.role !== TeacherRole.Admin && run.teacherId !== actor.sub) throw new ForbiddenException('无权操作该课堂');
    return run;
  }
  private assertVersion(plan: LessonPlan, version: number) { if (plan.version !== version) throw new ConflictException('教案已在其他页面修改，请刷新后重试'); }
  private parseSnapshots(run: LessonRun): LessonStepSnapshot[] { try { const value: unknown = JSON.parse(run.stepsSnapshot); return Array.isArray(value) ? value as LessonStepSnapshot[] : []; } catch { return []; } }
  private captureElapsed(run: LessonRun) {
    if (run.status === LessonRunStatus.Running && run.resumedAt) {
      run.elapsedSeconds += Math.max(0, Math.floor((Date.now() - run.resumedAt.getTime()) / 1000));
      run.resumedAt = null;
    }
  }
  private runResponse(run: LessonRun) {
    const liveSeconds = run.status === LessonRunStatus.Running && run.resumedAt
      ? Math.max(0, Math.floor((Date.now() - run.resumedAt.getTime()) / 1000))
      : 0;
    return { id: run.id, runId: run.id, lessonPlanId: run.lessonPlanId, teacherId: run.teacherId, status: run.status, currentStepOrder: run.currentStepOrder, lessonTitle: run.lessonTitle, lessonObjectives: run.lessonObjectives, ageGroup: run.ageGroup, steps: this.parseSnapshots(run), elapsedSeconds: run.elapsedSeconds + liveSeconds, startedAt: run.startedAt, endedAt: run.endedAt, updatedAt: run.updatedAt };
  }
}
