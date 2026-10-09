<script setup lang="ts">
/**
 * ClassroomAvatar.vue —— 课堂业务唯一使用的数字人组件。
 *
 * 结构：ClassroomAvatar → GrokBotAvatar → <agent-robot-avatar>（Agent Robot Avatar，CX-ArtLab / MIT）
 * 课堂视图（LessonClassroomView / ClassroomPartnerPanel）不感知任何第三方实现。
 *
 * 状态来源（单一权威，不建立第二套状态源）：
 *  - 默认不传 props：直接从现有 digitalHuman store 的 action 经 avatarStateMap 映射为 DigitalHumanState；
 *  - 可选 props.state：仅用于 DEV / 测试显式驱动（父页面只传必要参数）；
 *  - 可选 props.text：覆盖气泡文案；未传时按状态显示默认文案。
 *
 * 降级（数字人异常 ≠ 课堂失败）：
 *  - GrokBotAvatar 上报 fallback-required（customElements 不支持 / 初始化异常 / play 抛错 / 加载失败）；
 *  - 或 digitalHuman store.error 非空（如 TTS 不可用）。
 *  以上任一触发 → console.warn + 静态占位（🙂 小花老师），课堂步骤/播放控制不受影响。
 */
import { computed, defineAsyncComponent, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useDigitalHumanStore } from '@/stores/digitalHuman'
import type { DigitalHumanState } from './avatar.types'
import { toDigitalHumanState } from './avatarStateMap'

// Adapter 层失败（customElements 不支持 / 初始化 / play 抛错 / 加载失败）。
const localFailed = ref(false)
function onFallbackRequired() {
  localFailed.value = true
}

// 异步加载 Adapter：若 Adapter 或其依赖的 vendor（agent-robot-avatar）加载失败，
// 触发 onError → 静态占位降级，课堂主流程不受影响（组件加载失败属于可降级异常）。
const GrokBotAvatar = defineAsyncComponent({
  loader: () => import('./grokbot/GrokBotAvatar.vue'),
  onError: () => {
    console.warn('[ClassroomAvatar] GrokBotAvatar / vendor 组件加载失败，回退静态占位')
    localFailed.value = true
  },
})

const props = withDefaults(defineProps<{ state?: DigitalHumanState; text?: string; size?: number; color?: string }>(), { state: undefined, text: '', size: 240, color: undefined })

const store = useDigitalHumanStore()
const { action, error: storeError } = storeToRefs(store)

// 业务状态：显式 props.state 优先，否则 store.action → DigitalHumanState（白名单动作经映射层守卫）。
const bizState = computed<DigitalHumanState>(() => props.state ?? toDigitalHumanState(action.value))

// 综合失败信号：Adapter 异常 或 store 权威 error（如 TTS 不可用）。
const failed = computed(() => localFailed.value || Boolean(storeError.value))

// 默认气泡文案：与业务状态语义一致（与 DigitalHumanStage 风格保持一致）。
const DEFAULT_TEXT: Record<DigitalHumanState, string> = {
  idle: '准备好一起学习啦',
  greeting: '我们开始吧',
  listening: '我在认真听哦',
  thinking: '让我想一想',
  speaking: '我来和你说一说',
  happy: '太棒啦',
  encouraging: '再试一次，你可以的',
  surprised: '你发现了吗',
  celebrating: '给你一个大大的表扬',
  error: '哎呀，遇到一点小麻烦',
}
const bubbleText = computed(() => props.text || DEFAULT_TEXT[bizState.value] || DEFAULT_TEXT.idle)
</script>

<template>
  <div class="classroom-avatar" data-test="classroom-avatar">
    <GrokBotAvatar v-if="!failed" :state="bizState" :size="size" :color="color" @fallback-required="onFallbackRequired" />
    <!-- 降级占位：数字人异常时课堂仍然可用，仅静态展示身份 -->
    <div v-else class="avatar-fallback" role="img" :aria-label="storeError || '课堂数字人形象'">
      <span class="f-emoji">🙂</span>
      <span class="f-name">小花老师</span>
      <span v-if="bubbleText" class="f-bubble">{{ bubbleText }}</span>
      <small v-if="storeError" class="f-error">{{ storeError }}</small>
    </div>
  </div>
</template>

<style scoped>
.classroom-avatar {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.avatar-fallback {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px;
  border-radius: 14px;
  background: rgba(255, 253, 249, 0.82);
}
.f-emoji { font-size: 46px; line-height: 1; }
.f-name { color: #4F3D31; font-size: 14px; font-weight: 800; }
.f-bubble {
  max-width: 180px;
  text-align: center;
  color: #6B584C;
  font-size: 12px;
  line-height: 1.5;
}
.f-error { color: #C07A3E; font-size: 11px; font-weight: 700; }
</style>
