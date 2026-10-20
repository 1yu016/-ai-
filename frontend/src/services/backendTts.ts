// 真实后端 TTS（火山引擎）输出：将一句文本交给 POST /ai/tts，返回 mp3 data URL，
// 用 HTMLAudioElement 实际播放，由真实 play/ended 事件驱动说话表现与下一句衔接。
// 属于共享接入层，不承载对话队列、课堂状态机或数字人展示逻辑。
import { http } from '@/api/http'
import { playExclusiveAudio, stopBrowserSpeech as stopOwnedAudio } from './browserSpeech'
import { dialoguePerformance } from './dialoguePerformance'

export type BackendTtsCallbacks = {
  preparedAudio?: Promise<string>
  signal?: AbortSignal
  isCurrent?: () => boolean
  onStart?: () => void
  onEnded?: () => void
  onCancel?: () => void
  onError?: () => void
}

export type BackendTtsResult = 'started' | 'cancelled' | 'failed'

/** 后端 TTS 请求注入点，便于单测与未来替换服务。默认走项目 http 客户端。 */
export type TtsPost = (text: string, signal?: AbortSignal) => Promise<{ audioUrl?: string }>

export const defaultTtsPost: TtsPost = async (text, signal) => {
  const { data } = await http.post('/ai/tts', { text }, { signal })
  return data
}

/** 把一句文本合成为可播放的 data URL。返回前会校验响应结构，避免把坏内容喂给播放器。 */
export async function synthesizeTtsUrl(
  text: string,
  post: TtsPost = defaultTtsPost,
  signal?: AbortSignal,
): Promise<string> {
  const cleaned = cleanTextForTts(text)
  const started = performance.now()
  dialoguePerformance('tts-request')
  const data = await (signal ? post(cleaned, signal) : post(cleaned))
  const audioUrl = data?.audioUrl
  if (typeof audioUrl !== 'string' || !audioUrl.startsWith('data:audio/')) {
    throw new Error('语音合成服务未返回可播放音频。')
  }
  dialoguePerformance('tts-ready', { durationMs: performance.now() - started })
  return audioUrl
}

/** 去掉语音合成不需要的空白与换行，保持标点，便于稳定断句。 */
export function cleanTextForTts(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * 用真实后端 TTS 播放一句，真实 audio 事件驱动 onStart/onEnded。
 *  - started：播放器接受了播放请求；说话表现只由 playing/onStart 确认，不由此返回值确认。
 *  - cancelled：被新一代语音或控制取代（onCancel 已回调，不产生死回答）
 *  - failed：后端合成或播放失败（onError 已回调，调用方可决定是否回退）
 */
export async function playBackendTts(
  input: {
    signal?: AbortSignal
    text: string
    isCurrent?: () => boolean
    onStart?: () => void
    onEnded?: () => void
    onCancel?: () => void
    onError?: () => void
    post?: TtsPost
    preparedAudio?: Promise<string>
  },
): Promise<BackendTtsResult> {
  const { text } = input
  const current = () => !input.signal?.aborted && (!input.isCurrent || input.isCurrent())
  try {
    if (!current()) { input.onCancel?.(); return 'cancelled' }
    const url = await (input.preparedAudio ?? synthesizeTtsUrl(text, input.post, input.signal))
    if (!current()) {
      input.onCancel?.()
      return 'cancelled'
    }
    let audio: HTMLAudioElement | undefined
    const abort = () => { if (audio) stopOwnedAudio(audio) }
    const detach = () => input.signal?.removeEventListener('abort', abort)
    try {
      await playExclusiveAudio(url, {
        isCurrent: current,
        onCreated: value => { audio = value; input.signal?.addEventListener('abort', abort, { once: true }) },
        onStart: () => { dialoguePerformance('audio-playing'); input.onStart?.() },
        onCancel: () => { detach(); input.onCancel?.() },
        onEnded: () => { detach(); input.onEnded?.() },
        onError: () => { detach(); input.onError?.() },
      })
    } catch (error) { detach(); throw error }
    return 'started'
  } catch (error) {
    if (
      !current() || (error instanceof DOMException && error.name === 'AbortError')
    ) {
      input.onCancel?.()
      return 'cancelled'
    }
    input.onError?.()
    return 'failed'
  }
}
