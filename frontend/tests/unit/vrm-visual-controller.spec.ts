import { describe, expect, it } from 'vitest'
import { Object3D } from 'three'
import type { VRM } from '@pixiv/three-vrm'
import { VrmVisualController } from '@/avatar/animation/VrmVisualController'

describe('normalized VRM visual adapter (API fixture, not a VRM 1 asset)', () => {
  it('blends bones, opens mouth only during speech, and resets on cancellation', () => {
    const nodes = new Map<string, Object3D>()
    const weights = new Map<string, number>()
    const vrm = { humanoid: { getNormalizedBoneNode: (name: string) => {
      if (!nodes.has(name)) nodes.set(name, new Object3D())
      return nodes.get(name)
    } }, expressionManager: { setValue: (name: string, value: number) => weights.set(name, value) } } as unknown as VRM
    const visual = new VrmVisualController(vrm)
    visual.play('idle'); visual.update(0.1)
    const arm = nodes.get('rightUpperArm')!.quaternion.clone()
    visual.play('wave'); for (let i = 0; i < 20; i++) visual.update(0.05)
    expect(arm.angleTo(nodes.get('rightUpperArm')!.quaternion)).toBeGreaterThan(0.1)
    visual.play('talk'); visual.update(0.05); expect(weights.get('aa')).toBeGreaterThan(0)
    visual.play('listen'); visual.update(0.05); expect(weights.get('aa')).toBe(0)
    visual.play('encourage'); visual.update(0.05)
    visual.reset(); expect(weights.get('aa')).toBe(0); expect(weights.get('blink')).toBe(0)
    visual.update(0.05); expect(weights.get('aa')).toBe(0)
  })
})
