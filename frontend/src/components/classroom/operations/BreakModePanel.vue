<script setup lang="ts">
defineProps<{ breakMode: boolean; breakSeconds: number }>()

defineEmits<{ (e: 'toggle-break'): void }>()

function formatSeconds(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(
    value % 60,
  ).padStart(2, '0')}`
}
</script>

<template>
  <section class="panel">
    <div class="section-head">
      <h2>课间模式</h2>
      <span v-if="breakMode" class="pill">进行中</span>
    </div>
    <div v-if="breakMode" class="break-clock">
      {{ formatSeconds(breakSeconds) }}
    </div>
    <p class="muted">喝水 · 如厕 · 律动 · 眼保健操</p>
    <button class="button" @click="$emit('toggle-break')">
      {{ breakMode ? '返回课堂' : '开始 5 分钟课间' }}
    </button>
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
</style>
