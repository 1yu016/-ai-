// 数字人运行态类型定义。
// 约定：vrm 为后续阶段预留，当前后端 model_format 枚举仅 glb/gltf。
export type AvatarModelFormat = 'glb' | 'gltf' | 'vrm'

// One resolved, server-owned identity; a scene/provider must not mutate it.
export interface AvatarIdentity {
  classId: number | null
  runId: number | null
  deviceId: number | null
  characterId: number | null
  versionId: number | null
}

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

// 模型配置：对应后端 resolve 返回的 version + renderAsset。
export interface AvatarModelConfig {
  versionId: number | null
  engineVersion: string | null
  modelFormat: AvatarModelFormat | null
  modelUrl: string | null
}

// 当前课堂应使用的数字人配置（来自 GET /avatars/resolve），
// 字段对应后端返回：character / version / renderAsset / voice / personality / fallbackLevel。
export interface AvatarRuntimeConfig {
  character: { id: number | null; name: string; category?: string | null } | null
  model: AvatarModelConfig
  voice: AvatarVoiceConfig | null
  personality: AvatarPersonalityConfig | null
  fallbackLevel: string | null
  reason: string | null
  sourceScope: string | null
}
