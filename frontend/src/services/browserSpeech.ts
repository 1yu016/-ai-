export type BrowserAudioCallbacks = {
  onStart?: () => void
  onCreated?: (audio: HTMLAudioElement) => void
  isCurrent?: () => boolean
  onEnded?: () => void
  onError?: () => void
  onCancel?: () => void
}

let activeAudio: HTMLAudioElement | null = null
let playbackGeneration = 0
let cancelTextSpeech: (() => void) | null = null
let cancelActiveAudio: (() => void) | null = null

function clearAudio(audio: HTMLAudioElement) {
  audio.pause()
  if (typeof audio.removeAttribute === 'function') audio.removeAttribute('src')
  else audio.src = ''
  try { audio.load() } catch { /* 部分测试环境未实现 load */ }
}

/** 停止当前页面中的语音音频和 SpeechSynthesis，确保同一时间只有一个声音。 */
export function stopBrowserSpeech(expectedAudio?: HTMLAudioElement) {
  if (expectedAudio && activeAudio !== expectedAudio) return false
  playbackGeneration += 1
  const textNotify = cancelTextSpeech; cancelTextSpeech = null
  textNotify?.()
  const audioNotify = cancelActiveAudio; cancelActiveAudio = null
  audioNotify?.()
  if (activeAudio) clearAudio(activeAudio)
  activeAudio = null
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel()
  }
  return true
}

export function pauseBrowserSpeech(expectedAudio?: HTMLAudioElement): boolean {
  if (!activeAudio || (expectedAudio && activeAudio !== expectedAudio)) return false
  activeAudio.pause()
  return true
}

export async function resumeBrowserSpeech(expectedAudio?: HTMLAudioElement): Promise<boolean> {
  const audio = activeAudio; const generation = playbackGeneration
  if (!audio || (expectedAudio && audio !== expectedAudio)) return false
  try { await audio.play() } catch (cause) {
    if (generation !== playbackGeneration || activeAudio !== audio) { clearAudio(audio); return false }
    throw cause
  }
  if (generation !== playbackGeneration || activeAudio !== audio) { clearAudio(audio); return false }
  return true
}

/**
 * 播放独占语音。新语音会先停止旧语音；迟到的 ended/error 事件不能清理新实例。
 */
export async function playExclusiveAudio(
  source: string,
  callbacks: BrowserAudioCallbacks = {},
): Promise<HTMLAudioElement> {
  if (callbacks.isCurrent && !callbacks.isCurrent()) throw new DOMException('Speech cancelled', 'AbortError')
  stopBrowserSpeech()
  const generation = ++playbackGeneration
  const audio = new Audio(source)
  activeAudio = audio
  cancelActiveAudio = callbacks.onCancel ?? null
  callbacks.onCreated?.(audio)

  const finish = (kind: 'ended' | 'error') => {
    if (generation !== playbackGeneration || activeAudio !== audio) return
    clearAudio(audio)
    activeAudio = null
    cancelActiveAudio = null
    if (kind === 'ended') callbacks.onEnded?.()
    else callbacks.onError?.()
  }
  let started = false
  audio.addEventListener('playing', () => {
    if (started || generation !== playbackGeneration || activeAudio !== audio || (callbacks.isCurrent && !callbacks.isCurrent())) return
    started = true; callbacks.onStart?.()
  })
  audio.addEventListener('ended', () => finish('ended'), { once: true })
  audio.addEventListener('error', () => finish('error'), { once: true })

  try {
    if (callbacks.isCurrent && !callbacks.isCurrent()) throw new DOMException('Speech cancelled', 'AbortError')
    await audio.play()
    if (generation !== playbackGeneration || activeAudio !== audio || (callbacks.isCurrent && !callbacks.isCurrent())) {
      clearAudio(audio)
      throw new DOMException('Speech instance cancelled', 'AbortError')
    }
    return audio
  } catch (error) {
    if (generation === playbackGeneration && activeAudio === audio) {
      clearAudio(audio)
      activeAudio = null
      cancelActiveAudio = null
    } else {
      clearAudio(audio)
      throw new DOMException('Speech superseded', 'AbortError')
    }
    throw error
  }
}

export type BrowserSpeechOptions = {
  signal?: AbortSignal
  onCancel?: () => void
  onStart?: () => void
  lang?: string
  rate?: number
  volume?: number
  pitch?: number
  onEnd?: () => void
  onFallback?: () => void
  onError?: () => void
}

/**
 * 使用浏览器语音播放文本。指定参数失败时自动尝试一次系统默认音色。
 */
export function speakBrowserText(text: string, options: BrowserSpeechOptions = {}): boolean {
  if (options.signal?.aborted) return false
  if (typeof window === 'undefined' || !window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') return false
  stopBrowserSpeech()
  const generation = ++playbackGeneration
  const abort = () => { if (generation === playbackGeneration) stopBrowserSpeech() }
  const detach = () => options.signal?.removeEventListener('abort', abort)
  options.signal?.addEventListener('abort', abort, { once: true })
  cancelTextSpeech = () => { detach(); options.onCancel?.() }
  let fallbackAttempted = false
  let attempt = 0, settled = false

  const speak = (useDefaults: boolean) => {
    if (generation !== playbackGeneration) return
    const ticket = ++attempt
    let started = false
    const current = () => !settled && generation === playbackGeneration && ticket === attempt
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.onstart = () => {
      if (current() && !started) { started = true; options.onStart?.() }
    }
    if (!useDefaults) {
      if (options.lang) utterance.lang = options.lang
      if (options.rate != null) utterance.rate = options.rate
      if (options.volume != null) utterance.volume = options.volume
      if (options.pitch != null) utterance.pitch = options.pitch
    }
    utterance.onend = () => {
      if (current()) { settled = true; detach(); cancelTextSpeech = null; options.onEnd?.() }
    }
    utterance.onerror = () => {
      if (!current()) return
      if (!started && !fallbackAttempted && !useDefaults) {
        fallbackAttempted = true
        attempt++ // cancel may synchronously emit events for the failed attempt
        options.onFallback?.()
        window.speechSynthesis.cancel()
        speak(true)
        return
      }
      settled = true; detach(); cancelTextSpeech = null; options.onError?.()
    }
    try { window.speechSynthesis.speak(utterance) } catch {
      if (current()) { settled = true; detach(); cancelTextSpeech = null; options.onError?.() }
    }
  }

  speak(false)
  return true
}

