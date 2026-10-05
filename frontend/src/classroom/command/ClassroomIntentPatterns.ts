/**
 * 课堂指令的语句模板（sentence patterns）。
 *
 * 借鉴 OHF-Voice/hassil 的「模板 → 剪枝展开」与句子/意图解耦思想，
 * 用纯 TS 数据表表达「多种说法映射一个 intent」。匹配规则：
 *  - 每个 intent 有一组模板，命中任一即视为该意图候选。
 *  - 模板是子串匹配（可带 * 通配），配合全局否定/疑问守卫避免误判。
 *
 * 关键误判防护：
 *  - 否定守卫：句中被否定词紧邻包裹的指令不得执行（如“不要进入下一步”）。
 *  - 疑问守卫：疑问语气（如“下一步我们要做什么？”）不算执行指令。
 */
import { ClassroomIntent } from './ClassroomIntent'

/**
 * 模板语法：
 *  - 普通文本：按规范化后的子串匹配。
 *  - `*`：代表任意内容片段（可匹配 0 或更多字符）。
 * 例如 '*下一环节*' 可命中“我们进入下一环节吧”。
 */
export type IntentPattern = string

/** 各 intent 允许的语句模板。UNKNOWN 无模板，永远走 fallback。 */
export const INTENT_PATTERNS: Record<Exclude<ClassroomIntent, 'UNKNOWN'>, IntentPattern[]> =
  {
    NEXT_STEP: [
      '*下一步*',
      '*下个环节*',
      '*下一个环节*',
      '*下一环节*',
      '*下一个步骤*',
      '*继续向前*',
    ],
    PREVIOUS_STEP: [
      '*上一步*',
      '*上个环节*',
      '*上一个环节*',
      '*上一环节*',
      '*上一个步骤*',
      '*回去一步*',
    ],
    PAUSE_CLASS: [
      '*暂停*',
      '*停一下*',
      '*先停下*',
      '*停一停*',
      '*歇一下*',
    ],
    RESUME_CLASS: [
      '*继续*',
      '*恢复上课*',
      '*继续上课*',
      '*接着上课*',
      '*继续课堂*',
      '*继续吧*',
      '*接着来*',
      '*继续当前环节*',
    ],
    // RESET_STEP = 重置本环节（本地 Device/UI：停止资源+结束互动），
    // 只接受明确的“重置/重新开始”措辞。绝不含“再来一次/再讲一遍”等“自动重新播放”
    // 语义的模板——当前运行时没有真正的 replay 能力，禁止让用户以为系统会自动重播。
    RESET_STEP: [
      '*重置本环节*',
      '*重新开始本环节*',
      '*本环节从头来*',
      '*重新开始当前环节*',
    ],
  }

/**
 * 否定守卫：这些词若紧邻（前置于）某个候选模板命中位置，则该匹配视为无效，
 * 防止“不要进入下一步”这类句子被解析成 NEXT_STEP。
 * 必须精确、克制，避免把正常句子误判为否定。
 */
export const NEGATION_GUARDS = [
  '不要',
  '先不要',
  '别',
  '先别',
  '不必',
  '不用',
  '暂时别',
  '等下再',
] as const

/**
 * 疑问守卫：句末/句中带明显疑问语气时，视为提问而非执行指令。
 * 例如“下一步我们要做什么？”、“什么时候暂停？” → 都归 UNKNOWN。
 */
export const QUESTION_MARKERS = [
  '吗',
  '呢',
  '什么',
  '为什么',
  '怎么',
  '是哪',
  '哪个',
  '何时',
  '多少',
  '做什么',
  '怎么样',
  '是不是',
  '该不该',
  '要不要',
] as const

/**
 * 组合/选择结构词：句子若同时命中多个不同权威意图，且包含这些词，
 * 说明是「先后动作」或「二选一」而非单一前后缀措辞，应判为歧义，不得直接执行。
 * 例如：
 *  - “先暂停一下然后继续” → PAUSE+RESUME + “然后” → 歧义
 *  - “上一环节还是下一环节” → PREVIOUS+NEXT + “还是” → 歧义
 *  - “继续下一个环节” → RESUME+NEXT，无连接词 → 视为一体措辞 → NEXT
 */
export const COMBINATION_MARKERS = [
  '然后',
  '再',
  '之后',
  '还是',
  '或者',
  '要么',
  '随后',
] as const

/**
 * 恢复课堂的“继续”误判卫士：当“继续”后面紧跟一个进行中的动作宾语时，
 * 它表达的是“继续做某活动”（如“继续讲这个故事”“继续认识数字”），
 * 而不是“恢复课堂”。此时不得触发 RESUME_CLASS。
 * 仅当“继续”直接接“上课/课堂/讲下去”等明确的恢复词时才视为恢复课堂。
 */
export const RESUME_CONTINUATION_TARGETS = [
  '讲',
  '说',
  '做',
  '读',
  '学',
  '认识',
  '看',
  '听',
  '唱',
  '写',
  '画',
  '玩',
  '练',
  '思考',
  '回答',
  '朗读',
  '阅读',
] as const

