// 动作解析：将「状态机输出的动作名」解析为模型内可播放的动画资源。
// - GLB/GLTF：解析模型内部 animation clip（按 clip 名称关键词匹配，大小写不敏感）。
// - VRMA：下一阶段扩展，当前不解析。
// 纯逻辑模块，不依赖 Vue/渲染，可独立单测。

import type { AnimationClip } from 'three'

// 数字人动作名（与 digitalHuman store 动作白名单一致）
export const AVATAR_ACTION_NAMES = ['idle', 'listen', 'think', 'talk', 'question', 'happy', 'encourage', 'wave', 'goodbye'] as const
export type AvatarActionName = (typeof AVATAR_ACTION_NAMES)[number]

// 动作 → clip 名称关键词（按出现顺序匹配；GLB 建模习惯命名，如 Idle_Stand / Talk_Wave）
export const AVATAR_ACTION_KEYWORDS: Record<AvatarActionName, readonly string[]> = {
  idle: ['Idle', 'idle', 'Stand'],
  listen: ['Listening', 'Listen'],
  think: ['Think', 'Thinking'],
  talk: ['Talk', 'Talking'],
  happy: ['Happy', 'Celebrate', 'Dance'],
  question: ['Question', 'Look'],
  encourage: ['Encourage', 'Wave', 'Cheer', 'Dance'],
  wave: ['Wave', 'Waving', 'Hi'],
  goodbye: ['Goodbye', 'Wave', 'Sad', 'Dance'],
}

export interface AvatarActionResolverOptions {
  /** 无匹配时是否回退到首个片段（默认 true，保证动画不中断） */
  fallbackToFirst?: boolean
}

export class AvatarActionResolver {
  private readonly clips: ReadonlyArray<AnimationClip>
  private readonly fallbackToFirst: boolean

  constructor(clips: ReadonlyArray<AnimationClip>, options?: AvatarActionResolverOptions) {
    this.clips = clips
    this.fallbackToFirst = options?.fallbackToFirst ?? true
  }

  /** 动作名 → 可播放的动画片段；模型无动画或无匹配时返回 null。 */
  resolve(action: AvatarActionName): AnimationClip | null {
    if (!this.clips.length) return null
    const hints = AVATAR_ACTION_KEYWORDS[action]
    for (const hint of hints) {
      const hit = this.clips.find((clip) => clip.name.toLowerCase().includes(hint.toLowerCase()))
      if (hit) return hit
    }
    return this.fallbackToFirst ? (this.clips[0] ?? null) : null
  }
}
