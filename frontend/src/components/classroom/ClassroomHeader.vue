<script setup lang="ts">
import { ElProgress } from 'element-plus'

defineProps<{
  lessonTitle: string
  stepTitle: string
  paused: boolean
  currentStepIndex: number
  totalSteps: number
  elapsedSeconds: number
  stepMinutes: number
  progress: number
}>()

function formatTime(value: number): string {
  const m = Math.floor(value / 60)
  return `${String(m).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}
</script>

<template>
  <header class="classroom-header">
    <div class="header-left">
      <span class="status-pill" :class="{ paused }">{{ paused ? '已暂停' : '正在上课' }}</span>
      <h1 class="lesson-title">{{ lessonTitle }}</h1>
    </div>
    <div class="header-center">
      <small>当前环节</small>
      <strong>第 {{ currentStepIndex + 1 }} / {{ totalSteps }} 环节 · {{ stepTitle }}</strong>
    </div>
    <div class="header-right">
      <div class="metric"><small>已上课</small><strong>{{ formatTime(elapsedSeconds) }}</strong></div>
      <div class="metric"><small>本环节</small><strong>约 {{ stepMinutes }} 分钟</strong></div>
    </div>
    <ElProgress class="lesson-progress" :percentage="progress" :show-text="false" :stroke-width="8" :color="'#D88A4D'" />
  </header>
</template>

<style scoped>
.classroom-header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 20px 28px;
  flex: none;
}
.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.status-pill {
  flex: none;
  padding: 5px 14px;
  border-radius: 999px;
  background: #E7F0E3;
  color: #5B8C5C;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 1px;
}
.status-pill.paused { background: #FFF0E6; color: #C07A3E; }
.lesson-title {
  margin: 0;
  font-size: 26px;
  font-weight: 800;
  color: #4F3D31;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.header-center {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: center;
}
.header-center small { color: #9B8779; font-size: 12px; font-weight: 700; letter-spacing: 2px; }
.header-center strong {
  color: #6B584C;
  font-size: 15px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.header-right { display: flex; gap: 22px; }
.metric { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
.metric small { color: #9B8779; font-size: 12px; font-weight: 700; letter-spacing: 1px; }
.metric strong { color: #4F3D31; font-size: 18px; font-weight: 800; }
.lesson-progress { flex-basis: 100%; }
.lesson-progress :deep(.el-progress-bar__inner) { border-radius: 99px; }
</style>
