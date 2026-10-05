<script setup lang="ts">
// 课间休息面板：无本地状态，权威数据全部来自 ClassroomRun（breakStartedAt/breakEndsAt）。
// 由父组件传入 active/remainingSeconds，成功调用 start-break / end-break 后才切换 UI。
defineProps<{ active: boolean; remainingSeconds: number; busy: boolean; canStart: boolean }>()

defineEmits<{ (e: 'start-break', durationSeconds: number): void; (e: 'end-break'): void }>()

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
      <button
        v-for="item in DURATIONS"
        :key="item.seconds"
        class="button"
        :disabled="busy || !canStart"
        @click="$emit('start-break', item.seconds)"
      >
        {{ item.label }}
      </button>
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
  display: flex;
  gap: 10px;
  margin-top: 14px;
}
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
