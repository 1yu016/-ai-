/**
 * 课堂语音指令系统的结构化意图定义。
 *
 * 设计来源：参考 OHF-Voice/intents 的「sentence → intent」数据组织思想，
 * 但用 TypeScript 强类型常量替代 Python/YAML。任何指令在进入处理流水线之前
 * 都必须被解析为一个明确的 ClassroomIntent，禁止携带任意字符串散落在 Vue/store。
 */

/** 受控课堂命令（会作用到后端权威状态） */
export const AUTHORITATIVE_INTENTS = [
  'NEXT_STEP',
  'PREVIOUS_STEP',
  'PAUSE_CLASS',
  'RESUME_CLASS',
] as const

/** 当前设备/UI 命令（仅在本地资源播放器层面处理，不写后端） */
export const DEVICE_INTENTS = ['RESET_STEP'] as const

/** 无法可靠判定的兜底意图，应回落至已有 POST /ai/command */
export const ClassroomIntent = {
  NEXT_STEP: 'NEXT_STEP',
  PREVIOUS_STEP: 'PREVIOUS_STEP',
  PAUSE_CLASS: 'PAUSE_CLASS',
  RESUME_CLASS: 'RESUME_CLASS',
  RESET_STEP: 'RESET_STEP',
  UNKNOWN: 'UNKNOWN',
} as const

export type ClassroomIntent = (typeof ClassroomIntent)[keyof typeof ClassroomIntent]

/** 解析结果。local=true 表示本地确定性匹配成功；local=false 表示应 fallback 到 AI。 */
export interface ClassroomIntentMatch {
  intent: ClassroomIntent
  /** 原始输入 */
  raw: string
  /** 规范化后的输入 */
  normalized: string
  /** 是否为本地非 AI 解析结果 */
  local: boolean
  /** 需要用本地 echo 给 Executor 的执行结果（NEXT_STEP 等结构化命令） */
  command: 'next' | 'previous' | 'pause' | 'resume' | 'reset' | null
  /** 命中的模板文本，便于可观测性 */
  matchedPattern?: string
}