<script setup lang="ts">
import { ref } from 'vue'
import { ElButton, ElInput, ElOption, ElSelect } from 'element-plus'
import { storeToRefs } from 'pinia'
import {
  useClassroomAssistantStore,
  type AssistantTool,
} from '@/stores/classroomAssistant'

defineProps<{
  playing: boolean
}>()

const emit = defineEmits<{
  tool: [tool: AssistantTool | 'simplify']
  prompt: [text: string]
  play: []
  stop: []
  confirmAction: []
  end: []
}>()

const teacherPrompt = ref('')

const assistantStore = useClassroomAssistantStore()
const {
  ageGroup,
  theme,
  objective,
  currentStep,
  responseLength,
  playbackPolicy,
  loading,
  draftReply,
  teacherTip,
  suggestedAction,
  requiresTeacherConfirmation,
  attemptCount,
} = storeToRefs(assistantStore)

const quickTools: Array<{
  tool: AssistantTool | 'simplify'
  label: string
  icon: string
}> = [
  { tool: 'guided_question', label: '生成一个启发问题', icon: '❓' },
  { tool: 'give_hint', label: '再给一个小提示', icon: '💡' },
  { tool: 'simplify', label: '换一种简单说法', icon: '🗣️' },
  { tool: 'follow_up', label: '继续追问', icon: '🔎' },
  { tool: 'summarize', label: '总结孩子的发现', icon: '✨' },
  { tool: 'recommend_resource', label: '推荐一个相关素材', icon: '🖼️' },
]
</script>

<template>
  <section class="assistant-panel" aria-label="课堂助教教师控制台">
    <header class="assistant-panel-header">
      <div>
        <strong>🌱 启发式课堂助教</strong>
        <span>AI 内容先给教师预览，默认不会自动播放</span>
      </div>
      <ElButton type="danger" plain @click="emit('end')">结束本轮互动</ElButton>
    </header>

    <div class="assistant-settings">
      <label>
        <span>年龄段</span>
        <ElSelect v-model="ageGroup" aria-label="助教年龄段">
          <ElOption label="小班" value="small" />
          <ElOption label="中班" value="middle" />
          <ElOption label="大班" value="large" />
          <ElOption label="全年龄" value="all" />
        </ElSelect>
      </label>
      <label>
        <span>活动主题</span>
        <ElInput v-model="theme" maxlength="200" aria-label="活动主题" />
      </label>
      <label class="wide-setting">
        <span>教学目标</span>
        <ElInput v-model="objective" maxlength="1000" aria-label="教学目标" />
      </label>
      <label>
        <span>当前步骤</span>
        <ElInput v-model="currentStep" maxlength="500" aria-label="当前步骤" />
      </label>
      <label>
        <span>回答长度</span>
        <ElSelect v-model="responseLength" aria-label="回答长度">
          <ElOption label="简短（推荐）" value="short" />
          <ElOption label="适中" value="medium" />
          <ElOption label="稍详细" value="long" />
        </ElSelect>
      </label>
      <label>
        <span>播放方式</span>
        <ElSelect v-model="playbackPolicy" aria-label="播放方式">
          <ElOption label="教师确认后播放" value="confirm" />
          <ElOption label="直接播放普通回答" value="direct" />
        </ElSelect>
      </label>
    </div>

    <div class="assistant-free-prompt">
      <p>老师可以自由输入问题或要求；AI 先生成可编辑草稿，再由老师决定是否播放。</p>
      <div>
        <ElInput
          v-model="teacherPrompt"
          type="textarea"
          :rows="2"
          maxlength="1000"
          placeholder="输入老师想让助教回答的问题或课堂要求"
          aria-label="老师自由提问"
        />
        <ElButton
          type="primary"
          :loading="loading"
          :disabled="loading || !teacherPrompt.trim()"
          @click="emit('prompt', teacherPrompt.trim())"
        >
          生成 AI 草稿
        </ElButton>
      </div>
    </div>

    <div class="assistant-tools" aria-label="课堂助教快捷工具">
      <ElButton
        v-for="item in quickTools"
        :key="item.tool"
        :disabled="loading"
        @click="emit('tool', item.tool)"
      >
        <span aria-hidden="true">{{ item.icon }}</span>
        {{ item.label }}
      </ElButton>
    </div>

    <p v-if="attemptCount > 0" class="hint-level">
      当前提示层级：第 {{ attemptCount + 1 }} 级，AI 会逐步增加线索
    </p>

    <div v-if="loading" class="assistant-loading" role="status">
      <span></span>
      AI 正在准备一句适合孩子的话…
      <ElButton type="warning" plain @click="emit('stop')">中止生成</ElButton>
    </div>

    <div v-if="draftReply" class="assistant-draft">
      <div class="draft-heading">
        <strong>AI 准备说出的内容</strong>
        <span>教师可直接修改</span>
      </div>
      <ElInput
        v-model="draftReply"
        type="textarea"
        :autosize="{ minRows: 2, maxRows: 5 }"
        maxlength="500"
        aria-label="编辑AI问题"
      />
      <p class="teacher-tip"><strong>教师提示：</strong>{{ teacherTip }}</p>

      <div v-if="suggestedAction" class="suggested-action">
        <div>
          <strong>需要教师确认的建议</strong>
          <span>{{ suggestedAction.description }}</span>
        </div>
        <ElButton type="warning" @click="emit('confirmAction')">
          教师确认执行
        </ElButton>
        <ElButton @click="assistantStore.discardSuggestion()">暂不执行</ElButton>
      </div>

      <div class="draft-actions">
        <ElButton
          type="primary"
          :disabled="requiresTeacherConfirmation || playing"
          @click="emit('play')"
        >
          {{ playing ? '正在播放' : '教师确认并播放' }}
        </ElButton>
        <ElButton type="warning" plain @click="emit('stop')">停止回答</ElButton>
      </div>
    </div>
  </section>
