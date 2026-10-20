import type { ClassroomCommandOperation, ClassroomCommandResult, CommandRun } from '@/services/classroomCommandBus'
import { classroomRequestId } from '@/services/classroomCommandBus'
import { routeTeacherVoiceCommand, type TeacherVoiceCommandMatch } from './TeacherVoiceCommandRouter'
import { isQuestion, normalize, NEGATION_GUARDS } from './ClassroomIntentPatterns'
import { resolveIntent } from './ClassroomIntentRouter'

export type TeacherInstructionContext = CommandRun & { classId: number; currentStepIndex: number; status: string; breakActive?: boolean }
type Pending = { origin: TeacherInstructionContext; match: TeacherVoiceCommandMatch; requestId: string }
export interface TeacherInstructionDeps {
  context(): TeacherInstructionContext | null
  check?(match: TeacherVoiceCommandMatch): void
  currentResource?(): { id: number | string; title: string } | null
  students(classId: number): Promise<Array<{ id: number; classId: number; name: string; nickname: string | null; status: string }>>
  execute(match: TeacherVoiceCommandMatch, requestId: string): Promise<ClassroomCommandResult | null>
  query(requestId: string): Promise<{
    requestId: string; classroomRunId: number; deviceId: number; operation: string; status: string
    responsePayload: ClassroomCommandResult | null
  }>
  adopt(result: ClassroomCommandResult, origin: CommandRun): Promise<unknown> | void
}
export type InstructionFeedback = { handled: boolean; message: string; confirmation?: TeacherVoiceCommandMatch; result?: unknown; committedRunId?: number }

const same = (a: TeacherInstructionContext | null, b: TeacherInstructionContext) =>
  a?.id === b.id && a.deviceId === b.deviceId && a.classId === b.classId &&
  a.currentStepIndex === b.currentStepIndex && a.status === b.status && a.breakActive === b.breakActive && a.version === b.version

/** Teacher-control input only. Public microphone/dialogue never imports this session.
 * One in-flight write; unknown results retain the original identity and can only be queried.
 */
export class TeacherInstructionSession {
  private epoch = 0
  private busy = false
  private missing: { origin: TeacherInstructionContext; match: TeacherVoiceCommandMatch } | null = null
  private pending: Pending | null = null
  constructor(private readonly deps: TeacherInstructionDeps) {}
  get unresolvedRequestId() { return this.pending?.requestId ?? null }
  invalidate() { this.epoch++; this.missing = null }

  async submit(raw: string, requireTeacherConfirmation = false): Promise<InstructionFeedback> {
    const text = normalize(raw)
    const origin = this.deps.context()
    if (!origin) return { handled: true, message: '课堂状态未就绪，请重新查询。' }
    if (text === '取消') { this.missing = null; return { handled: true, message: '已取消待补充指令。' } }
    if (this.pending) return this.query()
    if (this.busy) return { handled: true, message: '正在处理上一条指令，请稍候。' }
    if (!text || isQuestion(text) || NEGATION_GUARDS.some(word => text.includes(word))) {
      this.missing = null
      return { handled: true, message: '未执行课堂操作。提问请使用儿童对话或教学助教入口。' }
    }
    let match: TeacherVoiceCommandMatch | undefined
    const flower = text.match(/^给(.+?)([一二两三四五1-5])朵(?:小红花|红花)$/)
    if (flower) {
      const stars = flower[2] === '两' ? 2 : Number(flower[2]) || '一二三四五'.indexOf(flower[2]!) + 1
      match = { operation: 'reward_student', normalized: text, label: '奖励小红花', requiresConfirmation: false, source: 'builtin',
        parameters: { studentName: flower[1]!.trim(), stars, rewardCategory: 'answer', rewardForms: ['flower'] } }
    } else {
      const route = routeTeacherVoiceCommand(text)
      if (route?.kind === 'command') match = route.match
      if (route?.kind === 'resource_search') {
        const resource = this.deps.currentResource?.()
        if (!resource && route.keyword === '当前资源') return { handled: true, message: '当前教学环节没有可用资源，请从资源面板选择。' }
        if (resource && ['当前资源', normalize(resource.title)].includes(route.keyword)) {
          match = { ...this.simple('play_resource', text), parameters: { resourceId: Number(resource.id) } }
        }
      }
      // These are classroom, not media, operations. Preserve explicit completion confirmation.
      if (['暂停', '暂停课堂', '暂停上课'].includes(text)) match = this.simple('pause_class', text)
      if (['继续上课', '恢复课堂', '恢复上课'].includes(text)) match = this.simple(origin.breakActive && origin.status === 'running' ? 'end_break' : 'resume_class', text)
      if (!match) {
        const local = resolveIntent(text).command
        const operations = { next: 'next_step', previous: 'previous_step', pause: 'pause_class', resume: 'resume_class' } as const
        if (local && local !== 'reset') match = this.simple(operations[local], text)
      }
    }
    if (!match && this.missing) {
      if (!same(origin, this.missing.origin)) {
        this.missing = null
        return { handled: true, message: '课堂状态已变化，请重新输入完整指令。旧补参没有执行。' }
      }
      match = { ...this.missing.match, parameters: { ...this.missing.match.parameters, studentName: raw.trim() } }
    }
    if (!match) { this.missing = null; return { handled: false, message: '' } }
    if (match.operation === 'group_roll_call') return { handled: true, message: '请在正式点名面板选择已有分组；不能以临时姓名列表代替分组身份。' }
    if (['reward_student', 'specified_roll_call'].includes(match.operation)) {
      const name = String(match.parameters?.studentName ?? '').trim()
      if (!name || ['他', '她', '这个孩子', '这位小朋友'].includes(name)) {
        this.missing = { origin: { ...origin }, match }
        return { handled: true, message: '请补充当前班级的学生姓名；重名时请到点名或奖励面板选择。' }
      }
      // Typed teacher instructions with complete parameters need no repeated confirmation.
      match = { ...match, requiresConfirmation: false }
    }
    if (match.requiresConfirmation || requireTeacherConfirmation) return { handled: true, message: '请教师确认识别结果或课堂生命周期操作。', confirmation: match }
    return this.execute(match)
  }

