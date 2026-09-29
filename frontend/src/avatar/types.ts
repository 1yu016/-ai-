// 数字人运行态类型定义。
// 约定：vrm 为后续阶段预留，当前后端 model_format 枚举仅 glb/gltf。
export type AvatarModelFormat = 'glb' | 'gltf' | 'vrm'

export interface AvatarVoiceConfig {
  provider: string
  voiceId: string
  language: string
  speed: number
  volume: number
  pitch: number
}

export interface AvatarPersonalityConfig {
  style: string
  catchphrases: string[]
  greeting: string
  encouragementStyle: string
  goodbyeText: string
}

// 当前课堂应使用的数字人配置（来自 GET /avatars/resolve）
export interface AvatarRuntimeConfig {
  characterId: number | null
  characterName: string
  modelUrl: string | null
  modelFormat: AvatarModelFormat | null
  engineVersion: string | null
  versionId: number | null
  sourceScope: string | null
  voice: AvatarVoiceConfig | null
  personality: AvatarPersonalityConfig | null
  fallbackLevel: string | null
  reason: string | null
}