import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { AuthUserType } from '../auth/entities/refresh-token-session.entity';
import { AvatarConfigurationService } from '../avatars/avatar-configuration.service';
import {
  ACTIVE_CLASSROOM_RUN_STATUSES,
  ClassroomRunStatus,
} from '../classroom-runs/classroom-run.types';
import { ClassroomEvent } from '../classroom-runs/entities/classroom-event.entity';
import { ClassroomRunStepSnapshot } from '../classroom-runs/entities/classroom-run-step-snapshot.entity';
import { ClassroomRun } from '../classroom-runs/entities/classroom-run.entity';
import { ClassroomSnapshot } from '../classroom-runs/entities/classroom-snapshot.entity';
import { ResourceReviewStatus } from '../data/entities/teaching-resource.entity';
import { AuditService } from '../platform/audit.service';
import { PlatformAccessService } from '../platform/platform-access.service';
import {
  ResourceService,
  type ResourceResponse,
} from '../resources/resource.service';
import { AiService } from './ai.service';
import {
  ClassroomDirectorDecision,
  ClassroomDirectorDecisionDto,
  ClassroomDirectorModelResultDto,
  ClassroomDirectorRequestDto,
  ClassroomDirectorSuggestedActionDto,
  ClassroomDirectorSuggestionStatus,
  ClassroomDirectorSuggestionType,
} from './dto/classroom-director.dto';
import { ClassroomDirectorSuggestion } from './entities/classroom-director-suggestion.entity';

