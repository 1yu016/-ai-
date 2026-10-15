import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { createHash } from 'node:crypto';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { AuthUserType } from '../auth/entities/refresh-token-session.entity';
import { LessonPlan } from './entities/lesson-plan.entity';
import { LessonPlanVersion } from './entities/lesson-plan-version.entity';
import { ClassroomRun } from '../classroom-runs/entities/classroom-run.entity';
import { ClassroomEvent } from '../classroom-runs/entities/classroom-event.entity';
import { ClassroomSummary } from '../classroom-runs/entities/classroom-summary.entity';
import { ClassroomRunStepSnapshot } from '../classroom-runs/entities/classroom-run-step-snapshot.entity';
import { ClassroomEventResult, ClassroomEventType, ClassroomRunStatus } from '../classroom-runs/classroom-run.types';
import { TeacherClass } from '../platform/entities/teacher-class.entity';
import { SchoolClass } from '../platform/entities/school-class.entity';
import { BuildEvidencePackDto, ReferenceRunsQueryDto } from './dto/lesson-evidence.dto';

const RULE_VERSION = 'classroom-evidence-v1';
const ALLOWED_EVENTS = [ClassroomEventType.Start, ClassroomEventType.ChangeStep, ClassroomEventType.Pause,
  ClassroomEventType.Resume, ClassroomEventType.Complete, ClassroomEventType.BreakStart, ClassroomEventType.BreakEnd];
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Read-only projection. Never invokes AI, authoring, summary generation or classroom commands. */
@Injectable()
export class LessonEvidenceService {
  constructor(private readonly db: DataSource) {}

  private async requirePlan(manager: EntityManager, actor: JwtTeacherPayload, id: number) {
    if (actor.userType !== AuthUserType.Teacher) throw new ForbiddenException('课堂经验入口仅面向教师');
    const plan = await manager.getRepository(LessonPlan).findOneBy({ id });
    if (!plan || plan.deletedAt) throw new NotFoundException('教案不存在');
    if (plan.teacherId !== actor.sub || (actor.schoolId && plan.schoolId && actor.schoolId !== plan.schoolId))
      throw new ForbiddenException('无权引用该教案的课堂经验');
    return plan;
  }

  private eligible(manager: EntityManager, actor: JwtTeacherPayload, planId: number) {
    const query = manager.getRepository(ClassroomRun).createQueryBuilder('run')
      .innerJoin(TeacherClass, 'relation', 'relation.class_id = run.class_id AND relation.teacher_id = :teacher', { teacher: actor.sub })
      .innerJoin(SchoolClass, 'school', 'school.id = run.class_id')
      .where('run.lesson_plan_id = :planId AND run.teacher_id = :teacher', { planId, teacher: actor.sub })
      .andWhere('run.status = :status AND run.ended_at IS NOT NULL', { status: ClassroomRunStatus.Completed });
    if (actor.schoolId) query.andWhere('(school.school_id IS NULL OR school.school_id = :schoolId)', { schoolId: actor.schoolId });
    return query;
  }

  async list(actor: JwtTeacherPayload, planId: number, input: ReferenceRunsQueryDto) {
    return this.db.transaction(async manager => {
      await this.requirePlan(manager, actor, planId);
      if (input.from && input.to && new Date(input.from) > new Date(input.to)) throw new BadRequestException('日期范围无效');
      const query = this.eligible(manager, actor, planId);
      if (input.lessonPlanVersion) query.andWhere('run.lesson_plan_version = :version', { version: input.lessonPlanVersion });
      if (input.from) query.andWhere('run.ended_at >= :from', { from: new Date(input.from) });
      if (input.to) query.andWhere('run.ended_at <= :to', { to: new Date(input.to) });
      const [runs, total] = await query.orderBy('run.ended_at', 'DESC').addOrderBy('run.id', 'DESC')
        .skip((input.page - 1) * input.pageSize).take(input.pageSize).getManyAndCount();
      const summaries = runs.length ? await manager.getRepository(ClassroomSummary).find({ where: { classroomRunId: In(runs.map(r => r.id)) } }) : [];
      return { items: runs.map(run => ({ runId: run.id, title: run.title, lessonPlanVersion: run.lessonPlanVersion,
        startedAt: run.startedAt, endedAt: run.endedAt, hasFormalSummary: summaries.some(s => s.classroomRunId === run.id && s.confirmedAt) })),
        total, page: input.page, pageSize: input.pageSize };
    });
  }

