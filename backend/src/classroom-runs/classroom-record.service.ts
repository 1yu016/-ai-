import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Like, Repository } from 'typeorm';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { AuthUserType } from '../auth/entities/refresh-token-session.entity';
import { ClassroomDirectorSuggestion } from '../ai/entities/classroom-director-suggestion.entity';
import { AuditLog } from '../platform/entities/audit-log.entity';
import { Student } from '../platform/entities/student.entity';
import { PlatformAccessService } from '../platform/platform-access.service';
import { AuditService } from '../platform/audit.service';
import { ConfirmClassroomSummaryDto } from './dto/classroom-record.dto';
import {
  ClassroomCommandStatus,
  MEDIA_CLASSROOM_COMMANDS,
} from './classroom-command.types';
import {
  ClassroomEventType,
  ClassroomRunStatus,
} from './classroom-run.types';
import {
  ClassroomSummaryAiService,
  type ClassroomSummaryContent,
  UNSAFE_CHILD_ASSESSMENT,
} from './classroom-summary-ai.service';
import { ClassroomCommandRecord } from './entities/classroom-command-record.entity';
import { ClassroomEvent } from './entities/classroom-event.entity';
import { ClassroomRollCallRecord } from './entities/classroom-roll-call-record.entity';
import { ClassroomRun } from './entities/classroom-run.entity';
import {
  ClassroomSummaryDraft,
  ClassroomSummaryDraftStatus,
} from './entities/classroom-summary-draft.entity';
import { ClassroomSummary } from './entities/classroom-summary.entity';
import { StudentAttendanceChange } from './entities/student-attendance-change.entity';
import { StudentQuestionRecord } from './entities/student-question-record.entity';
import { StudentRewardRecord } from './entities/student-reward-record.entity';

export type ClassroomTimelineItem = {
  key: string;
  type: string;
  title: string;
  description: string;
  occurredAt: Date;
  source: string;
  requestId?: string | null;
  details?: Record<string, unknown>;
};

@Injectable()
export class ClassroomRecordService {
  constructor(
    @InjectRepository(ClassroomRun)
    private readonly runs: Repository<ClassroomRun>,
    @InjectRepository(ClassroomEvent)
    private readonly events: Repository<ClassroomEvent>,
    @InjectRepository(ClassroomCommandRecord)
    private readonly commands: Repository<ClassroomCommandRecord>,
    @InjectRepository(StudentAttendanceChange)
    private readonly attendanceChanges: Repository<StudentAttendanceChange>,
    @InjectRepository(ClassroomRollCallRecord)
    private readonly rollCalls: Repository<ClassroomRollCallRecord>,
    @InjectRepository(StudentRewardRecord)
    private readonly rewards: Repository<StudentRewardRecord>,
    @InjectRepository(StudentQuestionRecord)
    private readonly questions: Repository<StudentQuestionRecord>,
    @InjectRepository(ClassroomDirectorSuggestion)
    private readonly directorSuggestions: Repository<ClassroomDirectorSuggestion>,
    @InjectRepository(AuditLog)
    private readonly auditLogs: Repository<AuditLog>,
    @InjectRepository(Student)
    private readonly students: Repository<Student>,
    @InjectRepository(ClassroomSummaryDraft)
    private readonly drafts: Repository<ClassroomSummaryDraft>,
    @InjectRepository(ClassroomSummary)
    private readonly summaries: Repository<ClassroomSummary>,
    private readonly access: PlatformAccessService,
    private readonly audit: AuditService,
    private readonly summaryAi: ClassroomSummaryAiService,
  ) {}