const LOW_CONFIDENCE = 0.75;
const UNSAFE_SAVED_CONTENT =
  /(?:https?:\/\/|javascript\s*:|<\/?script|\b(?:select|insert|update|delete|drop|alter)\b[\s\S]{0,80}\b(?:from|into|table|where|set)\b|\b(?:powershell|cmd\.exe|\/bin\/sh|system\s*\(|exec\s*\())/i;

type SafeEvent = {
  eventType: string;
  createdAt: Date;
  stepIndex?: number;
  checkpointType?: string;
  resourceId?: number;
};

@Injectable()
export class ClassroomDirectorService {
  constructor(
    @InjectRepository(ClassroomDirectorSuggestion)
    private readonly suggestions: Repository<ClassroomDirectorSuggestion>,
    @InjectRepository(ClassroomRun)
    private readonly runs: Repository<ClassroomRun>,
    @InjectRepository(ClassroomRunStepSnapshot)
    private readonly steps: Repository<ClassroomRunStepSnapshot>,
    @InjectRepository(ClassroomEvent)
    private readonly events: Repository<ClassroomEvent>,
    @InjectRepository(ClassroomSnapshot)
    private readonly snapshots: Repository<ClassroomSnapshot>,
    private readonly ai: AiService,
    private readonly access: PlatformAccessService,
    private readonly resources: ResourceService,
    private readonly avatars: AvatarConfigurationService,
    private readonly audit: AuditService,
  ) {}

  async suggest(actor: JwtTeacherPayload, dto: ClassroomDirectorRequestDto) {
    this.requireTeacher(actor);
    const duplicate = await this.suggestions.findOne({
      where: { teacherId: actor.sub, requestId: dto.requestId },
    });
    if (duplicate) return this.duplicateResponse(duplicate, dto.classroomRunId);

    const run = await this.requireCurrentRun(actor, dto.classroomRunId);
    if (dto.currentStepIndex !== run.currentStepIndex)
      throw new ConflictException('课堂步骤已经变化，请刷新后重新生成建议');
    const context = await this.buildContext(actor, run, dto);
    const reservation = await this.reserve(
      actor,
      run,
      dto,
      context.inputSummary,
    );
    if (!reservation.created)
      return this.duplicateResponse(reservation.entity, dto.classroomRunId);

    const generation = await this.ai.classroomDirector({
      authoritativeContext: context.prompt,
      teacherRequest: dto.teacherRequest.trim(),
    });
    let result = this.filterResult(
      generation.result,
      context.resources,
      context.steps,
    );
    let status = generation.status;

    const latestRun = await this.runs.findOne({ where: { id: run.id } });
    if (
      !latestRun ||
      latestRun.version !== run.version ||
      latestRun.currentStepIndex !== run.currentStepIndex ||
      !ACTIVE_CLASSROOM_RUN_STATUSES.includes(
        latestRun.status as (typeof ACTIVE_CLASSROOM_RUN_STATUSES)[number],
      )
    ) {
      result = this.stateChangedFallback();
      status = ClassroomDirectorSuggestionStatus.Fallback;
    }

    const saved = await this.finishReservation(reservation.entity, result, {
      ...generation,
      status,
    });
    await this.safeWriteAi({
      actor,
      feature: 'classroom_director',
      provider: generation.provider,
      model: generation.model,
      requestId: dto.requestId,
      status,
      latencyMs: generation.latencyMs,
      errorCode: generation.errorCode ?? undefined,
      metadata: {
        classroomRunId: run.id,
        currentStepIndex: run.currentStepIndex,
        suggestionType: result.suggestionType,
        confidence: result.confidence,
        resourceCandidateIds: result.resourceCandidates.map(
          (item) => item.resourceId,
        ),
        tokenUsage: {
          prompt: generation.promptTokens,
          completion: generation.completionTokens,
          total: generation.totalTokens,
        },
      },
    });
    return this.response(saved);
  }

  async decide(
    actor: JwtTeacherPayload,
    suggestionId: number,
    dto: ClassroomDirectorDecisionDto,
  ) {
    this.requireTeacher(actor);
    const suggestion = await this.suggestions.findOne({
      where: { id: suggestionId },
    });
    if (!suggestion) throw new NotFoundException('课堂导演建议不存在');
    if (suggestion.teacherId !== actor.sub)
      throw new ForbiddenException('无权处理其他教师的课堂建议');
    await this.requireOwnedRun(actor, suggestion.classroomRunId, true);
    if (suggestion.status === ClassroomDirectorSuggestionStatus.Processing)
      throw new ConflictException('建议仍在生成中');
    if (suggestion.decision) {
      if (
        suggestion.decision === dto.decision &&
        suggestion.executed === dto.executed
      )
        return this.response(suggestion);
      throw new ConflictException('该建议已经记录教师决定');
    }
    if (
      dto.decision === ClassroomDirectorDecision.Edited &&
      !dto.editedTeacherMessage &&
      !dto.editedSuggestedAction
    )
      throw new BadRequestException('edited决定必须提供修改后的内容');
    if (
      [
        ClassroomDirectorDecision.Rejected,
        ClassroomDirectorDecision.Ignored,
      ].includes(dto.decision) &&
      dto.executed
    )
      throw new BadRequestException('拒绝或忽略的建议不能标记为已执行');
    if (
      dto.editedTeacherMessage &&
      UNSAFE_SAVED_CONTENT.test(dto.editedTeacherMessage)
    )
      throw new BadRequestException('修改内容包含不安全指令');

    const action = dto.editedSuggestedAction
      ? await this.validateEditedAction(
          actor,
          suggestion.classroomRunId,
          dto.editedSuggestedAction,
        )
      : null;
    suggestion.decision = dto.decision;
    suggestion.editedTeacherMessage =
      dto.decision === ClassroomDirectorDecision.Edited
        ? (dto.editedTeacherMessage?.trim() ?? null)
        : null;
    suggestion.editedSuggestedAction =
      dto.decision === ClassroomDirectorDecision.Edited && action
        ? JSON.stringify(action)
        : null;
    suggestion.executed = dto.executed;
    suggestion.executionResult = dto.executionResult?.trim() || null;
    suggestion.decidedAt = new Date();
    const saved = await this.suggestions.save(suggestion);
    await this.safeWriteAi({
      actor,
      feature: 'classroom_director_decision',
      provider: suggestion.provider ?? undefined,
      model: suggestion.model ?? undefined,
      requestId: suggestion.requestId,
      status: dto.decision,
      metadata: {
        classroomRunId: suggestion.classroomRunId,
        suggestionId: suggestion.id,
        decision: dto.decision,
        executed: dto.executed,
        executionResultLength: suggestion.executionResult?.length ?? 0,
        editedMessageLength: suggestion.editedTeacherMessage?.length ?? 0,
      },
    });
    return this.response(saved);
  }

  private async buildContext(
    actor: JwtTeacherPayload,
    run: ClassroomRun,
    dto: ClassroomDirectorRequestDto,
  ) {
    const [schoolClass, steps, events, latestSnapshot, avatar] =
      await Promise.all([
        this.access.requireClassAccess(actor, run.classId),
        this.steps.find({
          where: { classroomRunId: run.id },
          order: { stepIndex: 'ASC' },
        }),
        this.events.find({
          where: { classroomRunId: run.id },
          order: { createdAt: 'DESC' },
          take: 20,
        }),
        this.snapshots.findOne({
          where: { classroomRunId: run.id },
          order: { snapshotVersion: 'DESC' },
        }),
        this.avatars.resolve(actor, {
          classroomRunId: run.id,
          deviceId: run.deviceId,
        }),
      ]);
    if (!steps.length) throw new ConflictException('课堂没有可用步骤快照');
    const currentStep = steps.find(
      (step) => step.stepIndex === run.currentStepIndex,
    );
    if (!currentStep) throw new ConflictException('当前课堂步骤不存在');
    const resources = await this.accessibleResources(actor, steps);
    const safeEvents = events.map((event) => this.safeEvent(event));
    const elapsedSeconds = this.currentElapsed(run);
    const plannedSeconds = steps.reduce(
      (sum, step) => sum + step.durationSeconds,
      0,
    );
    const remainingMinutes = Math.max(
      0,
      Math.ceil((plannedSeconds - elapsedSeconds) / 60),
    );
    const prompt = {
      lessonPlanSnapshot: {
        lessonPlanId: run.lessonPlanId,
        lessonPlanVersion: run.lessonPlanVersion,
        title: run.title,
        steps: steps.map((step) => ({
          stepIndex: step.stepIndex,
          title: step.title,
          type: step.type,
          content: step.content.slice(0, 800),
          durationSeconds: step.durationSeconds,
          resourceId: step.resourceId,
        })),
      },
      currentStep: {
        stepIndex: currentStep.stepIndex,
        title: currentStep.title,
        type: currentStep.type,
        content: currentStep.content.slice(0, 800),
      },
      classAgeRange: schoolClass.ageRange,
      classroom: {
        status: run.status,
        currentStepIndex: run.currentStepIndex,
        elapsedSeconds,
        remainingMinutes,
      },
      completedSteps: steps
        .filter((step) => step.stepIndex < run.currentStepIndex)
        .map((step) => ({ stepIndex: step.stepIndex, title: step.title })),
      recentEvents: safeEvents,
      availableResources: resources.map((resource) => ({
        id: resource.id,
        title: resource.title,
        resourceType: resource.resourceType,
        category: resource.category,
      })),
      rollCallSummary: this.stateSummary(latestSnapshot?.rollCallState),
      rewardSummary: this.stateSummary(latestSnapshot?.rewardState),
      avatar: this.avatarSummary(avatar as unknown as Record<string, unknown>),
    };
    return {
      prompt,
      steps,
      resources,
      inputSummary: JSON.stringify({
        classroomRunId: run.id,
        runVersion: run.version,
        currentStepIndex: run.currentStepIndex,
        serverRemainingMinutes: remainingMinutes,
        clientRecentEventCount: dto.recentEvents.length,
        teacherRequestLength: dto.teacherRequest.trim().length,
        serverEventTypes: safeEvents.map((event) => event.eventType),
        accessibleResourceIds: resources.map((resource) => resource.id),
      }),
    };
  }

  private async reserve(
    actor: JwtTeacherPayload,
    run: ClassroomRun,
    dto: ClassroomDirectorRequestDto,
    inputSummary: string,
  ) {
    try {
      const entity = await this.suggestions.save(
        this.suggestions.create({
          classroomRunId: run.id,
          teacherId: actor.sub,
          requestId: dto.requestId,
          runVersion: run.version,
          currentStepIndex: run.currentStepIndex,
          status: ClassroomDirectorSuggestionStatus.Processing,
          suggestionType: null,
          teacherMessage: null,
          reason: null,
          suggestedAction: null,
          resourceCandidates: '[]',
          confidence: null,
          requiresConfirmation: true,
          provider: null,
          model: null,
          inputSummary,
          outputJson: null,
          latencyMs: null,
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
          decision: null,
          editedTeacherMessage: null,
          editedSuggestedAction: null,
          executed: null,
          executionResult: null,
          decidedAt: null,
        }),
      );
      return { created: true as const, entity };
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      const entity = await this.suggestions.findOneByOrFail({
        teacherId: actor.sub,
        requestId: dto.requestId,
      });
      return { created: false as const, entity };
    }
  }

  private async finishReservation(
    entity: ClassroomDirectorSuggestion,
    result: ClassroomDirectorModelResultDto,
    generation: {
      status: ClassroomDirectorSuggestionStatus;
      provider: string;
      model: string;
      latencyMs: number;
      promptTokens: number | null;
      completionTokens: number | null;
      totalTokens: number | null;
    },
  ) {
    entity.status = generation.status;
    entity.suggestionType = result.suggestionType;
    entity.teacherMessage = result.teacherMessage;
    entity.reason = result.reason;
    entity.suggestedAction = result.suggestedAction
      ? JSON.stringify(result.suggestedAction)
      : null;
    entity.resourceCandidates = JSON.stringify(result.resourceCandidates);
    entity.confidence = result.confidence;
    entity.requiresConfirmation = result.requiresConfirmation;
    entity.provider = generation.provider;
    entity.model = generation.model;
    entity.outputJson = JSON.stringify(result);
    entity.latencyMs = generation.latencyMs;
    entity.promptTokens = generation.promptTokens;
    entity.completionTokens = generation.completionTokens;
    entity.totalTokens = generation.totalTokens;
    return this.suggestions.save(entity);
  }

  private filterResult(
    source: ClassroomDirectorModelResultDto,
    resources: ResourceResponse[],
    steps: ClassroomRunStepSnapshot[],
  ): ClassroomDirectorModelResultDto {
    const allowedResources = new Map(resources.map((item) => [item.id, item]));
    const allowedSteps = new Set(steps.map((item) => item.stepIndex));
    const candidates = source.resourceCandidates.filter((candidate) =>
      allowedResources.has(candidate.resourceId),
    );
    let action = source.suggestedAction ? { ...source.suggestedAction } : null;
    const reasons: string[] = [source.reason];
    if (action?.type !== source.suggestionType) {
      reasons.push('模型动作类型与建议类型不一致，已移除动作');
      action = null;
    }
    if (action?.resourceId && !allowedResources.has(action.resourceId)) {
      reasons.push('模型推荐的资源不可访问或未审核，已移除动作');
      action = null;
    }
    if (action?.stepIndex != null && !allowedSteps.has(action.stepIndex)) {
      reasons.push('模型建议的步骤编号不属于课堂快照，已移除动作');
      action = null;
    }
    if (
      source.suggestionType ===
        ClassroomDirectorSuggestionType.RecommendResource &&
      !candidates.length &&
      !action?.resourceId
    ) {
      return {
        suggestionType: ClassroomDirectorSuggestionType.Transition,
        teacherMessage:
          '当前没有通过权限和审核校验的资源，请教师继续当前环节或手动选择素材。',
        reason: `${reasons.join('；')}；没有有效资源，已降级为过渡建议。`,
        suggestedAction: null,
        resourceCandidates: [],
        confidence: Math.min(source.confidence, 0.4),
        requiresConfirmation: true,
      };
    }
    return {
      ...source,
      reason: reasons.join('；'),
      suggestedAction: action,
      resourceCandidates: candidates,
      confidence: source.confidence,
      requiresConfirmation:
        source.confidence < LOW_CONFIDENCE ||
        source.requiresConfirmation ||
        action !== null,
    };
  }

  private stateChangedFallback(): ClassroomDirectorModelResultDto {
    return {
      suggestionType: ClassroomDirectorSuggestionType.Transition,
      teacherMessage: '课堂状态已经变化，请教师刷新页面后再生成建议。',
      reason: '模型生成期间课堂步骤或状态发生变化，旧建议已失效。',
      suggestedAction: null,
      resourceCandidates: [],
      confidence: 0,
      requiresConfirmation: true,
    };
  }

  private async accessibleResources(
    actor: JwtTeacherPayload,
    steps: ClassroomRunStepSnapshot[],
  ) {
    const ids = Array.from(
      new Set(
        steps
          .map((step) => step.resourceId)
          .filter((id): id is number => id != null),
      ),
    );
    const result: ResourceResponse[] = [];
    for (const id of ids) {
      try {
        const resource = await this.resources.getOne(actor, id);
        if (resource.reviewStatus === ResourceReviewStatus.Approved)
          result.push(resource);
      } catch {
        // 越权或不存在的资源不进入模型上下文。
      }
    }
    return result;
  }

  private async validateEditedAction(
    actor: JwtTeacherPayload,
    classroomRunId: number,
    action: ClassroomDirectorSuggestedActionDto,
  ) {
    if (UNSAFE_SAVED_CONTENT.test(JSON.stringify(action)))
      throw new BadRequestException('修改后的动作包含不安全指令');
    if (action.stepIndex != null) {
      const exists = await this.steps.exists({
        where: { classroomRunId, stepIndex: action.stepIndex },
      });
      if (!exists) throw new BadRequestException('修改后的步骤编号无效');
    }
    if (action.resourceId != null) {
      const referenced = await this.steps.exists({
        where: { classroomRunId, resourceId: action.resourceId },
      });
      if (!referenced)
        throw new BadRequestException('修改后的资源不属于课堂快照');
      const resource = await this.resources.getOne(actor, action.resourceId);
      if (resource.reviewStatus !== ResourceReviewStatus.Approved)
        throw new BadRequestException('修改后的资源尚未审核通过');
    }
    return action;
  }

  private async requireCurrentRun(
    actor: JwtTeacherPayload,
    classroomRunId: number,
  ) {
    const run = await this.requireOwnedRun(actor, classroomRunId, true);
    if (
      ![ClassroomRunStatus.Running, ClassroomRunStatus.Paused].includes(
        run.status,
      )
    )
      throw new ConflictException('当前课堂状态不能生成AI导演建议');
    return run;
  }

  private async requireOwnedRun(
    actor: JwtTeacherPayload,
    classroomRunId: number,
    checkClassAccess: boolean,
  ) {
    const run = await this.runs.findOne({ where: { id: classroomRunId } });
    if (!run) throw new NotFoundException('课堂运行不存在');
    if (run.teacherId !== actor.sub)
      throw new ForbiddenException('只有当前课堂教师可以使用AI课堂导演');
    if (checkClassAccess)
      await this.access.requireClassAccess(actor, run.classId);
    return run;
  }

  private requireTeacher(actor: JwtTeacherPayload) {
    if (actor.userType !== AuthUserType.Teacher)
      throw new ForbiddenException('AI课堂导演仅供当前课堂教师使用');
  }

  private duplicateResponse(
    entity: ClassroomDirectorSuggestion,
    classroomRunId: number,
  ) {
    if (entity.classroomRunId !== classroomRunId)
      throw new ConflictException('requestId 已用于其他课堂');
    if (entity.status === ClassroomDirectorSuggestionStatus.Processing)
      throw new ConflictException('相同请求正在生成中，请稍后重试');
    return this.response(entity);
  }

  private response(entity: ClassroomDirectorSuggestion) {
    return {
      id: entity.id,
      classroomRunId: entity.classroomRunId,
      requestId: entity.requestId,
      status: entity.status,
      suggestionType: entity.suggestionType,
      teacherMessage: entity.teacherMessage,
      reason: entity.reason,
      suggestedAction: this.parseObject(entity.suggestedAction),
      resourceCandidates: this.parseArray(entity.resourceCandidates),
      confidence: entity.confidence,
      requiresConfirmation: entity.requiresConfirmation,
      decision: entity.decision,
      editedTeacherMessage: entity.editedTeacherMessage,
      editedSuggestedAction: this.parseObject(entity.editedSuggestedAction),
      executed: entity.executed,
      executionResult: entity.executionResult,
      decidedAt: entity.decidedAt,
      recordOnly: true,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  private safeEvent(event: ClassroomEvent): SafeEvent {
    let payload: Record<string, unknown> = {};
    try {
      const parsed: unknown = event.payload ? JSON.parse(event.payload) : {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        payload = parsed as Record<string, unknown>;
    } catch {
      payload = {};
    }
    return {
      eventType: event.eventType,
      createdAt: event.createdAt,
      ...(Number.isInteger(payload.stepIndex)
        ? { stepIndex: Number(payload.stepIndex) }
        : {}),
      ...(typeof payload.checkpointType === 'string'
        ? { checkpointType: payload.checkpointType.slice(0, 50) }
        : {}),
      ...(Number.isInteger(payload.resourceId)
        ? { resourceId: Number(payload.resourceId) }
        : {}),
    };
  }

  private stateSummary(value?: string) {
    if (!value) return { entryCount: 0 };
    try {
      const parsed: unknown = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        return { entryCount: 0 };
      const values = Object.values(parsed as Record<string, unknown>);
      return {
        entryCount: values.length,
        completedCount: values.filter(
          (item) => item === true || item === 'completed',
        ).length,
      };
    } catch {
      return { entryCount: 0 };
    }
  }

  private avatarSummary(value: Record<string, unknown>) {
    const character = value.character as
      { id?: number; name?: string; category?: string } | null | undefined;
    const version = value.version as
      | { id?: number; version?: number; engineVersion?: string }
      | null
      | undefined;
    const action = value.action as
      { requested?: string; effective?: string } | null | undefined;
    const voice = value.voice as
      | { provider?: string; language?: string; speed?: number }
      | null
      | undefined;
    return {
      character: character
        ? {
            id: character.id,
            name: character.name,
            category: character.category,
          }
        : null,
      version: version
        ? {
            id: version.id,
            version: version.version,
            engineVersion: version.engineVersion,
          }
        : null,
      action,
      voice,
      fallbackLevel: value.fallbackLevel,
      fallbackReason: value.reason,
    };
  }

  private currentElapsed(run: ClassroomRun) {
    if (run.status !== ClassroomRunStatus.Running || !run.resumedAt)
      return run.elapsedSeconds;
    return (
      run.elapsedSeconds +
      Math.max(0, Math.floor((Date.now() - run.resumedAt.getTime()) / 1000))
    );
  }

  private parseObject(value: string | null) {
    if (!value) return null;
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : null;
    } catch {
      return null;
    }
  }

  private parseArray(value: string) {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private isUniqueViolation(error: unknown) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : '';
    return code.includes('CONSTRAINT') || code === '23505';
  }

  private async safeWriteAi(
    input: Parameters<AuditService['writeAi']>[0],
  ): Promise<void> {
    try {
      await this.audit.writeAi(input);
    } catch {
      // AI审计日志失败不能改变已经落库的课堂建议或教师决定。
    }
  }
}
