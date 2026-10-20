import { http } from '@/api/http'
import { dialoguePerformance } from './dialoguePerformance'

export type DialogueTurn = { role: 'user' | 'assistant'; content: string }
export async function streamClassroomDialogue(input: { runId: number; stepIndex: number; requestId: string; text: string; history: DialogueTurn[]; token: string; signal: AbortSignal }, onText: (text: string) => void) {
  dialoguePerformance('submitted', { requestId: input.requestId, mode: input.history.length ? 'followup' : 'first' })
  const response = await fetch(`${http.defaults.baseURL || ''}/classroom-runs/${input.runId}/dialogue`, {
    method: 'POST', headers: { Authorization: `Bearer ${input.token}`, 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
    body: JSON.stringify({ requestId: input.requestId, stepIndex: input.stepIndex, text: input.text, history: input.history }), signal: input.signal,
  })
  if (!response.ok) throw new Error(response.status === 401 ? '登录已过期，请重新登录后提问。' : [403, 409].includes(response.status) ? '课堂权限或阶段已变化，请刷新课堂。' : '回答服务暂不可用，请老师接手。')
  if (!response.body || !response.headers.get('content-type')?.includes('application/x-ndjson')) throw new Error('回答服务格式不正确。')
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let pending = '', accepted = false, done = false, reply = '', route = ''
  function receive(line: string) {
    const event = JSON.parse(line) as { type: string; performance?: Record<string, unknown>; requestId?: string; runId?: number; stepIndex?: number; route?: string; text?: string; reply?: string; message?: string; safetyContractVersion?: number; safety?: { contractVersion?: number; status?: string; scope?: string } }
    if (event.type === 'meta') {
      if (accepted || event.requestId !== input.requestId || event.runId !== input.runId || event.stepIndex !== input.stepIndex) throw new Error('回答来源不匹配。')
      if (event.safetyContractVersion !== 1) throw new Error('回答缺少安全准入信息，已停止朗读。')
      accepted = true; route = event.route || ''; return
    }
    if (!accepted || done) throw new Error('回答事件顺序不正确。')
    if (event.type === 'delta' && typeof event.text === 'string') {
      if (event.safety?.contractVersion !== 1 || event.safety.status !== 'approved' || event.safety.scope !== 'whole_reply') throw new Error('回答尚未通过完整内容安全检查，不会朗读。')
      if (!reply) dialoguePerformance('first-approved-text', { requestId: input.requestId })
      reply += event.text; if (reply.length > 600) throw new Error('回答过长，已停止。'); onText(reply)
    }
    else if (event.type === 'done' && typeof event.reply === 'string') {
      if (route === 'question' && reply !== event.reply) throw new Error('回答内容不一致。')
      if (event.route === 'handoff') route = 'handoff'
      for (const key of ['contextMs', 'inputReviewMs', 'generationMs', 'postGenerationContextMs', 'outputReviewMs', 'totalMs']) {
        const value = event.performance?.[key]
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0) dialoguePerformance(`server:${key}`, { requestId: input.requestId, durationMs: value })
      }
      dialoguePerformance('answer-complete', { requestId: input.requestId })
      reply = event.reply; done = true
    }
    else throw new Error(event.message || '回答已中断，请手动重新提问。')
  }
  try {
    while (true) {
      const part = await reader.read()
      pending += decoder.decode(part.value, { stream: !part.done })
      if (pending.length > 12_000) throw new Error('回答数据过长。')
      let end: number
      while ((end = pending.indexOf('\n')) >= 0) { const line = pending.slice(0, end).trim(); pending = pending.slice(end + 1); if (line) receive(line) }
      if (part.done) break
    }
    if (pending.trim()) receive(pending)
    if (!done) throw new Error('回答连接中断，保留未完成文字，不会自动重发。')
    return { reply, route }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
