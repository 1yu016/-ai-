<script setup lang="ts">
import type { RunStep } from '@/stores/lessonRun'

defineProps<{
  steps: RunStep[]
  currentStepIndex: number
  paused: boolean
  busy: boolean
  collapsed: boolean
}>()

const emit = defineEmits<{
  (e: 'goStep', index: number): void
  (e: 'toggleCollapse'): void
}>()
</script>

<template>
  <aside class="step-sidebar" :class="{ collapsed }" aria-label="课堂环节导航">
    <div class="sidebar-top">
      <span v-if="!collapsed" class="sidebar-title">课堂环节</span>
      <button class="collapse-btn" type="button" :aria-label="collapsed ? '展开环节导航' : '收起环节导航'" @click="emit('toggleCollapse')">
        {{ collapsed ? '›' : '‹' }}
      </button>
    </div>
    <div class="step-list">
      <template v-if="!collapsed">
        <button
          v-for="step in steps"
          :key="step.stepIndex"
          type="button"
          class="step-item"
          :class="{ active: step.stepIndex === currentStepIndex, done: step.stepIndex < currentStepIndex }"
          :disabled="paused || busy"
          @click="emit('goStep', step.stepIndex)"
        >
          <span class="step-no">{{ step.stepIndex + 1 }}</span>
          <span class="step-name">{{ step.title }}</span>
          <span v-if="step.stepIndex === currentStepIndex" class="step-flag">当前</span>
          <span v-else-if="step.stepIndex < currentStepIndex" class="step-check">✓</span>
        </button>
      </template>
      <template v-else>
        <button
          v-for="step in steps"
          :key="step.stepIndex"
          type="button"
          class="step-pill"
          :class="{ active: step.stepIndex === currentStepIndex, done: step.stepIndex < currentStepIndex }"
          :title="step.title"
          :disabled="paused || busy"
          @click="emit('goStep', step.stepIndex)"
        >
          {{ step.stepIndex + 1 }}
        </button>
      </template>
    </div>
  </aside>
</template>

<style scoped>
.step-sidebar {
  width: 240px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
  padding: 14px 12px;
  border: 1px solid #E8DED1;
  border-radius: 16px;
  background: #FFFDF9;
  box-shadow: 0 6px 20px rgba(79, 61, 49, 0.08);
  transition: width 200ms ease;
}
.step-sidebar.collapsed { width: 68px; }
.sidebar-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex: none;
}
.step-sidebar.collapsed .sidebar-top { justify-content: center; }
.sidebar-title {
  color: #9B8779;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 2px;
  white-space: nowrap;
}
.collapse-btn {
  flex: none;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid #E8DED1;
  border-radius: 9px;
  background: #FFF8EE;
  color: #9B8779;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  transition: color 150ms ease, border-color 150ms ease;
}
.collapse-btn:hover { color: #D88A4D; border-color: #D88A4D; }
.step-list { display: flex; flex-direction: column; gap: 7px; min-height: 0; }
.step-sidebar.collapsed .step-list { align-items: center; }
.step-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 11px;
  border: 1px solid transparent;
  border-radius: 12px;
  background: transparent;
  color: #6B584C;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
  transition: background 150ms ease, border-color 150ms ease;
}
.step-item:hover { background: #FFF8EE; }
.step-item:disabled { cursor: not-allowed; opacity: 0.7; }
.step-no {
  flex: none;
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  border-radius: 8px;
  background: #F3E7D9;
  color: #9B8779;
  font-size: 13px;
  font-weight: 800;
}
.step-item.done .step-no { background: #E7F0E3; color: #5B8C5C; }
.step-item.active { background: #FBEFE3; border-color: #EACFB4; }
.step-item.active .step-no { background: #D88A4D; color: #fff; }
.step-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.step-item.active .step-name { color: #4F3D31; font-weight: 800; }
.step-flag { flex: none; color: #D88A4D; font-size: 11px; font-weight: 800; }
.step-check { flex: none; color: #78B978; font-size: 12px; }
.step-pill {
  width: 40px;
  height: 38px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 11px;
  background: transparent;
  color: #9B8779;
  font-size: 14px;
  font-weight: 800;
  cursor: pointer;
  transition: background 150ms ease, border-color 150ms ease;
}
.step-pill:hover { background: #FFF8EE; }
.step-pill.done { color: #78B978; }
.step-pill.active { background: #FBEFE3; border-color: #EACFB4; color: #D88A4D; }
.step-pill:disabled { cursor: not-allowed; opacity: 0.7; }
</style>
