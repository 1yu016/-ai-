import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { Repository } from 'typeorm';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { AuthUserType } from '../auth/entities/refresh-token-session.entity';
import { ClassroomRunStatus } from '../classroom-runs/classroom-run.types';
import { ClassroomRunStepSnapshot } from '../classroom-runs/entities/classroom-run-step-snapshot.entity';
import { ClassroomRun } from '../classroom-runs/entities/classroom-run.entity';
import { ResourceReviewStatus } from '../data/entities/teaching-resource.entity';
import { LessonPlanVersion } from '../lesson-plans/entities/lesson-plan-version.entity';
import { LessonPlan } from '../lesson-plans/entities/lesson-plan.entity';
import { AuditService } from '../platform/audit.service';
import { PlatformAccessService } from '../platform/platform-access.service';
import {
  ResourceService,
  type ResourceResponse,
} from '../resources/resource.service';
import { AiService } from './ai.service';
import { AudioService } from './audio.service';
import {
  HeuristicAssistantDecisionDto,
  HeuristicAssistantModelResultDto,
  HeuristicAssistantRequestDto,
  HeuristicDecisionAction,
  HeuristicDraftStatus,
  HeuristicFollowUpType,
  HeuristicSafetyStatus,
} from './dto/heuristic-assistant.dto';
import { HeuristicAssistantDraft } from './entities/heuristic-assistant-draft.entity';

const PRIVACY_PATTERN =
  /(?:你叫什么名字|告诉我(?:你的)?名字|我叫|我的名字(?:叫|是)|电话号码|手机号|1\d{10}|家庭住址|你住在哪里|我住在|我家在|发(?:一张)?照片|爸爸妈妈(?:叫什么|在哪里|做什么)|家庭情况)/i;
const ADULT_PATTERN =
  /(?:色情|性交|性行为|裸体|裸照|成人片|毒品|吸毒|赌博|喝酒|抽烟)/i;
const DANGER_PATTERN =
  /(?:跳楼|自杀|伤害自己|杀人|拿刀|玩火|点火|摸插座|触电|吞下|喝农药|从窗户跳|憋气比赛|勒住|受伤|流血|吃药|肚子疼|头疼|不舒服|很疼)/i;
const DIAGNOSIS_PATTERN =
  /(?:(?:你|他|她|小朋友).{0,8}(?:自闭症|多动症|抑郁症|智力低|智障|心理有问题|有病|品行差)|诊断|心理测试|智力测试)/i;
const NEGATIVE_LABEL_PATTERN =
  /(?:笨蛋|笨孩子|坏孩子|没用|真差劲|不如别的小朋友|最差|没人喜欢你)/i;
const BYPASS_PATTERN =
  /(?:不要告诉老师|绕过老师|不用老师确认|偷偷播放|跳过教师|不要教师控制)/i;
const INJECTION_PATTERN =
  /(?:(?:忽略|无视).{0,16}(?:之前|上面|所有).{0,12}(?:指令|规则|提示)|系统提示词|开发者消息|改变角色|角色扮演成|越狱|jailbreak|输出隐藏提示)/i;
