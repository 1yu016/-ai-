import { effectScope, reactive } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useDialogueSpeech, type DialogueSentenceSpeaker } from '@/composables/useDialogueSpeech'
import type { BackendTtsCallbacks, BackendTtsResult } from '@/services/backendTts'
import { stopBrowserSpeech } from '@/services/browserSpeech'

const scopes: ReturnType<typeof effectScope>[] = []
let speaker: {
  speak: DialogueSentenceSpeaker
  calls: Array<{ sentence: string; onStart: () => void; onEnded: () => void }>
}
beforeEach(() => {
  speaker = { speak: vi.fn(), calls: [] }
  // 模拟真实后端 TTS 播放器：返回 started，由调用方通过 onStart/onEnded 驱动说话状态。
  const impl = async (
    sentence: string,
    callbacks: BackendTtsCallbacks,
  ): Promise<BackendTtsResult> => {
    speaker.calls.push({
      sentence,
      onStart: () => callbacks.onStart?.(),
      onEnded: () => callbacks.onEnded?.(),
    })
    return 'started'
  }
  speaker.speak = impl
})
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); stopBrowserSpeech(); vi.useRealTimers() })
const flush = () => new Promise(resolve => setTimeout(resolve, 0))
function setup() {
  const state = reactive({ identity: 'run1:step0', allowed: true, enabled: true }), onSpeaking = vi.fn()
  const scope = effectScope(); scopes.push(scope)
  const speech = scope.run(() => useDialogueSpeech({ identity: () => state.identity, allowed: () => state.allowed, enabled: () => state.enabled, onSpeaking, speak: speaker.speak }))!
  speech.begin()
  return { speech, state, onSpeaking }
}

it('drives speaking state from real audio onStart/onEnded and chains to the next sentence', async () => {
  const { speech, onSpeaking } = setup()
  speech.append('第一句。第二句。')
  await flush()
  expect(speaker.calls).toHaveLength(1)
  expect(speaker.calls[0]!.sentence).toBe('第一句。')
  speaker.calls[0]!.onStart()
  expect(speech.speaking.value).toBe(true)
  expect(onSpeaking).toHaveBeenLastCalledWith(true)
  speaker.calls[0]!.onEnded()
  await flush()
  expect(speech.speaking.value).toBe(false)
  expect(onSpeaking).toHaveBeenLastCalledWith(false)
  expect(speaker.calls).toHaveLength(2)
  expect(speaker.calls[1]!.sentence).toBe('第二句。')
  speaker.calls[1]!.onStart()
  speaker.calls[1]!.onEnded()
  await flush()
  expect(speech.occupied.value).toBe(false)
})

it('a provider returning cancelled never marks speaking and clears the queue without replay', async () => {
  speaker.speak = (async () => 'cancelled') as DialogueSentenceSpeaker
  const { speech, onSpeaking } = setup()
  speech.append('旧句子。')
  await flush()
  expect(speech.speaking.value).toBe(false)
  expect(speech.occupied.value).toBe(false)
  expect(onSpeaking).not.toHaveBeenCalledWith(true)
})

it('a provider returning failed surfaces an error and stops without autoplaying stale text', async () => {
  speaker.speak = (async () => 'failed') as DialogueSentenceSpeaker
  const { speech } = setup()
  speech.append('无法朗读的话。')
  await flush()
  expect(speech.error.value).toContain('语音朗读不可用')
  expect(speech.speaking.value).toBe(false)
  expect(speech.occupied.value).toBe(false)
})