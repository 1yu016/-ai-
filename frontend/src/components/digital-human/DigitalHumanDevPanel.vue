<script setup lang="ts">
/**
 * DigitalHumanDevPanel.vue —— 数字人开发调试面板（仅 import.meta.env.DEV 下由父组件渲染）。
 *
 * 按钮只调用现有 digitalHuman store 的方法（playAction / setFallback / reset），
 * 严禁直接调用 Avatar 第三方 API（avatar.play / startWaiting / reset）。
 * 完整链路：store.action → ClassroomAvatar → avatarStateMap → Agent Robot Avatar。
 */
import { useDigitalHumanStore } from '@/stores/digitalHuman'
import type { DigitalHumanAction } from '@/stores/digitalHuman'

const store = useDigitalHumanStore()

// 按钮 → store 白名单动作（error 无对应白名单动作，走 setFallback 模拟异常）。
const ACTIONS: Array<{ label: string; action?: DigitalHumanAction; mode?: 'fallback' | 'reset' }> = [
  { label: 'Idle', action: 'idle' },
  { label: 'Greeting', action: 'wave' },
  { label: 'Listening', action: 'listen' },
  { label: 'Thinking', action: 'thinking' },
  { label: 'Speaking', action: 'talk' },
  { label: 'Happy', action: 'happy' },
  { label: 'Surprised', action: 'question' },
  { label: 'Error', mode: 'fallback' },
  { label: '恢复', mode: 'reset' },
]

function trigger(item: (typeof ACTIONS)[number]) {
  if (item.mode === 'fallback') {
    store.setFallback('DEV 演示：数字人异常')
    return
  }
  if (item.mode === 'reset') {
    store.reset()
    return
  }
  if (item.action) store.playAction(item.action)
}
</script>

<template>
  <div class="dh-dev-panel" data-test="dh-dev-panel">
    <span class="dh-dev-title">数字人调试（DEV）</span>
    <div class="dh-dev-buttons">
      <button v-for="item in ACTIONS" :key="item.label" type="button" @click="trigger(item)">
        {{ item.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.dh-dev-panel {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: 8px 0;
  padding: 8px 10px;
  border: 1px dashed #E8C9A0;
  border-radius: 12px;
  background: #FFFBF2;
}
.dh-dev-title { color: #8D6732; font-size: 12px; font-weight: 800; }
.dh-dev-buttons { display: flex; gap: 6px; flex-wrap: wrap; }
.dh-dev-buttons button {
  border: 1px solid #EFD9C8;
  border-radius: 999px;
  padding: 4px 12px;
  background: #FFF8EE;
  color: #8D6732;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.dh-dev-buttons button:hover { background: #FFF0E0; }
</style>