  async timeline(actor: JwtTeacherPayload, runId: number) {
    const run = await this.requireRun(actor, runId);
    const [events, commands, attendance, rollCalls, rewards, questions, suggestions] =
      await Promise.all([
        this.events.find({ where: { classroomRunId: runId } }),
        this.commands.find({ where: { classroomRunId: runId } }),
        this.attendanceChanges.find({ where: { classroomRunId: runId } }),
        this.rollCalls.find({ where: { classroomRunId: runId } }),
        this.rewards.find({ where: { classroomRunId: runId } }),
        this.questions.find({ where: { classroomRunId: runId } }),
        this.directorSuggestions.find({ where: { classroomRunId: runId } }),
      ]);
    const studentIds = new Set<number>();
    attendance.forEach((item) => studentIds.add(item.studentId));
    rollCalls.forEach((item) => studentIds.add(item.studentId));
    rewards.forEach((item) => studentIds.add(item.studentId));
    questions.forEach((item) => {
      if (!item.isAnonymous && item.studentId != null) studentIds.add(item.studentId);
    });
    const students = studentIds.size
      ? await this.students.find({ where: { id: In([...studentIds]) } })
      : [];
    const studentNames = new Map(
      students.map((item) => [item.id, item.nickname || item.name]),
    );
    const items: ClassroomTimelineItem[] = [];

    const formalizedEventTypes = new Set([
      ClassroomEventType.Command,
      ClassroomEventType.Attendance,
      ClassroomEventType.RollCall,
      ClassroomEventType.Checkpoint,
    ]);
    for (const event of events) {
      if (!formalizedEventTypes.has(event.eventType))
        items.push(this.eventItem(event));
    }
    for (const command of commands) {
      if (
        MEDIA_CLASSROOM_COMMANDS.has(command.operation) ||
        [ClassroomCommandStatus.Failure, ClassroomCommandStatus.Conflict].includes(
          command.status,
        )
      )
        items.push(this.commandItem(command));
    }
    for (const change of attendance) {
      const name = studentNames.get(change.studentId) ?? '幼儿';
      items.push({
        key: `attendance:${change.id}`,
        type: 'attendance',
        title: '考勤更新',
        description: `${name}：${change.previousStatus ?? '未记录'} → ${change.nextStatus}`,
        occurredAt: change.createdAt,
        source: change.source,
        requestId: change.requestId,
        details: {
          studentId: change.studentId,
          previousStatus: change.previousStatus,
          nextStatus: change.nextStatus,
        },
      });
    }
    for (const call of rollCalls) {
      items.push({
        key: `roll-call:${call.id}`,
        type: 'roll_call',
        title: '课堂点名',
        description: `${studentNames.get(call.studentId) ?? '幼儿'}（${call.mode}）`,
        occurredAt: call.createdAt,
        source: 'roll_call',
        requestId: call.requestId,
        details: { studentId: call.studentId, mode: call.mode, groupKey: call.groupKey },
      });
    }
    for (const reward of rewards) {
      const name = studentNames.get(reward.studentId) ?? '幼儿';
      items.push({
        key: `reward:${reward.id}`,
        type: 'reward',
        title: '发放奖励',
        description: `${name}：${reward.rewardCategory}，${reward.points}积分`,
        occurredAt: reward.createdAt,
        source: 'reward',
        requestId: reward.requestId,
        details: { studentId: reward.studentId, rewardCategory: reward.rewardCategory, points: reward.points },
      });
      if (reward.revokedAt) {
        items.push({
          key: `reward-revoke:${reward.id}`,
          type: 'reward_revoke',
          title: '撤销奖励',
          description: `${name}：${reward.revokeReason || '教师撤销'}`,
          occurredAt: reward.revokedAt,
          source: 'reward',
          requestId: reward.revokeRequestId,
          details: { rewardId: reward.id, studentId: reward.studentId },
        });
      }
    }
    for (const question of questions) {
      items.push({
        key: `question:${question.id}`,
        type: 'question',
        title: '幼儿提问',
        description: question.isAnonymous
          ? `匿名：${question.questionText}`
          : `${studentNames.get(question.studentId!) ?? '幼儿'}：${question.questionText}`,
        occurredAt: question.createdAt,
        source: 'question',
        requestId: question.requestId,
        details: {
          studentId: question.isAnonymous ? null : question.studentId,
          topic: question.topic,
          domain: question.domain,
          lessonStepIndex: question.lessonStepIndex,
        },
      });
    }
    for (const suggestion of suggestions) {
      items.push({
        key: `ai-suggestion:${suggestion.id}`,
        type: 'ai_suggestion',
        title: 'AI课堂导演建议',
        description: `${suggestion.title}：${suggestion.originalContent}`,
        occurredAt: suggestion.createdAt,
        source: 'ai_director',
        details: { suggestionId: suggestion.id, suggestionType: suggestion.type },
      });
    }
    items.push(...(await this.directorDecisionItems(runId, suggestions)));
    const deduplicated = [...new Map(
      items.map((item) => [
        item.requestId
          ? `${item.source}:${item.type}:${item.requestId}`
          : item.key,
        item,
      ]),
    ).values()];
    deduplicated.sort(
      (a, b) =>
        new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime() ||
        a.key.localeCompare(b.key),
    );
    return { run: this.runView(run), items: deduplicated };
  }

