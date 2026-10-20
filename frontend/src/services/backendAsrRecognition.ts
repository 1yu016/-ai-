// 真实云端 ASR 输入接入（火山 /ai/asr）：把一段连续麦克风音频按能量阈值切分，
// 每段通过 webm→wav→POST /ai/asr 识别，结果以 LocalRecognition 兼容接口交给课堂聆听状态机。
// 不是离线识别；环境开关不等于已经取得课堂持续录音/外部处理授权。
import { http } from '@/api/http'
import { dialoguePerformance } from './dialoguePerformance'
import {
  RECORDING_MIME_TYPE,
  webmToWav,
} from '@/services/recordingAudio'
import type { LocalRecognition } from './classroomListening'

export function isRealAsrEnabled(): boolean {
  return import.meta.env.VITE_CLASSROOM_REAL_ASR === 'true'
}

// ---- 纯 VAD 判定，便于单测 ----
export type VadState = {
  segment: boolean
  speechMs: number
  silenceMs: number
  segmentMs: number
}
export const SPEECH_RMS = 0.012
export const SPEECH_START_MS = 180
export const SILENCE_END_MS = 800
export const SEGMENT_MAX_MS = 12000
export type VadEvent = 'none' | 'start' | 'inside' | 'end'

export function createVadState(): VadState {
  return { segment: false, speechMs: 0, silenceMs: 0, segmentMs: 0 }
}
/**
 * 每收到一帧能量更新 VAD。speech 表示本帧是声音；frameMs 为帧时长(ms)。
 * 只有连续语音超过 SPEECH_START_MS 才 'start'，静音超过 SILENCE_END_MS 结束为 'end'，
 * 超过 SEGMENT_MAX_MS 也会强制 'end'，防止无限上传。
 */
export function vadStep(
  state: VadState,
  speech: boolean,
  frameMs: number,
): VadEvent {
  if (state.segment) {
    state.segmentMs += frameMs
    if (speech) {
      state.speechMs += frameMs
      state.silenceMs = 0
    } else {
      state.silenceMs += frameMs
      state.speechMs = 0
    }
    if (state.silenceMs >= SILENCE_END_MS || state.segmentMs >= SEGMENT_MAX_MS) {
      state.segment = false
      return 'end'
    }
    return 'inside'
  }
  if (speech) {
    state.speechMs += frameMs
    state.silenceMs = 0
    if (state.speechMs >= SPEECH_START_MS) {
      state.segment = true
      state.segmentMs = state.speechMs
      return 'start'
    }
    return 'none'
  }
  state.speechMs = 0
  state.silenceMs += frameMs
  return 'none'
}

// ---- /ai/asr 上传 ----
export async function asrRecognizeBlob(
  audioBlob: Blob,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted()
  dialoguePerformance('audio-input-complete')
  const started = performance.now()
  const wavBlob = await webmToWav(audioBlob)
  signal?.throwIfAborted()
  const formData = new FormData()
  formData.append('file', wavBlob, `kid-question-${Date.now()}.wav`)
  const { data } = await http.post('/ai/asr', formData, { signal })
  dialoguePerformance('asr-complete', { durationMs: performance.now() - started })
  const text = typeof data?.text === 'string' ? data.text.trim() : ''
  return text
}

/**
 * 生成一个 LocalRecognition 兼容的真实 ASR 实例，供 useClassroomListening 的 createRecognition 使用。
 * 说明：连续打开麦克风，语音段结束后上传识别，识别完成即派发 onresult，等待下一段。
 * 任一权限/格式不支持则 onerror + onend，由上层决定是否回退手动输入。
 */
