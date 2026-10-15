<script setup lang="ts">
import { ref } from 'vue'
import { ElAlert, ElButton, ElInput, ElMessage, ElTag } from 'element-plus'
import { apiErrorMessage } from '@/api/http'
import { useClassroomDirectorStore, type DirectorSuggestion } from '@/stores/classroomDirector'

const director = useClassroomDirectorStore()
const goal = ref('帮助幼儿理解当前环节，并控制课堂节奏')
const editingId = ref<number | null>(null)
const draft = ref('')
const typeLabel: Record<string, string> = {
  question: '提问', grouping: '分组', summary: '总结', transition: '转场',
  resource: '资源', reward: '奖励', pacing: '节奏',
}

async function generate() {
  if (!goal.value.trim()) return ElMessage.warning('请先填写教师当前目标')
  try { await director.generate(goal.value) }
  catch (error) { ElMessage.error(apiErrorMessage(error, '生成建议失败')) }
}
function beginEdit(item: DirectorSuggestion) { editingId.value = item.id; draft.value = item.content }
async function saveEdit(item: DirectorSuggestion) {
  if (!draft.value.trim()) return ElMessage.warning('建议内容不能为空')
  try { await director.edit(item, draft.value); editingId.value = null; ElMessage.success('修改已记录') }
  catch (error) { ElMessage.error(apiErrorMessage(error, '修改失败')) }
}
async function confirm(item: DirectorSuggestion) {
  try { await director.confirm(item); ElMessage.success(item.commandOperation ? '已确认并提交课堂操作' : '建议已确认') }
  catch (error) { ElMessage.error(apiErrorMessage(error, '确认失败，请刷新课堂状态后重试')) }
}
async function reject(item: DirectorSuggestion) {
  try { await director.reject(item); ElMessage.success('已忽略并记录') }
  catch (error) { ElMessage.error(apiErrorMessage(error, '忽略失败')) }
}
</script>

<template>
  <section class="director-panel" data-test="classroom-director-panel">
    <header>
      <div><strong>AI 课堂导演</strong><p>只生成建议，教师确认后才会执行课堂操作</p></div>
      <ElButton type="primary" :loading="director.loading" @click="generate">生成建议</ElButton>
    </header>
    <ElInput v-model="goal" maxlength="500" show-word-limit placeholder="教师当前目标" />
    <ElAlert
      v-if="director.message"
      :title="director.message"
      :type="director.status === 'safety_redirect' ? 'warning' : director.status === 'degraded' ? 'error' : 'success'"
      :closable="false"
      show-icon
    />
    <div class="suggestions">
      <article v-for="item in director.suggestions" :key="item.id" class="suggestion" :class="item.status">
        <div class="suggestion-head">
          <ElTag>{{ typeLabel[item.type] || item.type }}</ElTag><strong>{{ item.title }}</strong>
          <ElTag v-if="item.status !== 'pending'" :type="item.status === 'confirmed' ? 'success' : 'info'">
            {{ item.status === 'confirmed' ? '已确认' : '已忽略' }}
          </ElTag>
        </div>
        <ElInput v-if="editingId === item.id" v-model="draft" type="textarea" :rows="3" maxlength="500" show-word-limit />
        <p v-else class="content">{{ item.content }}</p>
        <small>建议原因：{{ item.rationale }}</small>
        <div v-if="item.status === 'pending'" class="actions">
          <template v-if="editingId === item.id">
            <ElButton :loading="director.busyId === item.id" @click="saveEdit(item)">保存修改</ElButton>
            <ElButton @click="editingId = null">取消</ElButton>
          </template>
          <template v-else>
            <ElButton @click="beginEdit(item)">编辑</ElButton>
            <ElButton type="success" :loading="director.busyId === item.id" @click="confirm(item)">教师确认</ElButton>
            <ElButton type="info" plain :loading="director.busyId === item.id" @click="reject(item)">忽略</ElButton>
          </template>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.director-panel { padding: 20px; border: 1px solid #dce9d5; border-radius: 16px; background: #fffdf9; }
header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
header strong { font-size: 20px; color: #4f3d31; } header p { margin: 4px 0 0; color: #8a786b; font-size: 13px; }
.el-alert { margin-top: 12px; }.suggestions { display: grid; gap: 12px; margin-top: 14px; }
.suggestion { padding: 14px; border: 1px solid #eee2d4; border-radius: 12px; background: #fffaf3; }
.suggestion.confirmed { border-color: #c9e4bd; background: #f5fbf1; }.suggestion.rejected { opacity: .62; }
.suggestion-head { display: flex; align-items: center; gap: 8px; }.content { margin: 10px 0; line-height: 1.65; }
small { color: #8a786b; }.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
</style>