  async ensureDraft(actor: JwtTeacherPayload, runId: number) {
    const run = await this.requireRun(actor, runId);
    if (run.status !== ClassroomRunStatus.Completed)
      throw new ConflictException('课堂完成后才能生成总结草稿');
    const existing = await this.drafts.findOne({ where: { classroomRunId: runId } });
    if (existing) return this.draftView(existing);
    const aggregate = await this.summaryAggregate(run);
    const result = await this.summaryAi.generate(aggregate.aiInput, aggregate.fallback);
    let draft: ClassroomSummaryDraft;
    try {
      draft = await this.drafts.save(
        this.drafts.create({
          classroomRunId: run.id,
          teacherId: run.teacherId,
          classroomSummary: result.classroomSummary,
          participation: result.participation,
          interestPoints: JSON.stringify(result.interestPoints),
          commonQuestions: JSON.stringify(result.commonQuestions),
          teachingStrategies: JSON.stringify(result.teachingStrategies),
          source: result.source,
          status: ClassroomSummaryDraftStatus.Pending,
        }),
      );
    } catch (error) {
      const concurrent = await this.drafts.findOne({
        where: { classroomRunId: runId },
      });
      if (!concurrent) throw error;
      return this.draftView(concurrent);
    }
    await this.audit.writeAi({
      actor,
      feature: 'classroom_summary',
      status: result.source,
      metadata: { classroomRunId: runId, draftId: draft.id },
    });
    return this.draftView(draft);
  }

  async getSummary(actor: JwtTeacherPayload, runId: number) {
    await this.requireRun(actor, runId);
    const [draft, summary] = await Promise.all([
      this.drafts.findOne({ where: { classroomRunId: runId } }),
      this.summaries.findOne({ where: { classroomRunId: runId } }),
    ]);
    return {
      draft: draft ? this.draftView(draft) : null,
      formalSummary: summary ? this.summaryView(summary) : null,
    };
  }

  async confirm(
    actor: JwtTeacherPayload,
    runId: number,
    dto: ConfirmClassroomSummaryDto,
  ) {
    this.requireTeacher(actor);
    const run = await this.requireRun(actor, runId);
    if (run.teacherId !== actor.sub)
      throw new ForbiddenException('只有本次课堂教师可以确认总结');
    const draft = await this.drafts.findOne({ where: { classroomRunId: runId } });
    if (!draft) throw new NotFoundException('课堂总结草稿不存在');
    if (draft.status === ClassroomSummaryDraftStatus.Discarded)
      throw new ConflictException('该总结草稿已经放弃');
    const content = this.normalizeContent(dto);
    try {
      this.summaryAi.assertSafe(content);
    } catch {
      throw new BadRequestException('总结不能包含儿童诊断、能力判断或负面标签');
    }
    const current = await this.summaries.findOne({ where: { classroomRunId: runId } });
    const summary = await this.summaries.save(
      this.summaries.create({
        ...current,
        classroomRunId: runId,
        draftId: draft.id,
        teacherId: actor.sub,
        classroomSummary: content.classroomSummary,
        participation: content.participation,
        interestPoints: JSON.stringify(content.interestPoints),
        commonQuestions: JSON.stringify(content.commonQuestions),
        teachingStrategies: JSON.stringify(content.teachingStrategies),
        confirmedAt: new Date(),
      }),
    );
    draft.status = ClassroomSummaryDraftStatus.Confirmed;
    await this.drafts.save(draft);
    await this.audit.write(actor, {
      action: current ? 'classroom_summary.updated' : 'classroom_summary.confirmed',
      targetType: 'classroom_run',
      targetId: runId,
      metadata: { draftId: draft.id, summaryId: summary.id },
    });
    return { formalSummary: this.summaryView(summary) };
  }

