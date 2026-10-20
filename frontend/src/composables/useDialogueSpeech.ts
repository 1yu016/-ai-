import { onScopeDispose, ref, watch } from 'vue'
import {
  playBackendTts,
  synthesizeTtsUrl,
  type BackendTtsCallbacks,
  type BackendTtsResult,
} from '@/services/backendTts'
import { speakBrowserText } from '@/services/browserSpeech'
import { dialoguePerformance } from '@/services/dialoguePerformance'

/**
 * 逐句朗读开关：VITE_CLASSROOM_REAL_TTS=true 时优先走真实后端 TTS（/ai/tts + 浏览器真实播放），
 * 失败自动回退浏览器 SpeechSynthesis；未开启时保持原有纯浏览器朗读，保证既有行为与测试不变。
 */
const REAL_TTS_ENABLED = import.meta.env.VITE_CLASSROOM_REAL_TTS === 'true'
// 真实 TTS 需先合成再播放，开始音容忍更长；纯浏览器路径保持 D-5 的 8 秒语义。
const STALE_START_MS = REAL_TTS_ENABLED ? 20000 : 8000
const SENTENCE_TIMEOUT_MS = 45000

export type DialogueSentenceSpeaker = (
  sentence: string,
  callbacks: BackendTtsCallbacks,
) => Promise<BackendTtsResult>

async function defaultSpeak(
  sentence: string,
  callbacks: BackendTtsCallbacks,
): Promise<BackendTtsResult> {
  const current = () => !callbacks.signal?.aborted && (!callbacks.isCurrent || callbacks.isCurrent())
  const browserSpeak = () => current() && speakBrowserText(sentence, {
      signal: callbacks.signal,
      lang: 'zh-CN',
      rate: 0.9,
      onStart: callbacks.onStart,
      onEnd: callbacks.onEnded,
      onCancel: callbacks.onCancel,
      onError: callbacks.onError,
    })
  if (!REAL_TTS_ENABLED) {
    return browserSpeak() ? 'started' : 'failed'
  }
  let started = false
  const real = await playBackendTts({
    signal: callbacks.signal,
    text: sentence,
    preparedAudio: callbacks.preparedAudio,
    isCurrent: callbacks.isCurrent,
    onStart: () => { started = true; callbacks.onStart?.() },
    onEnded: callbacks.onEnded,
    onCancel: callbacks.onCancel,
    // Only fall back before actual playback starts; never repeat a partially played sentence.
    onError: () => { if (started) callbacks.onError?.() },
  })
  if (real === 'started' || real === 'cancelled') return real
  if (!current()) return 'cancelled'
  if (started) return 'failed'
  return browserSpeak() ? 'started' : 'failed'
}

