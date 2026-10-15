import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, createHmac } from 'node:crypto';
import { IsNull, MoreThan, Repository } from 'typeorm';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { AuthUserType } from '../auth/entities/refresh-token-session.entity';
import { ClassroomRunService } from '../classroom-runs/classroom-run.service';
import {
  ClassroomCheckpointType,
  ClassroomRunStatus,
  TERMINAL_CLASSROOM_RUN_STATUSES,
} from '../classroom-runs/classroom-run.types';
import { ClassroomRun } from '../classroom-runs/entities/classroom-run.entity';
import { ClassroomRunStepSnapshot } from '../classroom-runs/entities/classroom-run-step-snapshot.entity';
import { ResourceReviewStatus } from '../data/entities/teaching-resource.entity';
import { Student } from '../platform/entities/student.entity';
import { PlatformAccessService } from '../platform/platform-access.service';
import { RecordStatus } from '../platform/platform.types';
import { ResourceService } from '../resources/resource.service';
import { AiService } from './ai.service';
import {
  ClassroomCommandParametersDto,
  ClassroomCommandRecognitionSource,
  ClassroomCommandRecordStatus,
  ClassroomCommandV2Intent,
  ClassroomCommandV2RequestDto,
  DownloadClassroomRulesQueryDto,
  ExecuteClassroomCommandDto,
  OfflineCommandResult,
  SaveClassroomCommandRuleDto,
  UploadOfflineCommandLogsDto,
} from './dto/classroom-command-v2.dto';
import { ClassroomCommandOfflineLog } from './entities/classroom-command-offline-log.entity';
import { ClassroomCommandRecord } from './entities/classroom-command-record.entity';
import { ClassroomCommandRule } from './entities/classroom-command-rule.entity';