  async discard(actor: JwtTeacherPayload, runId: number, reason?: string) {
    this.requireTeacher(actor);
    const run = await this.requireRun(actor, runId);
    if (run.teacherId !== actor.sub)
      throw new ForbiddenException('只有本次课堂教师可以放弃总结草稿');
    const draft = await this.drafts.findOne({ where: { classroomRunId: runId } });
    if (!draft) throw new NotFoundException('课堂总结草稿不存在');
    if (await this.summaries.exists({ where: { classroomRunId: runId } }))
      throw new ConflictException('正式总结已经确认，不能放弃草稿');
    draft.status = ClassroomSummaryDraftStatus.Discarded;
    await this.drafts.save(draft);
    await this.audit.write(actor, {
      action: 'classroom_summary.discarded',
      targetType: 'classroom_run',
      targetId: runId,
      metadata: { draftId: draft.id, reason: reason?.trim() || null },
    });
    return { success: true };
  }

  async report(actor: JwtTeacherPayload, runId: number) {
    const run = await this.requireRun(actor, runId);
    const summary = await this.summaries.findOne({ where: { classroomRunId: runId } });
    if (!summary) throw new ConflictException('教师确认总结后才能导出正式课堂报告');
    const timeline = await this.timeline(actor, runId);
    const view = this.summaryView(summary);
    const lines = [
      `课堂报告：${run.title}`,
      `开始时间：${run.startedAt?.toISOString() ?? '-'}`,
      `结束时间：${run.endedAt?.toISOString() ?? '-'}`,
      '',
      '【课堂摘要】',
      view.classroomSummary,
      '',
      '【参与情况】',
      view.participation,
      '',
      '【兴趣点】',
      ...view.interestPoints.map((item) => `- ${item}`),
      '',
      '【常见问题】',
      ...view.commonQuestions.map((item) => `- ${item}`),
      '',
      '【教学策略建议】',
      ...view.teachingStrategies.map((item) => `- ${item}`),
      '',
      '【课堂时间线】',
      ...timeline.items.map(
        (item) =>
          `${new Date(item.occurredAt).toLocaleString('zh-CN', { hour12: false })}  ${item.title}  ${item.description}`,
      ),
    ];
    await this.audit.write(actor, {
      action: 'data.export',
      targetType: 'classroom_report',
      targetId: runId,
      metadata: { format: 'txt', eventCount: timeline.items.length },
    });
    return {
      fileName: `${this.safeFileName(run.title)}-课堂报告.txt`,
      content: lines.join('\n'),
      generatedAt: new Date().toISOString(),
      formalSummary: view,
      timeline: timeline.items,
    };
  }

