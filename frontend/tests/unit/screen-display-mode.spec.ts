import { describe, expect, it } from 'vitest'
import { resolveScreenDisplayMode } from '@/presentation/screenDisplayMode'

describe('screen visual projection', () => {
  it('defaults to the speaker without playback side effects', () => {
    expect(resolveScreenDisplayMode({ resourceVisible: false, interactionVisible: false })).toBe('speaker')
  })
  it('highlights an interaction and reserves resources as the primary content', () => {
    expect(resolveScreenDisplayMode({ resourceVisible: false, interactionVisible: true })).toBe('interaction')
    expect(resolveScreenDisplayMode({ resourceVisible: true, interactionVisible: true, override: 'speaker' })).toBe('resource')
  })
  it('accepts a presentation-only adapter', () => {
    expect(resolveScreenDisplayMode({ resourceVisible: false, interactionVisible: false, override: 'interaction' })).toBe('interaction')
  })
})
