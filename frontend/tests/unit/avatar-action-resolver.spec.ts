import { describe, expect, it } from 'vitest'
import type { AnimationClip } from 'three'
import { AvatarActionResolver } from '@/avatar/action/AvatarActionResolver'

// 仅用 clip 名称构造最小对象（resolve 只读取 name）
function clip(name: string): AnimationClip {
  return { name, duration: 1, tracks: [] } as unknown as AnimationClip
}

describe('avatar action resolver', () => {
  const clips = [clip('Idle_Stand'), clip('Talk_Wave'), clip('Happy_Dance'), clip('Question_Look')]

  it('resolves each action to a matching clip by keyword, case-insensitively', () => {
    const resolver = new AvatarActionResolver(clips)
    expect(resolver.resolve('idle')?.name).toBe('Idle_Stand')
    expect(resolver.resolve('talk')?.name).toBe('Talk_Wave')
    expect(resolver.resolve('happy')?.name).toBe('Happy_Dance')
    expect(resolver.resolve('question')?.name).toBe('Question_Look')
  })

  it('falls back to compatible keywords when no exact hint exists', () => {
    const resolver = new AvatarActionResolver(clips)
    // encourage/goodbye/wave 都命中 Talk_Wave 中的 Wave
    expect(resolver.resolve('encourage')?.name).toBe('Talk_Wave')
    expect(resolver.resolve('goodbye')?.name).toBe('Talk_Wave')
    expect(resolver.resolve('wave')?.name).toBe('Talk_Wave')
  })

  it('returns null when the model has no animation clips', () => {
    const resolver = new AvatarActionResolver([])
    expect(resolver.resolve('idle')).toBeNull()
    expect(resolver.resolve('talk')).toBeNull()
  })

  it('returns null instead of first clip when fallbackToFirst is disabled and nothing matches', () => {
    const resolver = new AvatarActionResolver([clip('Custom_Pose')], { fallbackToFirst: false })
    expect(resolver.resolve('happy')).toBeNull()
  })

  it('falls back to the first clip when fallbackToFirst is enabled and nothing matches', () => {
    const resolver = new AvatarActionResolver([clip('Custom_Pose')])
    expect(resolver.resolve('think')?.name).toBe('Custom_Pose')
  })
})