export function createBackendAsrRecognition(
  deps: {
    getUserMedia?: typeof navigator.mediaDevices.getUserMedia
    getContext?: typeof AudioContext
    asr?: (blob: Blob, signal?: AbortSignal) => Promise<string>
    frameMs?: number
  } = {},
): LocalRecognition {
  const getUserMedia =
    deps.getUserMedia ??
    (() => navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    }))
  const audioCtx = () =>
    deps.getContext ? new deps.getContext() : new AudioContext()
  const recognize = deps.asr ?? asrRecognizeBlob
  const frameMs = deps.frameMs ?? 100

  const recognition: LocalRecognition = {
    processLocally: false,
    lang: 'zh-CN',
    continuous: true,
    interimResults: false,
    onresult: null,
    onerror: null,
    onend: null,
    onstart: null,
    start,
    abort,
  }

  let state: 'idle' | 'running' | 'aborted' = 'idle'
  let stream: MediaStream | null = null
  let context: AudioContext | null = null
  let analyser: AnalyserNode | null = null
  let recorder: MediaRecorder | null = null
  let generation = 0
  let pending: AbortController | null = null
  let vad = createVadState()
  let timer: ReturnType<typeof setInterval> | undefined

  function failByError(code: string) {
    recognition.onerror?.({ error: code })
    recognition.onerror = null
    recognition.onresult = null
    recognition.onend?.()
    recognition.onend = null
    release()
  }
  function release() {
    clearInterval(timer)
    timer = undefined
    pending?.abort(); pending = null
    const oldRecorder = recorder; recorder = null
    if (oldRecorder && oldRecorder.state !== 'inactive') {
      try { oldRecorder.stop() } catch { /* already stopped */ }
    }
    if (stream) stream.getTracks().forEach(track => track.stop())
    stream = null
    if (context) { void context.close().catch(() => {}); context = null }
    analyser = null
  }
  function finishSegment() {
    const record = recorder
    if (record && record.state !== 'inactive') record.stop()
  }
  function dispatchResult(transcript: string) {
    if (!transcript || state !== 'running' || !recognition.onresult) return
    recognition.onresult({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript } }],
    })
  }
  function beginSegment() {
    if (!stream || state !== 'running' || recorder || pending) return
    const token = generation
    const chunks: Blob[] = []
    let mediaRecorder: MediaRecorder
    try {
      mediaRecorder = new MediaRecorder(
        stream,
        isSupportedMime(),
      )
    } catch {
      state = 'aborted'; generation++; failByError('audio-capture')
      return
    }
    recorder = mediaRecorder
    mediaRecorder.addEventListener('dataavailable', (event: BlobEvent) => {
      if (token === generation && state === 'running' && event.data.size > 0) chunks.push(event.data)
    })
    mediaRecorder.addEventListener(
      'stop',
      () => {
        if (recorder === mediaRecorder) recorder = null
        if (token !== generation || state !== 'running' || !chunks.length) return
        const blob = new Blob(chunks, { type: mediaRecorder.mimeType || RECORDING_MIME_TYPE })
        const controller = new AbortController(); pending = controller
        void recognize(blob, controller.signal).then(text => {
          if (token === generation && !controller.signal.aborted) dispatchResult(text)
        }).catch(() => {
          if (token !== generation || controller.signal.aborted) return
          state = 'aborted'; generation++; failByError('network')
        }).finally(() => { if (pending === controller) pending = null })
      },
      { once: true },
    )
    try { mediaRecorder.start(BUFFERED_MS) } catch {
      state = 'aborted'; generation++; failByError('audio-capture')
    }
  }
  function tick() {
    if (state !== 'running' || !analyser || !context) return
    const sampleBuffer = analyser.fftSize || 1024
    const buffer = new Float32Array(sampleBuffer)
    analyser.getFloatTimeDomainData(buffer)
    let sum = 0
    for (let index = 0; index < sampleBuffer; index++) {
      const value = buffer[index] ?? 0
      sum += value * value
    }
    const rms = Math.sqrt(sum / sampleBuffer)
    const event = vadStep(vad, rms >= SPEECH_RMS, frameMs)
    if (event === 'start') beginSegment()
    else if (event === 'end') finishSegment()
  }
  async function start() {
    if (state === 'running') return
    state = 'running'
    vad = createVadState()
    await ensureMedia(++generation)
  }
  async function ensureMedia(token: number) {
    try {
      const acquired = await getUserMedia()
      if (token !== generation || state !== 'running') {
        acquired.getTracks().forEach(track => track.stop()); return
      }
      stream = acquired
    } catch (error) {
      const notAllowed =
        error instanceof DOMException && error.name === 'NotAllowedError'
      if (token !== generation || state !== 'running') return
      state = 'aborted'
      failByError(notAllowed ? 'not-allowed' : 'service-not-allowed')
      return
    }
    try {
      context = audioCtx()
      const source = context.createMediaStreamSource(stream)
      analyser = context.createAnalyser()
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0.2
      source.connect(analyser)
    } catch {
      if (state !== 'running') { release(); return }
      state = 'aborted'
      failByError('service-not-allowed')
      return
    }
    recognition.onstart?.()
    if (token !== generation || state !== 'running') return
    timer = setInterval(tick, frameMs)
  }
  function abort() {
    state = 'aborted'
    generation++
    release()
    recognition.onstart = null
    const endpoint = recognition.onend
    recognition.onend = null
    recognition.onresult = null
    recognition.onerror = null
    endpoint?.()
  }
  return recognition
}

const BUFFERED_MS = 250

function isSupportedMime(): MediaRecorderOptions {
  try {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(RECORDING_MIME_TYPE)) {
      return { mimeType: RECORDING_MIME_TYPE }
    }
  } catch { /* 回退默认编码 */ }
  return {}
}
