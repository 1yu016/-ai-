/**
 * ResourceCommandCoordinator（Stage 6.5）—— 资源命令的确认流程与执行决策，纯逻辑。
 *
 * 三个职责，全部只读/纯函数，便于单测：
 *  - evaluateResourceCommand：安全句守卫。疑问/否定表达绝不当作打开/播放执行；
 *    明确的搜索类提问（有什么/有没有/哪些/给我看看）强制按 search_resource 处理。
 *  - buildResourceResult：把 POST /ai/command 的响应归一化为 ResourceCommandResult。
 *    资源命令的确认是硬约束：即使后端 requiresConfirmation=false / matchStatus=matched，
 *    也一律产生“待确认结果”，绝不自动执行。
 *  - resolveExecuteAction：教师确认后决定“打开 or 播放”：
 *    · play_resource + 可播放媒体（audio/video）→ openResource(resource, true)
 *    · play_resource + image/pdf/ppt 等 → 降级为“打开”并明确告知，禁止假装播放
 *    · search_resource / open_resource → openResource(resource, false)
 *
 * 本模块不感知 Vue/store；openResource 的最终调用由课堂页在教师确认后发起。
 */
import {
  NEGATION_GUARDS,
  isQuestion,
  normalize,
} from './ClassroomIntentPatterns'
import {
  isPlayableResource,
  isResourceIntent,
  type ResourceCandidate,
  type ResourceCommandResult,
  type ResourceIntent,
  type ResourceMatchStatus,
} from './ResourceCommand'
import {
  normalizeServerResource,
  type CourseResource,
  type ServerResource,
} from '@/stores/courseResource'

/** 资源命令被安全句（疑问/否定）拦截时的统一反馈，不含任何技术词。 */
export const RESOURCE_SAFETY_DECLINE_HINT =
  '这是一句疑问或否定表达，未执行任何资源操作。'

/** not_found 时的固定反馈（§七：不得自动打开资源库、不得播放其它无关资源）。 */
export const RESOURCE_NOT_FOUND_HINT = '没有找到合适的资源，未执行。'

/** 明确属于“搜索类提问”的表达词：命中后即使模型判为打开/播放，也强制按搜索处理。 */
export const SEARCH_QUERY_MARKERS = [
  '有什么',
  '有没有',
  '哪些',
  '给我看看',
  '找一个',
] as const

/** 安全句判定结果：allowed=true 时返回最终生效的 intent（可能被强制为 search）。 */
export type ResourceSafetyVerdict =
  | { allowed: true; intent: ResourceIntent }
  | { allowed: false; message: string }

/**
 * 对“AI 已判为资源意图”的文本做最终安全把关：
 *  - 否定表达（不要/别/不必/不用…）→ 拒绝；
 *  - 搜索类提问 → 强制 search_resource（只搜索展示，绝不自动播放/打开）；
 *  - 其余疑问句（为什么打不开 / 播放什么比较好…）→ 拒绝；
 *  - 明确祈使句 → 放行。
 */
export function evaluateResourceCommand(
  aiIntent: string,
  rawText: string,
): ResourceSafetyVerdict {
  const normalized = normalize(rawText)
  if (!normalized) {
    return { allowed: false, message: RESOURCE_SAFETY_DECLINE_HINT }
  }
  if (NEGATION_GUARDS.some((guard) => normalized.includes(guard))) {
    return { allowed: false, message: RESOURCE_SAFETY_DECLINE_HINT }
  }
  if (
    SEARCH_QUERY_MARKERS.some((marker) => normalized.includes(marker))
  ) {
    return { allowed: true, intent: 'search_resource' }
  }
  if (isQuestion(normalized)) {
    return { allowed: false, message: RESOURCE_SAFETY_DECLINE_HINT }
  }
  // 显式“打开/播放”动词比模型分类更可靠。即使模型把“打开视频”
  // 误判成 play_resource，也必须保持教师原始指令的执行语义。
  if (/^(?:请|帮我|麻烦你?)?\s*(?:打开|open)(?:\s|$|[^a-z])/.test(normalized)) {
    return { allowed: true, intent: 'open_resource' }
  }
  if (/^(?:请|帮我|麻烦你?)?\s*(?:播放|播一下|放一下|play)(?:\s|$|[^a-z])/.test(normalized)) {
    return { allowed: true, intent: 'play_resource' }
  }
  if (isResourceIntent(aiIntent)) {
    return { allowed: true, intent: aiIntent }
  }
  return { allowed: false, message: RESOURCE_SAFETY_DECLINE_HINT }
}

