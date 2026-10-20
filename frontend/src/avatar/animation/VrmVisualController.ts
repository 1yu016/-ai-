import { Euler, Quaternion } from 'three'
import type { VRM } from '@pixiv/three-vrm'
import type { AvatarActionName } from '../action/AvatarActionResolver'

/** Render-only normalized humanoid poses, shared by VRM 0.x and 1.0. No classroom commands. */
export class VrmVisualController {
  private action: AvatarActionName = 'idle'
  private elapsed = 0
  private actionTime = 0
  private readonly bones
  constructor(private readonly vrm: VRM) {
    this.bones = (['head', 'chest', 'leftUpperArm', 'rightUpperArm', 'rightLowerArm'] as const).map(name => {
      const node = vrm.humanoid.getNormalizedBoneNode(name)
      return { name, node, rest: node?.quaternion.clone() ?? new Quaternion() }
    })
  }
  play(action: AvatarActionName) {
    if (this.action !== action) this.actionTime = 0
    this.action = action
    return true
  }
  reset() {
    this.action = 'idle'
    this.actionTime = 0
    for (const preset of ['aa', 'blink']) this.vrm.expressionManager?.setValue(preset, 0)
  }
  update(delta: number) {
    const dt = Math.min(Math.max(delta, 0), 0.1)
    this.elapsed += dt
    this.actionTime += dt
    const wave = this.action === 'wave' || this.action === 'goodbye'
    const praise = this.action === 'happy' || this.action === 'encourage'
    const listen = this.action === 'listen'
    for (const bone of this.bones) {
      if (!bone.node) continue
      let x = 0, y = 0, z = 0
      if (bone.name === 'leftUpperArm') z = 1.15
      if (bone.name === 'rightUpperArm') z = wave ? -0.25 : praise ? -0.65 : -1.15
      if (bone.name === 'rightLowerArm' && wave) { x = -1.25; y = Math.sin(this.actionTime * 8) * 0.22 }
      if (bone.name === 'head') { z = listen ? 0.12 : 0; x = praise ? Math.sin(this.actionTime * 5) * 0.06 : 0 }
      if (bone.name === 'chest') x = Math.sin(this.elapsed * 1.7) * 0.012
      const target = bone.rest.clone().multiply(new Quaternion().setFromEuler(new Euler(x, y, z)))
      bone.node.quaternion.slerp(target, 1 - Math.exp(-dt * 9))
    }
    const manager = this.vrm.expressionManager
    // Basic playback-state mouth, not phoneme alignment. Unsupported presets are safe no-ops.
    manager?.setValue('aa', this.action === 'talk' ? 0.15 + 0.5 * Math.pow(Math.sin(this.actionTime * 11), 2) : 0)
    const blinkPhase = this.elapsed % 4.3
    manager?.setValue('blink', blinkPhase < 0.16 ? Math.sin(blinkPhase / 0.16 * Math.PI) : 0)
  }
}
