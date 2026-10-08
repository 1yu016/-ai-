<script setup lang="ts">
import { ref } from 'vue'
import type { BreakContentType, StartBreakOptions } from '@/stores/lessonRun'
// 课间休息面板：无本地状态，权威数据全部来自 ClassroomRun（breakStartedAt/breakEndsAt）。
// 由父组件传入 active/remainingSeconds，成功调用 start-break / end-break 后才切换 UI。
defineProps<{ active: boolean; remainingSeconds: number; busy: boolean; canStart: boolean }>()

const emit = defineEmits<{ (e: 'start-break', options: StartBreakOptions): void; (e: 'end-break'): void }>()

const selectedContent = ref<BreakContentType>('water')
const CONTENTS: Array<{ type: BreakContentType; icon: string; label: string }> = [
  { type: 'water', icon: '🥤', label: '喝水' },
  { type: 'toilet', icon: '🚻', label: '如厕' },
  { type: 'movement', icon: '🎵', label: '律动' },
  { type: 'eye_exercise', icon: '👀', label: '眼保健操' },
  { type: 'light_music', icon: '🎶', label: '轻音乐' },
  { type: 'safety', icon: '🛡️', label: '安全提示' },
]

const DURATIONS = [
  { seconds: 180, label: '3 分钟' },
  { seconds: 300, label: '5 分钟' },
  { seconds: 600, label: '10 分钟' },
]

function formatSeconds(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(
    value % 60,
  ).padStart(2, '0')}`
}

function start(durationSeconds: number) {
  emit('start-break', {
    durationSeconds,
    contentType: selectedContent.value,
    idleProtectionSeconds: Math.min(120, durationSeconds),
  })
}
</script>

<template>
  <section class="panel">
    <div class="section-head">
      <h2>课间休息</h2>
      <span v-if="active" class="pill">进行中</span>
    </div>
    <div v-if="active" class="break-clock" data-test="break-countdown">
      {{ formatSeconds(remainingSeconds) }}
    </div>
    <p v-else class="muted">喝水 · 如厕 · 律动，让幼儿放松休息</p>
    <div v-if="active" class="actions">
      <button class="button" :disabled="busy" @click="$emit('end-break')">
        {{ busy ? '处理中…' : '提前结束课间' }}
      </button>
    </div>
    <div v-else class="duration-actions">
      <div class="content-options" aria-label="选择课间内容">
        <button
          v-for="item in CONTENTS"
          :key="item.type"
          type="button"
          class="content-button"
          :class="{ selected: selectedContent === item.type }"
          :disabled="busy || !canStart"
          @click="selectedContent = item.type"
        >
          <span>{{ item.icon }}</span>{{ item.label }}
        </button>
      </div>
      <div class="time-buttons">
      <button
        v-for="item in DURATIONS"
        :key="item.seconds"
        class="button"
        :disabled="busy || !canStart"
        @click="start(item.seconds)"
      >
        {{ item.label }}
      </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.panel {
  border: 1px solid #f0ddce;
  border-radius: 18px;
  background: #fffdf9;
  padding: 20px;
  box-shadow: 0 10px 28px #b9795114;
}
.section-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.section-head h2,
.panel h2 {
  margin: 0 0 6px;
}
.muted {
  color: #9a7e6e;
  line-height: 1.6;
}
.pill {
  padding: 7px 11px;
  border-radius: 999px;
  background: #fff0e4;
  color: #a9654c;
  font-size: 13px;
}
.break-clock {
  text-align: center;
  font-size: 48px;
  font-weight: 800;
  color: #d67b59;
  margin: 18px 0;
}
.actions {
  display: flex;
  justify-content: center;
}
.duration-actions {
  display: grid;
  gap: 14px;
  margin-top: 14px;
}
.content-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.content-button { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 9px 7px; border: 1px solid #f0ddce; border-radius: 10px; background: #fff; color: #795f50; cursor: pointer; }
.content-button.selected { border-color: #e99168; background: #fff0e7; color: #a54f32; font-weight: 700; }
.time-buttons { display: flex; gap: 10px; }
.button {
  border: 0;
  border-radius: 11px;
  padding: 10px 16px;
  cursor: pointer;
  background: #e99168;
  color: #fff;
}
.button:hover {
  background: #d67b59;
}
.button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