  async build(actor: JwtTeacherPayload, planId: number, input: BuildEvidencePackDto) {
    return this.db.transaction(async manager => {
      const plan = await this.requirePlan(manager, actor, planId);
      if (plan.version !== input.baseVersion) throw new ConflictException('备课版本已变化，请刷新后重新选择');
      const ids = [...new Set(input.runIds)].sort((a,b) => a-b);
      const runs = await this.eligible(manager, actor, planId).andWhere('run.id IN (:...ids)', { ids }).orderBy('run.id','ASC').getMany();
      if (runs.length !== ids.length) throw new ForbiddenException('所选课堂包含无权限、非同教案或未正常结束记录');
      const sources = []; const teacherReview = []; const safeRuns = []; const warnings: string[] = [];
      for (const run of runs) {
        const [version, summary, events, steps] = await Promise.all([
          manager.getRepository(LessonPlanVersion).findOneBy({ lessonPlanId: planId, versionNo: run.lessonPlanVersion }),
          manager.getRepository(ClassroomSummary).findOneBy({ classroomRunId: run.id }),
          manager.getRepository(ClassroomEvent).find({ where: { classroomRunId: run.id, result: ClassroomEventResult.Success, eventType: In(ALLOWED_EVENTS) }, order: { createdAt:'ASC', id:'ASC' } }),
          manager.getRepository(ClassroomRunStepSnapshot).find({ where:{classroomRunId:run.id}, order:{stepIndex:'ASC'} }),
        ]);
        let historicalSteps: Array<{id:number;title:string}> = [];
        let validVersion = false;
        if (version) { try { const snapshot = JSON.parse(version.snapshotJson); if (Array.isArray(snapshot.steps)) { historicalSteps=snapshot.steps; validVersion=true; } } catch { /* Missing/corrupt evidence must not be inferred from current plan. */ } }
        const runWarnings = ['事件计数不代表参与度或教学效果；不提供推测的环节实际时长',
          '第一版仅纳入成功的课堂生命周期与步骤事件，不据此推断资源完整播放或幼儿互动效果'];
        if (!validVersion) runWarnings.push('历史教案版本缺失或无法读取');
        if (!summary?.confirmedAt) runWarnings.push('没有教师确认总结，仅提供执行事实');
        if (run.lessonPlanVersion !== input.baseVersion) runWarnings.push('课堂使用版本与当前备课版本不同，不自动对应当前步骤');
        const unmatched = steps.filter(step => !historicalSteps.some(old => old.id === step.originalStepId));
        if (unmatched.length) runWarnings.push('存在无法对应历史教案的步骤');
        // A single event source avoids event/command double counting. Never export raw payload.
        const seen = new Set<string>();
        const facts = events.filter(event => { const key=event.requestId || `event:${event.id}`; if(seen.has(key))return false; seen.add(key); return true; })
          .map(event => ({ evidenceId:`event:${event.id}`, type:event.eventType, occurredAt:event.createdAt }));
        const safe = { runId:run.id, lessonPlanId:planId, lessonPlanVersion:run.lessonPlanVersion,
          startedAt:run.startedAt, endedAt:run.endedAt, recordedElapsedSeconds:run.elapsedSeconds,
          facts, limitations:runWarnings };
        sources.push({ runId:run.id, runDigest:hash({id:run.id,status:run.status,version:run.version,startedAt:run.startedAt,endedAt:run.endedAt,elapsed:run.elapsedSeconds}),
          lessonPlanVersion:run.lessonPlanVersion, historicalVersionId:version?.id ?? null,
          historicalVersionDigest:version ? hash(version.snapshotJson) : null,
          events:events.map(e=>({id:e.id,digest:hash(e)})),
          summary:summary?.confirmedAt ? { id:summary.id,confirmedAt:summary.confirmedAt,updatedAt:summary.updatedAt,digest:hash(summary) } : null });
        teacherReview.push({ runId:run.id, title:run.title, steps:steps.map(step=>({historicalStepId:step.originalStepId,
          title:step.title, plannedDurationSeconds:step.durationSeconds, historyMatched:historicalSteps.some(s=>s.id===step.originalStepId) })),
          formalSummary:summary?.confirmedAt ? { classroomSummary:summary.classroomSummary,participation:summary.participation,
            interestPoints:summary.interestPoints,commonQuestions:summary.commonQuestions,teachingStrategies:summary.teachingStrategies,
            label:'教师确认意见，不是客观效果测量；未经脱敏不得发送AI' } : null });
        safeRuns.push(safe); warnings.push(...runWarnings.map(w=>`课堂#${run.id}：${w}`));
      }
      const pack = { schemaVersion:1, ruleVersion:RULE_VERSION, targetLessonPlanId:planId, baseVersion:input.baseVersion,
        sourceManifest:sources, teacherReview, safeFacts:{runs:safeRuns}, warnings };
      return { ...pack, digest:hash(pack), generatedAt:new Date().toISOString(), usageNotice:'本批不调用AI。仅safeFacts允许作为后续安全输入；teacherReview不可整体发送AI。' };
    });
  }
}
