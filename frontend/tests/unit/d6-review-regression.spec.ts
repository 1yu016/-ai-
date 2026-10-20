import { afterEach, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { createBackendAsrRecognition } from '@/services/backendAsrRecognition'
import { playBackendTts } from '@/services/backendTts'
import { stopBrowserSpeech } from '@/services/browserSpeech'
import { useDialogueSpeech } from '@/composables/useDialogueSpeech'

afterEach(() => { stopBrowserSpeech(); vi.useRealTimers(); vi.unstubAllGlobals() })
it('releases microphone permission that resolves after abort, without starting', async () => {
  let resolve!: (value: MediaStream) => void
  const stop = vi.fn(), onStart = vi.fn(), getContext = vi.fn()
  const recognition = createBackendAsrRecognition({ getUserMedia: () => new Promise(r => { resolve = r }), getContext: getContext as never })
  recognition.onstart = onStart
  recognition.start(); recognition.abort()
  resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream)
  await Promise.resolve(); await Promise.resolve()
  expect(stop).toHaveBeenCalledOnce()
  expect(getContext).not.toHaveBeenCalled()
  expect(onStart).not.toHaveBeenCalled()
})

it('delivers every independent ASR segment with a usable result index', async () => {
  vi.useFakeTimers()
  let loud = true
  class Context {
    createMediaStreamSource() { return { connect() {} } }
    createAnalyser() { return { fftSize: 4, getFloatTimeDomainData(buffer: Float32Array) { buffer.fill(loud ? .1 : 0) } } }
    close = vi.fn(async () => {})
  }
  class Recorder extends EventTarget {
    static isTypeSupported() { return true }
    state = 'inactive'; mimeType = 'audio/webm'
    start() { this.state = 'recording' }
    stop() { this.state = 'inactive'; this.dispatchEvent(new MessageEvent('dataavailable', { data: new Blob(['synthetic']) })); this.dispatchEvent(new Event('stop')) }
  }
  vi.stubGlobal('MediaRecorder', Recorder)
  const recognition = createBackendAsrRecognition({ getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) as unknown as MediaStream, getContext: Context as never, asr: async () => '合成问题' })
  const texts: string[] = []
  recognition.onresult = event => { for (let i = event.resultIndex; i < event.results.length; i++) texts.push(event.results[i]![0].transcript) }
  recognition.start(); await Promise.resolve()
  for (let i = 0; i < 2; i++) { loud = true; await vi.advanceTimersByTimeAsync(200); loud = false; await vi.advanceTimersByTimeAsync(800) }
  recognition.abort()
  expect(texts).toEqual(['合成问题', '合成问题'])
})

class AudioFixture extends EventTarget {
  static latest: AudioFixture
  constructor(public src: string) { super(); AudioFixture.latest = this }
  play = vi.fn(async () => {})
  pause = vi.fn(); load = vi.fn(); removeAttribute = vi.fn()
}
it('uses actual playing events, not play promise resolution, and reports external cancellation', async () => {
  vi.stubGlobal('Audio', AudioFixture)
  const onStart = vi.fn(), onCancel = vi.fn()
  await playBackendTts({ text: '合成测试', post: async () => ({ audioUrl: 'data:audio/wav;base64,AAAA' }), onStart, onCancel })
  expect(onStart).not.toHaveBeenCalled()
  AudioFixture.latest.dispatchEvent(new Event('playing'))
  expect(onStart).toHaveBeenCalledOnce()
  stopBrowserSpeech()
  expect(onCancel).toHaveBeenCalledOnce()
})
it('never synthesizes an already invalid sentence', async () => {
  const post = vi.fn(async () => ({ audioUrl: 'data:audio/wav;base64,AAAA' }))
  expect(await playBackendTts({ text: '旧句', isCurrent: () => false, post })).toBe('cancelled')
  expect(post).not.toHaveBeenCalled()
})
it('ignores a previous sentence callback after the next sentence has started', async () => {
  const calls: Array<Parameters<NonNullable<Parameters<typeof useDialogueSpeech>[0]['speak']>>[1]> = []
  const scope = effectScope()
  const speech = scope.run(() => useDialogueSpeech({ identity: () => 'run1:step0', allowed: () => true, enabled: () => true, onSpeaking() {}, speak: async (_text, cb) => { calls.push(cb); return 'started' } }))!
  try {
    speech.begin(); speech.append('第一句。第二句。')
    calls[0]!.onStart!(); calls[0]!.onEnded!(); calls[1]!.onStart!()
    calls[0]!.onEnded!()
    expect(speech.speaking.value).toBe(true)
    calls[1]!.onEnded!()
    calls[0]!.onStart!()
    expect(speech.speaking.value).toBe(false)
    expect(speech.occupied.value).toBe(false)
  } finally { scope.stop() }
})
it('releases the queue when the provider promise rejects', async () => {
  const scope = effectScope()
  const speech = scope.run(() => useDialogueSpeech({ identity: () => 'r1', allowed: () => true, enabled: () => true, onSpeaking() {}, speak: async () => { throw new Error('network') } }))!
  try {
    speech.begin(); speech.append('合成问题。'); await Promise.resolve(); await Promise.resolve()
    expect(speech.occupied.value).toBe(false)
    expect(speech.error.value).toContain('语音朗读不可用')
  } finally { scope.stop() }
})
