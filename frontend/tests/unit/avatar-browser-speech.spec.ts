import { afterEach, expect, it, vi } from 'vitest'
import { speakBrowserText, stopBrowserSpeech } from '@/services/browserSpeech'

afterEach(() => { stopBrowserSpeech(); vi.unstubAllGlobals() })
it('D2 only actual current utterance start/end drives speaking, not submission or late callbacks', () => {
  const utterances: SpeechSynthesisUtterance[] = []
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} })
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { cancel: vi.fn(), speak: (u: SpeechSynthesisUtterance) => utterances.push(u) } })
  const oldStart = vi.fn(), currentStart = vi.fn(), currentEnd = vi.fn()
  speakBrowserText('old synthetic', { onStart: oldStart })
  speakBrowserText('new synthetic', { onStart: currentStart, onEnd: currentEnd })
  expect(currentStart).not.toHaveBeenCalled()
  utterances[0]!.onstart?.({} as SpeechSynthesisEvent)
  expect(oldStart).not.toHaveBeenCalled()
  utterances[1]!.onstart?.({} as SpeechSynthesisEvent)
  expect(currentStart).toHaveBeenCalledOnce()
  stopBrowserSpeech()
  utterances[1]!.onend?.({} as SpeechSynthesisEvent)
  expect(currentEnd).not.toHaveBeenCalled()
})
