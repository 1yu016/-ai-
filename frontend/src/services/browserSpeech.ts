export type BrowserAudioCallbacks = {
  onEnded?: () => void
  onError?: () => void
}

let activeAudio: HTMLAudioElement | null = null
let playbackGeneration = 0

function clearAudio(audio: HTMLAudioElement) {
  audio.pause()
  if (typeof audio.removeAttribute === 'function') audio.removeAttribute('src')
  else audio.src = ''
  try { audio.load() } catch { /* 部分测试环境未实现 load */ }
}

/** 停止当前页面中的语音音频和 SpeechSynthesis，确保同一时间只有一个声音。 */
export function stopBrowserSpeech() {
  playbackGeneration += 1
  if (activeAudio) clearAudio(activeAudio)
  activeAudio = null
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel()
  }
}

export function pauseBrowserSpeech(): boolean {
  if (!activeAudio) return false
  activeAudio.pause()
  return true
}

export async function resumeBrowserSpeech(): Promise<boolean> {
  if (!activeAudio) return false
  await activeAudio.play()
  return true
}

/**
 * 播放独占语音。新语音会先停止旧语音；迟到的 ended/error 事件不能清理新实例。
 */
export async function playExclusiveAudio(
  source: string,
  callbacks: BrowserAudioCallbacks = {},
): Promise<HTMLAudioElement> {
  stopBrowserSpeech()
  const generation = ++playbackGeneration
  const audio = new Audio(source)
  activeAudio = audio

  const finish = (kind: 'ended' | 'error') => {
    if (generation !== playbackGeneration || activeAudio !== audio) return
    clearAudio(audio)
    activeAudio = null
    if (kind === 'ended') callbacks.onEnded?.()
    else callbacks.onError?.()
  }
  audio.addEventListener('ended', () => finish('ended'), { once: true })
  audio.addEventListener('error', () => finish('error'), { once: true })

  try {
    await audio.play()
    return audio
  } catch (error) {
    if (generation === playbackGeneration && activeAudio === audio) {
      clearAudio(audio)
      activeAudio = null
    }
    throw error
  }
}

export type BrowserSpeechOptions = {
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
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false
  stopBrowserSpeech()
  const generation = ++playbackGeneration
  let fallbackAttempted = false

  const speak = (useDefaults: boolean) => {
    if (generation !== playbackGeneration) return
    const utterance = new SpeechSynthesisUtterance(text)
    if (!useDefaults) {
      if (options.lang) utterance.lang = options.lang
      if (options.rate != null) utterance.rate = options.rate
      if (options.volume != null) utterance.volume = options.volume
      if (options.pitch != null) utterance.pitch = options.pitch
    }
    utterance.onend = () => {
      if (generation === playbackGeneration) options.onEnd?.()
    }
    utterance.onerror = () => {
      if (generation !== playbackGeneration) return
      if (!fallbackAttempted && !useDefaults) {
        fallbackAttempted = true
        options.onFallback?.()
        window.speechSynthesis.cancel()
        speak(true)
        return
      }
      options.onError?.()
    }
    window.speechSynthesis.speak(utterance)
  }

  speak(false)
  return true
}

