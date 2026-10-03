<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElButton, ElForm, ElFormItem, ElInput, ElMessage, ElOption, ElSelect } from 'element-plus'
import { AGE_GROUPS, resourceApi, toArrayField } from '@/api/resources'
import type { AiSuggestion, ResourceAgeGroup } from '@/api/resources'
import { apiErrorMessage } from '@/api/http'

const props = defineProps<{ resourceId: number }>()
defineEmits<{ (event: 'saved'): void }>()

const AGE_LABELS: Record<ResourceAgeGroup, string> = {
  small: '小班',
  middle: '中班',
  large: '大班',
  all: '通用',
}

const loading = ref(false)
const hasDraft = ref(false)

// AI 生成的建议以「草稿」形式存在：不会自动覆盖已保存的资源内容
const draft = reactive<{
  tags: string
  ageGroup: ResourceAgeGroup
  teachingGoals: string
  activitySuggestions: string
}>({
  tags: '',
  ageGroup: 'all',
  teachingGoals: '',
  activitySuggestions: '',
})

async function fetchSuggestion(): Promise<void> {
  loading.value = true
  try {
    const { data } = await resourceApi.aiSuggestion(props.resourceId)
    if (!data) {
      ElMessage.info('当前没有可用的 AI 建议，您也可以手动填写草稿后确认保存。')
      hasDraft.value = true
      return
    }
    fillDraft(data)
    ElMessage.success('已用 AI 建议填充草稿，请确认后保存。')
  } catch (error) {
    ElMessage.warning(`${apiErrorMessage(error, '获取 AI 建议失败')}，可手动填写后保存。`)
    hasDraft.value = true
  } finally {
    loading.value = false
  }
}

/** 「用 AI 建议填充草稿」：仅写入草稿区，不影响已保存的资源内容 */
function fillDraft(suggestion: AiSuggestion): void {
  draft.tags = (suggestion.tags ?? []).join(',')
  draft.ageGroup = suggestion.ageGroup ?? 'all'
  draft.teachingGoals = suggestion.teachingGoals ?? ''
  draft.activitySuggestions = suggestion.activitySuggestions ?? ''
  hasDraft.value = true
}

async function confirmSave(): Promise<void> {
  loading.value = true
  try {
    const payload: AiSuggestion = {
      tags: toArrayField(draft.tags),
      ageGroup: draft.ageGroup,
      teachingGoals: draft.teachingGoals,
      activitySuggestions: draft.activitySuggestions,
    }
    await resourceApi.confirmAiSuggestion(props.resourceId, payload)
    ElMessage.success('AI 教学建议已保存')
    clearDraft()
  } catch (error) {
    ElMessage.error(apiErrorMessage(error, '保存失败，请稍后重试。'))
  } finally {
    loading.value = false
  }
}

function clearDraft(): void {
  draft.tags = ''
  draft.ageGroup = 'all'
  draft.teachingGoals = ''
  draft.activitySuggestions = ''
  hasDraft.value = false
}
</script>

<template>
  <section class="ai-panel">
    <header class="ai-head">
      <h3>🤖 AI 教学建议</h3>
      <div class="ai-actions">
        <ElButton :loading="loading" type="primary" @click="fetchSuggestion">
          获取 AI 建议
        </ElButton>
        <ElButton v-if="hasDraft" :disabled="loading" @click="clearDraft">清除草稿</ElButton>
      </div>
    </header>
    <p class="hint">AI 建议先进入「草稿」，不会自动覆盖已保存的内容，确认无误后再保存。</p>

    <ElForm v-if="hasDraft" label-position="top" class="draft-form">
      <ElFormItem label="标签">
        <ElInput v-model="draft.tags" placeholder="多个标签用逗号分隔" />
      </ElFormItem>
      <ElFormItem label="建议年龄段">
        <ElSelect v-model="draft.ageGroup" class="full">
          <ElOption
            v-for="group in AGE_GROUPS"
            :key="group"
            :label="AGE_LABELS[group] ?? group"
            :value="group"
          />
        </ElSelect>
      </ElFormItem>
      <ElFormItem label="教学目标">
        <ElInput
          v-model="draft.teachingGoals"
          type="textarea"
          :rows="3"
          placeholder="说明该资源可用于达成的教学目标"
        />
      </ElFormItem>
      <ElFormItem label="活动建议">
        <ElInput
          v-model="draft.activitySuggestions"
          type="textarea"
          :rows="4"
          placeholder="基于该资源组织的课堂活动建议"
        />
      </ElFormItem>
      <div class="draft-actions">
        <ElButton type="success" :loading="loading" @click="confirmSave">确认保存</ElButton>
        <ElButton :disabled="loading" @click="clearDraft">取消</ElButton>
      </div>
    </ElForm>
  </section>
</template>

<style scoped>
.ai-panel {
  padding: 18px;
  border: 1px solid #d8ece4;
  border-radius: 12px;
  background: #f4fbf8;
}

.ai-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.ai-head h3 {
  margin: 0;
  font-size: 16px;
}

.ai-actions {
  display: flex;
  gap: 8px;
}

.ai-panel .hint {
  margin: 8px 0 0;
  color: #5c7168;
  font-size: 12px;
}

.draft-form {
  max-width: 560px;
  margin-top: 16px;
}

.draft-form .full {
  width: 100%;
}

.draft-actions {
  display: flex;
  gap: 10px;
}
</style>