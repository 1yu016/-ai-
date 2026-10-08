﻿﻿﻿<script setup lang="ts">
import { ref } from 'vue'
import DigitalHumanDevPanel from '@/components/digital-human/DigitalHumanDevPanel.vue'
import ClassroomAvatar from '@/components/digital-human/ClassroomAvatar.vue'

// 课堂右侧「AI 教学伙伴」常驻主卡：
// - 2D ClassroomAvatar（Agent Robot Avatar）常驻作为课堂陪伴数字人，
//   状态标签 + 简短气泡 + 进入大屏入口
// - 点击数字人主体直接进入数字人大屏（activeFullscreenPanel = 'avatar'）
// - 窄屏可折叠（默认展开），折叠时数字人隐藏，不卸载
defineProps<{
  actionText: string
  micReady: boolean
  assistantOnline: boolean
  classroomStatusText: string
}>()

defineOptions({ name: 'ClassroomPartnerPanel' })

const emit = defineEmits<{ (e: 'enter-avatar'): void }>()
const collapsed = ref(false)
// 开发调试面板仅 DEV 下渲染（模板表达式不允许直接使用 import.meta，故在此求值）。
const isDev = import.meta.env.DEV
</script>

<template>
  <aside class="partner-panel" data-test="dh-card">
    <div class="dh-card-head">
      <strong>🤖 AI 教学伙伴</strong>
      <span class="dh-state">当前状态：{{ actionText }}</span>
      <button class="dh-collapse" type="button" data-test="dh-collapse" :aria-label="collapsed ? '展开数字人' : '收起数字人'" @click="collapsed = !collapsed">
        {{ collapsed ? '展开数字人' : '收起' }}
      </button>
    </div>

    <template v-if="!collapsed">
      <!-- 开发调试面板：仅 import.meta.env.DEV 下渲染，按钮走 digitalHuman store -->
      <DigitalHumanDevPanel v-if="isDev" />
      <div class="dh-stage" data-test="dh-stage" @click="emit('enter-avatar')">
        <!-- 2D 陪伴数字人：ClassroomAvatar 常驻，点击进入大屏 -->
        <ClassroomAvatar />
        <span class="dh-click-hint">点击数字人进入大屏</span>
      </div>
      <button class="dh-avatar-entry" type="button" data-test="enter-avatar" @click="emit('enter-avatar')">
        进入数字人大屏
      </button>
      <div class="dh-status-line">
        <span :class="micReady ? 'ok' : 'warn'">麦克风{{ micReady ? '就绪' : '不可用' }}</span>
        <span :class="assistantOnline ? 'ok' : 'off'">AI助教{{ assistantOnline ? '在线' : '待命' }}</span>
        <span class="run">{{ classroomStatusText }}</span>
      </div>
    </template>
    <p v-else class="dh-collapsed-hint">数字人已收起，点右上角「展开数字人」恢复。</p>
  </aside>
</template>

<style scoped>
.partner-panel {
  min-width: 0;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.dh-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dh-card-head strong { color: #4F3D31; font-size: 15px; font-weight: 800; }
.dh-state {
  padding: 3px 10px;
  border-radius: 999px;
  background: #FFF8EE;
  color: #8D6732;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}
/* 折叠按钮：常规宽屏隐藏，仅在特别窄的教师设备上出现 */
.dh-collapse {
  display: none;
  margin-left: auto;
  border: 1px solid #EFD9C8;
  border-radius: 999px;
  padding: 3px 10px;
  background: #FFF8EE;
  color: #8D6732;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.dh-stage {
  position: relative;
  flex: 1 1 300px;
  min-height: 240px;
  max-height: 320px;
  overflow: hidden;
  border: 1px solid #E8DED1;
  border-radius: 16px;
  background: radial-gradient(circle at 50% 30%, #FFFDF6 0%, #FFF7EC 100%);
  box-shadow: 0 6px 20px rgba(79, 61, 49, 0.08);
  cursor: pointer;
  /* 2D 陪伴数字人本体直接常驻于此，点击进入 3D 数字人大屏 */
  display: flex;
  align-items: center;
  justify-content: center;
}
.dh-stage :deep(.classroom-avatar) {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dh-click-hint {
  position: absolute;
  left: 50%;
  bottom: 8px;
  transform: translateX(-50%);
  padding: 2px 10px;
  border-radius: 999px;
  background: rgba(255, 253, 249, 0.82);
  color: #9B8779;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
  pointer-events: none;
}
.dh-avatar-entry {
  border: 1px solid #EFD9C8;
  border-radius: 12px;
  padding: 9px 10px;
  background: #FFF8EE;
  color: #8D6732;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.dh-status-line {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.dh-status-line span {
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  white-space: nowrap;
}
.dh-status-line span.ok { background: #E7F0E3; color: #5B8C5C; }
.dh-status-line span.warn { background: #FFF0E6; color: #C07A3E; }
.dh-status-line span.off { background: #F3EDE6; color: #9B8779; }
.dh-status-line span.run { background: #F3EDE6; color: #9B8779; }
.dh-collapsed-hint { margin: 0; color: #9B8779; font-size: 13px; }

@media (max-width: 1280px) {
  .partner-panel { gap: 10px; }
  .dh-stage { flex-basis: 200px; min-height: 160px; max-height: 220px; }
  .dh-card-head strong { font-size: 14px; }
  .dh-state { font-size: 11px; }
  .dh-avatar-entry { padding: 8px 10px; font-size: 12px; }
}
/* 特别窄：显示折叠按钮，数字人默认仍展开 */
@media (max-width: 999px) {
  .dh-collapse { display: inline-flex; }
  .dh-stage { flex-basis: 170px; min-height: 150px; max-height: 200px; }
}
</style>
