/**
 * 课堂本地语音唤醒（教师端）。
 *
 * 设计边界：
 *  - 唤醒检测完全在本机浏览器内完成（vosk-browser + vosk-model-small-cn，Apache-2.0），
 *    唤醒前不向云端上传任何教室音频；模型与脚本由本项目静态资源提供，无第三方请求。
 *  - 只有教师点击「开启语音唤醒」并授予麦克风权限后才开始采集；关闭即释放麦克风与识别器。
 *  - 本模块只负责「听到唤醒词 → 采集一段指令语音 → 交给既有课堂指令链路」，
 *    不解析业务意图、不调用任何课堂 API；点名/奖励/课堂状态仍由既有 CommandBus 执行。
 *  - 数字人播报期间由调用方 setPlaybackActive(true)，本模块停止送音，避免自唤醒。
 */

export type WakeUiState = 'off' | 'loading' | 'waiting' | 'awake' | 'error'

export type WakeSpeechCallbacks = {
  onState?: (state: WakeUiState, message: string) => void
  /** 命中唤醒词（已经给出视觉反馈，可另行播报/数字人动作）。 */
  onWake?: () => void
  /** 指令采集期间的本地部分识别文本（用于「正在识别」提示）。 */
  onPartial?: (text: string) => void
  /** 一段指令语音结束：blob 为 webm 音频，localText 为本地识别文本（云端 ASR 的兜底）。 */
  onUtterance?: (blob: Blob, localText: string) => void
  /** 指令接收窗口因超时 / 停止口令结束（唤醒检测仍在继续）。 */
  onCommandWindowEnd?: (reason: string) => void
}

export type WakeSpeechOptions = WakeSpeechCallbacks & {
  /** Public transcription never wakes, buffers command audio or invokes teacher callbacks. */
  publicTranscription?: boolean
  onPublicUtterance?: (text: string) => void
  /** 默认 `/vendor/vosk.js`。 */
  scriptUrl?: string
  /** 默认 `/vosk-model/model.tar.gz`。 */
  modelUrl?: string
  /** 唤醒词（宽松匹配，允许空格/标点差异）。 */
  wakePhrases?: string[]
  /** 唤醒后持续接收后续指令的窗口时长。 */
  commandWindowMs?: number
  /** Hard cap across all activity renewals; default 60 seconds. */
  maxSessionMs?: number
  /** 单条指令最长录音时长。 */
  maxUtteranceMs?: number
  /** 两次唤醒之间的防抖。 */
  wakeCooldownMs?: number
}

export const DEFAULT_WAKE_PHRASES = ['你好小助手', '您好小助手', '小助手你好', '你好小助', '嘿小助手', '小星']
const DEFAULT_COMMAND_WINDOW_MS = 20_000
const DEFAULT_MAX_UTTERANCE_MS = 12_000
const DEFAULT_WAKE_COOLDOWN_MS = 2_500
const PUBLIC_UTTERANCE_IDLE_MS = 5_000

/** 唤醒/指令文本归一化：去标点、空格与全角差异，便于口语容错。 */
export function normalizeSpeechText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, '')
    .replace(/[\s，。！？、；：“”‘’（）《》〈〉,.!?;:'"()[\]{}<>#@&%~`^_\-=+/\\|]/g, '')
    .trim()
}

/** 宽松唤醒词匹配：允许 ASR 少一个字/多一个语气字，但不接受只出现「小助手」。 */
export function matchWakePhrase(raw: string, phrases: string[] = DEFAULT_WAKE_PHRASES): string | null {
  const text = normalizeSpeechText(raw)
  if (!text) return null
  for (const phrase of phrases) {
    const target = normalizeSpeechText(phrase)
    if (!target) continue
    if (text.includes(target)) return phrase
    if(target.length<4)continue
    const minLength = Math.max(2, target.length - 1)
    for (let start = 0; start + minLength <= text.length; start += 1) {
      const slice = text.slice(start, start + target.length)
      // 容错片段必须与唤醒词同开头，避免只听到「小助手」就误唤醒。
      if (slice.length >= minLength && slice.startsWith(target[0]!) && editDistanceAtMostOne(slice, target)) return phrase
    }
  }
  return null
}

function editDistanceAtMostOne(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  let j = 0
  let edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1
      j += 1
      continue
    }
    edits += 1
    if (edits > 1) return false
    if (a.length > b.length) i += 1
    else if (a.length < b.length) j += 1
    else {
      i += 1
      j += 1
    }
  }
  return true
}

