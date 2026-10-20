import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanTextForTts,
  playBackendTts,
  synthesizeTtsUrl,
} from '@/services/backendTts'
import { stopBrowserSpeech } from '@/services/browserSpeech'

class FakeAudio {
  static instances: FakeAudio[] = []
  src = ''
  play = vi.fn(async () => {})
  pause = vi.fn()
  load = vi.fn()
  removeAttribute = vi.fn()
  listeners: Record<string, Array<() => void>> = {}
  constructor(source: string) { this.src = source; FakeAudio.instances.push(this) }
  addEventListener(type: string, callback: () => void) { (this.listeners[type] ??= []).push(callback) }
  emit(type: string) { this.listeners[type]?.forEach((callback) => callback()) }
}

describe('backend TTS provider', () => {
  beforeEach(() => {
    FakeAudio.instances = []
    vi.stubGlobal('Audio', FakeAudio)
  })
  afterEach(() => { vi.unstubAllGlobals(); stopBrowserSpeech() })

  it('normalizes whitespace before synthesis, preserving punctuation', () => {
    expect(cleanTextForTts(' 第一句。\n第二 句 ')).toBe('第一句。 第二 句')
  })

  it('plays injected backend audio and drives onStart/onEnded from controlled audio events', async () => {
    const post = vi.fn(async () => ({ audioUrl: 'data:audio/mpeg;base64,AAAA' }))
    const onStart = vi.fn(), onEnded = vi.fn()
    const result = await playBackendTts({ text: '今天天气怎么样？', post, onStart, onEnded })
    expect(result).toBe('started')
    expect(post).toHaveBeenCalledWith('今天天气怎么样？')
    expect(onStart).not.toHaveBeenCalled()
    FakeAudio.instances[0]!.emit('playing')
    expect(onStart).toHaveBeenCalledOnce()
    expect(onEnded).not.toHaveBeenCalled()
    FakeAudio.instances[0]!.emit('ended')
    expect(onEnded).toHaveBeenCalledOnce()
  })

  it('returns failed and fires onError when backend synthesis fails', async () => {
    const onError = vi.fn()
    const result = await playBackendTts({ text: '你好', post: async () => { throw new Error('boom') }, onError })
    expect(result).toBe('failed')
    expect(onError).toHaveBeenCalledOnce()
  })

  it('returns cancelled and fires onCancel when no longer current after synthesis', async () => {
    const onCancel = vi.fn(), onError = vi.fn()
    const result = await playBackendTts({ text: '你好', post: async () => ({ audioUrl: 'data:audio/mpeg;base64,AAAA' }), isCurrent: () => false, onCancel, onError })
    expect(result).toBe('cancelled')
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onError).not.toHaveBeenCalled()
  })

  it('rejects malformed audio responses so they never reach the player', async () => {
    await expect(synthesizeTtsUrl('你好', async () => ({ audioUrl: 'not-an-audio' }))).rejects.toThrow()
    await expect(synthesizeTtsUrl('你好', async () => ({} as never))).rejects.toThrow()
  })
})
