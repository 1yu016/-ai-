// 数字人状态机：业务事件 → 状态 → (动作, 表情)。
// 纯逻辑模块，不依赖 Vue / Three.js，可独立单测。
// 规则：状态只能由白名单事件驱动，不根据文本关键词或任意指令控制动作。

export const AVATAR_STATES = ['idle', 'listen', 'think', 'talk', 'happy', 'question', 'encourage', 'goodbye'] as const
export type AvatarState = (typeof AVATAR_STATES)[number]

export const AVATAR_EXPRESSIONS = ['neutral', 'happy', 'question', 'thinking', 'goodbye'] as const
export type AvatarExpression = (typeof AVATAR_EXPRESSIONS)[number]

export const AVATAR_AI_EMOTIONS = ['happy', 'question', 'encourage', 'think', 'neutral'] as const
export type AvatarAiEmotion = (typeof AVATAR_AI_EMOTIONS)[number]

// 允许的事件输入（仅枚举值；组件不得传入自定义动作/文本）
export type AvatarStateEvent =
  | { type: 'tts_start' }                       // TTS 播放开始
  | { type: 'tts_end' }                         // TTS 播放结束/中断/失败
  | { type: 'ai_response'; emotion: AvatarAiEmotion }  // AI 回应情绪
  | { type: 'teacher_command'; command: 'listen' }     // 教师指令（点数字人/麦克风）
  | { type: 'step_change' }                     // 课堂步骤变化
  | { type: 'lesson_end' }                      // 课堂结束
  | { type: 'settle' }                          // 回归待机（情绪/思考结束后）

export interface AvatarStateSnapshot {
  state: AvatarState
  /** 渲染层动作名（数字人动作白名单，驱动动画播放） */
  action: string
  expression: AvatarExpression
}

const SNAPSHOT: Record<AvatarState, AvatarStateSnapshot> = {
  idle: { state: 'idle', action: 'idle', expression: 'neutral' },
  listen: { state: 'listen', action: 'listen', expression: 'neutral' },
  think: { state: 'think', action: 'think', expression: 'thinking' },
  talk: { state: 'talk', action: 'talk', expression: 'neutral' },
  happy: { state: 'happy', action: 'happy', expression: 'happy' },
  question: { state: 'question', action: 'question', expression: 'question' },
  encourage: { state: 'encourage', action: 'encourage', expression: 'happy' },
  goodbye: { state: 'goodbye', action: 'goodbye', expression: 'goodbye' },
}

const EMOTION_TO_STATE: Record<AvatarAiEmotion, AvatarState> = {
  happy: 'happy',
  question: 'question',
  encourage: 'encourage',
  think: 'think',
  neutral: 'idle',
}

// 状态转换表（按事件类型静态定义；ai_response / teacher_command 含载荷，走代码规则）
const TRANSITIONS: Record<AvatarState, Partial<Record<Exclude<AvatarStateEvent['type'], 'ai_response' | 'teacher_command'>, AvatarState>>> = {
  idle: { tts_start: 'talk', step_change: 'idle', lesson_end: 'goodbye', tts_end: 'idle', settle: 'idle' },
  listen: { tts_start: 'talk', step_change: 'idle', lesson_end: 'goodbye', tts_end: 'idle' },
  think: { tts_start: 'talk', tts_end: 'idle', step_change: 'idle', lesson_end: 'goodbye' },
  talk: { tts_end: 'idle', step_change: 'idle', lesson_end: 'goodbye' },
  happy: { tts_start: 'talk', tts_end: 'idle', step_change: 'idle', lesson_end: 'goodbye', settle: 'idle' },
  question: { tts_start: 'talk', tts_end: 'idle', step_change: 'idle', lesson_end: 'goodbye', settle: 'idle' },
  encourage: { tts_start: 'talk', tts_end: 'idle', step_change: 'idle', lesson_end: 'goodbye', settle: 'idle' },
  goodbye: { settle: 'idle' },
}

export class AvatarStateMachine {
  private state: AvatarState = 'idle'

  get current(): AvatarState {
    return this.state
  }

  /** 当前快照：状态 + 动作 + 表情（渲染层只读此值）。 */
  snapshot(): AvatarStateSnapshot {
    return SNAPSHOT[this.state]
  }

  /** 处理事件，返回转移后的快照；事件不影响当前状态时返回当前快照。 */
  transition(event: AvatarStateEvent): AvatarStateSnapshot {
    const next = this.nextState(event)
    if (next) this.state = next
    return this.snapshot()
  }

  /** 回归待机（组件卸载/课堂重置时使用）。 */
  reset(): void {
    this.state = 'idle'
  }

  private nextState(event: AvatarStateEvent): AvatarState | null {
    // 课堂结束（goodbye）为终态，仅 settle 可回归待机。
    if (this.state === 'goodbye') return event.type === 'settle' ? 'idle' : null
    // 全局事件规则
    if (event.type === 'ai_response') {
      // 说话中收到情绪不打断，保持 talk；其余状态按情绪映射。
      if (this.state === 'talk') return null
      return EMOTION_TO_STATE[event.emotion]
    }
    if (event.type === 'teacher_command') {
      return event.command === 'listen' ? 'listen' : null
    }
    return TRANSITIONS[this.state][event.type] ?? null
  }
}