/** A bounded utterance queue for this reply, not an audio engine or classroom state machine. */
export function useDialogueSpeech(deps: {
  identity: () => string
  allowed: () => boolean
  enabled: () => boolean
  onSpeaking: (value: boolean) => void
  speak?: DialogueSentenceSpeaker
  prepare?: (sentence: string, signal: AbortSignal) => Promise<string>
}) {
  const occupied = ref(false), speaking = ref(false), error = ref('')
  const depsSpeak = deps.speak ?? defaultSpeak
  const prepare = deps.prepare ?? (!deps.speak && REAL_TTS_ENABLED ? (sentence: string, signal: AbortSignal) => synthesizeTtsUrl(sentence, undefined, signal) : undefined)
  let generation = 0, active = false, received = '', buffered = '', failed = false
  let queue: string[] = [], timer: ReturnType<typeof setTimeout> | undefined
  let sentenceId = 0, controller: AbortController | undefined
  let preparationController = new AbortController()
  let prepared: { sentence: string; audio: Promise<string> } | undefined
  // At most ONE checked sentence ahead. No playback and no synthesis of raw model tokens.
  function prepareNext() {
    if (!prepare || prepared || !speaking.value || !queue.length || failed || !deps.allowed() || !deps.enabled()) return
    const sentence = queue[0]!
    const signal = preparationController.signal
    const audio = Promise.resolve().then(() => {
      signal.throwIfAborted()
      return prepare(sentence, signal)
    })
    void audio.catch(() => {}) // Consumed later by the ordinary failure/fallback path.
    prepared = { sentence, audio }
  }
  function clear() {
    preparationController.abort(); preparationController = new AbortController(); prepared = undefined
    generation++; clearTimeout(timer); active = false; queue = []; received = ''; buffered = ''
    const old = controller; controller = undefined; old?.abort()
    occupied.value = false; speaking.value = false; deps.onSpeaking(false)
  }
  function stop() {
    if (occupied.value) dialoguePerformance('speech-cancelled')
    failed = true
    clear()
  }
  function fail(message: string) { failed = true; stop(); error.value = message }
  async function next() {
    if (active || !queue.length) { occupied.value = active || queue.length > 0; return }
    if (!deps.enabled() || !deps.allowed() || failed) { stop(); return }
    const sentence = queue.shift()!, ticket = generation, owner = deps.identity()
    const preparedAudio = prepared?.sentence === sentence ? prepared.audio : undefined
    prepared = undefined
    const instance = ++sentenceId
    controller = new AbortController()
    const signal = controller.signal
    active = true; occupied.value = true
    const current = () => active && instance === sentenceId && !signal.aborted && ticket === generation && owner === deps.identity() && deps.allowed() && deps.enabled()
    timer = setTimeout(() => { if (current()) fail('语音未能开始，已停止朗读；可继续阅读文字。') }, STALE_START_MS)
    const callbacks: BackendTtsCallbacks = {
      preparedAudio,
      signal,
      isCurrent: current,
      onStart: () => {
        if (!current()) return
        clearTimeout(timer); speaking.value = true; deps.onSpeaking(true); dialoguePerformance('avatar-speaking', { sentence: instance })
        prepareNext()
        timer = setTimeout(() => { if (current()) fail('本句朗读超时，已停止语音。') }, SENTENCE_TIMEOUT_MS)
      },
      onEnded: () => {
        if (!current()) return
        clearTimeout(timer); active = false; speaking.value = false; deps.onSpeaking(false)
        dialoguePerformance(queue.length ? 'sentence-ended' : 'playback-complete', { sentence: instance })
        void next()
      },
      onCancel: () => { if (current()) { failed = true; clear(); error.value = '朗读已被其他语音或控制接管，不会重播旧句子。' } },
      onError: () => { if (current()) fail('语音朗读不可用，请阅读文字或由老师讲解。') },
    }
    let result: BackendTtsResult
    try { result = await depsSpeak(sentence, callbacks) } catch {
      if (current()) fail('语音朗读不可用，请阅读文字或由老师讲解。')
      return
    }
    if (result === 'failed' && current()) fail('语音朗读不可用，请阅读文字或由老师讲解。')
    else if (result === 'cancelled' && current() && !failed) stop()
  }
  function begin() { stop(); failed = false; error.value = '' }
  function append(text: string, finished = false) {
    if (!deps.enabled() || !deps.allowed() || failed) return
    if (!text.startsWith(received) || text.length > 600) { fail('回答来源发生变化，已停止朗读。'); return }
    buffered += text.slice(received.length); received = text
    let boundary: number
    while ((boundary = buffered.search(/[。！？.!?\n]/)) >= 0) {
      const sentence = buffered.slice(0, boundary + 1); buffered = buffered.slice(boundary + 1)
      if (sentence.trim()) queue.push(sentence)
    }
    if (finished && buffered.trim()) { queue.push(buffered); buffered = '' }
    if (queue.length > 12) { fail('朗读队列过长，已停止语音。'); return }
    prepareNext()
    void next()
  }
  watch(deps.identity, stop, { flush: 'sync' })
  watch(() => deps.allowed() && deps.enabled(), value => { if (!value) stop() }, { flush: 'sync' })
  onScopeDispose(stop)
  return { occupied, speaking, error, begin, append, stop }
}
