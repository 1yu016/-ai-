import { describe, expect, it, vi } from 'vitest'
import { ClassroomIntent } from '@/classroom/command/ClassroomIntent'
import {
  asrRecognizeWav,
  createClassroomVoiceRecorder,
  runAsrTextThroughCommand,
} from '@/services/voiceCommand'
import { ClassroomCommandExecutor } from '@/classroom/command/ClassroomCommandExecutor'
import { DeviceCommandExecutor } from '@/classroom/command/DeviceCommandExecutor'
import { useLessonRunStore } from '@/stores/lessonRun'
import { useResourcePlayerStore } from '@/stores/resourcePlayer'

// jsdom 无 AudioContext，mock webmToWav 避免真实解码；仅影响 asrRecognizeWav 用例。
vi.mock('@/services/recordingAudio', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/recordingAudio')>()
  return {
    ...actual,
    webmToWav: vi.fn(async () => new Blob(['wav'], { type: 'audio/wav' })),
  }
})

function buildExecutors() {
  const next = vi.fn()
  const previous = vi.fn()
  const pause = vi.fn()
  const resume = vi.fn()
  const reset = vi.fn()
  const lessonRun = {
    next, previous, pause, resume, repeat: reset,
  } as unknown as ReturnType<typeof useLessonRunStore>
  const resourcePlayer = {} as ReturnType<typeof useResourcePlayerStore>
  const classroom = new ClassroomCommandExecutor(lessonRun, resourcePlayer)
  const device = new DeviceCommandExecutor(resourcePlayer)
  return { executors: { classroom, device }, next, previous, pause, resume, reset, lessonRun }
}

function deps(overrides: Partial<{ isCurrent: () => boolean; post: () => Promise<unknown> }> = {}) {
  return {
    post: overrides.post ?? vi.fn(async () => ({ intent: 'unknown', reply: '' })),
    isCurrent: overrides.isCurrent ?? (() => true),
  }
}

describe('Stage 6.3 语音命令：ASR 文本 → 已有 Command Runtime', () => {
  it('ASR “下一步”→ Router NEXT_STEP → Executor → lessonRun.next', async () => {
    const { executors, next } = buildExecutors()
    const outcome = await runAsrTextThroughCommand('下一步', 1, { currentPage: 'resources', playerStatus: 'idle' }, executors, deps())
    expect(outcome.kind).toBe('executed')
    if (outcome.kind === 'executed') expect(outcome.intent).toBe(ClassroomIntent.NEXT_STEP)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('ASR “下一步我们要做什么”→ 疑问守卫 → UNKNOWN → 不执行', async () => {
    const { executors, next } = buildExecutors()
    const post = vi.fn(async () => ({ intent: 'unknown', reply: '' }))
    const outcome = await runAsrTextThroughCommand('下一步我们要做什么', 1, { currentPage: 'resources', playerStatus: 'idle' }, executors, deps({ post }))
    expect(outcome.kind).toBe('unsupported')
    expect(next).not.toHaveBeenCalled()
  })

  it('ASR “不要下一步我们继续讲”→ UNKNOWN → 不执行任何 classroom-run 写操作', async () => {
    const { executors, next, previous, pause, resume, reset } = buildExecutors()
    const post = vi.fn(async () => ({ intent: 'unknown', reply: '' }))
    const outcome = await runAsrTextThroughCommand('不要下一步我们继续讲', 1, { currentPage: 'resources', playerStatus: 'idle' }, executors, deps({ post }))
    expect(outcome.kind).toBe('unsupported')
    expect(next).not.toHaveBeenCalled(); expect(previous).not.toHaveBeenCalled()
    expect(pause).not.toHaveBeenCalled(); expect(resume).not.toHaveBeenCalled(); expect(reset).not.toHaveBeenCalled()
  })

  it('ASR 空文本 → 不执行，提示“没有听清”', async () => {
    const { executors, next } = buildExecutors()
    const outcome = await runAsrTextThroughCommand('   ', 1, { currentPage: 'resources', playerStatus: 'idle' }, executors, deps())
    expect(outcome.kind).toBe('failed')
    if (outcome.kind === 'failed') expect(outcome.hint).toContain('没有听清')
    expect(next).not.toHaveBeenCalled()
  })

  it('ASR 请求失败 → 抛错（由调用方安全处理，不执行）', async () => {
    const post = vi.fn(async () => { throw new Error('asr 500') })
    await expect(asrRecognizeWav(new Blob(['x'], { type: 'audio/webm' }), post)).rejects.toThrow()
  })

  it('麦克风权限失败 → start() 拒绝且不触发 onBlob', async () => {
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => { const e = new DOMException('denied', 'NotAllowedError'); throw e }) } })
    const onBlob = vi.fn()
    const recorder = createClassroomVoiceRecorder({ onBlob, onError: vi.fn() })
    await expect(recorder.start()).rejects.toThrow()
    expect(onBlob).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('fallback timeout → 沿用 Stage 6.2 safe failure（不执行）', async () => {
    const { executors, next } = buildExecutors()
    const post = vi.fn(async () => { throw new Error('timeout') })
    const outcome = await runAsrTextThroughCommand('我们回到刚刚认识数字外形的那个环节', 1, { currentPage: 'resources', playerStatus: 'idle' }, executors, deps({ post }))
    expect(outcome.kind).toBe('failed')
    if (outcome.kind === 'failed') expect(outcome.hint).toContain('未能识别')
    expect(next).not.toHaveBeenCalled()
  })

  it('迟到响应：runId 已失效（isCurrent=false）→ 即使返回可执行意图也不执行', async () => {
    const { executors, next } = buildExecutors()
    const post = vi.fn(async () => ({ intent: 'next_step', reply: '' }))
    const outcome = await runAsrTextThroughCommand('复杂表达', 42, { currentPage: 'resources', playerStatus: 'idle' }, executors, deps({ post, isCurrent: () => false }))
    expect(outcome.kind).toBe('failed')
    expect(next).not.toHaveBeenCalled()
  })
})

