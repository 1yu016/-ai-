import { describe, expect, it } from 'vitest'
import {
  createVadState,
  isRealAsrEnabled,
  vadStep,
  SPEECH_RMS,
  SILENCE_END_MS,
} from '@/services/backendAsrRecognition'

describe('backend ASR VAD core', () => {
  it('only starts a segment after sustained speech', () => {
    const state = createVadState()
    expect(vadStep(state, false, 100)).toBe('none')
    // 前 100ms 不足以开始
    expect(vadStep(state, true, 100)).toBe('none')
    expect(vadStep(state, true, 100)).toBe('start')
    expect(vadStep(state, true, 100)).toBe('inside')
  })

  it('ends a segment after sustained silence', () => {
    const state = createVadState()
    vadStep(state, true, 100)
    vadStep(state, true, 100)
    expect(vadStep(state, true, 100)).toBe('inside')
    for (let i = 0; i < Math.ceil(SILENCE_END_MS / 100) - 1; i++) {
      expect(vadStep(state, false, 100)).toBe('inside')
    }
    expect(vadStep(state, false, 100)).toBe('end')
  })

  it('force-ends an over-long segment to avoid unbounded upload', () => {
    const state = createVadState()
    vadStep(state, true, 100)
    vadStep(state, true, 100)
    let insideCount = 0
    let endSeen = false
    for (let i = 0; i < 400 && !endSeen; i++) {
      const event = vadStep(state, true, 100)
      if (event === 'inside') insideCount += 1
      if (event === 'end') endSeen = true
    }
    expect(endSeen).toBe(true)
    expect(insideCount).toBeGreaterThan(0)
  })

  it('exposes the real-ASR env gate', () => {
    expect(isRealAsrEnabled()).toBe(false)
    expect(SPEECH_RMS).toBeGreaterThan(0)
  })
})