import { effectScope, reactive } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useDialogueSpeech } from '@/composables/useDialogueSpeech'
import { speakBrowserText, stopBrowserSpeech } from '@/services/browserSpeech'

const scopes: ReturnType<typeof effectScope>[] = []
let utterances: SpeechSynthesisUtterance[] = []
beforeEach(() => {
  vi.useFakeTimers(); utterances = []
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} })
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { cancel: vi.fn(), speak: (u: SpeechSynthesisUtterance) => utterances.push(u) } })
})
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); stopBrowserSpeech(); vi.useRealTimers(); vi.unstubAllGlobals() })
function setup() {
  const state = reactive({ identity: 'run1:step0', allowed: true, enabled: true }), onSpeaking = vi.fn()
  const scope = effectScope(); scopes.push(scope)
  const speech = scope.run(() => useDialogueSpeech({ identity: () => state.identity, allowed: () => state.allowed, enabled: () => state.enabled, onSpeaking }))!
  speech.begin()
  return { speech, state, scope, onSpeaking }
}
const emit = (index: number, event: 'onstart' | 'onend') => utterances[index]![event]?.({} as SpeechSynthesisEvent)
it('reads the first completed sentence before answer completion, queues subsequent sentences exactly once', () => {
  const { speech, onSpeaking } = setup()
  speech.append('第一句。第二')
  expect(utterances.map(u => u.text)).toEqual(['第一句。'])
  expect(speech.speaking.value).toBe(false)
  emit(0, 'onstart'); expect(speech.speaking.value).toBe(true)
  speech.append('第一句。第二句。'); speech.append('第一句。第二句。', true)
  expect(utterances).toHaveLength(1)
  emit(0, 'onend'); expect(utterances.map(u => u.text)).toEqual(['第一句。', '第二句。'])
  emit(1, 'onstart'); emit(1, 'onend')
  expect(speech.occupied.value).toBe(false); expect(onSpeaking).toHaveBeenLastCalledWith(false)
})
it.each(['pause', 'identity', 'disable', 'dispose'])('%s invalidates pending speech, queue and late callbacks; no replay', mode => {
  const { speech, state, scope, onSpeaking } = setup()
  speech.append('旧句子。待播放句子。')
  const old = utterances[0]!
  if (mode === 'pause') state.allowed = false
  else if (mode === 'identity') state.identity = 'run2:step0'
  else if (mode === 'disable') state.enabled = false
  else scope.stop()
  old.onstart?.({} as SpeechSynthesisEvent); old.onend?.({} as SpeechSynthesisEvent)
  expect(speech.speaking.value).toBe(false); expect(onSpeaking).toHaveBeenLastCalledWith(false)
  state.allowed = true; state.enabled = true; speech.append('旧句子。待播放句子。', true)
  expect(utterances).toHaveLength(1)
})
it('another speech owner cancels this queue; later cleanup cannot cancel the new owner', () => {
  const { speech, scope } = setup(); speech.append('旧句子。第二句。'); emit(0, 'onstart')
  const started = vi.fn()
  speakBrowserText('老师接管', { onStart: started })
  expect(speech.occupied.value).toBe(false)
  scope.stop(); emit(1, 'onstart'); expect(started).toHaveBeenCalledOnce()
  expect(utterances).toHaveLength(2)
})
it('times out when browser accepts but never starts an utterance, retaining manual/text fallback', () => {
  const { speech } = setup(); speech.append('浏览器不发声。')
  vi.advanceTimersByTime(8000)
  expect(speech.occupied.value).toBe(false); expect(speech.error.value).toContain('未能开始')
  emit(0, 'onstart'); expect(speech.speaking.value).toBe(false)
})
it('preserves newline boundaries, flushes one final fragment and rejects non-prefix replacement', () => {
  const { speech } = setup(); speech.append('\n第一句。尾句', true)
  emit(0, 'onend'); expect(utterances.map(u => u.text)).toEqual(['第一句。', '尾句'])
  speech.append('被替换的旧结果'); expect(speech.occupied.value).toBe(false); expect(speech.error.value).toContain('来源')
})
