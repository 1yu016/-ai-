<script setup lang="ts">
/**
 * GrokBotAvatar.vue —— 数字人 2D 表情动画 Adapter。
 *
 * ⚠️ 命名说明：文件名沿用项目内部历史命名，但实际封装的第三方是
 *    「Agent Robot Avatar」（CX-ArtLab / MIT），不是 xAI 官方 GrokBot。
 *
 * 职责：
 *  - 加载 vendor 的 agent-robot-avatar 自定义元素（零运行时依赖，SVG + Shadow DOM）。
 *  - 接收统一业务状态 DigitalHumanState，映射为第三方 action 并调用真实 API：
 *      play() / startWaiting() / stopWaiting() / reset()
 *  - 持续态（listening）与一次性动画（thinking/speaking/...）严格区分：
 *    listening 用 startWaiting()，离开 listening 先 stopWaiting()，避免多个 waiting loop。
 *  - 快速切换竞态防护：递增 sequenceId，异步动画完成后校验 token，
 *    旧动画结果不会覆盖新状态。
 *  - 儿童课堂适配：默认关闭 press-squeeze / antenna-drag 拖拽手势，保留
 *    blink / 轻微 idle / pointer-follow；motion 保持 auto，尊重 prefers-reduced-motion。
 *  - 异常降级：customElements 不支持 / 初始化异常 / play 抛错 → console.warn，
 *    不影响宿主页面（课堂降级原则：数字人失败 ≠ 课堂失败）。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { DigitalHumanState } from '../avatar.types'
import { toAvatarAction, CONTINUOUS_AVATAR_STATES } from '../avatarStateMap'
// 引入即注册 <agent-robot-avatar> 自定义元素（core 内 customElements.define）。
import '@/vendor/agent-robot-avatar/agent-robot-avatar.js'

// color：换肤入口，透传给 <agent-robot-avatar color=...>（vendor 内部同步头部/眼皮/天线点颜色）。
const props = defineProps<{ state: DigitalHumanState; size?: number; color?: string }>()
const emit = defineEmits<{ (e: 'fallback-required'): void }>()

// Agent Robot Avatar 公开 API 子集（与 vendor index.d.ts 对齐，不臆造方法）。
interface AgentRobotAvatarElement extends HTMLElement {
  play(action: string): this | Promise<void>
  reset(): this
  startWaiting(options?: { variant?: 'default' | 'wrap' }): Promise<this>
  stopWaiting(): this
  setPressSqueeze(enabled: boolean): this
  setAntennaDrag(enabled: boolean): this
  setPointerFollow(enabled: boolean): this
}

const avatarEl = ref<AgentRobotAvatarElement | null>(null)
// 递增 token：每次状态变更自增，异步动画完成后校验，旧结果作废。
let sequenceId = 0
// 当前已应用的状态：避免持续态重复 startWaiting()。
let appliedState: DigitalHumanState | null = null

function warn(message: string, error?: unknown) {
  // 数字人异常仅告警，不向上抛，保证课堂主流程不受影响。
  console.warn(`[ClassroomAvatar] ${message}`, error ?? '')
}

function elementSupported(): boolean {
  return typeof window !== 'undefined' && 'customElements' in window &&
    Boolean(window.customElements.get('agent-robot-avatar'))
}

/** 一次性动画：校验 token 后 play()；失败触发占位降级（不向上抛）。 */
function playOneShot(action: string, token: number) {
  const avatar = avatarEl.value
  if (!avatar) return
  try {
    const result = avatar.play(action)
    // play 返回 this 或 Promise<void>；统一包装，完成后校验 token 防止旧动画覆盖新状态。
    if (result && typeof (result as Promise<void>).then === 'function') {
      void (result as Promise<void>).catch((e: unknown) => {
        if (token !== sequenceId) return
        warn(`play('${action}') 异常`, e)
        emit('fallback-required')
      })
    }
  } catch (e) {
    if (token !== sequenceId) return
    warn(`play('${action}') 抛错`, e)
    emit('fallback-required')
  }
}

/** 进入持续态：startWaiting()（防重复由 applyState 的 wasListening 判断控制）。 */
function enterContinuous() {
  const avatar = avatarEl.value
  if (!avatar) return
  try {
    void avatar.startWaiting().catch((e: unknown) => {
      warn('startWaiting() 异常', e)
      emit('fallback-required')
    })
  } catch (e) {
    warn('startWaiting() 抛错', e)
    emit('fallback-required')
  }
}

/** 离开持续态：stopWaiting()，确保只有一个 waiting loop。 */
function leaveContinuous() {
  const avatar = avatarEl.value
  if (!avatar) return
  try {
    avatar.stopWaiting()
  } catch (e) {
    warn('stopWaiting() 抛错', e)
  }
}

function applyState(next: DigitalHumanState) {
  const token = ++sequenceId
  const avatar = avatarEl.value
  if (!avatar) return
  // 0. 记录切换前的持续态，用于判断是否需要 stopWaiting / 是否需要新启动 waiting。
  const wasListening = appliedState === 'listening'
  // 1. 从持续态切走：先 stopWaiting()，确保不残留 waiting loop。
  if (wasListening && next !== 'listening') leaveContinuous()
  appliedState = next
  // 2. 持续态：startWaiting()（此前不在 listening 才启动，避免重复 waiting loop）。
  if (CONTINUOUS_AVATAR_STATES.has(next)) {
    if (!wasListening) enterContinuous()
    return
  }
  // 3. 一次性状态：idle 用 reset() 回归，其余用 play()。
  const action = toAvatarAction(next)
  if (action === 'idle') {
    try {
      avatar.reset()
    } catch (e) {
      warn('reset() 抛错', e)
      emit('fallback-required')
    }
    return
  }
  playOneShot(action, token)
}

onMounted(() => {
  if (!elementSupported()) {
    warn('当前环境不支持 customElements，2D 数字人不可用，回退静态占位')
    emit('fallback-required')
    return
  }
  // 儿童课堂适配：关闭拖拽手势，保留轻量 idle/blink/pointer-follow。
  try {
    avatarEl.value?.setPressSqueeze(false)
    avatarEl.value?.setAntennaDrag(false)
  } catch (e) {
    warn('手势配置异常（不影响动画）', e)
  }
  if (props.state) applyState(props.state)
})

watch(() => props.state, (next) => {
  if (!next) return
  applyState(next)
})

onBeforeUnmount(() => {
  // 页面卸载：停掉持续态 waiting loop，其余由 custom element 的 disconnectedCallback 释放 rAF/监听。
  leaveContinuous()
  sequenceId++ // 使所有在途异步结果全部失效
})
</script>

<template>
  <agent-robot-avatar
    ref="avatarEl"
    class="grokbot-avatar"
    :size="size ?? 160"
    :color="color"
    motion="auto"
    press-squeeze="false"
    antenna-drag="false"
    aria-label="课堂数字人形象"
  />
</template>

<style scoped>
.grokbot-avatar {
  display: block;
  width: 100%;
  height: 100%;
  margin: 0 auto;
  /* 尺寸由 size 属性驱动（vendor 内部同步 --face-size），无需在此声明。 */
}
</style>