  private async summaryAggregate(run: ClassroomRun) {
    const [attendance, rollCalls, rewards, questions, suggestions, events] =
      await Promise.all([
        this.attendanceChanges.find({ where: { classroomRunId: run.id } }),
        this.rollCalls.find({ where: { classroomRunId: run.id } }),
        this.rewards.find({ where: { classroomRunId: run.id } }),
        this.questions.find({ where: { classroomRunId: run.id } }),
        this.directorSuggestions.find({ where: { classroomRunId: run.id } }),
        this.events.find({ where: { classroomRunId: run.id } }),
      ]);
    const latestAttendance = new Map<number, string>();
    attendance
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .forEach((item) => latestAttendance.set(item.studentId, item.nextStatus));
    const attendanceCounts = this.count([...latestAttendance.values()]);
    const topics = this.count(questions.map((item) => item.topic || '未分类'));
    const commonQuestions = this.count(
      questions.map((item) => this.redactQuestion(item.questionText)),
    )
      .slice(0, 5)
      .map((item) => item.name);
    const interestPoints = topics
      .filter((item) => item.name !== '未分类')
      .slice(0, 5)
      .map((item) => item.name);
    const fallback: ClassroomSummaryContent = {
      classroomSummary: `${run.title}已完成，共记录${events.length}个课堂操作节点，课堂过程包含${new Set(events.filter((item) => item.eventType === ClassroomEventType.ChangeStep).map((item) => item.id)).size}次步骤切换。`,
      participation: `考勤${latestAttendance.size}人，点名${rollCalls.length}次，有效奖励${rewards.filter((item) => !item.revokedAt).length}次，幼儿提问${questions.length}条。`,
      interestPoints: interestPoints.length ? interestPoints : ['本节课堂互动内容'],
      commonQuestions,
      teachingStrategies: [
        '继续使用观察、比较和动手验证，引导幼儿先表达自己的发现。',
        '结合本节常见问题安排简短复习，并给不同表达方式留出时间。',
      ],
    };
    return {
      fallback,
      aiInput: {
        lessonTitle: run.title,
        durationSeconds: run.elapsedSeconds,
        attendance: attendanceCounts,
        rollCallCount: rollCalls.length,
        activeRewardCount: rewards.filter((item) => !item.revokedAt).length,
        questionCount: questions.length,
        questionTopics: topics.slice(0, 10),
        commonQuestions,
        aiSuggestionCount: suggestions.length,
        confirmedAiSuggestionCount: suggestions.filter((item) => item.status === 'confirmed').length,
        eventCount: events.length,
      },
    };
  }

  private eventItem(event: ClassroomEvent): ClassroomTimelineItem {
    const labels: Partial<Record<ClassroomEventType, [string, string]>> = {
      [ClassroomEventType.Start]: ['class_start', '课堂开始'],
      [ClassroomEventType.Complete]: ['class_end', '课堂完成'],
      [ClassroomEventType.Cancel]: ['class_end', '课堂中止'],
      [ClassroomEventType.ChangeStep]: ['step_change', '步骤切换'],
      [ClassroomEventType.BreakStart]: ['break_start', '进入课间'],
      [ClassroomEventType.BreakEnd]: ['break_end', '结束课间'],
      [ClassroomEventType.Recover]: ['recovery', '课堂恢复'],
      [ClassroomEventType.Takeover]: ['recovery', '更换设备接管'],
      [ClassroomEventType.Fail]: ['error', '课堂异常'],
      [ClassroomEventType.SnapshotFailed]: ['error', '快照异常'],
      [ClassroomEventType.Pause]: ['class_pause', '暂停课堂'],
      [ClassroomEventType.Resume]: ['class_resume', '恢复课堂'],
    };
    const [type, title] = labels[event.eventType] ?? ['classroom_event', event.eventType];
    const details = this.objectJson(event.payload);
    return {
      key: `event:${event.id}`,
      type,
      title,
      description: this.eventDescription(event.eventType, details),
      occurredAt: event.createdAt,
      source: 'classroom_event',
      requestId: event.requestId,
      details,
    };
  }

  private commandItem(command: ClassroomCommandRecord): ClassroomTimelineItem {
    const failure = command.status !== ClassroomCommandStatus.Success;
    return {
      key: `command:${command.id}`,
      type: failure ? 'error' : 'resource',
      title: failure ? '课堂操作未执行' : '资源与媒体操作',
      description: failure
        ? `${command.operation}：${command.failureReason || command.status}`
        : `${command.operation}（${command.source}）`,
      occurredAt: command.executedAt || command.createdAt,
      source: command.source,
      requestId: command.requestId,
      details: {
        operation: command.operation,
        targetDeviceId: command.targetDeviceId,
        status: command.status,
        parameters: this.objectJson(command.parametersSummary),
      },
    };
  }

