/**
 * ClassroomIntentRouter：课堂口令 → 结构化意图 的解析入口。
 *
 * 完全借鉴 OHF-Voice/default-agent 的「local intent first」流水线：
 *   ① normalize → ② local exact/phrase match → ③ 无法可靠判断时让渡给 AI。
 * 本地匹配是确定性、毫秒级、零 AI 成本的；只有复杂表达才返回 UNKNOWN 并建议 fallback。
 *
 * 该模块不感知任何 Vue/store/后端实现，是纯逻辑，便于单测覆盖。
 */
import {
  ClassroomIntent,
  type ClassroomIntentMatch,
} from './ClassroomIntent'
import {
  hasCombinationStructure,
  isQuestion,
  matchAllIntentPatterns,
  normalize,
  type IntentPattern,
} from './ClassroomIntentPatterns'

/**
 * 本地匹配优先级。靠前者优先。
 * 注意：RESUME_CLASS 的“继续/接着来”容易与 NEXT_STEP 的“继续下一环节”抢词，
 * 因此这里必须让 NEXT/PREVIOUS 在 RESUME 之前，命中后才轮到。
 */
const LOCAL_MATCH_ORDER: Array<Exclude<ClassroomIntent, 'UNKNOWN'>> = [
  ClassroomIntent.NEXT_STEP,
  ClassroomIntent.PREVIOUS_STEP,
  ClassroomIntent.PAUSE_CLASS,
  ClassroomIntent.RESUME_CLASS,
  ClassroomIntent.RESET_STEP,
]

/** 结构化命令与意图的映射关系（用于 Echo 给 Executor，见 ClassroomCommandExecutor）。 */
const INTENT_COMMAND: Record<
  Exclude<ClassroomIntent, 'UNKNOWN'>,
  NonNullable<ClassroomIntentMatch['command']>
> = {
  NEXT_STEP: 'next',
  PREVIOUS_STEP: 'previous',
  PAUSE_CLASS: 'pause',
  RESUME_CLASS: 'resume',
  RESET_STEP: 'reset',
}

export interface ClassroomCommandMetadata {
  /** 是否允许本地确定性解析命中（默认 true）。测试可传入控制注入。 */
  enableLocal?: boolean
  /** 自定义本地匹配顺序（默认 NEXT→PREVIOUS→PAUSE→RESUME→REPEAT）。 */
  patternOverrides?: Record<ClassroomIntent, IntentPattern[]>
  /** 注入的重写模板表：键为该意图，值为允许的模板。用于单测覆盖自定义语料。 */
  overridePatterns?: Record<Exclude<ClassroomIntent, 'UNKNOWN'>, IntentPattern[]>
}

/**
 * 解析用户口令。
 * 返回的 ClassroomIntentMatch 总是带 intent + command（可能为 null）。
 * 当 local=false（即 intent=UNKNOWN）时，调用方应把 raw 文本交给已有 POST /ai/command 兜底。
 */
export function resolveIntent(
  raw: string,
  metadata: ClassroomCommandMetadata = {},
): ClassroomIntentMatch {
  const normalized = normalize(raw)
  const base: ClassroomIntentMatch = {
    intent: ClassroomIntent.UNKNOWN,
    raw,
    normalized,
    local: false,
    command: null,
  }

  if (!normalized) return base
  // 疑问语气不算执行指令（“下一步我们要做什么？”、ASR 无标点“下一步应该怎么做”等）
  if (isQuestion(normalized)) return base

  const useLocal = metadata.enableLocal ?? true
  if (!useLocal) return base

  const all = matchAllIntentPatterns(normalized, LOCAL_MATCH_ORDER)
  if (all.length === 0) return base

  const distinct = new Set(all.map((m) => m.intent))
  // 多意图命中：
  //  - 若句子含组合/选择结构词（然后/还是/或者…）→ 歧义，不得按顺序随便执行。
  //  - 否则视为同一动作的多重措辞（如“继续下一个环节”命中 RESUME+NEXT，
  //    实为 NEXT）→ 按优先级取首个。
  if (distinct.size >= 2 && hasCombinationStructure(normalized)) return base

  const match = all[0]!

  return {
    intent: match.intent,
    raw,
    normalized,
    local: true,
    command: INTENT_COMMAND[match.intent],
    matchedPattern: match.matchedPattern,
  }
}

/**
 * 已获批准、允许进入新 Executor 的意图白名单。
 * 后端 /ai/command 返回的下划线小写枚举，只有能被安全映射到新课程命令的才在此列；
 * 其余（play_resource/open_resources/volume_up/open_chat/start_activity 等）
 * 属于后续 Device Command 阶段，本阶段一律视为 unsupported，不得自动执行。
 */
const AI_INTENT_ALLOWLIST: Record<string, ClassroomIntent> = {
  /** 后端 next_step/previous_step 是唯一能映射到新 Executor 的权威课程命令 */
  next_step: ClassroomIntent.NEXT_STEP,
  previous_step: ClassroomIntent.PREVIOUS_STEP,
}

/** 结论化：AI 返回的 intent 是否被允许转交 Executor。 */
export type AiIntentVerdict =
  | { allowed: true; match: ClassroomIntentMatch }
  | { allowed: false; unsupported: boolean }

/**
 * 把后端 /ai/command 的 intent 结果归类：
 *  - 允许 → 返回一份可供 Executor 执行的结构化 match
 *  - 未批准 → allowed:false，绝不转交 Executor
 */
export function classifyAiIntent(aiIntent: string, raw: string): AiIntentVerdict {
  const mapped = AI_INTENT_ALLOWLIST[aiIntent]
  if (!mapped) {
    return { allowed: false, unsupported: true }
  }
  return {
    allowed: true,
    match: {
      intent: mapped,
      raw,
      normalized: normalize(raw),
      local: false,
      command: INTENT_COMMAND[mapped as Exclude<ClassroomIntent, 'UNKNOWN'>],
    },
  }
}