</template>

<style scoped>
.assistant-panel {
  flex: none;
  max-height: 54%;
  overflow-y: auto;
  padding: 14px 18px;
  border-bottom: 1px solid #dcead7;
  background: #f7fcf4;
  color: #41523e;
}

.assistant-panel-header,
.draft-heading,
.suggested-action,
.draft-actions,
.assistant-loading {
  display: flex;
  align-items: center;
}

.assistant-panel-header {
  justify-content: space-between;
  gap: 16px;
}

.assistant-panel-header > div,
.draft-heading {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.assistant-panel-header strong {
  font-size: 16px;
}

.assistant-panel-header span,
.draft-heading span {
  color: #71816d;
  font-size: 11px;
}

.assistant-settings {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 9px;
  margin-top: 12px;
}

.assistant-settings label {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.assistant-settings label > span {
  color: #687865;
  font-size: 11px;
  font-weight: 700;
}

.assistant-settings :deep(.el-input__wrapper),
.assistant-settings :deep(.el-select__wrapper) {
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 0 0 1px #d8e6d3 inset;
}

.wide-setting {
  grid-column: span 2;
}

.assistant-free-prompt {
  margin-top: 12px;
}

.assistant-free-prompt > p {
  margin: 0 0 7px;
  color: #687865;
  font-size: 12px;
  line-height: 1.55;
}

.assistant-free-prompt > div {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: stretch;
  gap: 8px;
}

.assistant-free-prompt :deep(.el-textarea__inner) {
  height: 100%;
  min-height: 58px !important;
  border-radius: 10px;
  box-shadow: 0 0 0 1px #d8e6d3 inset;
  font-family: inherit;
}

.assistant-free-prompt :deep(.el-button) {
  height: 100%;
  min-height: 58px;
  margin: 0;
  border-radius: 10px;
}

.assistant-tools {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: 12px;
}

.assistant-tools :deep(.el-button) {
  width: 100%;
  height: 38px;
  margin: 0;
  justify-content: flex-start;
  border-color: #d0e1ca;
  border-radius: 10px;
  background: #fff;
  color: #50664b;
  font-size: 12px;
}

.hint-level {
  margin: 10px 0 0;
  color: #7a6a3b;
  font-size: 11px;
}

.assistant-loading {
  gap: 9px;
  margin-top: 12px;
  padding: 9px 11px;
  border-radius: 10px;
  background: #eef7ea;
  font-size: 12px;
}

.assistant-loading > span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #7baa6f;
  animation: assistant-pulse 1.1s ease-in-out infinite;
}

.assistant-loading :deep(.el-button) {
  margin-left: auto;
}

.assistant-draft {
  margin-top: 12px;
  padding: 12px;
  border: 1px solid #cfdfc9;
  border-radius: 13px;
  background: #fff;
}

.draft-heading {
  margin-bottom: 8px;
}

.assistant-draft :deep(.el-textarea__inner) {
  border-radius: 11px;
  box-shadow: 0 0 0 1px #d4e2cf inset;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.6;
}

.teacher-tip {
  margin: 8px 0 0;
  color: #687865;
  font-size: 12px;
  line-height: 1.55;
}

.suggested-action {
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
  padding: 10px;
  border-radius: 10px;
  background: #fff5dd;
}

.suggested-action > div {
  min-width: 180px;
  flex: 1;
  display: grid;
  gap: 2px;
}

.suggested-action span {
  color: #866b3f;
  font-size: 11px;
}

.draft-actions {
  gap: 8px;
  margin-top: 11px;
}

.draft-actions :deep(.el-button) {
  height: 40px;
  border-radius: 11px;
}

@keyframes assistant-pulse {
  50% {
    opacity: 0.35;
    transform: scale(0.72);
  }
}

@media (max-width: 760px) {
  .assistant-panel {
    max-height: 58%;
    padding: 12px;
  }

  .assistant-settings,
  .assistant-tools {
    grid-template-columns: 1fr 1fr;
  }

  .wide-setting {
    grid-column: span 2;
  }

  .assistant-free-prompt > div {
    grid-template-columns: 1fr;
  }

  .assistant-free-prompt :deep(.el-button) {
    min-height: 42px;
  }
}
</style>
