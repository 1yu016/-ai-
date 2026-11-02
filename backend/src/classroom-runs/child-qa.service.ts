import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Interval } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { ClassroomRunService } from './classroom-run.service';
import { StudentQuestionService } from './student-question.service';
import { StudentQuestionRecord } from './entities/student-question-record.entity';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { AuthUserType } from '../auth/entities/refresh-token-session.entity';
import { CHILD_KNOWLEDGE_PROVIDER, childQaSessionValid, readChildQaConfig, type ChildQaSession, type ChildKnowledgeProvider, type ChildKnowledgeReply } from './child-qa.core';

@Injectable()
export class ChildQaService {
  private readonly sessions = new Map<number, ChildQaSession>();
  constructor(private readonly runs: ClassroomRunService, private readonly questions: StudentQuestionService,
    @InjectRepository(StudentQuestionRecord) private readonly records: Repository<StudentQuestionRecord>,
    @Inject(CHILD_KNOWLEDGE_PROVIDER) private readonly knowledge: ChildKnowledgeProvider) {}

  private async context(actor: JwtTeacherPayload, runId: number) {
    if (actor.userType !== AuthUserType.Teacher) throw new ForbiddenException('只有课堂教师可管理儿童问答');
    const run = await this.runs.get(actor, runId);
    if (run.teacherId !== actor.sub) throw new ForbiddenException('只有本节课堂教师可开启儿童问答');
    return run;
  }

  async state(actor: JwtTeacherPayload, runId: number, renew = false) {
    const run = await this.context(actor, runId);
    const session = this.sessions.get(runId);
    if (!session || !childQaSessionValid(session, run)) { await this.closeSession(runId); return { mode: 'teacher', session: null }; }
    try { await this.runs.assertOperation(actor, runId, 'child_qa_start'); }
    catch { await this.closeSession(runId); return { mode: 'teacher', session: null }; }
    if (renew) session.leaseUntil = Math.min(session.expiresAt, Date.now() + 6000);
    return { mode: 'child', session };
  }

  async start(actor: JwtTeacherPayload, runId: number, requestId: string) {
    const run = await this.context(actor, runId);
    await this.runs.assertOperation(actor, runId, 'child_qa_start');
    const config = readChildQaConfig(run.steps?.find(s => s.stepIndex === run.currentStepIndex)?.actionConfig);
    if (!config) throw new ConflictException('本节冻结教案当前环节未配置儿童问答');
    await this.closeSession(runId);
    const session: ChildQaSession = { id: requestId || randomUUID(), runId, teacherId: actor.sub, deviceId: run.deviceId,
      stepIndex: run.currentStepIndex, version: run.version, expiresAt: Date.now() + config.seconds * 1000, leaseUntil: Date.now() + 6000, config };
    this.sessions.set(runId, session);
    return { mode: 'child', session };
  }

  async stop(actor: JwtTeacherPayload, runId: number, sessionId?: string) {
    await this.context(actor, runId);
    const current = this.sessions.get(runId);
    if (current && sessionId && current.id !== sessionId) return { mode: 'child', session: current, stopped: false };
    await this.closeSession(runId);
    return { mode: 'teacher', session: null, stopped: true };
  }

  async onTeacherControl(actor: JwtTeacherPayload, runId: number) {
    if (this.sessions.has(runId)) await this.stop(actor, runId);
  }

  private async requireSession(actor: JwtTeacherPayload, runId: number, sessionId: string) {
    const value = await this.state(actor, runId);
    if (!value.session || value.session.id !== sessionId) throw new ConflictException('儿童问答已关闭或上下文已变化，请老师重新开启');
    return value.session;
  }

