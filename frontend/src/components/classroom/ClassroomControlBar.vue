<script setup lang="ts">
import { ElButton } from 'element-plus'

defineProps<{
  paused: boolean
  busy: boolean
  currentStepIndex: number
  totalSteps: number
}>()

const emit = defineEmits<{
  (e: 'previous'): void
  (e: 'next'): void
  (e: 'repeat'): void
  (e: 'pause'): void
  (e: 'resume'): void
  (e: 'finishComplete'): void
  (e: 'finishCancel'): void
}>()
</script>

<template>
  <footer class="classroom-controlbar">
    <div class="control-group">
      <span class="group-label">环节控制</span>
      <ElButton size="large" :disabled="paused || busy || currentStepIndex <= 0" @click="emit('previous')">上一步</ElButton>
      <ElButton size="large" :disabled="paused || busy" @click="emit('repeat')">重置本环节</ElButton>
      <ElButton size="large" type="primary" :disabled="paused || busy || currentStepIndex >= totalSteps - 1" @click="emit('next')">下一步</ElButton>
    </div>
    <div class="control-group">
      <span class="group-label">课堂状态</span>
      <ElButton v-if="!paused" size="large" type="warning" :loading="busy" :disabled="busy" @click="emit('pause')">暂停课堂</ElButton>
      <ElButton v-else size="large" type="success" :loading="busy" :disabled="busy" @click="emit('resume')">继续课堂</ElButton>
    </div>
    <div class="control-group danger">
      <span class="group-label">课堂结束</span>
      <ElButton size="large" type="danger" :loading="busy" :disabled="busy" @click="emit('finishComplete')">结束课堂</ElButton>
      <ElButton size="large" type="danger" plain :disabled="busy" @click="emit('finishCancel')">中止</ElButton>
    </div>
  </footer>
</template>

<style scoped>
.classroom-controlbar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 14px 24px 18px;
}
.control-group {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 20px;
}
.control-group + .control-group { border-left: 1px solid #E8DED1; }
.group-label {
  margin-right: 2px;
  color: #9B8779;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 1px;
  white-space: nowrap;
}
.classroom-controlbar :deep(.el-button) { min-width: 112px; height: 48px; border-radius: 12px; font-size: 15px; }
@media (max-width: 1280px) {
  .classroom-controlbar { justify-content: space-between; }
  .control-group { padding: 0 12px; }
}
@media (max-width: 1024px) {
  .classroom-controlbar { flex-wrap: wrap; gap: 12px 8px; }
  .control-group + .control-group { border-left: 0; }
}
</style>