/**
 * 判断“继续”之后是否紧跟着一个内容动作宾语（→ 应视为继续做活动，而非恢复课堂）。
 * 只取“继续”后紧跟的片段做前缀/就近匹配，避免把整句里别处的动词误算进去。
 */
export function hasResumeContinuationAfter(normalized: string): boolean {
  const idx = normalized.indexOf('继续')
  if (idx === -1) return false
  const tail = normalized.slice(idx + '继续'.length)
  if (!tail) return false
  return RESUME_CONTINUATION_TARGETS.some((target) => {
    // 紧跟在“继续”之后的动作词：完全相等、或以该动作词开头、或紧跟其后。
    return tail.startsWith(target)
  })
}

/** 规范化：trim、去常见标点、全角转半角、统一简体空档。 */
export function normalize(sentence: string): string {
  let text = sentence.trim().toLowerCase()

  // 全角 → 半角（标点与字母数字）
  text = text.replace(/[\uff01-\uff5e]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  )
  // 全角空格/制表直接移除（中文口令无需空格）
  text = text.replace(/[\u3000\t]/g, '')

  // 移除常见标点（保留中文与字母数字）
  text = text.replace(/[，。！？、；：“”‘’（）《》〈〉,.!?;:'"()[\]{}<>#@&%~`^_\-=+/\\|]/g, ' ')

  // 合并空白
  text = text.replace(/\s+/g, ' ')
  return text.trim()
}

/** 判断规范化文本是否带否定词包裹的指令片段。 */
function hasNegationBefore(normalized: string, matchStart: number): boolean {
  for (const guard of NEGATION_GUARDS) {
    const idx = normalized.lastIndexOf(guard, matchStart - 1)
    if (idx === -1) continue
    // 否定词必须紧邻命中片段之前（允许少量语气词间隔），且片段确实在被否定的位置。
    const guardEnd = idx + guard.length
    if (guardEnd <= matchStart && matchStart - guardEnd <= 2) {
      return true
    }
  }
  return false
}

/** 判断规范化文本是否带明确疑问语气。 */
export function isQuestion(normalized: string): boolean {
  if (normalized.endsWith('?')) return true
  return QUESTION_MARKERS.some((marker) => normalized.includes(marker))
}

/**
 * 在文本中寻找模板的实际匹配区间（供否定守卫判定）。
 * `pattern` 中 `*` 通配：先分割首尾，其余仅需为连续子串片段序列。
 */
function findPatternSpan(
  normalized: string,
  pattern: IntentPattern,
): { start: number } | null {
  if (!pattern.includes('*')) {
    const idx = normalized.indexOf(pattern)
    return idx === -1 ? null : { start: idx }
  }

  // 简化实现：把 * 视为任意前后缀，取核心片段命中即可。
  // 例如 '*下一环节*' 核心为 '下一环节'。
  const core = pattern.replace(/\*/g, '').trim()
  if (!core) return null
  const idx = normalized.indexOf(core)
  return idx === -1 ? null : { start: idx }
}

/**
 * 尝试把一个规范化文本解析为若干受保护意图（去重）。
 * 返回所有命中的不同 intent 及其首条命中模板，用于宾语调用方做冲突/歧义判断。
 * 否定守卫全局生效：被否定词紧邻包裹的片段不计入。
 */
export function matchAllIntentPatterns(
  normalized: string,
  preferredOrder: Array<Exclude<ClassroomIntent, 'UNKNOWN'>>,
): Array<{ intent: Exclude<ClassroomIntent, 'UNKNOWN'>; matchedPattern?: string }> {
  const found: {
    intent: Exclude<ClassroomIntent, 'UNKNOWN'>
    matchedPattern?: string
  }[] = []
  for (const intent of preferredOrder) {
    for (const pattern of INTENT_PATTERNS[intent]) {
      const span = findPatternSpan(normalized, pattern)
      if (!span) continue
      if (hasNegationBefore(normalized, span.start)) continue
      // “继续 + 内容动作宾语”（继续讲故事/继续认识数字）≠ 恢复课堂。
      // 仅抑制 RESUME_CLASS 命中，不污染其它意图。
      if (intent === ClassroomIntent.RESUME_CLASS && hasResumeContinuationAfter(normalized)) continue
      found.push({ intent, matchedPattern: pattern })
      break
    }
  }
  return found
}

/**
 * 组合结构词存在性：含任意 COMBINATION_MARKERS 视为存在潜在歧义结构。
 */
export function hasCombinationStructure(normalized: string): boolean {
  return COMBINATION_MARKERS.some((marker) => normalized.includes(marker))
}

/**
 * 旧版：按优先级返回首个命中（单意图场景）。
 * 保留向后兼容，但冲突场景请调用方改用 matchAllIntentPatterns + 自行判定。
 */
export function matchIntentPatterns(
  normalized: string,
  preferredOrder: Array<Exclude<ClassroomIntent, 'UNKNOWN'>>,
): { intent: Exclude<ClassroomIntent, 'UNKNOWN'>; matchedPattern?: string } | null {
  const all = matchAllIntentPatterns(normalized, preferredOrder)
  return all[0] ?? null
}