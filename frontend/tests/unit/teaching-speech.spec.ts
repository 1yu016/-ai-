import { effectScope, reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTeachingSpeech } from '@/composables/useTeachingSpeech'
import { playExclusiveAudio, stopBrowserSpeech } from '@/services/browserSpeech'

class AudioFixture {
  static all: AudioFixture[] = []
  static pending: (() => Promise<void>) | null = null
  paused = true
  src: string
  listeners: Record<string, (() => void)[]> = {}
  constructor(src: string) { this.src = src; AudioFixture.all.push(this) }
  play = vi.fn(async () => { if (AudioFixture.pending) await AudioFixture.pending(); this.paused = false })
  pause = vi.fn(() => { this.paused = true })
  load = vi.fn()
  removeAttribute = vi.fn(() => { this.src = '' })
  addEventListener(type: string, cb: () => void) { (this.listeners[type] ??= []).push(cb) }
  emit(type: string) { this.listeners[type]?.forEach(cb => cb()) }
}
function deferred<T>() { let resolve!: (x: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
describe('classroom-owned teaching speech', () => {
  const scopes: ReturnType<typeof effectScope>[] = []
  beforeEach(() => { AudioFixture.all = []; AudioFixture.pending = null; vi.stubGlobal('Audio', AudioFixture) })
  afterEach(() => { scopes.splice(0).forEach(s => s.stop()); stopBrowserSpeech(); vi.unstubAllGlobals() })
  function setup() {
    const state = reactive({ run: 1, device: 1, step: 0, phase: 'teaching', allowed: true })
    const request = vi.fn(async () => '/synthetic.wav'), authorize = vi.fn(async () => {}), onError = vi.fn()
    const scope = effectScope(); scopes.push(scope); const onSpeaking = vi.fn()
    const speech = scope.run(() => useTeachingSpeech({ identity: () => JSON.stringify([state.run, state.device, state.step, state.phase]),
      allowed: () => state.allowed, authorize, requestAudio: request, onSpeaking, onError }))!
    return { state, request, authorize, onError, onSpeaking, speech, scope }
  }
  it('TEACHING preserves play, local pause/resume and cancel', async () => {
    const { speech } = setup()
    expect(await speech.play('合成教学语音')).toBe(true)
    speech.pause(); expect(AudioFixture.all[0]!.paused).toBe(true)
    expect(await speech.resume()).toBe(true); expect(speech.speaking.value).toBe(true)
    speech.stop(); expect(AudioFixture.all[0]!.paused).toBe(true); expect(await speech.resume()).toBe(false)
  })
  it('authoritative pause actually stops owned audio and prevents local resume', async () => {
    const { speech, state } = setup(); await speech.play('合成文本')
    state.phase = 'paused'; state.allowed = false
    const audio = AudioFixture.all[0]!
    expect(audio.paused).toBe(true); expect(audio.src).toBe('')
    expect(await speech.resume()).toBe(false)
    state.phase = 'teaching'; state.allowed = true
    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(await speech.resume()).toBe(false)
    expect(await speech.play('新实例')).toBe(true)
  })
  it('late TTS cannot start after pause and quick classroom resume', async () => {
    const { speech, state, request } = setup(); const wait = deferred<string>()
    request.mockReturnValueOnce(wait.promise)
    const pending = speech.play('old'); await vi.waitFor(() => expect(request).toHaveBeenCalled())
    state.phase = 'paused'; state.allowed = false; state.phase = 'teaching'; state.allowed = true
    wait.resolve('/late.wav'); await pending
    expect(AudioFixture.all).toHaveLength(0)
  })
  it.each(['run', 'device', 'step'] as const)('%s switch invalidates old events and pending TTS', async field => {
    const { speech, state } = setup(); await speech.play('old')
    const old = AudioFixture.all[0]!
    state[field]++
    await speech.play('new'); old.emit('ended'); old.emit('error')
    expect(speech.speaking.value).toBe(true); expect(AudioFixture.all[1]!.paused).toBe(false)
  })
  it('unmount cancels pending request and cannot play after response', async () => {
    const { speech, scope, request } = setup(); const wait = deferred<string>(); request.mockReturnValueOnce(wait.promise)
    const pending = speech.play('old'); await vi.waitFor(() => expect(request).toHaveBeenCalled())
    scope.stop(); wait.resolve('/late.wav'); await pending
    expect(AudioFixture.all).toHaveLength(0)
  })
  it('late play promise cannot resurrect cancelled audio', async () => {
    const { speech, state } = setup(); const wait = deferred<void>(); AudioFixture.pending = () => wait.promise
    const pending = speech.play('old'); await vi.waitFor(() => expect(AudioFixture.all).toHaveLength(1))
    state.phase = 'paused'; state.allowed = false
    wait.resolve(); await pending
    expect(AudioFixture.all[0]!.paused).toBe(true); expect(speech.speaking.value).toBe(false)
  })
  it('rapid local resume/pause does not let old completion update a new instance', async () => {
    const { speech } = setup(); await speech.play('old'); speech.pause()
    const wait = deferred<void>(); AudioFixture.pending = () => wait.promise
    const pending = speech.resume(); speech.pause(); speech.stop()
    AudioFixture.pending = null; await speech.play('new')
    wait.resolve(); await pending
    expect(speech.speaking.value).toBe(true); expect(AudioFixture.all[1]!.paused).toBe(false)
  })
  it('stopping old teaching owner does not stop unrelated newer audio', async () => {
    const { speech } = setup(); await speech.play('teaching')
    await playExclusiveAudio('/other-page.wav'); speech.stop()
    expect(AudioFixture.all[1]!.paused).toBe(false)
  })
  it('policy missing/expired blocks teaching without touching ASR or resource elements', async () => {
    const { speech, state, authorize } = setup(); state.allowed = false
    expect(await speech.play('blocked')).toBe(false); expect(authorize).not.toHaveBeenCalled()
    expect(AudioFixture.all).toHaveLength(0)
  })
  it('disposing an older owner cannot end the new owner digital-human speaking state', async () => {
    const first = setup(), second = setup()
    await first.speech.play('old'); await second.speech.play('new')
    first.onSpeaking.mockClear(); first.scope.stop()
    expect(first.onSpeaking).not.toHaveBeenCalled()
    expect(second.speech.speaking.value).toBe(true)
    expect(AudioFixture.all[1]!.paused).toBe(false)
  })
  it('superseded pending play rejection cannot report a new owner as failed', async () => {
    const first = setup(), second = setup(), wait = deferred<void>()
    AudioFixture.pending = () => wait.promise
    const old = first.speech.play('old'); await vi.waitFor(() => expect(AudioFixture.all).toHaveLength(1))
    AudioFixture.pending = null; await second.speech.play('new')
    wait.resolve(); await old
    expect(first.onError).not.toHaveBeenCalled()
    expect(second.speech.speaking.value).toBe(true); expect(AudioFixture.all[1]!.paused).toBe(false)
  })
})
