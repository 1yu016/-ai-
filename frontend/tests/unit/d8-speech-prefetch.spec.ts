import { effectScope, reactive } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { useDialogueSpeech } from '@/composables/useDialogueSpeech'
import type { BackendTtsCallbacks } from '@/services/backendTts'

const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => scopes.splice(0).forEach(s => s.stop()))
function setup() {
  const state = reactive({ identity: 'run1:step0', allowed: true })
  const callbacks: BackendTtsCallbacks[] = []
  const speak = vi.fn(async (_text: string, callback: BackendTtsCallbacks) => { callbacks.push(callback); return 'started' as const })
  const prepare = vi.fn<(sentence: string, signal: AbortSignal) => Promise<string>>(async () => 'data:audio/wav;base64,c3ludGhldGlj')
  const scope = effectScope(); scopes.push(scope)
  const speech = scope.run(() => useDialogueSpeech({ identity: () => state.identity, allowed: () => state.allowed, enabled: () => true, onSpeaking: vi.fn(), speak, prepare }))!
  speech.begin()
  return { state, speech, speak, prepare, callbacks, scope }
}
it('prepares only one next sentence after actual playing, never plays ahead or re-synthesizes it', async () => {
  const { speech, speak, prepare, callbacks } = setup()
  speech.append('第一句。第二句。第三句。', true)
  expect(prepare).not.toHaveBeenCalled()
  callbacks[0]!.onStart!(); await Promise.resolve(); await Promise.resolve()
  expect(prepare).toHaveBeenCalledTimes(1); expect(speak).toHaveBeenCalledTimes(1)
  callbacks[0]!.onEnded!()
  expect(speak.mock.calls.map(c => c[0])).toEqual(['第一句。', '第二句。'])
  await expect(callbacks[1]!.preparedAudio).resolves.toMatch(/^data:audio/)
  callbacks[1]!.onStart!(); await Promise.resolve(); await Promise.resolve()
  expect(prepare).toHaveBeenCalledTimes(2)
})
it.each(['stop', 'pause', 'identity', 'dispose'])('invalidates in-flight preparation and old callbacks on %s', async kind => {
  const { state, speech, speak, prepare, callbacks, scope } = setup()
  speech.append('第一句。第二句。', true)
  callbacks[0]!.onStart!(); await Promise.resolve()
  const signal = prepare.mock.calls[0]?.[1] as AbortSignal
  if (kind === 'stop') speech.stop()
  else if (kind === 'pause') state.allowed = false
  else if (kind === 'identity') state.identity = 'run2:step1'
  else scope.stop()
  expect(signal.aborted).toBe(true)
  callbacks[0]!.onEnded!(); callbacks[0]!.onStart!()
  expect(speak).toHaveBeenCalledTimes(1); expect(speech.speaking.value).toBe(false)
})
it('cancel before preparation microtask prevents even the request, with no unhandled rejection', async () => {
  const { speech, prepare, callbacks } = setup()
  speech.append('第一句。第二句。', true); callbacks[0]!.onStart!(); speech.stop()
  await Promise.resolve(); await Promise.resolve()
  expect(prepare).not.toHaveBeenCalled()
})
