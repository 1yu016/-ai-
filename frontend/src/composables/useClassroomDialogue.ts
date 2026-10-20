import { onScopeDispose, ref, watch } from 'vue'
import { streamClassroomDialogue, type DialogueTurn } from '@/services/classroomDialogue'

export function useClassroomDialogue(deps: {
  identity: () => string; allowed: () => boolean; runId: () => number; stepIndex: () => number; token: () => string
  onComplete: (text: string) => void; onStop: () => void; onStart?: () => void; onPartial?: (text: string) => void; onFailure?: () => void
}, transport = streamClassroomDialogue) {
  const busy = ref(false), reply = ref(''), error = ref(''), history = ref<DialogueTurn[]>([])
  let generation = 0, controller: AbortController | null = null
  function stop(clear = false) {
    generation++; controller?.abort(); controller = null; busy.value = false; deps.onStop()
    if (clear) { history.value = []; reply.value = ''; error.value = '' }
  }
  async function ask(text: string) {
    if (!deps.allowed() || busy.value || !text.trim()) return
    stop(); reply.value = ''; error.value = ''; busy.value = true
    deps.onStart?.()
    const ticket = generation, owner = deps.identity(), abort = new AbortController()
    controller = abort
    const valid = () => generation === ticket && owner === deps.identity() && deps.allowed() && !abort.signal.aborted
    try {
      const result = await transport({ runId: deps.runId(), stepIndex: deps.stepIndex(), token: deps.token(), requestId: crypto.randomUUID(), text: text.trim(), history: history.value.slice(-8), signal: abort.signal }, value => { if (valid()) { reply.value = value; deps.onPartial?.(value) } })
      if (!valid()) return
      reply.value = result.reply
      if (result.route === 'question') {
        history.value = [...history.value, { role: 'user', content: text.trim() }, { role: 'assistant', content: result.reply }].slice(-8) as DialogueTurn[]
        deps.onComplete(result.reply)
      }
    } catch (cause) { if (valid()) { deps.onFailure?.(); error.value = cause instanceof Error ? cause.message : '回答中断，请老师接手。' } }
    finally { if (ticket === generation) { busy.value = false; controller = null } }
  }
  watch(deps.identity, () => stop(true), { flush: 'sync' })
  watch(deps.allowed, allowed => { if (!allowed) stop() }, { flush: 'sync' })
  const hidden = () => { if (document.hidden) stop() }
  document.addEventListener('visibilitychange', hidden)
  onScopeDispose(() => { document.removeEventListener('visibilitychange', hidden); stop(true) })
  return { busy, reply, error, history, ask, stop }
}