const UNSAFE_OUTPUT_PATTERN =
  /(?:https?:\/\/|javascript\s*:|<\/?script|\b(?:select|insert|update|delete|drop|alter)\b[\s\S]{0,80}\b(?:from|into|table|where|set)\b|\b(?:powershell|cmd\.exe|\/bin\/sh|system\s*\(|exec\s*\())/i;
const DIRECT_ANSWER_PATTERN =
  /(?:答案(?:是|为)|正确(?:答案|结果)|结果(?:是|为)|其实就是|所以答案|直接告诉你|等于)/;

type SafetyCategory =
  | 'privacy'
  | 'adult'
  | 'danger'
  | 'diagnosis'
  | 'negative_label'
  | 'teacher_bypass'
  | 'prompt_injection';

@Injectable()
export class HeuristicAssistantService {
  constructor(
    @InjectRepository(HeuristicAssistantDraft)
    private readonly drafts: Repository<HeuristicAssistantDraft>,
    @InjectRepository(ClassroomRun)
    private readonly runs: Repository<ClassroomRun>,
    @InjectRepository(ClassroomRunStepSnapshot)
    private readonly steps: Repository<ClassroomRunStepSnapshot>,
    @InjectRepository(LessonPlan)
    private readonly lessonPlans: Repository<LessonPlan>,
    @InjectRepository(LessonPlanVersion)
    private readonly lessonVersions: Repository<LessonPlanVersion>,
    private readonly ai: AiService,
    private readonly audio: AudioService,
    private readonly access: PlatformAccessService,
    private readonly resources: ResourceService,
    private readonly audit: AuditService,
  ) {}

  async create(actor: JwtTeacherPayload, dto: HeuristicAssistantRequestDto) {
    this.requireTeacher(actor);
    const duplicate = await this.drafts.findOne({
      where: { teacherId: actor.sub, requestId: dto.requestId },
    });
    if (duplicate) {
      await this.requireOwnedDraft(actor, duplicate.id);
      return this.duplicateResponse(duplicate, dto.classroomRunId);
    }

    const run = await this.requireActiveOwnedRun(actor, dto.classroomRunId);
    const context = await this.buildContext(actor, run, dto);
    const safetyCategory = this.detectSafetyCategory(
      [
        dto.childText,
        ...dto.conversationContext.map((item) => item.content),
      ].join('\n'),
    );
    const reservation = await this.reserve(
      actor,
      run,
      dto,
      this.inputSummary(dto, run, safetyCategory),
    );
    if (!reservation.created)
      return this.duplicateResponse(reservation.entity, dto.classroomRunId);

    let result: HeuristicAssistantModelResultDto;
    let generation: Awaited<ReturnType<AiService['heuristicAssistant']>>;
    if (safetyCategory) {
      result = this.safetyRedirect(safetyCategory, context.hintLevel);
      generation = {
        result,
        status: HeuristicDraftStatus.Pending,
        provider: 'local-safety-filter',
        model: 'deterministic-v1',
        latencyMs: 0,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        errorCode: null,
      };
    } else {
      generation = await this.ai.heuristicAssistant({
        authoritativeContext: context.prompt,
        childText: this.redact(dto.childText),
        conversationContext: dto.conversationContext.slice(-6).map((item) => ({
          role: item.role,
          content: this.redact(item.content),
        })),
        targetHintLevel: context.hintLevel,
      });
      result = await this.filterResult(
        actor,
        generation.result,
        context.hintLevel,
        context.resource,
      );
    }

    const latestRun = await this.runs.findOne({ where: { id: run.id } });
    if (
      !latestRun ||
      latestRun.version !== run.version ||
      latestRun.currentStepIndex !== run.currentStepIndex ||
      ![ClassroomRunStatus.Running, ClassroomRunStatus.Paused].includes(
        latestRun.status,
      )
    ) {
      result = this.safeStateChanged(context.hintLevel);
      generation = {
        ...generation,
        status: HeuristicDraftStatus.Fallback,
        errorCode: 'CLASSROOM_STATE_CHANGED',
      };
    }

    const saved = await this.finishReservation(
      reservation.entity,
      result,
      generation,
    );
    await this.safeWriteAi({
      actor,
      feature: 'heuristic_assistant',
      provider: generation.provider,
      model: generation.model,
      requestId: dto.requestId,
      status: saved.status,
      latencyMs: generation.latencyMs,
      errorCode: generation.errorCode ?? undefined,
      metadata: {
        classroomRunId: run.id,
        currentStepIndex: run.currentStepIndex,
        attemptCount: dto.attemptCount,
        hintLevel: result.hintLevel,
        safetyStatus: result.safetyStatus,
        followUpType: result.followUpType,
        recommendedResourceId: result.recommendedResourceId,
        childTextLength: dto.childText.length,
        conversationTurns: dto.conversationContext.length,
        tokenUsage: {
          prompt: generation.promptTokens,
          completion: generation.completionTokens,
          total: generation.totalTokens,
        },
      },
    });
    return this.response(saved);
  }

  async getOne(actor: JwtTeacherPayload, id: number) {
    const draft = await this.requireOwnedDraft(actor, id);
    return this.response(draft);
  }

  async decide(
    actor: JwtTeacherPayload,
    id: number,
    dto: HeuristicAssistantDecisionDto,
  ) {
    const draft = await this.requireOwnedDraft(actor, id);
    if (draft.status === HeuristicDraftStatus.Processing)
      throw new ConflictException('启发式草稿仍在生成中');
    if (
      [HeuristicDraftStatus.Discarded, HeuristicDraftStatus.Aborted].includes(
        draft.status,
      )
    )
      throw new ConflictException('该互动已经结束，不能继续修改或确认');

    if (dto.action === HeuristicDecisionAction.Edit) {
      if (!dto.editedResponseText)
        throw new BadRequestException('编辑草稿时必须提供修改后的内容');
      draft.editedResponseText = this.validateTeacherEdit(
        dto.editedResponseText,
        draft.hintLevel ?? 1,
      );
      draft.status = HeuristicDraftStatus.Edited;
      draft.decidedAt = null;
    } else if (dto.action === HeuristicDecisionAction.Confirm) {
      if (draft.status === HeuristicDraftStatus.Confirmed)
        return this.response(draft);
      draft.status = HeuristicDraftStatus.Confirmed;
      draft.decidedAt = new Date();
    } else if (dto.action === HeuristicDecisionAction.Discard) {
      draft.status = HeuristicDraftStatus.Discarded;
      draft.decidedAt = new Date();
    } else {
      draft.status = HeuristicDraftStatus.Aborted;
      draft.decidedAt = new Date();
    }
    const saved = await this.drafts.save(draft);
    await this.safeWriteAi({
      actor,
      feature: 'heuristic_assistant_decision',
      provider: draft.provider ?? undefined,
      model: draft.model ?? undefined,
      requestId: draft.requestId,
      status: dto.action,
      metadata: {
        classroomRunId: draft.classroomRunId,
        draftId: draft.id,
        action: dto.action,
        editedTextLength: draft.editedResponseText?.length ?? 0,
      },
    });
    return this.response(saved);
  }

  async play(actor: JwtTeacherPayload, id: number) {
    const draft = await this.requireOwnedDraft(actor, id);
    await this.requireActiveOwnedRun(actor, draft.classroomRunId);
    if (draft.status !== HeuristicDraftStatus.Confirmed)
      throw new ConflictException('草稿尚未由教师确认，不能正式播放');
    const text = draft.editedResponseText ?? draft.responseText;
    if (!text) throw new ConflictException('没有可播放的启发式内容');
    const audioUrl = await this.audio.tts(text);
    draft.ttsPlayedAt = new Date();
    await this.drafts.save(draft);
    await this.safeWriteAi({
      actor,
      feature: 'heuristic_assistant_tts',
      provider: draft.provider ?? undefined,
      model: draft.model ?? undefined,
      requestId: draft.requestId,
      status: 'played',
      metadata: {
        classroomRunId: draft.classroomRunId,
        draftId: draft.id,
        textLength: text.length,
      },
    });
    return { id: draft.id, audioUrl, playedAt: draft.ttsPlayedAt };
  }

  private async buildContext(
    actor: JwtTeacherPayload,
    run: ClassroomRun,
    dto: HeuristicAssistantRequestDto,
  ) {
    const [schoolClass, step, plan, version] = await Promise.all([
      this.access.requireClassAccess(actor, run.classId),
      this.steps.findOne({
        where: {
          classroomRunId: run.id,
          stepIndex: run.currentStepIndex,
        },
      }),
      this.lessonPlans.findOne({ where: { id: run.lessonPlanId } }),
      this.lessonVersions.findOne({
        where: {
          lessonPlanId: run.lessonPlanId,
          versionNo: run.lessonPlanVersion,
        },
      }),
    ]);
    if (!step) throw new ConflictException('当前课堂步骤不存在');
    if (!plan) throw new ConflictException('课堂对应教案不存在');
    const versionSnapshot = this.parseJsonObject(version?.snapshotJson);
    const objectives =
      typeof versionSnapshot.objectives === 'string'
        ? versionSnapshot.objectives
        : plan.objectives;
    const resource = await this.currentResource(actor, step.resourceId);
    const hintLevel = Math.min(5, dto.attemptCount + 1);
    return {
      hintLevel,
      resource,
      prompt: {
        classroom: {
          classroomRunId: run.id,
          status: run.status,
          ageRange: schoolClass.ageRange,
          lessonTitle: run.title,
        },
        currentStep: {
          stepIndex: step.stepIndex,
          title: step.title,
          type: step.type,
          content: step.content.slice(0, 800),
        },
        teachingObjectives: objectives.slice(0, 1000),
        currentResource: resource
          ? {
              id: resource.id,
              title: resource.title,
              type: resource.resourceType,
            }
          : null,
        teacherSettings: {
          requestedActivityGoal: this.redact(dto.activityGoal),
          stepActions: this.safeActionSummary(step.actionConfig),
        },
        attemptCount: dto.attemptCount,
        targetHintLevel: hintLevel,
        availableResources: resource
          ? [{ id: resource.id, title: resource.title }]
          : [],
      },
    };
  }

  private async currentResource(
    actor: JwtTeacherPayload,
    resourceId: number | null,
  ): Promise<ResourceResponse | null> {
    if (!resourceId) return null;
    try {
      const resource = await this.resources.getOne(actor, resourceId);
      return resource.reviewStatus === ResourceReviewStatus.Approved
        ? resource
        : null;
    } catch {
      return null;
    }
  }

  private async filterResult(
    actor: JwtTeacherPayload,
    source: HeuristicAssistantModelResultDto,
    hintLevel: number,
    currentResource: ResourceResponse | null,
  ): Promise<HeuristicAssistantModelResultDto> {
    const outputSafetyCategory = this.detectSafetyCategory(source.responseText);
    if (
      source.safetyStatus === HeuristicSafetyStatus.SafetyRedirect ||
      outputSafetyCategory
    )
      return this.safetyRedirect(outputSafetyCategory ?? 'privacy', hintLevel);
    let resourceId = source.recommendedResourceId;
    if (resourceId != null) {
      if (!currentResource || resourceId !== currentResource.id) {
        resourceId = null;
      } else {
        try {
          const resource = await this.resources.getOne(actor, resourceId);
          if (resource.reviewStatus !== ResourceReviewStatus.Approved)
            resourceId = null;
        } catch {
          resourceId = null;
        }
      }
    }
    const responseText = this.sanitizeModelResponse(
      source.responseText,
      hintLevel,
    );
    return {
      responseText,
      hintLevel,
      safetyStatus: source.safetyStatus,
      followUpType: this.followUpForLevel(hintLevel, source.followUpType),
      recommendedResourceId: resourceId,
      requiresTeacherConfirmation: true,
    };
  }

  private sanitizeModelResponse(value: string, hintLevel: number) {
    let text = value
      .replace(/你错了|答错了|不对/g, '我们再试试看')
      .replace(/真聪明|你好聪明/g, '你观察得很认真')
      .replace(/笨蛋|笨孩子|坏孩子|没用|差劲/g, '继续试试看')
      .replace(/不如别的小朋友|比.+?差/g, '每个人都可以按自己的速度试一试')
      .replace(/\s+/g, ' ')
      .trim();
    if (
      !text ||
      UNSAFE_OUTPUT_PATTERN.test(text) ||
      NEGATIVE_LABEL_PATTERN.test(text) ||
      (hintLevel < 5 && DIRECT_ANSWER_PATTERN.test(text))
    )
      return this.localHint(hintLevel).responseText;
    let questionCount = 0;
    text = text.replace(/[？?]/g, (mark) => {
      questionCount += 1;
      return questionCount === 1 ? mark : '。';
    });
    const sentences = text.match(/[^。！？!?]+[。！？!?]?/g) ?? [text];
    const compact = sentences.slice(0, 3).join('').slice(0, 240).trim();
    return compact || this.localHint(hintLevel).responseText;
  }

  private validateTeacherEdit(value: string, hintLevel: number) {
    if (
      UNSAFE_OUTPUT_PATTERN.test(value) ||
      NEGATIVE_LABEL_PATTERN.test(value) ||
      ADULT_PATTERN.test(value) ||
      DANGER_PATTERN.test(value) ||
      DIAGNOSIS_PATTERN.test(value) ||
      PRIVACY_PATTERN.test(value)
    )
      throw new BadRequestException('修改后的内容包含不适合幼儿播放的信息');
    return this.sanitizeModelResponse(value, hintLevel);
  }

  private safetyRedirect(category: SafetyCategory, hintLevel: number) {
    const danger = category === 'danger' || category === 'adult';
    return {
      responseText: danger
        ? '先不要尝试这件事。请马上告诉身边的老师，让老师来帮助你。'
        : '这件事不要在这里继续说。请告诉身边的老师，让老师来陪你处理。',
      hintLevel,
      safetyStatus: HeuristicSafetyStatus.SafetyRedirect,
      followUpType: HeuristicFollowUpType.TeacherHelp,
      recommendedResourceId: null,
      requiresTeacherConfirmation: true,
    };
  }

  private safeStateChanged(hintLevel: number) {
    return {
      responseText: '课堂环节已经变化，请老师重新查看后再决定怎么引导。',
      hintLevel,
      safetyStatus: HeuristicSafetyStatus.Filtered,
      followUpType: HeuristicFollowUpType.None,
      recommendedResourceId: null,
      requiresTeacherConfirmation: true,
    };
  }

  private localHint(hintLevel: number): HeuristicAssistantModelResultDto {
    const hints: Record<
      number,
      { responseText: string; followUpType: HeuristicFollowUpType }
    > = {
      1: {
        responseText: '你愿意想一想很棒。先看一看眼前的东西，你发现了什么呀？',
        followUpType: HeuristicFollowUpType.Observe,
      },
      2: {
        responseText: '你正在认真尝试。把这两个放在一起比一比，哪里不一样呀？',
        followUpType: HeuristicFollowUpType.Compare,
      },
      3: {
        responseText: '你没有放弃，真不错。试着数一数或摸一摸，会发现什么呀？',
        followUpType: HeuristicFollowUpType.Operate,
      },
      4: {
        responseText: '你已经试了好几次。你觉得更像第一个，还是第二个呀？',
        followUpType: HeuristicFollowUpType.Choice,
      },
      5: {
        responseText: '我们一起看看答案，再用实物试一试验证它，好吗？',
        followUpType: HeuristicFollowUpType.Verify,
      },
    };
    const selected = hints[hintLevel] ?? hints[5]!;
    return {
      ...selected,
      hintLevel,
      safetyStatus: HeuristicSafetyStatus.Safe,
      recommendedResourceId: null,
      requiresTeacherConfirmation: true,
    };
  }

  private followUpForLevel(hintLevel: number, source: HeuristicFollowUpType) {
    const fixed: Record<number, HeuristicFollowUpType> = {
      1: HeuristicFollowUpType.Observe,
      2: HeuristicFollowUpType.Compare,
      3: HeuristicFollowUpType.Operate,
      4: HeuristicFollowUpType.Choice,
      5: HeuristicFollowUpType.Verify,
    };
    return fixed[hintLevel] ?? source;
  }

  private detectSafetyCategory(value: string): SafetyCategory | null {
    if (INJECTION_PATTERN.test(value)) return 'prompt_injection';
    if (BYPASS_PATTERN.test(value)) return 'teacher_bypass';
    if (DANGER_PATTERN.test(value)) return 'danger';
    if (ADULT_PATTERN.test(value)) return 'adult';
    if (DIAGNOSIS_PATTERN.test(value)) return 'diagnosis';
    if (NEGATIVE_LABEL_PATTERN.test(value)) return 'negative_label';
    if (PRIVACY_PATTERN.test(value)) return 'privacy';
    return null;
  }

  private redact(value: string) {
    return value
      .replace(/1\d{10}/g, '[已脱敏电话]')
      .replace(/我叫[^，。！？!?\s]{1,12}/g, '[已脱敏姓名]')
      .replace(/我的名字(?:叫|是)[^，。！？!?\s]{1,12}/g, '[已脱敏姓名]')
      .replace(/我住在[^。！？!?]{1,80}/g, '[已脱敏地址]')
      .replace(/我家在[^。！？!?]{1,80}/g, '[已脱敏地址]')
      .replace(/爸爸妈妈[^。！？!?]{1,80}/g, '[已脱敏家庭信息]')
      .replace(INJECTION_PATTERN, '[已过滤指令]')
      .slice(0, 500);
  }

  private inputSummary(
    dto: HeuristicAssistantRequestDto,
    run: ClassroomRun,
    safetyCategory: SafetyCategory | null,
  ) {
    return JSON.stringify({
      classroomRunId: run.id,
      runVersion: run.version,
      currentStepIndex: run.currentStepIndex,
      attemptCount: dto.attemptCount,
      childTextLength: dto.childText.length,
      childTextHash: createHash('sha256').update(dto.childText).digest('hex'),
      conversationTurnCount: dto.conversationContext.length,
      activityGoalLength: dto.activityGoal.length,
      safetyCategory,
    });
  }

  private async reserve(
    actor: JwtTeacherPayload,
    run: ClassroomRun,
    dto: HeuristicAssistantRequestDto,
    inputSummary: string,
  ) {
    try {
      const entity = await this.drafts.save(
        this.drafts.create({
          classroomRunId: run.id,
          teacherId: actor.sub,
          requestId: dto.requestId,
          runVersion: run.version,
          currentStepIndex: run.currentStepIndex,
          attemptCount: dto.attemptCount,
          inputSummary,
          responseText: null,
          hintLevel: null,
          safetyStatus: null,
          followUpType: null,
          recommendedResourceId: null,
          requiresTeacherConfirmation: true,
          status: HeuristicDraftStatus.Processing,
          editedResponseText: null,
          decidedAt: null,
          ttsPlayedAt: null,
          provider: null,
          model: null,
          latencyMs: null,
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
        }),
      );
      return { created: true as const, entity };
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      const entity = await this.drafts.findOneByOrFail({
        teacherId: actor.sub,
        requestId: dto.requestId,
      });
      return { created: false as const, entity };
    }
  }

  private async finishReservation(
    draft: HeuristicAssistantDraft,
    result: HeuristicAssistantModelResultDto,
    generation: Awaited<ReturnType<AiService['heuristicAssistant']>>,
  ) {
    draft.responseText = result.responseText;
    draft.hintLevel = result.hintLevel;
    draft.safetyStatus = result.safetyStatus;
    draft.followUpType = result.followUpType;
    draft.recommendedResourceId = result.recommendedResourceId;
    draft.requiresTeacherConfirmation = true;
    draft.status = generation.status;
    draft.provider = generation.provider;
    draft.model = generation.model;
    draft.latencyMs = generation.latencyMs;
    draft.promptTokens = generation.promptTokens;
    draft.completionTokens = generation.completionTokens;
    draft.totalTokens = generation.totalTokens;
    return this.drafts.save(draft);
  }

  private async requireOwnedDraft(actor: JwtTeacherPayload, id: number) {
    this.requireTeacher(actor);
    const draft = await this.drafts.findOne({ where: { id } });
    if (!draft) throw new NotFoundException('启发式课堂助教草稿不存在');
    if (draft.teacherId !== actor.sub)
      throw new ForbiddenException('无权访问其他教师的互动草稿');
    const run = await this.runs.findOne({
      where: { id: draft.classroomRunId },
    });
    if (!run) throw new NotFoundException('课堂运行不存在');
    await this.access.requireClassAccess(actor, run.classId);
    return draft;
  }

  private async requireActiveOwnedRun(
    actor: JwtTeacherPayload,
    classroomRunId: number,
  ) {
    this.requireTeacher(actor);
    const run = await this.runs.findOne({ where: { id: classroomRunId } });
    if (!run) throw new NotFoundException('课堂运行不存在');
    if (run.teacherId !== actor.sub)
      throw new ForbiddenException('只有当前课堂教师可以使用启发式助教');
    await this.access.requireClassAccess(actor, run.classId);
    if (
      ![ClassroomRunStatus.Running, ClassroomRunStatus.Paused].includes(
        run.status,
      )
    )
      throw new ConflictException('当前课堂状态不能使用启发式助教');
    return run;
  }

  private requireTeacher(actor: JwtTeacherPayload) {
    if (actor.userType !== AuthUserType.Teacher)
      throw new ForbiddenException('启发式课堂助教仅供当前课堂教师使用');
  }

  private duplicateResponse(
    entity: HeuristicAssistantDraft,
    classroomRunId: number,
  ) {
    if (entity.classroomRunId !== classroomRunId)
      throw new ConflictException('requestId 已用于其他课堂');
    if (entity.status === HeuristicDraftStatus.Processing)
      throw new ConflictException('相同请求正在生成中，请稍后重试');
    return this.response(entity);
  }

  private response(draft: HeuristicAssistantDraft) {
    return {
      id: draft.id,
      classroomRunId: draft.classroomRunId,
      requestId: draft.requestId,
      responseText: draft.editedResponseText ?? draft.responseText,
      originalResponseText: draft.responseText,
      editedResponseText: draft.editedResponseText,
      hintLevel: draft.hintLevel,
      safetyStatus: draft.safetyStatus,
      followUpType: draft.followUpType,
      recommendedResourceId: draft.recommendedResourceId,
      requiresTeacherConfirmation: draft.requiresTeacherConfirmation,
      status: draft.status,
      ttsAllowed: draft.status === HeuristicDraftStatus.Confirmed,
      ttsPlayedAt: draft.ttsPlayedAt,
      conversationPersisted: false,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
    };
  }

  private safeActionSummary(value: string | null) {
    const parsed = this.parseJson(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 10).map((item) => {
      if (!item || typeof item !== 'object') return {};
      const record = item as Record<string, unknown>;
      return {
        actionType:
          typeof record.actionType === 'string'
            ? record.actionType.slice(0, 50)
            : undefined,
        actionName:
          typeof record.actionName === 'string'
            ? record.actionName.slice(0, 50)
            : undefined,
      };
    });
  }

  private parseJson(value?: string | null): unknown {
    if (!value) return null;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }

  private parseJsonObject(value?: string | null) {
    const parsed = this.parseJson(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
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
      // 审计日志失败不改变已经生成或确认的互动草稿。
    }
  }
}
