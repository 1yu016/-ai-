<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElButton, ElInput, ElMessage, ElOption, ElSelect } from 'element-plus'
import { useVoiceCommandPreferenceStore } from '@/stores/voiceCommandPreference'
import type { ClassroomCommandOperation } from '@/services/classroomCommandBus'

defineProps<{
  commandFeedback: string
  voiceFeedback: string
  commandBusy: boolean
  voiceRecState: 'idle' | 'recording' | 'recognizing'
  busy: boolean
  isActive: boolean
  pendingConfirmation?: string
}>()

const commandInput = defineModel<string>('commandInput', { default: '' })

const emit = defineEmits<{
  (e: 'runCommand'): void
  (e: 'toggleVoiceRecording'): void
  (e: 'confirmCommand'): void
  (e: 'cancelCommand'): void
}>()

const preferences = useVoiceCommandPreferenceStore()
const showCustom = ref(false)
const phrase = ref('')
const operation = ref<ClassroomCommandOperation>('next_step')
const options: Array<{ value: ClassroomCommandOperation; label: string }> = [
  { value: 'previous_step', label: '上一环节' }, { value: 'next_step', label: '下一环节' },
  { value: 'pause_media', label: '暂停资源' }, { value: 'resume_media', label: '继续资源' },
  { value: 'stop_media', label: '停止资源' }, { value: 'previous_page', label: '上一页' },
  { value: 'next_page', label: '下一页' }, { value: 'zoom_in', label: '放大' },
  { value: 'zoom_out', label: '缩小' }, { value: 'mute', label: '静音' },
  { value: 'unmute', label: '取消静音' }, { value: 'random_roll_call', label: '随机点名' },
  { value: 'start_break', label: '进入课间' }, { value: 'end_break', label: '结束课间' },
  { value: 'complete_class', label: '完成课堂（始终确认）' },
]
onMounted(() => void preferences.load().catch(() => undefined))
async function addSynonym() {
  try {
    await preferences.add(phrase.value, operation.value)
    phrase.value = ''
    ElMessage.success('自定义口令已保存')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  }
}
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
    <div v-if="pendingConfirmation" class="confirm-card">
      <strong>请教师确认：{{ pendingConfirmation }}</strong>
      <div><ElButton type="primary" @click="emit('confirmCommand')">确认执行</ElButton><ElButton @click="emit('cancelCommand')">取消</ElButton></div>
    </div>
    <ElButton link class="custom-toggle" @click="showCustom = !showCustom">{{ showCustom ? '收起自定义口令' : '管理自定义口令' }}</ElButton>
    <div v-if="showCustom" class="custom-panel">
      <p>自定义语句只能映射到系统白名单；与内置口令冲突时无法保存。</p>
      <div class="custom-form">
        <ElInput v-model="phrase" maxlength="40" placeholder="例如：往前走" />
        <ElSelect v-model="operation"><ElOption v-for="item in options" :key="item.value" :label="item.label" :value="item.value" /></ElSelect>
        <ElButton type="primary" :disabled="!phrase.trim()" @click="addSynonym">保存</ElButton>
      </div>
      <div v-for="item in preferences.items" :key="item.id" class="synonym-row">
        <span>“{{ item.phrase }}” → {{ options.find((option) => option.value === item.operation)?.label ?? item.operation }}</span>
        <ElButton v-if="item.id" link type="danger" @click="preferences.remove(item.id)">删除</ElButton>
      </div>
    </div>
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
.confirm-card { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-top:12px; padding:12px; border:1px solid #F0C36A; border-radius:10px; background:#FFF8E7; color:#785A22; }
.custom-toggle { margin-top:10px; }
.custom-panel { margin-top:8px; padding:12px; border:1px solid #E8DED1; border-radius:10px; background:#fff; }
.custom-panel p { margin:0 0 8px; color:#8A7668; font-size:12px; }
.custom-form { display:grid; grid-template-columns:minmax(140px,1fr) 180px auto; gap:8px; }
.synonym-row { display:flex; justify-content:space-between; align-items:center; margin-top:8px; padding-top:8px; border-top:1px solid #F0E8DE; font-size:13px; }
@media (max-width: 640px) { .command-row { grid-template-columns: 1fr; } }
</style>
