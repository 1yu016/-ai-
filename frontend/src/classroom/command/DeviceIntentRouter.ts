/**
 * DeviceIntentRouter：device 口令 → 结构化媒体意图 的解析入口（Stage 6.4）。
 *
 * 设计：与 ClassroomIntentRouter 对称，但只负责「明确媒体语义」。
 *  - resolveDeviceIntent(raw)：raw → DeviceIntentMatch | null
 *    · 疑问句（“视频为什么暂停了”“声音为什么这么小”“下一步播放什么”）→ null
 *    · 否定句（“不要暂停视频”）→ null
 *    · 不含明确媒体对象/动作（“暂停”“暂停一下”“继续”“继续上课”）→ null
 *  - classifyAiDeviceIntent(aiIntent)：把后端 /ai/command 返回的下划线 intent
 *    归类为 DeviceIntent（放行 pause_media 等 6 个），供 AI fallback 路由。
 *
 * 本模块不感知 Vue/store，纯逻辑，便于单测。
 */
import { NEGATION_GUARDS, isQuestion, normalize } from './ClassroomIntentPatterns'
import { detectDeviceIntent } from './DeviceIntentPatterns'
import { DeviceIntent, type DeviceIntentMatch } from './DeviceIntent'

/** 每个受支持 DeviceIntent 的代表性模板（可观测性）。 */
const DEVICE_PATTERN_LABEL: Record<DeviceIntent, string> = {
  PAUSE_MEDIA: '暂停 + 媒体对象/动作',
  RESUME_MEDIA: '恢复/继续 + 媒体对象/动作',
  STOP_MEDIA: '停止 + 媒体对象/动作',
  CLOSE_RESOURCE: '关闭资源/播放器/媒体',
  VOLUME_UP: '声音/媒体 + 调大',
  VOLUME_DOWN: '声音/媒体 + 调小',
}

/**
 * 本地确定性解析。null 表示无明确媒体语义（应交给 Classroom 或 AI fallback）。
 * 缺省只接通“暂停/暂停一下”等裸口令→（不命中）→ 保持 PAUSE_CLASS 语义不变。
 */
export function resolveDeviceIntent(raw: string): DeviceIntentMatch | null {
  const normalized = normalize(raw)
  if (!normalized) return null
  // 疑问守卫：“为什么/怎么/做什么/何时…” 一律不是执行指令。
  if (isQuestion(normalized)) return null
  // 否定守卫：含“不要/别/先别/不必/不用…” 不执行媒体命令，交给上层统一兜底。
  if (NEGATION_GUARDS.some((guard) => normalized.includes(guard))) return null

  const intent = detectDeviceIntent(normalized)
  if (!intent) return null
  return {
    intent,
    raw,
    normalized,
    matchedPattern: DEVICE_PATTERN_LABEL[intent],
  }
}

/** 后端 /ai/command 放行的 6 个媒体 intent（下划线小写）→ DeviceIntent。 */
export const DEVICE_AI_INTENT_NAMES: Record<string, DeviceIntent> = {
  pause_media: DeviceIntent.PAUSE_MEDIA,
  resume_media: DeviceIntent.RESUME_MEDIA,
  stop_media: DeviceIntent.STOP_MEDIA,
  close_resource: DeviceIntent.CLOSE_RESOURCE,
  volume_up: DeviceIntent.VOLUME_UP,
  volume_down: DeviceIntent.VOLUME_DOWN,
}

export type AiDeviceIntentVerdict =
  | { allowed: true; match: DeviceIntentMatch }
  | { allowed: false }

/**
 * 归类 AI 返回的 intent。仅 6 个媒体意图放行进 DeviceCommandExecutor；
 * 其余（search/open/play_resource/open_resources 等）一律 allowed:false，
 * 由 fallback 判定为 unsupported，绝不自动执行。
 */
export function classifyAiDeviceIntent(
  aiIntent: string,
): AiDeviceIntentVerdict {
  const mapped = DEVICE_AI_INTENT_NAMES[aiIntent]
  if (!mapped) return { allowed: false }
  return {
    allowed: true,
    match: {
      intent: mapped,
      raw: '',
      normalized: '',
      matchedPattern: DEVICE_PATTERN_LABEL[mapped],
    },
  }
}