  async execute(match: TeacherVoiceCommandMatch): Promise<InstructionFeedback> {
    if (this.pending) return this.query()
    if (this.busy) return { handled: true, message: '正在处理上一条指令，请稍候。' }
    const origin = this.deps.context()
    if (!origin) return { handled: true, message: '课堂状态未就绪。' }
    if (match.operation === 'group_roll_call') return { handled: true, message: '请在正式分组点名面板选择分组。' }
    const captured = { ...origin }, epoch = this.epoch
    this.busy = true
    let sent = false
    try {
      const parameters = { ...match.parameters }
      if (['reward_student', 'specified_roll_call'].includes(match.operation)) {
        const name = String(parameters.studentName ?? '').trim()
        const students = await this.deps.students(captured.classId)
        const matches = students.filter(s => s.classId === captured.classId && s.status === 'active' && (s.name === name || s.nickname === name))
        if (matches.length !== 1) return { handled: true, message: matches.length ? '该姓名对应多名学生，请到正式面板选择。' : '当前班级没有找到有效学生，请补充准确姓名。' }
        parameters.studentId = matches[0]!.id
        delete parameters.studentName
      }
      if (epoch !== this.epoch || !same(this.deps.context(), captured)) return { handled: true, message: '课堂上下文已变化，旧指令未执行。' }
      this.missing = null
      const resolved = { ...match, parameters }
      this.deps.check?.(resolved)
      const requestId = classroomRequestId('teacher-instruction')
      // Preserve identity before handing off to the existing Store/CommandBus.
      this.pending = { origin: captured, match: resolved, requestId }
      sent = true
      const result = await this.deps.execute(resolved, requestId)
      if (!result || result.status !== 'success' || result.requestId !== requestId ||
          result.runId !== captured.id || result.operation !== resolved.operation) throw new Error('未获得匹配的成功回执')
      this.pending = null
      return { handled: true, message: this.message(result), result: result.result, committedRunId: result.runId }
    } catch (error) {
      const status = (error as { response?: { status?: number } }).response?.status
      // Even an HTTP failure may follow a committed canonical transaction.
      // Only explicit admission failures are final here; all ambiguous results stay queryable.
      if (!sent || [400, 401, 403, 404, 422].includes(status ?? 0)) {
        this.pending = null
        return { handled: true, message: error instanceof Error ? error.message : '权限或参数检查未通过，未确认执行成功。' }
      }
      return { handled: true, message: '执行结果暂时未知，已保留原请求。请查询结果，不要重复提交。' }
    } finally { this.busy = false }
  }

  async query(): Promise<InstructionFeedback> {
    const pending = this.pending
    if (!pending) return { handled: true, message: '没有待查询的指令。' }
    try {
      const record = await this.deps.query(pending.requestId)
      if (record.requestId !== pending.requestId || record.classroomRunId !== pending.origin.id ||
          record.deviceId !== pending.origin.deviceId || record.operation !== pending.match.operation) throw new Error('指令身份不匹配')
      const result = record.responsePayload
      if (record.status !== 'success' || !result || result.status !== 'success' ||
          result.requestId !== pending.requestId || result.runId !== pending.origin.id || result.operation !== pending.match.operation) {
        return { handled: true, message: '尚无可靠成功回执，请保留请求标识并继续查询；不会自动重发。' }
      }
      this.pending = null
      // Preserve committed result even when current-state refresh fails.
      try { await this.deps.adopt(result, pending.origin) } catch { /* success remains success */ }
      return { handled: true, message: `原请求（课堂 ${result.runId}）：${this.message(result)}`, result: result.result, committedRunId: result.runId }
    } catch {
      return { handled: true, message: '结果尚未查明，请稍后再次查询。不会重新发送业务命令。' }
    }
  }
  private simple(operation: ClassroomCommandOperation, label: string): TeacherVoiceCommandMatch {
    return { operation, label, normalized: label, requiresConfirmation: false, source: 'builtin' }
  }
  private message(result: ClassroomCommandResult): string {
    const value = result.result as { studentName?: string; student?: { name?: string; displayName?: string }; stars?: number; record?: { studentName?: string } } | null
    if (result.operation.includes('roll_call')) {
      const name = value?.studentName ?? value?.student?.displayName ?? value?.student?.name ?? value?.record?.studentName
      return name ? `正式点名已完成：${name}。实际大屏播放尚未确认。` : '正式点名已完成，请查看正式结果；实际大屏播放尚未确认。'
    }
    if (result.operation === 'reward_student') return '奖励已正式记录，真棒！实际大屏播放尚未确认。'
    return '课堂操作已提交成功。实际设备播放尚未确认。'
  }
}