const TOKEN_TTL_MS = 2 * 60 * 1000;
const RULE_BUNDLE_VERSION = 2026092801;
const LOW_CONFIDENCE = 0.85;
const UNSAFE_TEXT =
  /(?:https?:\/\/|javascript\s*:|<\/?script|\b(?:select|insert|update|delete|drop|alter)\b[\s\S]{0,80}\b(?:from|into|table|where|set)\b|(?:^|[\\/])(?:etc|windows|users|home)(?:[\\/]|$)|\.\.[\\/]|\b(?:powershell|cmd\.exe|\/bin\/sh|system\s*\(|exec\s*\())/i;

const CONFIRMATION_INTENTS = new Set<ClassroomCommandV2Intent>([
  ClassroomCommandV2Intent.CallStudent,
  ClassroomCommandV2Intent.Reward,
  ClassroomCommandV2Intent.BreakMode,
  ClassroomCommandV2Intent.ReturnToClass,
  ClassroomCommandV2Intent.NextStep,
  ClassroomCommandV2Intent.PreviousStep,
]);

const OFFLINE_SAFE_INTENTS = new Set<ClassroomCommandV2Intent>([
  ClassroomCommandV2Intent.NextPage,
  ClassroomCommandV2Intent.PreviousPage,
  ClassroomCommandV2Intent.Play,
  ClassroomCommandV2Intent.Pause,
  ClassroomCommandV2Intent.Resume,
  ClassroomCommandV2Intent.Stop,
  ClassroomCommandV2Intent.ZoomIn,
  ClassroomCommandV2Intent.ZoomOut,
  ClassroomCommandV2Intent.Mute,
  ClassroomCommandV2Intent.Unmute,
]);

type BuiltinRule = {
  intent: ClassroomCommandV2Intent;
  phrases: string[];
  pattern: RegExp;
  message: string;
  offlineSafe: boolean;
};

const BUILTIN_RULES: BuiltinRule[] = [
  rule(
    ClassroomCommandV2Intent.BreakMode,
    ['进入课间模式', '课间模式', 'start break mode'],
    /^(?:进入)?课间模式$|^start break mode$/i,
    '准备进入课间模式。',
  ),
  rule(
    ClassroomCommandV2Intent.ReturnToClass,
    ['返回课堂', '继续上课', 'return to class'],
    /^(?:返回课堂|继续上课)$|^return to class$/i,
    '准备返回课堂。',
  ),
  rule(
    ClassroomCommandV2Intent.NextStep,
    ['下一步', '下一个环节', 'next step'],
    /^(?:下一步|下一个环节)$|^next step$/i,
    '准备进入下一课堂步骤。',
  ),
  rule(
    ClassroomCommandV2Intent.PreviousStep,
    ['上一步', '前一个环节', 'previous step'],
    /^(?:上一步|前一个环节|返回上一步)$|^previous step$/i,
    '准备返回上一课堂步骤。',
  ),
  rule(
    ClassroomCommandV2Intent.NextPage,
    ['下一页', 'next page'],
    /^(?:下一页|翻到下一页)$|^next page$/i,
    '准备显示下一页。',
    true,
  ),
  rule(
    ClassroomCommandV2Intent.PreviousPage,
    ['上一页', 'previous page'],
    /^(?:上一页|翻到上一页)$|^previous page$/i,
    '准备显示上一页。',
    true,
  ),
  rule(
    ClassroomCommandV2Intent.ZoomIn,
    ['放大', 'zoom in'],
    /^(?:放大|放大一点)$|^zoom in$/i,
    '准备放大当前内容。',
    true,
  ),
  rule(
    ClassroomCommandV2Intent.ZoomOut,
    ['缩小', 'zoom out'],
    /^(?:缩小|缩小一点)$|^zoom out$/i,
    '准备缩小当前内容。',
    true,
  ),
  rule(
    ClassroomCommandV2Intent.Mute,
    ['静音', 'mute'],
    /^(?:静音|关闭声音)$|^mute$/i,
    '准备静音。',
    true,
  ),
  rule(
    ClassroomCommandV2Intent.Unmute,
    ['取消静音', 'unmute'],
    /^(?:取消静音|打开声音)$|^unmute$/i,
    '准备取消静音。',
    true,
  ),
  rule(
    ClassroomCommandV2Intent.Pause,
    ['暂停', 'pause'],
    /^(?:暂停|暂停播放|停一下)$|^pause$/i,
    '准备暂停播放。',
    true,
  ),
  rule(
    ClassroomCommandV2Intent.Resume,
    ['继续播放', 'resume'],
    /^(?:继续|继续播放|恢复播放)$|^resume$/i,
    '准备继续播放。',
    true,
  ),
  rule(
    ClassroomCommandV2Intent.Stop,
    ['停止播放', 'stop'],
    /^(?:停止|停止播放|结束播放)$|^stop$/i,
    '准备停止播放。',
    true,
  ),
  rule(
    ClassroomCommandV2Intent.Play,
    ['播放', 'play'],
    /^(?:播放|开始播放)$|^play$/i,
    '准备播放当前资源。',
    true,
  ),
];

function rule(
  intent: ClassroomCommandV2Intent,
  phrases: string[],
  pattern: RegExp,
  message: string,
  offlineSafe = false,
): BuiltinRule {
  return { intent, phrases, pattern, message, offlineSafe };
}

type Recognition = {
  intent: ClassroomCommandV2Intent;
  parameters: ClassroomCommandParametersDto;
  confidence: number;
  message: string;
  source: ClassroomCommandRecognitionSource;
  errorCode?: string | null;
};

type Candidate = {
  type: 'resource' | 'student';
  id: number;
  title: string;
};

@Injectable()
export class ClassroomCommandService {
  private readonly tokenSecret: string;

  constructor(
    @InjectRepository(ClassroomCommandRecord)
    private readonly records: Repository<ClassroomCommandRecord>,
    @InjectRepository(ClassroomCommandRule)
    private readonly rules: Repository<ClassroomCommandRule>,
    @InjectRepository(ClassroomCommandOfflineLog)
    private readonly offlineLogs: Repository<ClassroomCommandOfflineLog>,
    @InjectRepository(ClassroomRun)
    private readonly runs: Repository<ClassroomRun>,
    @InjectRepository(ClassroomRunStepSnapshot)
    private readonly steps: Repository<ClassroomRunStepSnapshot>,
    @InjectRepository(Student)
    private readonly students: Repository<Student>,
    private readonly config: ConfigService,
    private readonly ai: AiService,
    private readonly access: PlatformAccessService,
    private readonly resources: ResourceService,
    private readonly classroomRuns: ClassroomRunService,
  ) {
    const tokenSecret =
      this.config.get<string>('JWT_ACCESS_SECRET')?.trim() ||
      this.config.get<string>('JWT_SECRET')?.trim();
    if (!tokenSecret || tokenSecret.length < 16)
      throw new Error('缺少安全的 JWT_ACCESS_SECRET（至少 16 个字符）');
    this.tokenSecret = tokenSecret;
  }

  async recognize(actor: JwtTeacherPayload, dto: ClassroomCommandV2RequestDto) {
    this.requireTeacher(actor);
    const duplicate = await this.records.findOne({
      where: { teacherId: actor.sub, requestId: dto.requestId },
    });
    if (duplicate) {
      await this.requireRun(actor, duplicate.classroomRunId);
      if (duplicate.classroomRunId !== dto.classroomRunId)
        throw new ConflictException('requestId 已用于其他课堂');
      if (duplicate.status === ClassroomCommandRecordStatus.Processing)
        throw new ConflictException('相同指令正在识别中');
      return this.response(duplicate);
    }

    const run = await this.requireRun(actor, dto.classroomRunId);
    if (UNSAFE_TEXT.test(dto.text)) {
      return this.persistImmediateUnknown(
        actor,
        run,
        dto,
        '指令包含不安全内容，已拒绝识别。',
      );
    }
    const reserved = await this.reserve(actor, run, dto);
    if (!reserved.created) return this.response(reserved.entity);

    let recognition = await this.recognizeCustom(actor, dto);
    recognition ??= this.recognizeLocal(dto.text);
    if (!recognition) {
      const model = await this.ai.classifyClassroomCommandV2({
        text: dto.text.trim(),
        locale: dto.locale,
        authoritativeContext: {
          classroomRunId: run.id,
          status: run.status,
          currentStepIndex: run.currentStepIndex,
          stepCount: await this.steps.countBy({ classroomRunId: run.id }),
          playerStatus: dto.context.playerStatus ?? null,
          currentPage: dto.context.currentPage ?? null,
        },
      });
      recognition = {
        ...model.result,
        source: ClassroomCommandRecognitionSource.Ai,
        errorCode: model.errorCode,
      };
    }

    let resolved: Awaited<
      ReturnType<ClassroomCommandService['resolveParameters']>
    >;
    try {
      resolved = await this.resolveParameters(actor, run, dto, recognition);
    } catch (error) {
      reserved.entity.source = recognition.source;
      reserved.entity.intent = recognition.intent;
      reserved.entity.confidence = recognition.confidence;
      reserved.entity.status = ClassroomCommandRecordStatus.Rejected;
      reserved.entity.message = '指令参数或目标无效，已拒绝执行。';
      reserved.entity.errorCode = this.errorCode(error);
      await this.records.save(reserved.entity);
      throw error;
    }
    const lowConfidence = recognition.confidence < LOW_CONFIDENCE;
    const requiresConfirmation =
      lowConfidence || CONFIRMATION_INTENTS.has(recognition.intent);
    const needsSelection = resolved.selectionRequired;
    const intent = Object.values(ClassroomCommandV2Intent).includes(
      recognition.intent,
    )
      ? recognition.intent
      : ClassroomCommandV2Intent.Unknown;
    const status =
      intent === ClassroomCommandV2Intent.Unknown
        ? ClassroomCommandRecordStatus.Unknown
        : needsSelection
          ? ClassroomCommandRecordStatus.AwaitingSelection
          : ClassroomCommandRecordStatus.Recognized;

    const record = reserved.entity;
    record.source = recognition.source;
    record.intent = intent;
    record.parameters = JSON.stringify(resolved.parameters);
    record.confidence = recognition.confidence;
    record.candidates = JSON.stringify(resolved.candidates);
    record.requiresConfirmation = requiresConfirmation || needsSelection;
    record.status = status;
    record.message = needsSelection
      ? resolved.candidates.length
        ? '找到多个候选项，请教师选择后重新确认指令。'
        : '没有找到可执行的课堂对象，请换一种说法。'
      : recognition.message;
    record.errorCode = recognition.errorCode ?? null;
    if (status === ClassroomCommandRecordStatus.Recognized) {
      const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
      const token = this.executionToken(record);
      record.executionTokenHash = this.hash(token);
      record.executionTokenExpiresAt = expiresAt;
    }
    return this.response(await this.records.save(record));
  }

  async execute(actor: JwtTeacherPayload, dto: ExecuteClassroomCommandDto) {
    this.requireTeacher(actor);
    const tokenHash = this.hash(dto.executionToken);
    const record = await this.records.findOne({
      where: { executionTokenHash: tokenHash },
    });
    if (!record) throw new NotFoundException('执行凭证不存在或无效');
    if (record.teacherId !== actor.sub)
      throw new ForbiddenException('无权使用其他教师的执行凭证');
    if (record.executionTokenUsedAt)
      throw new ConflictException('执行凭证已使用，不能重放');
    if (
      !record.executionTokenExpiresAt ||
      record.executionTokenExpiresAt.getTime() <= Date.now()
    ) {
      record.status = ClassroomCommandRecordStatus.Rejected;
      record.errorCode = 'TOKEN_EXPIRED';
      await this.records.save(record);
      throw new ConflictException('执行凭证已过期');
    }
    await this.requireRun(actor, record.classroomRunId);
    const claimedAt = new Date();
    const claimed = await this.records.update(
      {
        id: record.id,
        teacherId: actor.sub,
        status: ClassroomCommandRecordStatus.Recognized,
        executionTokenUsedAt: IsNull(),
      },
      {
        status: ClassroomCommandRecordStatus.Executing,
        confirmedAt: claimedAt,
        executionTokenUsedAt: claimedAt,
      },
    );
    if (claimed.affected !== 1)
      throw new ConflictException('执行凭证正在使用或已失效');
    record.status = ClassroomCommandRecordStatus.Executing;
    record.confirmedAt = claimedAt;
    record.executionTokenUsedAt = claimedAt;

    try {
      const run = await this.requireRun(actor, record.classroomRunId);
      const parameters = this.parseParameters(record.parameters);
      const result = await this.executeWhitelisted(
        actor,
        run,
        record,
        parameters,
        dto.requestId,
      );
      record.status = ClassroomCommandRecordStatus.Executed;
      record.executionResult = JSON.stringify(result);
      record.errorCode = null;
      await this.records.save(record);
      return {
        id: record.id,
        intent: record.intent,
        status: record.status,
        confirmed: true,
        result,
        message: '课堂指令已按白名单执行。',
      };
    } catch (error) {
      record.status = ClassroomCommandRecordStatus.Error;
      record.errorCode = this.errorCode(error);
      record.executionResult = null;
      await this.records.save(record);
      throw error;
    }
  }

  async saveRule(actor: JwtTeacherPayload, dto: SaveClassroomCommandRuleDto) {
    this.requireTeacher(actor);
    if (dto.intent === ClassroomCommandV2Intent.Unknown)
      throw new BadRequestException('自定义短语不能映射到unknown');
    if (UNSAFE_TEXT.test(dto.phrase))
      throw new BadRequestException('自定义短语包含不安全内容');
    const normalizedPhrase = this.normalize(dto.phrase);
    if (!normalizedPhrase) throw new BadRequestException('自定义短语不能为空');
    const builtin = this.recognizeLocal(dto.phrase);
    if (builtin && builtin.intent !== dto.intent)
      throw new ConflictException('该短语与系统白名单规则映射冲突');
    const template = this.sanitizeParameterTemplate(
      dto.parameterTemplate ?? {},
    );
    this.validateParametersForIntent(dto.intent, template);
    const locale = dto.locale.toLowerCase();
    let entity = await this.rules.findOne({
      where: { teacherId: actor.sub, locale, normalizedPhrase },
    });
    if (entity && entity.intent !== dto.intent)
      throw new ConflictException('相同短语已映射到其他白名单意图');
    const validUntil = dto.validUntil ? new Date(dto.validUntil) : null;
    if (validUntil && validUntil.getTime() <= Date.now())
      throw new BadRequestException('规则有效期必须晚于当前时间');
    if (entity) {
      entity.phrase = dto.phrase.trim();
      entity.parameterTemplate = JSON.stringify(template);
      entity.priority = dto.priority ?? entity.priority;
      entity.validUntil = validUntil;
      entity.active = true;
      entity.version += 1;
    } else {
      entity = this.rules.create({
        teacherId: actor.sub,
        locale,
        phrase: dto.phrase.trim(),
        normalizedPhrase,
        intent: dto.intent,
        parameterTemplate: JSON.stringify(template),
        priority: dto.priority ?? 200,
        version: 1,
        active: true,
        validUntil,
      });
    }
    const saved = await this.rules.save(entity);
    return this.ruleResponse(saved);
  }

  async downloadRules(
    actor: JwtTeacherPayload,
    query: DownloadClassroomRulesQueryDto,
  ) {
    this.requireTeacher(actor);
    const now = new Date();
    const locale = query.locale.toLowerCase();
    const custom = await this.rules.find({
      where: [
        { teacherId: actor.sub, locale, active: true, validUntil: IsNull() },
        {
          teacherId: actor.sub,
          locale,
          active: true,
          validUntil: MoreThan(now),
        },
      ],
      order: { priority: 'DESC', id: 'ASC' },
    });
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const ruleVersion =
      RULE_BUNDLE_VERSION +
      custom.reduce((sum, item) => sum + item.id * item.version, 0);
    return {
      ruleVersion,
      locale,
      generatedAt: now,
      expiresAt,
      rules: [
        ...BUILTIN_RULES.filter((item) => item.offlineSafe).flatMap((item) =>
          item.phrases.map((phrase) => ({
            phrase,
            intent: item.intent,
            parameterTemplate: {},
            priority: 100,
            version: ruleVersion,
            validUntil: expiresAt,
            source: ClassroomCommandRecognitionSource.Local,
          })),
        ),
        ...custom
          .filter((item) => OFFLINE_SAFE_INTENTS.has(item.intent))
          .map((item) => ({
            phrase: item.phrase,
            intent: item.intent,
            parameterTemplate: this.parseJsonObject(item.parameterTemplate),
            priority: item.priority,
            version: item.version,
            validUntil: item.validUntil ?? expiresAt,
            source: ClassroomCommandRecognitionSource.Custom,
          })),
      ],
    };
  }

  async uploadOfflineLogs(
    actor: JwtTeacherPayload,
    dto: UploadOfflineCommandLogsDto,
  ) {
    this.requireTeacher(actor);
    let accepted = 0;
    let duplicates = 0;
    for (const item of dto.logs) {
      await this.requireRunOwnership(actor, item.classroomRunId);
      if (
        item.result === OfflineCommandResult.Executed &&
        !OFFLINE_SAFE_INTENTS.has(item.intent)
      )
        throw new BadRequestException(
          `离线模式禁止执行${item.intent}，只能上传拒绝或错误日志`,
        );
      const existing = await this.offlineLogs.findOne({
        where: { teacherId: actor.sub, localEventId: item.localEventId },
      });
      if (existing) {
        duplicates += 1;
        continue;
      }
      const parameters = this.sanitizeParameterTemplate(item.parameters);
      this.validateParametersForIntent(item.intent, parameters);
      if (
        item.result === OfflineCommandResult.Executed &&
        item.intent === ClassroomCommandV2Intent.Play &&
        typeof parameters.resourceId === 'number'
      )
        await this.requireApprovedResource(actor, parameters.resourceId);
      await this.offlineLogs.save(
        this.offlineLogs.create({
          classroomRunId: item.classroomRunId,
          teacherId: actor.sub,
          localEventId: item.localEventId,
          textHash: this.hash(item.text.trim()),
          intent: item.intent,
          parameters: JSON.stringify(parameters),
          ruleVersion: item.ruleVersion,
          result: item.result,
          errorCode: item.errorCode ?? null,
          executedAt: new Date(item.executedAt),
        }),
      );
      accepted += 1;
    }
    return { accepted, duplicates };
  }

  private async recognizeCustom(
    actor: JwtTeacherPayload,
    dto: ClassroomCommandV2RequestDto,
  ): Promise<Recognition | null> {
    const ruleEntity = await this.rules.findOne({
      where: {
        teacherId: actor.sub,
        locale: dto.locale.toLowerCase(),
        normalizedPhrase: this.normalize(dto.text),
        active: true,
      },
    });
    if (!ruleEntity) return null;
    if (ruleEntity.validUntil && ruleEntity.validUntil.getTime() <= Date.now())
      return null;
    return {
      intent: ruleEntity.intent,
      parameters: this.parseParameters(ruleEntity.parameterTemplate),
      confidence: 1,
      message: '已匹配教师自定义课堂指令。',
      source: ClassroomCommandRecognitionSource.Custom,
    };
  }

  private recognizeLocal(text: string): Recognition | null {
    const normalized = this.normalize(text);
    const call = normalized.match(
      /^(?:请)?(?:点名|请|叫)(.+?)(?:小朋友)?(?:回答|起来|发言)?$|^(?:call on|ask)\s+(.+)$/i,
    );
    if (call) {
      const studentName = (call[1] ?? call[2] ?? '').trim();
      return {
        intent: ClassroomCommandV2Intent.CallStudent,
        parameters: studentName ? { studentName } : {},
        confidence: 0.98,
        message: '准备点名，请教师确认。',
        source: ClassroomCommandRecognitionSource.Local,
      };
    }
    if (/^(?:随机点名|随机请一位小朋友)$|^call a student$/i.test(normalized))
      return {
        intent: ClassroomCommandV2Intent.CallStudent,
        parameters: {},
        confidence: 0.99,
        message: '准备随机点名，请教师确认。',
        source: ClassroomCommandRecognitionSource.Local,
      };
    const reward = normalized.match(
      /^(?:奖励|给)(.+?)(?:小朋友)?(?:一朵)?(?:小红花|小花|奖励)$|^reward\s+(.+)$/i,
    );
    if (reward) {
      const studentName = (reward[1] ?? reward[2] ?? '').trim();
      return {
        intent: ClassroomCommandV2Intent.Reward,
        parameters: studentName ? { studentName } : {},
        confidence: 0.98,
        message: '准备记录奖励，请教师确认。',
        source: ClassroomCommandRecognitionSource.Local,
      };
    }
    const playResource = normalized.match(
      /^(?:播放|播一下|放一下|play)\s*(.+)$/i,
    );
    if (playResource?.[1])
      return {
        intent: ClassroomCommandV2Intent.Play,
        parameters: { resourceKeyword: playResource[1].trim() },
        confidence: 0.98,
        message: '准备播放匹配的课堂资源。',
        source: ClassroomCommandRecognitionSource.Local,
      };
    const builtin = BUILTIN_RULES.find((item) => item.pattern.test(normalized));
    return builtin
      ? {
          intent: builtin.intent,
          parameters: {},
          confidence: 0.99,
          message: builtin.message,
          source: ClassroomCommandRecognitionSource.Local,
        }
      : null;
  }

  private async resolveParameters(
    actor: JwtTeacherPayload,
    run: ClassroomRun,
    dto: ClassroomCommandV2RequestDto,
    recognition: Recognition,
  ): Promise<{
    parameters: ClassroomCommandParametersDto;
    candidates: Candidate[];
    selectionRequired: boolean;
  }> {
    const parameters = this.sanitizeParameters(recognition.parameters);
    this.validateParametersForIntent(
      recognition.intent,
      parameters as unknown as Record<string, unknown>,
    );
    if (recognition.intent === ClassroomCommandV2Intent.Play) {
      if (parameters.resourceKeyword) {
        const matches = (
          await this.resources.search(
            actor,
            parameters.resourceKeyword,
            dto.context.resourceType,
          )
        ).filter((item) => item.reviewStatus === ResourceReviewStatus.Approved);
        const candidates = matches.slice(0, 5).map((item) => ({
          type: 'resource' as const,
          id: item.id,
          title: item.title,
        }));
        if (dto.context.currentResourceId) {
          const selected = matches.find(
            (item) => item.id === dto.context.currentResourceId,
          );
          if (!selected)
            throw new BadRequestException('选择的资源不在当前候选列表中');
          await this.requireApprovedResource(actor, selected.id);
          parameters.resourceId = selected.id;
          return { parameters, candidates: [], selectionRequired: false };
        }
        if (matches.length === 1) parameters.resourceId = matches[0]!.id;
        else delete parameters.resourceId;
        return {
          parameters,
          candidates,
          selectionRequired: matches.length !== 1,
        };
      }
      if (parameters.resourceId ?? dto.context.currentResourceId) {
        const id = parameters.resourceId ?? dto.context.currentResourceId!;
        const resource = await this.requireApprovedResource(actor, id);
        parameters.resourceId = resource.id;
      }
    }
    if (
      recognition.intent === ClassroomCommandV2Intent.CallStudent ||
      recognition.intent === ClassroomCommandV2Intent.Reward
    ) {
      const activeStudents = await this.students.find({
        where: { classId: run.classId, status: RecordStatus.Active },
        order: { id: 'ASC' },
      });
      const selectedId = parameters.studentId ?? dto.context.selectedStudentId;
      if (selectedId) {
        const student = activeStudents.find((item) => item.id === selectedId);
        if (!student) throw new BadRequestException('学生不属于当前课堂班级');
        parameters.studentId = student.id;
        delete parameters.studentName;
        return { parameters, candidates: [], selectionRequired: false };
      }
      if (parameters.studentName) {
        const keyword = this.normalize(parameters.studentName);
        const matched = activeStudents.filter(
          (item) =>
            this.normalize(item.name) === keyword ||
            (item.nickname && this.normalize(item.nickname) === keyword),
        );
        const candidates = matched.map((item) => ({
          type: 'student' as const,
          id: item.id,
          title: item.nickname ?? item.name,
        }));
        if (matched.length === 1) parameters.studentId = matched[0]!.id;
        else delete parameters.studentId;
        return {
          parameters,
          candidates,
          selectionRequired: matched.length !== 1,
        };
      }
      if (
        recognition.intent === ClassroomCommandV2Intent.CallStudent &&
        activeStudents.length
      ) {
        const selected =
          activeStudents[recordSeed(run.id, activeStudents.length)]!;
        parameters.studentId = selected.id;
      }
    }
    const requiredStudentMissing =
      (recognition.intent === ClassroomCommandV2Intent.Reward ||
        recognition.intent === ClassroomCommandV2Intent.CallStudent) &&
      !parameters.studentId;
    return {
      parameters,
      candidates: [],
      selectionRequired: requiredStudentMissing,
    };
  }

  private async executeWhitelisted(
    actor: JwtTeacherPayload,
    run: ClassroomRun,
    record: ClassroomCommandRecord,
    parameters: ClassroomCommandParametersDto,
    executeRequestId: string,
  ) {
    const requestId = `cmd-${record.id}-${this.hash(executeRequestId).slice(0, 16)}`;
    if (record.intent === ClassroomCommandV2Intent.BreakMode)
      return this.classroomRuns.pause(actor, run.id, {
        requestId,
        version: run.version,
        deviceId: run.deviceId,
      });
    if (record.intent === ClassroomCommandV2Intent.ReturnToClass)
      return this.classroomRuns.resume(actor, run.id, {
        requestId,
        version: run.version,
        deviceId: run.deviceId,
      });
    if (
      record.intent === ClassroomCommandV2Intent.NextStep ||
      record.intent === ClassroomCommandV2Intent.PreviousStep
    ) {
      const stepIndex =
        run.currentStepIndex +
        (record.intent === ClassroomCommandV2Intent.NextStep ? 1 : -1);
      if (stepIndex < 0) throw new ConflictException('已经是第一个课堂步骤');
      return this.classroomRuns.changeStep(actor, run.id, {
        requestId,
        version: run.version,
        deviceId: run.deviceId,
        stepIndex,
      });
    }
    if (
      record.intent === ClassroomCommandV2Intent.CallStudent ||
      record.intent === ClassroomCommandV2Intent.Reward
    ) {
      if (!parameters.studentId)
        throw new BadRequestException('点名或奖励指令缺少有效学生');
      const student = await this.students.findOne({
        where: {
          id: parameters.studentId,
          classId: run.classId,
          status: RecordStatus.Active,
        },
      });
      if (!student) throw new ForbiddenException('学生不属于当前课堂班级');
      return this.classroomRuns.checkpoint(actor, run.id, {
        requestId,
        version: run.version,
        deviceId: run.deviceId,
        checkpointType:
          record.intent === ClassroomCommandV2Intent.CallStudent
            ? ClassroomCheckpointType.RollCall
            : ClassroomCheckpointType.Reward,
        ...(record.intent === ClassroomCommandV2Intent.CallStudent
          ? { rollCallState: { studentId: student.id, source: 'command' } }
          : { rewardState: { studentId: student.id, source: 'command' } }),
      });
    }
    if (
      record.intent === ClassroomCommandV2Intent.Play &&
      parameters.resourceId
    )
      await this.requireApprovedResource(actor, parameters.resourceId);
    return { action: record.intent, parameters };
  }

  private async requireRun(actor: JwtTeacherPayload, id: number) {
    const run = await this.requireRunOwnership(actor, id);
    if (
      (
        TERMINAL_CLASSROOM_RUN_STATUSES as readonly ClassroomRunStatus[]
      ).includes(run.status)
    )
      throw new ConflictException('课堂已结束，不能识别或执行课堂指令');
    return run;
  }

  private async requireRunOwnership(actor: JwtTeacherPayload, id: number) {
    const run = await this.runs.findOne({ where: { id } });
    if (!run) throw new NotFoundException('课堂运行不存在');
    if (run.teacherId !== actor.sub)
      throw new ForbiddenException('只有当前课堂教师可以操作课堂指令');
    await this.access.requireClassAccess(actor, run.classId);
    return run;
  }

  private async requireApprovedResource(actor: JwtTeacherPayload, id: number) {
    const resource = await this.resources.getOne(actor, id);
    if (resource.reviewStatus !== ResourceReviewStatus.Approved)
      throw new ConflictException('资源未审核通过，不能用于正式课堂');
    return resource;
  }

  private async reserve(
    actor: JwtTeacherPayload,
    run: ClassroomRun,
    dto: ClassroomCommandV2RequestDto,
  ) {
    try {
      const entity = await this.records.save(
        this.records.create({
          classroomRunId: run.id,
          teacherId: actor.sub,
          requestId: dto.requestId,
          textHash: this.hash(dto.text.trim()),
          locale: dto.locale.toLowerCase(),
          source: ClassroomCommandRecognitionSource.Local,
          intent: ClassroomCommandV2Intent.Unknown,
          parameters: '{}',
          confidence: 0,
          candidates: '[]',
          requiresConfirmation: true,
          executionTokenHash: null,
          executionTokenExpiresAt: null,
          executionTokenUsedAt: null,
          confirmedAt: null,
          status: ClassroomCommandRecordStatus.Processing,
          message: '正在识别课堂指令。',
          executionResult: null,
          errorCode: null,
        }),
      );
      return { created: true as const, entity };
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      const entity = await this.records.findOneByOrFail({
        teacherId: actor.sub,
        requestId: dto.requestId,
      });
      if (entity.status === ClassroomCommandRecordStatus.Processing)
        throw new ConflictException('相同指令正在识别中');
      return { created: false as const, entity };
    }
  }

  private async persistImmediateUnknown(
    actor: JwtTeacherPayload,
    run: ClassroomRun,
    dto: ClassroomCommandV2RequestDto,
    message: string,
  ) {
    const reservation = await this.reserve(actor, run, dto);
    if (!reservation.created) return this.response(reservation.entity);
    reservation.entity.status = ClassroomCommandRecordStatus.Rejected;
    reservation.entity.message = message;
    reservation.entity.errorCode = 'UNSAFE_INPUT';
    return this.response(await this.records.save(reservation.entity));
  }

  private response(record: ClassroomCommandRecord) {
    const token =
      record.executionTokenHash &&
      !record.executionTokenUsedAt &&
      record.executionTokenExpiresAt &&
      record.executionTokenExpiresAt.getTime() > Date.now()
        ? this.executionToken(record)
        : null;
    return {
      id: record.id,
      intent: record.intent,
      parameters: this.parseJsonObject(record.parameters),
      confidence: record.confidence,
      candidates: this.parseJsonArray(record.candidates),
      requiresConfirmation: record.requiresConfirmation,
      executionToken: token,
      executionTokenExpiresAt: token ? record.executionTokenExpiresAt : null,
      message: record.message,
      source: record.source,
      status: record.status,
    };
  }

  private executionToken(record: ClassroomCommandRecord) {
    const signature = createHmac('sha256', this.tokenSecret)
      .update(`${record.id}:${record.teacherId}:${record.requestId}`)
      .digest('base64url');
    return `${record.id}_${signature}`;
  }

  private sanitizeParameters(value: ClassroomCommandParametersDto) {
    return this.sanitizeParameterTemplate(
      value as unknown as Record<string, unknown>,
    ) as ClassroomCommandParametersDto;
  }

  private sanitizeParameterTemplate(value: Record<string, unknown>) {
    const allowed = new Set([
      'resourceId',
      'resourceKeyword',
      'studentId',
      'studentName',
    ]);
    const result: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value)) {
      if (!allowed.has(key))
        throw new BadRequestException(`指令参数${key}不在白名单中`);
      if ((key === 'resourceId' || key === 'studentId') && raw != null) {
        if (!Number.isInteger(raw) || Number(raw) < 1)
          throw new BadRequestException(`指令参数${key}无效`);
        result[key] = Number(raw);
      } else if (
        (key === 'resourceKeyword' || key === 'studentName') &&
        raw != null
      ) {
        if (typeof raw !== 'string' || raw.trim().length > 200)
          throw new BadRequestException(`指令参数${key}无效`);
        if (UNSAFE_TEXT.test(raw))
          throw new BadRequestException(`指令参数${key}包含不安全内容`);
        result[key] = raw.trim();
      }
    }
    return result;
  }

  private validateParametersForIntent(
    intent: ClassroomCommandV2Intent,
    parameters: Record<string, unknown>,
  ) {
    const allowed =
      intent === ClassroomCommandV2Intent.Play
        ? new Set(['resourceId', 'resourceKeyword'])
        : intent === ClassroomCommandV2Intent.CallStudent ||
            intent === ClassroomCommandV2Intent.Reward
          ? new Set(['studentId', 'studentName'])
          : new Set<string>();
    const illegal = Object.keys(parameters).find((key) => !allowed.has(key));
    if (illegal)
      throw new BadRequestException(`${intent}指令不允许使用参数${illegal}`);
  }

  private parseParameters(value: string) {
    return this.sanitizeParameters(this.parseJsonObject(value));
  }

  private parseJsonObject(value: string) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  private parseJsonArray(value: string): Candidate[] {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? (parsed as Candidate[]) : [];
    } catch {
      return [];
    }
  }

  private ruleResponse(entity: ClassroomCommandRule) {
    return {
      id: entity.id,
      phrase: entity.phrase,
      locale: entity.locale,
      intent: entity.intent,
      parameterTemplate: this.parseJsonObject(entity.parameterTemplate),
      priority: entity.priority,
      version: entity.version,
      validUntil: entity.validUntil,
      active: entity.active,
    };
  }

  private normalize(value: string) {
    return value
      .trim()
      .toLocaleLowerCase()
      .replace(/[，。！？!?、,.]/g, '')
      .replace(/\s+/g, ' ');
  }

  private hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private requireTeacher(actor: JwtTeacherPayload) {
    if (actor.userType !== AuthUserType.Teacher)
      throw new ForbiddenException('课堂指令仅供教师使用');
  }

  private isUniqueViolation(error: unknown) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : '';
    return code.includes('CONSTRAINT') || code === '23505';
  }

  private errorCode(error: unknown) {
    if (error instanceof ConflictException) return 'CONFLICT';
    if (error instanceof ForbiddenException) return 'FORBIDDEN';
    if (error instanceof NotFoundException) return 'NOT_FOUND';
    if (error instanceof BadRequestException) return 'INVALID_PARAMETER';
    return 'EXECUTION_ERROR';
  }
}

function recordSeed(runId: number, count: number) {
  return Math.abs(runId) % count;
}
