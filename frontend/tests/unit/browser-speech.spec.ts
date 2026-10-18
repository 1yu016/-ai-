import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  pauseBrowserSpeech,
  playExclusiveAudio,
  resumeBrowserSpeech,
  speakBrowserText,
  stopBrowserSpeech,
} from '@/services/browserSpeech'

class FakeAudio {
  static instances: FakeAudio[] = []
  src: string
  paused = false
  play = vi.fn(async () => { this.paused = false })
  pause = vi.fn(() => { this.paused = true })
  load = vi.fn()
  removeAttribute = vi.fn()
  listeners: Record<string, Array<() => void>> = {}
  constructor(source: string) { this.src = source; FakeAudio.instances.push(this) }
  addEventListener(type: string, callback: () => void) { (this.listeners[type] ??= []).push(callback) }
  emit(type: string) { this.listeners[type]?.forEach((callback) => callback()) }
}

describe('browser speech playback', () => {
  beforeEach(() => {
    FakeAudio.instances = []
    vi.stubGlobal('Audio', FakeAudio)
    vi.stubGlobal('SpeechSynthesisUtterance', class {
      text: string
      lang = ''
      rate = 1
      volume = 1
      pitch = 1
      onend: ((event: SpeechSynthesisEvent) => void) | null = null
      onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null
      constructor(text: string) { this.text = text }
    })
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { cancel: vi.fn(), speak: vi.fn() },
    })
  })

  afterEach(() => {
    stopBrowserSpeech()
    vi.unstubAllGlobals()
  })

  it('stops the previous voice before starting a new one', async () => {
    await playExclusiveAudio('/one.mp3')
    const first = FakeAudio.instances[0]!
    await playExclusiveAudio('/two.mp3')
    expect(first.pause).toHaveBeenCalled()
    expect(first.removeAttribute).toHaveBeenCalledWith('src')
    expect(FakeAudio.instances[1]!.play).toHaveBeenCalledTimes(1)
  })

  it('supports pause, resume and cancel', async () => {
    await playExclusiveAudio('/voice.mp3')
    const audio = FakeAudio.instances[0]!
    expect(pauseBrowserSpeech()).toBe(true)
    expect(audio.pause).toHaveBeenCalled()
    expect(await resumeBrowserSpeech()).toBe(true)
    expect(audio.play).toHaveBeenCalledTimes(2)
    stopBrowserSpeech()
    expect(await resumeBrowserSpeech()).toBe(false)
  })

  it('falls back to the browser default voice after configured speech fails', () => {
    const fallback = vi.fn()
    expect(speakBrowserText('你好', { lang: 'zh-CN', rate: 1.2, onFallback: fallback })).toBe(true)
    const speak = vi.mocked(window.speechSynthesis.speak)
    const configured = speak.mock.calls[0]![0]
    configured.onerror?.({ error: 'voice-unavailable', utterance: configured } as SpeechSynthesisErrorEvent)
    expect(fallback).toHaveBeenCalledTimes(1)
    expect(speak).toHaveBeenCalledTimes(2)
  })
})

