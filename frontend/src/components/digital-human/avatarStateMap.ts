// 数字人状态映射层（纯函数，无 Vue 依赖，可独立单测）。
// 职责：现有 digitalHuman store.action → 本项目 DigitalHumanState → Agent Robot Avatar action。
// 约定：业务层只感知 DigitalHumanState；第三方动作名（success/waiting/inspect/send 等）一律封在此层与 Adapter 内。
import type { DigitalHumanAction } from '@/stores/digitalHuman'
import type { DigitalHumanState } from './avatar.types'

/**
 * store.action → DigitalHumanState
 * 与现有 AvatarStateMachine 的动作白名单一一对应：
 *   idle → idle（待机）
 *   listen → listening（倾听）
 *   thinking → thinking（思考）
 *   talk → speaking（讲述/TTS）
 *   happy → happy
 *   question → surprised（提问互动：数字人摆出好奇/疑问姿态）
 *   encourage → encouraging
 *   praise → celebrating
 *   wave → greeting（挥手问候 = 进入课堂/开场欢迎）
 *   goodbye → idle（告别后回归待机，不再维持任何一次性动画）
 */
export const ACTION_TO_STATE: Record<DigitalHumanAction, DigitalHumanState> = {
  idle: 'idle',
  listen: 'listening',
  thinking: 'thinking',
  think: 'thinking',
  talk: 'speaking',
  happy: 'happy',
  question: 'surprised',
  encourage: 'encouraging',
  praise: 'celebrating',
  wave: 'greeting',
  goodbye: 'idle',
}

/**
 * DigitalHumanState → Agent Robot Avatar action（一次性动画 / 状态名）。
 * 注意：
 * - listening 是「持续态」，不走 play()，而走 startWaiting()（见 GrokBotAvatar Adapter）。
 * - greeting/encouraging/celebrating 在第三方没有一一对应的动作，统一用 success 近似；
 *   近似细节只允许存在 Adapter/映射层，业务层不感知。
 * - error → error（第三方有系统错误表情）。
 */
export const STATE_TO_AVATAR_ACTION: Record<DigitalHumanState, string> = {
  idle: 'idle',
  greeting: 'success',
  listening: 'waiting', // 持续态：Adapter 会用 startWaiting()，不用 play('waiting')
  thinking: 'inspect',
  speaking: 'send',
  happy: 'success',
  encouraging: 'success',
  surprised: 'surprise',
  celebrating: 'success',
  error: 'error',
}

/** 持续态状态集合：进入这些状态必须用 startWaiting()，且切换前先 stopWaiting()。 */
export const CONTINUOUS_AVATAR_STATES: ReadonlySet<DigitalHumanState> = new Set<DigitalHumanState>(['listening'])

/** store.action → 本项目状态（带守卫：未知 action 回退 idle）。 */
export function toDigitalHumanState(action: DigitalHumanAction): DigitalHumanState {
  return ACTION_TO_STATE[action] ?? 'idle'
}

/** 本项目状态 → 第三方动作名（带守卫：未知状态回退 idle）。 */
export function toAvatarAction(state: DigitalHumanState): string {
  return STATE_TO_AVATAR_ACTION[state] ?? 'idle'
}
