/**
 * 课堂语音命令接入（Stage 6.3）。
 *
 * 职责（遵循「复用现有 Classroom Command Runtime，不新建 Router/后端」）：
 *  - 共享录音编排：一次 push-to-talk session（getUserMedia + MediaRecorder），
 *    避免在 ChatView / LessonClassroomView 里再复制第三份 MediaRecorder 逻辑；
 *  - ASR：复用已有 POST /ai/asr；
 *  - 识别文本：送入已有 ClassroomIntentRouter；local 命中 → ClassroomCommandExecutor
 *    → existing ClassroomRun API；UNKNOWN → 已有 runAiCommandFallback()（5s timeout + allowlist）。
 *
 * 安全约束：
 *  - 无持续监听 / 无 wake word：一次点击 → 一次录音 → 一次识别 → 一次命令；
 *  - 任何错误（权限/不支持/空录音/ASR 失败/空 text/fallback 失败）都不执行课堂命令；
 *  - 本模块是纯 TS（除 createClassroomVoiceRecorder 涉及浏览器 API），便于注入 mock 单测。
 */
import { ClassroomCommandExecutor } from '@/classroom/command/ClassroomCommandExecutor'
import { resolveIntent } from '@/classroom/command/ClassroomIntentRouter'
import {
  runAiCommandFallback,
  type AiCommandFallbackDeps,
} from '@/classroom/command/classroomAiFallback'
import {
  RECORDING_MIME_TYPE,
  isRecordingSupported,
  webmToWav,
} from '@/services/recordingAudio'

export type VoiceCommandOutcome =
  | { kind: 'executed'; intent: string; message: string }
  | { kind: 'unsupported'; intent: string; reply: string }
  | { kind: 'failed'; hint: string }

export interface VoiceCommandContext {
  currentPage: string
  currentResourceId?: string
  playerStatus: string
  ageGroup?: string
}

/**
 * 把 /ai/asr 识别出的文本跑一遍「本地 Router → AI fallback」流水线。
 * 与文本口令 runCommand 完全同一条命令链路，绝不新建第二套 Router。
 * 返回 outcome，由调用方决定 UI 反馈；本函数不修改任何课堂状态以外的副作用（除 Executor 本身）。
 */
export async function runAsrTextThroughCommand(
  text: string,
  runId: number,
  context: VoiceCommandContext,
  executor: ClassroomCommandExecutor,
  deps: AiCommandFallbackDeps,
  timeoutMs = 5000,
): Promise<VoiceCommandOutcome> {
  const trimmed = text.trim()
  if (!trimmed) {
    // 空文本：不得执行任何课堂命令。
    return { kind: 'failed', hint: '没有听清，请再说一次。' }
  }
  const match = resolveIntent(trimmed)
  if (match.local && match.command) {
    const result = await executor.execute(match)
    return { kind: 'executed', intent: match.intent, message: result.message }
  }
  // UNKNOWN（含疑问句“下一步我们要做什么”、否定句“不要下一步我们继续讲”等）
  // → 已有 AI fallback：5s timeout + allowlist + safe failure。
  return runAiCommandFallback(
    runId,
    trimmed,
    { text: trimmed, context },
    deps,
    executor,
    timeoutMs,
  )
}

export interface ClassroomVoiceRecorderOptions {
  /** 录音完成（一次 utterance）后回调原始 webm blob */
  onBlob: (blob: Blob) => void
  /** 录音链路（权限/MediaRecorder/环境）错误 */
  onError: (error: Error) => void
  /** 可注入环境探测（默认 isRecordingSupported） */
  isSupported?: () => boolean
}

export interface ClassroomVoiceRecorder {
  start: () => Promise<void>
  stop: () => void
  /** 放弃本次录音：停止并释放麦克风，不触发 onBlob */
  cancel: () => void
}

/**
 * 一次 push-to-talk 录音 session。
 * 复用共享模块：RECORDING_MIME_TYPE / isRecordingSupported / 权限错误处理与
 * ChatView 现有实现对齐，避免第三份复制。
 */
export function createClassroomVoiceRecorder(
  options: ClassroomVoiceRecorderOptions,
): ClassroomVoiceRecorder {
  const supported = options.isSupported ?? isRecordingSupported
  let stream: MediaStream | null = null
  let recorder: MediaRecorder | null = null
  let chunks: Blob[] = []
  let completed = false

  const releaseTracks = () => {
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
  }

  return {
    async start() {
      if (recorder && recorder.state !== 'inactive') {
        return
      }
      if (!supported()) {
        throw new Error(
          '当前浏览器不支持麦克风录音，请使用最新版 Chrome 或 Edge。',
        )
      }
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })
      const mediaRecorder = new MediaRecorder(mediaStream, {
        mimeType: RECORDING_MIME_TYPE,
      })
      stream = mediaStream
      recorder = mediaRecorder
      chunks = []
      completed = false

      mediaRecorder.addEventListener(
        'dataavailable',
        (event: BlobEvent) => {
          if (event.data.size > 0) chunks.push(event.data)
        },
      )
      mediaRecorder.addEventListener(
        'stop',
        () => {
          const blob = new Blob(chunks, { type: RECORDING_MIME_TYPE })
          chunks = []
          recorder = null
          releaseTracks()
          if (!completed) options.onBlob(blob)
        },
        { once: true },
      )
      mediaRecorder.addEventListener(
        'error',
        () => {
          completed = true
          recorder = null
          releaseTracks()
          options.onError(new Error('录音发生错误，请重新尝试。'))
        },
        { once: true },
      )

      mediaRecorder.start()
    },
    stop() {
      if (!recorder || recorder.state === 'inactive') return
      recorder.stop()
    },
    cancel() {
      completed = true
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop()
      }
      recorder = null
      chunks = []
      releaseTracks()
    },
  }
}

/**
 * ASR 请求封装：webm → wav，POST /ai/asr，返回规范化文本。
 * post 注入以便单测与复用 http 客户端。
 */
export async function asrRecognizeWav(
  audioBlob: Blob,
  post: AiCommandFallbackDeps['post'],
): Promise<string> {
  const wavBlob = await webmToWav(audioBlob)
  const formData = new FormData()
  formData.append('file', wavBlob, `voice-command-${Date.now()}.wav`)
  const res = await post('/ai/asr', formData)
  const data = res as { text?: unknown }
  const text = typeof data?.text === 'string' ? data.text.trim() : ''
  return text
}

// 仅为单测引用保留：标注 RECORDING_MIME_TYPE / isRecordingSupported 已被本模块使用。
export { RECORDING_MIME_TYPE, isRecordingSupported }
