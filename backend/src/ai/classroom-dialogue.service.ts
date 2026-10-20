import { ConflictException, Injectable } from '@nestjs/common';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { ClassroomCockpitService } from '../classroom-runs/classroom-cockpit.service';
import { AiService } from './ai.service';
import type { ClassroomDialogueDto } from './dto/classroom-dialogue.dto';
import { DataSource } from 'typeorm';
import { LessonPlanVersion } from '../lesson-plans/entities/lesson-plan-version.entity';
import { ClassroomContentSafetyService, CHILD_APPROVAL, CHILD_SAFE_REDIRECT, CHILD_SAFETY_UNAVAILABLE, hasChildContentRisk, normaliseChildContent } from './classroom-content-safety.service';

// An additional conservative fence, not comprehensive anonymisation or moderation.
const restricted = /我叫|我的名字|住址|地址|电话|手机号|照片|家庭|受伤|流血|吃药|疼|自杀|伤害|脱衣|陌生人|我是老师|我是管理员/;
const command = /奖励|加分|送.{0,4}花|考勤|签到|点名|翻页|下一页|上一页|下一步|暂停|结束课堂|下课|打开.{0,8}(?:资源|视频)|切换.{0,8}(?:步骤|课堂)/;
export const dialogueRoute = (text: string) => { const normalized = normaliseChildContent(text); return restricted.test(normalized) || hasChildContentRisk(normalized) ? 'handoff' : command.test(normalized) ? 'teacher_intent' : normalized.trim().length < 2 ? 'unclear' : 'question'; };

@Injectable()
export class ClassroomDialogueService {
  constructor(private readonly cockpit: ClassroomCockpitService, private readonly ai: AiService, private readonly db: DataSource, private readonly safety: ClassroomContentSafetyService) {}
  async context(actor: JwtTeacherPayload, id: number, stepIndex: number) {
    const state = await this.cockpit.get(actor, id);
    if (state.phase !== 'teaching' || state.break.active || state.recovery.manualInterventionRequired || !state.capabilities.allowedActions.includes('tts') || state.lesson.currentStep?.stepIndex !== stepIndex)
      throw new ConflictException({ code: 'DIALOGUE_CONTEXT_CHANGED', message: '课堂阶段或环节已变化，请返回当前教学环节。' });
    return state;
  }
  async *reply(actor: JwtTeacherPayload, id: number, dto: ClassroomDialogueDto, signal: AbortSignal) {
    const started = performance.now();
    const timings: Record<string, number> = {};
    let checkpoint = started;
    const mark = (name: string) => { const now = performance.now(); timings[name] = Math.round(now - checkpoint); checkpoint = now; };
    const initial = await this.context(actor, id, dto.stepIndex);
    if (signal.aborted) return;
    const route = dialogueRoute(dto.text);
    yield { type: 'meta', schemaVersion: 1, safetyContractVersion: 1, requestId: dto.requestId, runId: id, stepIndex: dto.stepIndex, runVersion: initial.run.version, route };
    if (route !== 'question') {
      yield { type: 'done', reply: route === 'teacher_intent' ? '这需要老师在课堂控制台操作，我没有执行。' : '请现场老师来帮助我们。', route };
      return;
    }
    const version = await this.db.getRepository(LessonPlanVersion).findOneBy({ lessonPlanId: initial.run.lessonPlanId, versionNo: initial.run.lessonPlanVersion });
    let ageGroup: string | null = null;
    try { const value: unknown = JSON.parse(version?.snapshotJson ?? '{}').ageGroup; if (value === '3-4' || value === '4-5' || value === '5-6') ageGroup = value; } catch { /* historical context is unavailable, not substituted with a live plan */ }
    const context = {
      lesson: initial.lesson.frozen, step: initial.lesson.currentStep?.title,
      // Review the frozen lesson's text, not editor markup or resource URL attributes.
      studentContent: initial.lesson.currentStep?.studentContent?.replace(/<\/?[A-Za-z][^>]*>/g, ' ').slice(0, 1200),
      ageGroup, audience: ageGroup ? `${ageGroup}岁幼儿` : '3至6岁幼儿；使用保守的适龄短句，未知确切年龄，不猜测',
    };
    let reply = '';
    const history = dto.history.filter(item => !restricted.test(item.content) && !command.test(item.content));
    const validContext = async () => {
      const current = await this.context(actor, id, dto.stepIndex);
      if (current.run.version !== initial.run.version || current.run.deviceId !== initial.run.deviceId || current.run.lessonPlanVersion !== initial.run.lessonPlanVersion) throw new Error('DIALOGUE_CONTEXT_CHANGED');
    };
    await validContext();
    mark('contextMs');
    const inputApproved = await this.safety.check('input', context, dto.text, history, signal);
    mark('inputReviewMs');
    if (!inputApproved) {
      await validContext(); if (signal.aborted) return;
      yield { type: 'delta', text: CHILD_SAFE_REDIRECT, safety: CHILD_APPROVAL };
      yield { type: 'done', reply: CHILD_SAFE_REDIRECT, route: 'handoff' }; return;
    }
    await validContext(); if (signal.aborted) return;
    for await (const token of this.ai.streamClassroomDialogue(context, dto.text, history, signal)) {
      if (signal.aborted) return;
      reply += token;
      if (reply.length > 600) throw new Error('DIALOGUE_OUTPUT_LIMIT');
      // Buffer only: no text escapes here. Re-reading the whole cockpit for EVERY token
      // serialised database projections with generation. The authoritative version check
      // immediately after generation and before each approved emission still fences changes.
    }
    mark('generationMs');
    await validContext();
    if (signal.aborted) return;
    if (!reply.trim()) throw new Error('DIALOGUE_EMPTY_RESPONSE');
    mark('postGenerationContextMs');
    const approved = await this.safety.check('output', context, reply, [...history, { role: 'user', content: dto.text }], signal);
    mark('outputReviewMs');
    await validContext(); if (signal.aborted) return;
    if (!approved) {
      yield { type: 'delta', text: CHILD_SAFETY_UNAVAILABLE, safety: CHILD_APPROVAL };
      yield { type: 'done', reply: CHILD_SAFETY_UNAVAILABLE, route: 'handoff' }; return;
    }
    for (const sentence of reply.match(/[^。！？.!?\n]+[。！？.!?\n]*|[。！？.!?\n]+/g) ?? []) {
      await validContext(); if (signal.aborted) return;
      yield { type: 'delta', text: sentence, safety: CHILD_APPROVAL };
    }
    yield { type: 'done', reply, route: 'question', performance: { ...timings, totalMs: Math.round(performance.now() - started) } };
  }
}
