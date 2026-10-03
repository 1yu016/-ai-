<script setup lang="ts">
import { ElButton, ElInput } from 'element-plus'

defineProps<{
  commandFeedback: string
  voiceFeedback: string
  commandBusy: boolean
  voiceRecState: 'idle' | 'recording' | 'recognizing'
  busy: boolean
  isActive: boolean
}>()

const commandInput = defineModel<string>('commandInput', { default: '' })

const emit = defineEmits<{
  (e: 'runCommand'): void
  (e: 'toggleVoiceRecording'): void
}>()
</script>

<template>
  <section class="voice-card">
    <div class="card-head">
      <div class="card-title">
        <strong>🎙 课堂语音控制</strong>
        <small>输入课堂口令，或点击语音按钮说出指令</small>
      </div>
    </div>
    <div class="command-row">
      <ElInput v-model="commandInput" placeholder="课堂口令（下一步 / 暂停 / 继续上课 / 重置本环节…）" @keyup.enter="emit('runCommand')" aria-label="课堂口令文本输入" />
      <ElButton type="primary" :loading="busy || commandBusy" :disabled="!commandInput.trim()" @click="emit('runCommand')">执行口令</ElButton>
      <ElButton
        type="success"
        plain
        :class="{ 'voice-recording': voiceRecState === 'recording' }"
        :loading="voiceRecState === 'recognizing'"
        :disabled="voiceRecState === 'recognizing' || (voiceRecState === 'idle' && (busy || !isActive))"
        @click="emit('toggleVoiceRecording')"
      >
        {{ voiceRecState === 'recording' ? '正在听…（点击结束）' : voiceRecState === 'recognizing' ? '正在识别…' : '🎙 语音控制课堂' }}
      </ElButton>
    </div>
    <span v-if="commandFeedback" class="feedback command">{{ commandFeedback }}</span>
    <span v-if="voiceFeedback" class="feedback voice">{{ voiceFeedback }}</span>
  </section>
</template>

<style scoped>
.voice-card {
  padding: 18px 22px 20px;
  border: 1px solid #E8DED1;
  border-radius: 16px;
  background: #FFFDF9;
  box-shadow: 0 6px 20px rgba(79, 61, 49, 0.08);
}
.card-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.card-title { display: grid; gap: 3px; }
.card-title strong { color: #4F3D31; font-size: 17px; font-weight: 800; }
.card-title small { color: #9B8779; font-size: 12px; }
.command-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 10px; margin-top: 12px; }
.command-row :deep(.el-button) { height: auto; min-width: 118px; border-radius: 11px; }
.voice-recording { background: #FFF4DC !important; border-color: #F2A266 !important; color: #8D6732 !important; }
.feedback { display: block; margin-top: 10px; padding: 8px 11px; border-radius: 9px; font-size: 13px; line-height: 1.5; }
.feedback.command { background: #FFF4DC; color: #8D6732; }
.feedback.voice { background: #EFF4FF; color: #4A6D8D; }
@media (max-width: 640px) { .command-row { grid-template-columns: 1fr; } }
</style>