/**
 * 去掉识别文本开头的唤醒词，避免「你好小助手随机点名」把唤醒词带进口令。
 * 返回归一化后的剩余文本。
 */
export function stripWakePhrase(raw: string, phrases: string[] = DEFAULT_WAKE_PHRASES): string {
  let text = normalizeSpeechText(raw)
  if (!text) return ''
  for (let round = 0; round < 2; round += 1) {
    let removed = false
    for (const phrase of phrases) {
      const target = normalizeSpeechText(phrase)
      if (!target) continue
      if (text.startsWith(target)) {
        text = text.slice(target.length)
        removed = true
        break
      }
    }
    if (!removed) break
  }
  return text
}

/** 结束指令接收窗口的口令（只控制本模块状态，不产生课堂业务操作）。 */
export function isStopListeningPhrase(raw: string): boolean {
  const text = normalizeSpeechText(raw)
  return ['停止听指令', '停止接收指令', '不用听了', '结束听指令', '停止监听指令', '停止听我说话', '停止收听', '取消'].includes(text)
}

type VoskRecognizer = {
  on: (event: 'result' | 'partialresult', listener: (message: unknown) => void) => void
  acceptWaveform: (buffer: AudioBuffer) => void
  remove: () => void
}
type VoskModel = {
  KaldiRecognizer: new (sampleRate: number, grammar?: string) => VoskRecognizer
  terminate: () => void
}
type VoskGlobal = { createModel: (url: string, logLevel?: number) => Promise<VoskModel> }

function getWindow(): (Window & { Vosk?: VoskGlobal }) | null {
  return typeof window === 'undefined' ? null : (window as Window & { Vosk?: VoskGlobal })
}

async function loadVoskScript(scriptUrl: string): Promise<VoskGlobal> {
  const win = getWindow()
  if (!win) throw new Error('当前环境不支持浏览器语音识别。')
  if (win.Vosk) return win.Vosk
  await new Promise<void>((resolve, reject) => {
    const script = document.querySelector<HTMLScriptElement>('script[data-vosk-script="1"]')
    if (script) {
      if (win.Vosk) return resolve()
      script.addEventListener('load', () => resolve(), { once: true })
      script.addEventListener('error', () => reject(new Error('本地唤醒引擎加载失败。')), { once: true })
      return
    }
    const created = document.createElement('script')
    created.src = scriptUrl
    created.async = true
    created.dataset.voskScript = '1'
    created.addEventListener('load', () => resolve(), { once: true })
    created.addEventListener('error', () => reject(new Error('本地唤醒引擎加载失败。')), { once: true })
    document.head.appendChild(created)
  })
  if (!win.Vosk) throw new Error('本地唤醒引擎不可用。')
  return win.Vosk
}

function microphoneErrorMessage(error: unknown): string {
  if(error instanceof Error && /not supported/i.test(error.message))return '当前浏览器或输入设备不支持语音采集，请检查麦克风并使用最新版 Chrome 或 Edge。'
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return '麦克风权限被拒绝，请在浏览器地址栏允许麦克风后重试。'
    }
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      return '没有检测到麦克风设备，请连接麦克风后重试。'
    }
    if (error.name === 'NotReadableError') {
      return '麦克风被其它程序占用，请关闭占用后重试。'
    }
  }
  return error instanceof Error ? error.message : '无法开启麦克风。'
}

export class LocalWakeSpeech {
  private readonly options: Required<
    Pick<WakeSpeechOptions, 'scriptUrl' | 'modelUrl' | 'wakePhrases' | 'commandWindowMs' | 'maxUtteranceMs' | 'wakeCooldownMs'>
  > & WakeSpeechOptions
  private model: VoskModel | null = null
  private recognizer: VoskRecognizer | null = null
  private stream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private processor: ScriptProcessorNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private sampleRate = 0
  /** 指令阶段采集的 PCM 帧（直接来自唤醒识别同一条音频流，避免二次录音错位）。 */
  private commandFrames: Float32Array[] = []
  private commandSamples = 0
  /** 当前指令分段的峰值音量，用于跳过静音，避免"没有听清"式的空提交。 */
  private commandPeak = 0
  /** 唤醒前的短预录，保证「你好小助手，随机点名」一口气说完也能拿到指令。 */
  private prerollFrames: Float32Array[] = []
  private prerollSamples = 0
  private mode: 'off' | 'starting' | 'waiting' | 'command' = 'off'
  private commandDeadline = 0
  private sessionDeadline = 0
  private commandTimer: ReturnType<typeof setTimeout> | null = null
  private publicPauseTimer: ReturnType<typeof setTimeout> | null = null
  private publicText = ''
  private maxUtteranceTimer: ReturnType<typeof setTimeout> | null = null
  private lastWakeAt = 0
  private playbackActive = false
  private starting = false
  private disposed = false
  private lastError = ''

