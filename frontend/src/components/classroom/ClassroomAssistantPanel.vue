<script setup lang="ts">
import { ElButton, ElInput } from 'element-plus'
import type { AssistantTool } from '@/stores/classroomAssistant'

defineProps<{
  enabled: boolean
  childVoiceStatus: string
  assistantLoading: boolean
  childRecording: boolean
  childRequestingMicrophone: boolean
  childRecognizing: boolean
  teacherTip: string
  requiresTeacherConfirmation: boolean
  assistantSpeechLoading: boolean
  assistantSpeaking: boolean
  draftAccepted: boolean
  attemptCount: number
}>()

const teacherPrompt = defineModel<string>('teacherPrompt', { default: '' })
const childReply = defineModel<string>('childReply', { default: '' })
const draftReply = defineModel<string>('draftReply', { default: '' })

const emit = defineEmits<{
  (e: 'toggleAssistant'): void
  (e: 'askAssistant', tool?: AssistantTool, useTeacherPrompt?: boolean): void
  (e: 'toggleChildRecording'): void
  (e: 'playDraft'): void
  (e: 'stopSpeech'): void
  (e: 'acceptDraft'): void
  (e: 'discardDraft'): void
}>()
</script>

<template>
  <section class="assistant-card">
    <div class="card-head">
      <div class="card-title">
        <strong>🌱 启发式课堂助教</strong>
        <small>任意环节都可调用，AI 先生成可编辑草稿，再由老师决定是否播放</small>
      </div>
      <ElButton size="small" type="success" plain @click="emit('toggleAssistant')">{{ enabled ? '收起助教' : '打开助教' }}</ElButton>
    </div>
    <template v-if="enabled">
      <p class="card-tip">老师可以自由输入问题或要求；AI 先生成可编辑草稿，再由老师决定是否播放。</p>
      <div class="assistant-free-input">
        <ElInput v-model="teacherPrompt" type="textarea" :rows="2" maxlength="1000" placeholder="输入老师想让助教回答的问题或课堂要求" />
        <ElButton type="primary" :loading="assistantLoading" :disabled="!teacherPrompt.trim()" @click="emit('askAssistant', undefined, true)">生成AI草稿</ElButton>
      </div>
      <div class="assistant-child-voice">
        <ElInput v-model="childReply" type="textarea" :rows="2" maxlength="1000" placeholder="点击右侧“让孩子说话”，识别文字会显示在这里，老师也可修改" aria-label="孩子语音识别结果" />
        <ElButton :type="childRecording ? 'danger' : 'default'" :loading="childRequestingMicrophone || childRecognizing" :disabled="assistantLoading || childRequestingMicrophone || childRecognizing" @click="emit('toggleChildRecording')">
          {{ childRecording ? '■ 说完了' : '🎤 让孩子说话' }}
        </ElButton>
      </div>
      <p v-if="childVoiceStatus" class="child-voice-status" role="status">{{ childVoiceStatus }}</p>
      <div class="assistant-buttons">
        <ElButton type="primary" :loading="assistantLoading" @click="emit('askAssistant', 'guided_question', false)">生成启发问题</ElButton>
        <ElButton :disabled="assistantLoading" @click="emit('askAssistant', 'give_hint', false)">再给提示</ElButton>
        <ElButton :disabled="assistantLoading" @click="emit('askAssistant', 'follow_up', false)">继续追问</ElButton>
        <ElButton :disabled="assistantLoading" @click="emit('askAssistant', 'encourage', false)">鼓励表达</ElButton>
        <ElButton :disabled="assistantLoading" @click="emit('askAssistant', 'summarize', false)">总结本环节</ElButton>
        <span v-if="attemptCount" class="attempt-level">提示层级 {{ attemptCount + 1 }}</span>
      </div>
      <div v-if="draftReply" class="ai-draft">
        <small>AI 草稿（可由教师修改后再决定）</small>
        <ElInput v-model="draftReply" type="textarea" :autosize="{ minRows: 2, maxRows: 5 }" maxlength="500" aria-label="编辑AI草稿" />
        <em>{{ teacherTip }}</em>
        <div class="assistant-draft-actions">
          <ElButton type="primary" :loading="assistantSpeechLoading" :disabled="requiresTeacherConfirmation || assistantSpeaking" @click="emit('playDraft')">
            {{ assistantSpeaking ? '正在播放' : '教师确认并播放' }}
          </ElButton>
          <ElButton v-if="assistantSpeaking" type="warning" plain @click="emit('stopSpeech')">停止播放</ElButton>
          <ElButton type="success" plain :disabled="draftAccepted" @click="emit('acceptDraft')">{{ draftAccepted ? '已确认文字' : '教师自行讲述' }}</ElButton>
          <ElButton @click="emit('discardDraft')">暂不采用</ElButton>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.assistant-card {
  padding: 20px 22px 22px;
  border: 1px solid #E8DED1;
  border-radius: 16px;
  background: #FFFDF9;
  box-shadow: 0 6px 20px rgba(79, 61, 49, 0.08);
}
.card-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.card-title { display: grid; gap: 3px; }
.card-title strong { color: #4F3D31; font-size: 17px; font-weight: 800; }
.card-title small { color: #9B8779; font-size: 12px; }
.card-tip { margin: 12px 0 14px; color: #9B8779; font-size: 13px; line-height: 1.6; }
.assistant-free-input,
.assistant-child-voice {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: stretch;
  gap: 10px;
  margin-bottom: 10px;
}
.assistant-free-input :deep(.el-button),
.assistant-child-voice :deep(.el-button) { height: auto; min-width: 150px; border-radius: 11px; }
.child-voice-status { margin: 0 0 12px; padding: 8px 11px; border-radius: 9px; background: #FFF8EE; color: #8D6732; font-size: 14px; }
.assistant-buttons,
.assistant-draft-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-top: 10px; }
.assistant-buttons :deep(.el-button),
.assistant-draft-actions :deep(.el-button) { border-radius: 11px; }
.attempt-level { margin-left: 4px; color: #9B8779; font-size: 13px; }
.ai-draft { display: grid; gap: 10px; margin-top: 12px; padding: 14px; border: 1px solid #DCE9D5; border-radius: 12px; background: #F4FAF0; }
.ai-draft :deep(.el-textarea__inner) { font-size: 16px; line-height: 1.6; }
.ai-draft small { color: #718064; font-weight: 700; }
.ai-draft em { display: block; color: #718064; font-size: 14px; line-height: 1.6; }
.assistant-draft-actions { margin-top: 0; }
</style>