  private async directorDecisionItems(
    runId: number,
    suggestions: ClassroomDirectorSuggestion[],
  ): Promise<ClassroomTimelineItem[]> {
    const ids = suggestions.map((item) => String(item.id));
    const logs = await this.auditLogs.find({
      where: [
        {
          targetType: 'classroom_run',
          targetId: String(runId),
          action: Like('classroom_director.%'),
        },
        ...(ids.length
          ? [
              {
                targetType: 'director_suggestion',
                targetId: In(ids),
                action: Like('classroom_director.%'),
              },
            ]
          : []),
      ],
    });
    return logs
      .filter((log) => log.action !== 'classroom_director.generated')
      .map((log) => {
        const action = log.action.split('.').pop() || log.action;
        const title = action === 'edited'
          ? '教师编辑AI建议'
          : action === 'confirmed'
            ? '教师确认AI建议'
            : action === 'rejected'
              ? '教师拒绝AI建议'
              : 'AI建议处理';
        return {
          key: `director-audit:${log.id}`,
          type: `ai_${action}`,
          title,
          description: title,
          occurredAt: log.createdAt,
          source: 'teacher',
          details: this.objectJson(log.metadata),
        };
      });
  }

  private async requireRun(actor: JwtTeacherPayload, runId: number) {
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException('课堂运行不存在');
    await this.access.requireClassAccess(actor, run.classId);
    return run;
  }

  private requireTeacher(actor: JwtTeacherPayload) {
    if (actor.userType !== AuthUserType.Teacher)
      throw new ForbiddenException('管理员不能代替教师确认课堂总结');
  }

  private normalizeContent(dto: ConfirmClassroomSummaryDto): ClassroomSummaryContent {
    return {
      classroomSummary: dto.classroomSummary.trim(),
      participation: dto.participation.trim(),
      interestPoints: this.cleanList(dto.interestPoints),
      commonQuestions: this.cleanList(dto.commonQuestions),
      teachingStrategies: this.cleanList(dto.teachingStrategies),
    };
  }

  private cleanList(values: string[]) {
    return values.map((item) => item.trim()).filter(Boolean);
  }

  private draftView(draft: ClassroomSummaryDraft) {
    return {
      id: draft.id,
      classroomRunId: draft.classroomRunId,
      teacherId: draft.teacherId,
      ...this.contentView(draft),
      source: draft.source,
      status: draft.status,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
    };
  }

  private summaryView(summary: ClassroomSummary) {
    return {
      id: summary.id,
      classroomRunId: summary.classroomRunId,
      draftId: summary.draftId,
      teacherId: summary.teacherId,
      ...this.contentView(summary),
      confirmedAt: summary.confirmedAt,
      updatedAt: summary.updatedAt,
    };
  }

  private contentView(value: {
    classroomSummary: string;
    participation: string;
    interestPoints: string;
    commonQuestions: string;
    teachingStrategies: string;
  }) {
    return {
      classroomSummary: value.classroomSummary,
      participation: value.participation,
      interestPoints: this.stringList(value.interestPoints),
      commonQuestions: this.stringList(value.commonQuestions),
      teachingStrategies: this.stringList(value.teachingStrategies),
    };
  }

  private stringList(value: string) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string')
        : [];
    } catch {
      return [];
    }
  }

  private count(values: string[]) {
    const counts = new Map<string, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
  }

  private redactQuestion(value: string) {
    const cleaned = value
      .replace(/1\d{10}/g, '[已隐藏电话]')
      .replace(/\d{5,}/g, '[已隐藏数字]')
      .trim()
      .slice(0, 160);
    return UNSAFE_CHILD_ASSESSMENT.test(cleaned) ? '需要教师关注的问题' : cleaned;
  }

  private objectJson(value: string | null): Record<string, unknown> {
    if (!value) return {};
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  private eventDescription(
    type: ClassroomEventType,
    details: Record<string, unknown>,
  ) {
    if (type === ClassroomEventType.ChangeStep)
      return `切换到第${Number(details.stepIndex ?? 0) + 1}步`;
    if (type === ClassroomEventType.BreakStart)
      return `课间${details.durationSeconds ?? ''}秒`;
    if (type === ClassroomEventType.BreakEnd)
      return `返回第${Number(details.restoredStepIndex ?? 0) + 1}步`;
    return typeof details.status === 'string' ? details.status : type;
  }

  private runView(run: ClassroomRun) {
    return {
      id: run.id,
      title: run.title,
      classId: run.classId,
      teacherId: run.teacherId,
      status: run.status,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
    };
  }

  private safeFileName(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, '_').trim() || '课堂';
  }
}
