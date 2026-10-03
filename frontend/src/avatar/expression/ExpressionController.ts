// 表情解析：将「动作/状态」映射为表情表达式。
// - 渲染层只调 model.setExpression(expressionName, value)，不做业务判断。
// - VRM 的 ExpressionManager 预设名与 GLB morph target 命名在本层统一以关键词描述，
//   具体由 AvatarLoader 按模型类型解析执行。

import type { AvatarActionName } from '../action/AvatarActionResolver'

export type AvatarExpressionName = 'neutral' | 'happy' | 'question' | 'encourage' | 'goodbye' | 'talk' | 'thinking' | 'blink'

// 动作 → 表情（状态机输出的动作白名单 → 表情名）
export const ACTION_EXPRESSION_MAP: Record<AvatarActionName, AvatarExpressionName> = {
  idle: 'neutral',
  listen: 'neutral',
  thinking: 'neutral',
  talk: 'talk',
  happy: 'happy',
  question: 'question',
  encourage: 'happy',
  praise: 'happy',
  wave: 'neutral',
  goodbye: 'goodbye',
}

// 表情 → 施加的 morph target / ExpressionManager 预设（关键词，大小写不敏感子串匹配）
// question = surprised（惊讶）+ brow（挑眉）；goodbye = sad/smile。
// thinking 无专用 morph：空目标 = 安全 no-op（不改变当前表情，不报错）。
export const EXPRESSION_TARGETS: Record<AvatarExpressionName, readonly string[]> = {
  neutral: [],
  happy: ['happy', 'smile'],
  question: ['surprised', 'brow'],
  encourage: ['happy', 'smile'],
  goodbye: ['sad', 'smile'],
  talk: ['mouthOpen', 'viseme', 'aa', 'oh', 'ih'],
  thinking: [],
  blink: ['blink', 'eyeBlink'],
}

export const ExpressionController = {
  fromAction(action: AvatarActionName): AvatarExpressionName {
    return ACTION_EXPRESSION_MAP[action]
  },
  targets(name: AvatarExpressionName): readonly string[] {
    return EXPRESSION_TARGETS[name] ?? []
  },
}