describe('Stage 6.3 共享录音编排（createClassroomVoiceRecorder）', () => {
  function fakeStream() {
    return { getTracks: () => [{ stop: vi.fn() }], stop: vi.fn() }
  }
  function fakeMediaRecorderClass() {
    class FakeMediaRecorder {
      static isTypeSupported = () => true
      state = 'inactive'
      handlers: Record<string, ((...a: unknown[]) => void)[]> = {}
      constructor() { this.state = 'inactive' }
      addEventListener(type: string, fn: (...a: unknown[]) => void) { (this.handlers[type] ??= []).push(fn) }
      start() { this.state = 'recording' }
      stop() { this.state = 'inactive'; for (const fn of this.handlers['stop'] ?? []) fn() }
    }
    return FakeMediaRecorder as unknown as typeof MediaRecorder
  }

  it('一次 push-to-talk：start → stop → 产出 blob，仅一次 getUserMedia', async () => {
    const getUserMedia = vi.fn(async () => fakeStream())
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    vi.stubGlobal('MediaRecorder', fakeMediaRecorderClass())
    const onBlob = vi.fn()
    const recorder = createClassroomVoiceRecorder({ onBlob, onError: vi.fn() })
    await recorder.start()
    // 重复 start：录音中直接返回，不创建第二个 session
    await recorder.start()
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    recorder.stop()
    expect(onBlob).toHaveBeenCalledTimes(1)
    const blob = onBlob.mock.calls[0]![0]
    expect(blob).toBeInstanceOf(Blob)
    vi.unstubAllGlobals()
  })

  it('重复点击防护：录音中再点不创建并发 session', async () => {
    const getUserMedia = vi.fn(async () => fakeStream())
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    vi.stubGlobal('MediaRecorder', fakeMediaRecorderClass())
    const onBlob = vi.fn()
    const recorder = createClassroomVoiceRecorder({ onBlob, onError: vi.fn() })
    await recorder.start()
    await recorder.start() // 第二次 start 内部直接 return
    await recorder.start() // 第三次同样
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    recorder.cancel()
    expect(onBlob).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

describe('Stage 6.3 ASR 封装（asrRecognizeWav）', () => {
  it('返回规范化文本', async () => {
    const post = vi.fn(async () => ({ text: ' 下一步 ' }))
    const text = await asrRecognizeWav(new Blob(['x'], { type: 'audio/webm' }), post)
    expect(text).toBe('下一步')
  })

  it('ASR 返回空 text → 返回空字符串（由调用方判定不执行）', async () => {
    const post = vi.fn(async () => ({ text: '' }))
    const text = await asrRecognizeWav(new Blob(['x'], { type: 'audio/webm' }), post)
    expect(text).toBe('')
  })
})