/** 后端 /ai/command 资源响应（松散类型，防御后端字段缺失/变形）。 */
export type AiResourcePayload = {
  intent?: unknown
  keyword?: unknown
  reply?: unknown
  matchStatus?: unknown
  resource?: unknown
  candidates?: unknown
  requiresConfirmation?: unknown
}

function isResourceCandidateArray(value: unknown): value is ServerResource[] {
  return Array.isArray(value)
}

/**
 * 把后端返回的 resource / candidates 归一化为前端 CourseResource 候选数组。
 * 匹配失败或字段缺失的资源会被过滤，绝不把脏数据放进候选列表。
 */
export function normalizeCandidates(
  resource?: unknown,
  candidates?: unknown,
): ResourceCandidate[] {
  const list = isResourceCandidateArray(candidates)
    ? candidates
    : resource
      ? [resource]
      : []
  return list
    .map((item) => normalizeServerResource(item as ServerResource))
    .filter((item): item is CourseResource => !!item)
}

/**
 * 归一化 /ai/command 响应 → ResourceCommandResult。
 * 资源命令一律“待确认”，requiresConfirmation 被忽略（§五 硬约束）。
 */
export function buildResourceResult(
  data: AiResourcePayload,
  intent: ResourceIntent,
): ResourceCommandResult | null {
  const reply =
    typeof data.reply === 'string' && data.reply.trim()
      ? data.reply.trim()
      : ''
  if (!reply) return null
  const candidates = normalizeCandidates(data.resource, data.candidates)
  const rawStatus =
    typeof data.matchStatus === 'string' ? data.matchStatus : ''
  let matchStatus: ResourceMatchStatus
  if (rawStatus === 'not_found' || candidates.length === 0) {
    matchStatus = 'not_found'
  } else if (rawStatus === 'low_confidence') {
    matchStatus = 'low_confidence'
  } else if (rawStatus === 'multiple' || candidates.length > 1) {
    matchStatus = 'multiple'
  } else {
    matchStatus = 'matched'
  }
  return {
    intent,
    keyword:
      typeof data.keyword === 'string' && data.keyword.trim()
        ? data.keyword.trim()
        : undefined,
    // not_found 使用固定反馈（§七），不携带后端关键字话术，避免误导教师重试。
    reply: matchStatus === 'not_found' ? RESOURCE_NOT_FOUND_HINT : reply,
    matchStatus,
    candidates,
  }
}

/** 教师确认后的执行动作。 */
export type ResourceExecuteAction =
  | { action: 'open'; autoPlay: false; note?: string }
  | { action: 'play'; autoPlay: true; note?: string }

/** 该资源“不可播放”时的明确降级说明（§十，禁止静默改变语义）。 */
export const UNPLAYABLE_NOTE = '该资源不可播放，将以打开方式展示。'

/**
 * 根据最初意图与选定资源决定最终执行动作（open vs play）。
 *  - search / open → 打开（不自动播放）；
 *  - play + 可播放媒体 → 播放（autoplay）；
 *  - play + image/pdf/ppt 等 → 降级为打开，并明确告知教师。
 */
export function resolveExecuteAction(
  intent: ResourceIntent,
  resource: ResourceCandidate,
): ResourceExecuteAction {
  if (intent !== 'play_resource') {
    return { action: 'open', autoPlay: false }
  }
  if (isPlayableResource(resource)) {
    return { action: 'play', autoPlay: true }
  }
  return { action: 'open', autoPlay: false, note: UNPLAYABLE_NOTE }
}

/** 资源被不可播放降级时，是否需要在执行前明确告知。 */
export function hasDegradedPlay(
  action: ResourceExecuteAction,
): action is { action: 'open'; autoPlay: false; note: string } {
  return action.action === 'open' && Boolean(action.note)
}