  async ask(actor: JwtTeacherPayload, runId: number, input: { sessionId: string; requestId: string; question: string }) {
    const session = await this.requireSession(actor, runId, input.sessionId);
    const text = input.question.trim();
    if (!text || text.length > 300) throw new BadRequestException('儿童问题需为1至300字');
    let reply: ChildKnowledgeReply;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      reply = await Promise.race([Promise.resolve(this.knowledge.answer(text, session.config)), new Promise<ChildKnowledgeReply>((_, reject) => { timer = setTimeout(() => reject(new Error('Knowledge provider timeout')), 3000); })]);
    } catch { reply = { answer: '我暂时不能确定，请老师来帮助我们。', source: 'provider_unavailable', status: 'handoff' }; }
    finally { if (timer) clearTimeout(timer); }
    if (!reply || !['pending', 'handoff'].includes(reply.status) || typeof reply.answer !== 'string' || !reply.answer.trim() || reply.answer.length > 500 ||
      /https?:|javascript:|<script|自杀|杀人|脱衣|吞食|吃药|家庭地址|手机号码/i.test(reply.answer))
      reply = { answer: '这个回答还不适合直接提供，请老师来帮助我们。', source: 'output_safety_handoff', status: 'handoff' };
    await this.requireSession(actor, runId, input.sessionId);
    const { question } = await this.questions.create(actor, runId, { requestId: input.requestId, questionText: text,
      lessonStepIndex: session.stepIndex, isAnonymous: true, topic: session.config.topic });
    await this.requireSession(actor, runId, input.sessionId);
    const record = await this.records.findOneByOrFail({ id: question.id, classroomRunId: runId });
    if (!record.qaSessionId) {
      record.qaSessionId = session.id; record.answerText = reply.answer; record.answerSource = reply.source; record.answerStatus = reply.status;
      await this.records.save(record);
    } else if (record.qaSessionId !== session.id) throw new ConflictException('重复请求不属于本次问答会话');
    return { question: { ...question, answerText: record.answerText, answerStatus: record.answerStatus, answerSource: record.answerSource, qaSessionId: record.qaSessionId } };
  }

  async review(actor: JwtTeacherPayload, runId: number, sessionId: string, questionId: number, approve: boolean) {
    await this.requireSession(actor, runId, sessionId);
    const record = await this.records.findOneBy({ id: questionId, classroomRunId: runId, qaSessionId: sessionId });
    if (!record) throw new ConflictException('问题不属于当前有效问答');
    if (record.answerStatus !== 'pending') throw new ConflictException('仅待审核的可靠知识回答可批准，其他问题交老师处理');
    record.answerStatus = approve ? 'approved' : 'rejected';
    await this.records.save(record);
    return { questionId, questionText: record.questionText, answerText: record.answerText ?? '', answerStatus: record.answerStatus };
  }

  async acknowledgePresentation(actor: JwtTeacherPayload, runId: number, sessionId: string) {
    const session = this.sessions.get(runId);
    if (session?.id === sessionId) { session.version = (await this.context(actor, runId)).version; delete session.pendingVersion; }
  }

  beginPresentation(runId: number, sessionId: string, nextVersion: number) {
    const session = this.sessions.get(runId);
    if (session?.id === sessionId) session.pendingVersion = nextVersion;
  }

  cancelPresentation(runId: number, sessionId: string) {
    const session = this.sessions.get(runId);
    if (session?.id === sessionId) delete session.pendingVersion;
  }

  async approvedPresentation(actor: JwtTeacherPayload, runId: number, sessionId: string, questionId: number, text: string) {
    await this.requireSession(actor, runId, sessionId);
    const record = await this.records.findOneBy({ id: questionId, classroomRunId: runId, qaSessionId: sessionId, answerStatus: 'approved' });
    if (!record || record.answerText !== text) throw new ConflictException('儿童回答必须与教师审核记录一致');
    return { questionText: record.questionText };
  }

  async questionPresentation(actor: JwtTeacherPayload, runId: number, sessionId: string, questionId: number) {
    await this.requireSession(actor, runId, sessionId);
    const record = await this.records.findOne({ where: { id: questionId, classroomRunId: runId, qaSessionId: sessionId } });
    if (!record || !['pending', 'handoff'].includes(record.answerStatus ?? ''))
      throw new ConflictException('问题不属于当前待处理的儿童问答');
    return { questionText: record.questionText, answerStatus: record.answerStatus };
  }

  private async closeSession(runId: number) {
    const old = this.sessions.get(runId);
    this.sessions.delete(runId);
    if (old) await this.records.update({ classroomRunId: runId, qaSessionId: old.id, answerStatus: 'pending' }, { answerStatus: 'cancelled' });
  }

  @Interval(3000)
  async expireLeases() {
    for (const [runId, session] of this.sessions)
      if (Date.now() >= Math.min(session.expiresAt, session.leaseUntil)) await this.closeSession(runId);
  }
}
