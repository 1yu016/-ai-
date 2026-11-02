<script setup lang="ts">
import { ElButton } from 'element-plus'
import type { WakeUiState } from '@/services/localWakeSpeech'

const props = defineProps<{
  state: WakeUiState
  statusText: string
  detail?: string
  busy?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{ (e: 'toggle'): void }>()

const labels: Record<WakeUiState, string> = {
  off: '语音唤醒未开启',
  loading: '正在开启语音唤醒…',
  waiting: '正在等待唤醒词',
  awake: '已唤醒',
  error: '语音唤醒不可用',
}
</script>

<template>
  <section class="wake-card" :data-state="props.state" data-test="wake-control">
    <div class="wake-head">
      <div class="wake-title">
        <strong>🎧 语音唤醒</strong>
        <small>{{ labels[props.state] }}<template v-if="props.state === 'waiting'">：你好，小助手 / 小星</template></small>
      </div>
      <ElButton
        :type="props.state === 'off' || props.state === 'error' ? 'primary' : 'danger'"
        plain
        :loading="props.state === 'loading'"
        :disabled="props.disabled || props.busy"
        @click="emit('toggle')"
      >
        {{ props.state === 'off' || props.state === 'error' ? '开启语音唤醒' : '关闭语音唤醒' }}
      </ElButton>
    </div>
    <p class="wake-status" role="status" data-test="wake-status">{{ props.statusText }}</p>
    <p v-if="props.detail" class="wake-detail" data-test="wake-detail">{{ props.detail }}</p>
    <p class="wake-note">每次唤醒后20秒活动窗口，连续收听最多60秒；说“停止听我说话”结束窗口。关闭或页面失焦即释放麦克风。本地识别不上传音频。</p>
  </section>
</template>

<style scoped>
.wake-card {
  margin-top: 14px;
  padding: 16px 20px 18px;
  border: 1px solid #E8DED1;
  border-radius: 16px;
  background: #FFFDF9;
  box-shadow: 0 6px 20px rgba(79, 61, 49, 0.08);
}
.wake-card[data-state='waiting'] { border-color: #B9D8C2; }
.wake-card[data-state='awake'] { border-color: #F0C36A; background: #FFFBF2; }
.wake-card[data-state='error'] { border-color: #E7B5B5; background: #FFF7F7; }
.wake-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.wake-title { display: grid; gap: 3px; }
.wake-title strong { color: #4F3D31; font-size: 16px; font-weight: 800; }
.wake-title small { color: #9B8779; font-size: 12px; }
.wake-status { margin: 12px 0 0; padding: 9px 12px; border-radius: 9px; background: #F6F1E9; color: #5C4B3D; font-size: 14px; line-height: 1.5; word-break: break-all; }
.wake-card[data-state='waiting'] .wake-status { background: #EDF6EF; color: #38614A; }
.wake-card[data-state='awake'] .wake-status { background: #FFF4DC; color: #8D6732; }
.wake-card[data-state='error'] .wake-status { background: #FDECEC; color: #9A3B3B; }
.wake-detail { margin: 8px 0 0; color: #7A6657; font-size: 13px; line-height: 1.5; word-break: break-all; }
.wake-note { margin: 10px 0 0; color: #A3907F; font-size: 12px; line-height: 1.5; }
</style>
