/**
 * Resource Command（Stage 6.5）—— 资源命令的领域类型与判定，纯逻辑，不感知 Vue/store。
 *
 * 职责边界：
 *  - 只定义「搜索 / 打开 / 播放」三个资源意图的类型；
 *  - 归一化后端 /ai/command 对资源命令的 matchStatus；
 *  - 可播放性判定（PLAY 只允许 audio / video）。
 *
 * 资源命令与 DeviceIntent（pause/resume/stop/close/volume）不是同一层次，
 * 因此这里不挂在 DeviceIntentRouter / DeviceCommandExecutor 下；
 * 由 ResourceCommandCoordinator 负责“结果构建 / 确认流程 / 降级播放”决策。
 */
import type { CourseResource } from '@/stores/courseResource'

/** 资源类意图（与后端 ClassroomCommandIntent 的 search/open/play_resource 对应）。 */
export const RESOURCE_INTENTS = [
  'search_resource',
  'open_resource',
  'play_resource',
] as const

export type ResourceIntent = (typeof RESOURCE_INTENTS)[number]

/** 判断后端 /ai/command 返回的 intent 是否属于资源命令。 */
export function isResourceIntent(value: string): value is ResourceIntent {
  return (RESOURCE_INTENTS as readonly string[]).includes(value)
}

/** 后端 /ai/command 对资源命令实际返回的 matchStatus（见 ai.controller.ts CommandResponseDto）。 */
export type ResourceMatchStatus =
  | 'matched'
  | 'multiple'
  | 'low_confidence'
  | 'not_found'

/** 真正可播放的媒体类型：只有这些允许 PLAY_RESOURCE 的 autoplay。 */
export const PLAYABLE_MEDIA_TYPES = ['audio', 'video'] as const

export type PlayableMediaType = (typeof PLAYABLE_MEDIA_TYPES)[number]

/** 资源是否真正可播放（image / document / presentation 等不算可播放媒体）。 */
export function isPlayableResource(resource: CourseResource): boolean {
  return (PLAYABLE_MEDIA_TYPES as readonly string[]).includes(
    resource.mediaType,
  )
}

/** 候选资源（前端统一形态）。 */
export type ResourceCandidate = CourseResource

/**
 * 一次资源命令的结构化结果（教师确认前只读，绝不自动执行）。
 * 无论后端是否 requiresConfirmation=false，资源命令都必须先进入确认流程。
 */
export interface ResourceCommandResult {
  intent: ResourceIntent
  /** 提取的资源关键词（有则显示）。 */
  keyword?: string
  /** 后端返回给教师的话术（“找到了以下资源，请选择：”等）。 */
  reply: string
  matchStatus: ResourceMatchStatus
  /** 候选列表：matched 单条 / multiple / low_confidence 统一归一化为数组；not_found 为空。 */
  candidates: ResourceCandidate[]
}