  constructor(options: WakeSpeechOptions = {}) {
    this.options = {
      ...options,
      scriptUrl: options.scriptUrl ?? `${import.meta.env.BASE_URL}vendor/vosk.js`,
      modelUrl: options.modelUrl ?? `${import.meta.env.BASE_URL}vosk-model/model.tar.gz`,
      wakePhrases: options.wakePhrases ?? DEFAULT_WAKE_PHRASES,
      commandWindowMs: options.commandWindowMs ?? DEFAULT_COMMAND_WINDOW_MS,
      maxUtteranceMs: options.maxUtteranceMs ?? DEFAULT_MAX_UTTERANCE_MS,
      wakeCooldownMs: options.wakeCooldownMs ?? DEFAULT_WAKE_COOLDOWN_MS,
      maxSessionMs: Math.max(1000,Math.min(options.maxSessionMs ?? 60000,60000)),
    }
  }

  get state(): WakeUiState {
    if (this.mode === 'starting') return 'loading'
    if (this.mode === 'command') return 'awake'
    if (this.mode === 'waiting') return 'waiting'
    return this.lastError ? 'error' : 'off'
  }

  private emitState(state: WakeUiState, message: string) {
    this.options.onState?.(state, message)
  }

  /** 教师主动开启：加载本地模型 → 请求麦克风 → 进入等待唤醒词。 */
  async start(): Promise<void> {
    if (this.starting || this.mode !== 'off') return
    this.starting = true
    this.disposed = false
    this.lastError = ''
    this.mode = 'starting'
    this.emitState('loading', '正在加载本地唤醒引擎…')
    try {
      const Vosk = await loadVoskScript(this.options.scriptUrl)
      if (this.disposed) return
      const model = await Vosk.createModel(this.options.modelUrl, -1)
      if (this.disposed) {
        model.terminate()
        return
      }
      this.model = model
      this.emitState('loading', '正在请求麦克风权限…')
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      })
      if (this.disposed) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      this.stream = stream
      const audioContext = new AudioContext()
      await audioContext.resume().catch(() => undefined)
      this.audioContext = audioContext
      this.sampleRate = audioContext.sampleRate
      const recognizer = new model.KaldiRecognizer(audioContext.sampleRate)
      this.recognizer = recognizer
      recognizer.on('partialresult', (message) => this.handlePartial(message))
      recognizer.on('result', (message) => this.handleResult(message))
      const source = audioContext.createMediaStreamSource(stream)
      const processor = audioContext.createScriptProcessor(4096, 1, 1)
      processor.onaudioprocess = (event) => {
        if (this.playbackActive || this.disposed) return
        this.collectFrame(event.inputBuffer)
        try {
          this.recognizer?.acceptWaveform(event.inputBuffer)
        } catch {
          /* 单帧失败不中断监听 */
        }
      }
      // 必须接到 destination 才会持续回调；用 0 增益避免本机回声。
      const silentGain = audioContext.createGain()
      silentGain.gain.value = 0
      source.connect(processor)
      processor.connect(silentGain)
      silentGain.connect(audioContext.destination)
      this.source = source
      this.processor = processor
      this.mode = 'waiting'
      this.emitState('waiting', this.options.publicTranscription ? '本地儿童问题收听中' : '正在等待唤醒词：你好，小助手')
      if (this.options.publicTranscription) this.commandTimer = setTimeout(() => this.finishPublicUtterance(), Math.min(30000, this.options.maxUtteranceMs))
    } catch (error) {
      this.lastError = microphoneErrorMessage(error)
      this.emitState('error', this.lastError)
      await this.releaseResources()
      this.mode = 'off'
    } finally {
      this.starting = false
    }
  }

  /** 教师主动关闭：停止采集、释放麦克风与识别器（不保留后台监听）。 */
  async stop(): Promise<void> {
    this.disposed = true
    this.mode = 'off'
    this.lastError = ''
    await this.releaseResources()
    this.emitState('off', '语音唤醒已关闭，麦克风已释放。')
  }

  /** 数字人/媒体播报期间暂停送音，避免 TTS 触发自身唤醒或重复指令。 */
  setPlaybackActive(active: boolean) {
    this.playbackActive = active
    // 播报期间丢弃已采集的指令音频，避免把数字人自己的声音当成教师指令。
    if (active) this.resetCommandAudio()
  }

  /** 云端识别出「停止听指令」时，由调用方结束指令窗口（唤醒检测继续）。 */
  stopCommandWindow() {
    if (this.mode === 'command') this.endCommandWindow('已停止接收指令，仍在等待唤醒词。')
  }

  private async releaseResources() {
    this.clearCommandTimers()
    this.resetCommandAudio()
    this.prerollFrames = []
    this.prerollSamples = 0
    try {
      this.processor?.disconnect()
      this.source?.disconnect()
    } catch {
      /* ignore */
    }
    this.processor = null
    this.source = null
    if (this.audioContext) {
      await this.audioContext.close().catch(() => undefined)
      this.audioContext = null
    }
    this.sampleRate = 0
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
    try {
      this.recognizer?.remove()
    } catch {
      /* ignore */
    }
    this.recognizer = null
    if (this.model) {
      try {
        this.model.terminate()
      } catch {
        /* ignore */
      }
      this.model = null
    }
  }

  private handlePartial(message: unknown) {
    if (this.options.publicTranscription || this.disposed) return
    if(this.playbackActive)return
    const text = (message as { result?: { partial?: string } })?.result?.partial ?? ''
    if (!text) return
    if (this.mode === 'waiting') {
      if (matchWakePhrase(text, this.options.wakePhrases)) this.handleWake()
      return
    }
    if (this.mode === 'command') {
      const rest = stripWakePhrase(text, this.options.wakePhrases)
      if (rest) this.options.onPartial?.(rest)
    }
  }

  private handleResult(message: unknown) {
    if (this.options.publicTranscription) {
      if (this.disposed || this.playbackActive || this.mode !== 'waiting') return
      const text = (message as { result?: { text?: string } })?.result?.text?.trim()
      if (text) {
        this.publicText = this.appendPublicTranscript(this.publicText, text)
        if (this.publicPauseTimer) clearTimeout(this.publicPauseTimer)
        // Vosk may emit several final segments around child pauses. Wait for a
        // quiet gap before submitting, while the independent 30s cap remains.
        this.publicPauseTimer = setTimeout(() => this.finishPublicUtterance(), PUBLIC_UTTERANCE_IDLE_MS)
      }
      return
    }
    if (this.playbackActive) return
    const text = (message as { result?: { text?: string } })?.result?.text ?? ''
    if (!text) return
    if (this.mode === 'waiting') {
      if (matchWakePhrase(text, this.options.wakePhrases)) this.handleWake()
      return
    }
    if (this.mode !== 'command') return
    const rest = stripWakePhrase(text, this.options.wakePhrases)
    if (isStopListeningPhrase(rest || text)) {
      this.endCommandWindow('已停止接收指令，仍在等待唤醒词。')
      return
    }
    if (!rest || normalizeSpeechText(rest).length < 2) {
      this.extendCommandWindow()
      return
    }
    this.emitUtterance(rest)
  }

  private appendPublicTranscript(previous: string, next: string) {
    if (!previous) return next
    if (previous.includes(next)) return previous
    if (next.startsWith(previous)) return next
    let overlap = Math.min(previous.length, next.length)
    while (overlap > 0 && previous.slice(-overlap) !== next.slice(0, overlap)) overlap -= 1
    return previous + next.slice(overlap)
  }

  private finishPublicUtterance() {
    const text = this.publicText.trim()
    this.publicText = ''
    if (this.publicPauseTimer) clearTimeout(this.publicPauseTimer)
    this.publicPauseTimer = null
    if (this.commandTimer) clearTimeout(this.commandTimer)
    this.commandTimer = null
    if (text) this.options.onPublicUtterance?.(text)
    void this.stop()
  }

  private emitUtterance(localText: string) {
    const peak = this.commandPeak
    const blob = this.takeUtteranceWav()
    if (this.disposed || this.mode !== 'command') return
    // 本地识别结果可能是上一段语音的延迟结果；当前分段静音时不做业务提交。
    if (!localText && peak < 0.012) {
      this.extendCommandWindow()
      return
    }
    if (localText) this.options.onUtterance?.(blob, localText)
    if (this.mode !== 'command') return
    this.extendCommandWindow()
  }

  private handleWake() {
    const now = Date.now()
    if (now - this.lastWakeAt < this.options.wakeCooldownMs) return
    this.lastWakeAt = now
    this.mode = 'command'
    this.sessionDeadline = now + (this.options.maxSessionMs ?? 60000)
    // 把唤醒前的短预录并入指令音频：避免「你好小助手，随机点名」一口气说完时丢掉指令。
    this.commandFrames = this.prerollFrames
    this.commandSamples = this.prerollSamples
    this.prerollFrames = []
    this.prerollSamples = 0
    this.options.onWake?.()
    this.emitState('awake', '我在。请说指令。')
    this.extendCommandWindow()
  }

  private extendCommandWindow() {
    const remaining = this.sessionDeadline-Date.now()
    if (remaining<=0) {this.endCommandWindow('连续收听已达时限，请重新唤醒。');return}
    const duration=Math.min(this.options.commandWindowMs,remaining)
    this.commandDeadline = Date.now() + duration
    if (this.commandTimer) clearTimeout(this.commandTimer)
    this.commandTimer = setTimeout(() => {
      if (this.mode === 'command') this.endCommandWindow('指令接收已超时，回到等待唤醒词。')
    }, duration)
    if (this.maxUtteranceTimer) clearTimeout(this.maxUtteranceTimer)
    this.maxUtteranceTimer = setTimeout(() => {
      if (this.mode !== 'command') return
      // 静音段（例如数字人播报后的空白）不产生指令提交。
      if (this.commandPeak < 0.012) {
        this.resetCommandAudio()
        this.extendCommandWindow()
        return
      }
      this.emitUtterance('')
    }, this.options.maxUtteranceMs)
  }

  private endCommandWindow(reason: string) {
    this.clearCommandTimers()
    this.resetCommandAudio()
    this.mode = 'waiting'
    this.options.onCommandWindowEnd?.(reason)
    this.emitState('waiting', '正在等待唤醒词：你好，小助手')
  }

  private clearCommandTimers() {
    if (this.commandTimer) clearTimeout(this.commandTimer)
    if (this.maxUtteranceTimer) clearTimeout(this.maxUtteranceTimer)
    if (this.publicPauseTimer) clearTimeout(this.publicPauseTimer)
    this.publicText = ''
    this.commandTimer = null
    this.publicPauseTimer = null
    this.maxUtteranceTimer = null
  }

  /** 采集一帧音频：等待唤醒时只保留最近 1.5s 预录，唤醒后累积为指令音频。 */
  private collectFrame(input: AudioBuffer) {
    if (this.options.publicTranscription) return
    const channel = input.getChannelData(0)
    if (!channel?.length) return
    if (this.mode === 'command') {
      let peak = 0
      for (let index = 0; index < channel.length; index += 1) {
        const value = Math.abs(channel[index]!)
        if (value > peak) peak = value
      }
      if (peak > this.commandPeak) this.commandPeak = peak
      this.commandFrames.push(new Float32Array(channel))
      this.commandSamples += channel.length
      return
    }
    if (this.mode !== 'waiting' || !this.sampleRate) return
    this.prerollFrames.push(new Float32Array(channel))
    this.prerollSamples += channel.length
    const limit = Math.round(this.sampleRate * 1.5)
    while (this.prerollSamples > limit && this.prerollFrames.length) {
      const removed = this.prerollFrames.shift()
      this.prerollSamples -= removed?.length ?? 0
    }
  }

  /** 取出当前指令音频（16bit PCM WAV），并清空缓冲供下一句指令使用。 */
  private takeUtteranceWav(): Blob {
    const frames = this.commandFrames
    const samples = this.commandSamples
    this.commandFrames = []
    this.commandSamples = 0
    this.commandPeak = 0
    if (!samples || !this.sampleRate) return new Blob([], { type: 'audio/wav' })
    return encodeWav(frames, this.sampleRate, samples)
  }

  private resetCommandAudio() {
    this.commandFrames = []
    this.commandSamples = 0
    this.commandPeak = 0
  }
}

/** Float32 PCM 帧 → 16bit 单声道 WAV Blob（供既有 /ai/asr 直接使用）。 */
function encodeWav(frames: Float32Array[], sampleRate: number, sampleCount: number): Blob {
  const bytesPerSample = 2
  const dataSize = sampleCount * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  const writeText = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index))
  }
  writeText(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeText(8, 'WAVE')
  writeText(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * bytesPerSample, true)
  view.setUint16(32, bytesPerSample, true)
  view.setUint16(34, 16, true)
  writeText(36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (const frame of frames) {
    for (let index = 0; index < frame.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, frame[index] ?? 0))
      view.setInt16(offset, Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff), true)
      offset += bytesPerSample
    }
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

export { microphoneErrorMessage }
