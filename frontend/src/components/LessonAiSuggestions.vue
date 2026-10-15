<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { ElButton, ElInput, ElInputNumber, ElMessage, ElOption, ElSelect } from 'element-plus'
import { useLessonPlanStore } from '@/stores/lessonPlan'
import { useLessonAiReviewStore, type ReviewField } from '@/stores/lessonAiReview'
const lesson = useLessonPlanStore(); const review = useLessonAiReviewStore()
const emit = defineEmits<{ close: [] }>()
const target = ref(''); const requirements = ref(''); const task = ref<'step_optimization' | 'student_text'>('step_optimization')
const existingDraftId = ref<number | undefined>()
const targetStep = computed(() => lesson.steps.find(s => s.localStepId === review.targetKey))
const edits = reactive<Record<string, Record<string, string | number>>>({})
const fields = [
  { key: 'teacherInstruction' as const, label: '教师建议', source: 'teacherInstructionSuggestion' as const },
  { key: 'studentContent' as const, label: '学生候选', source: 'studentContentCandidate' as const },
]
watch(() => review.suggestion, suggestion => {
  Object.keys(edits).forEach(key => delete edits[key])
  for (const candidate of suggestion?.output.candidates ?? []) edits[candidate.candidateId] = {
    teacherInstruction: candidate.teacherInstructionSuggestion, studentContent: candidate.studentContentCandidate,
    durationSeconds: candidate.durationSecondsSuggestion,
  }
})
watch(() => lesson.current?.id, () => { review.clear(); target.value = '' })
onBeforeUnmount(() => review.clear())
async function generate() { try { await review.generate(target.value, task.value, requirements.value) } catch(e) { ElMessage.warning(e instanceof Error ? e.message : '请检查目标步骤') } }
async function apply(id: string, field: ReviewField, value?: string | number) { try { await review.apply(id, field, value); ElMessage.success('已应用到编辑草稿，尚未保存') } catch(e) { ElMessage.warning(e instanceof Error ? e.message : '应用失败') } }
function decision(id: string, field: ReviewField) { return lesson.aiProvenance.find(r => r.draftId === review.suggestion?.id && r.candidateId === id && r.field === field)?.decision }
const decisionLabel = { accepted: '已接受', modified: '已修改后接受', rejected: '已拒绝' }
</script>

<template>
  <aside class="suggestions" aria-label="AI备课建议">
    <div class="actions"><h2>AI 备课建议</h2><ElButton @click="emit('close')">收起建议</ElButton></div><p>仅供教师审阅。接受只修改编辑草稿，保存仍由你决定。</p>
    <label>目标环节</label><ElSelect v-model="target" placeholder="选择已保存环节" :disabled="review.busy">
      <ElOption v-for="step in lesson.steps.filter(s => s.id)" :key="step.localStepId" :label="step.title || '未命名环节'" :value="step.localStepId!" />
    </ElSelect>
    <label>希望 AI 帮助什么</label><ElSelect v-model="task" :disabled="review.busy"><ElOption label="优化指定环节" value="step_optimization"/><ElOption label="提供学生文字候选" value="student_text"/></ElSelect>
    <ElInput v-model="requirements" type="textarea" :rows="2" maxlength="3000" placeholder="补充要求，例如：用简单提问引导观察"/>
    <ElButton type="primary" :loading="review.busy" :disabled="!target || lesson.saving" @click="generate">生成候选建议</ElButton>
    <small>尚未保存的新步骤，请先人工保存。AI 不会读取未保存修改作为正式版本。</small>
    <label>查看已保存的候选 Draft</label><ElInputNumber v-model="existingDraftId" :min="1"/><ElButton :disabled="!existingDraftId || review.busy" @click="review.loadDraft(existingDraftId!)">读取候选Draft</ElButton>
    <p v-if="review.error" role="alert">{{ review.error }}</p>
    <p v-if="review.stale" role="alert" class="warning">编辑内容已变化，此批建议只能查看或拒绝；请保存必要修改后重新生成。</p>
    <template v-if="review.suggestion">
      <p class="source">Draft #{{ review.suggestion.id }} · 基础 v{{ review.suggestion.output.baseVersion }} · 目标步骤 #{{ review.suggestion.output.targetStepId }}</p>
      <p v-for="warning in review.suggestion.output.warnings" :key="warning" class="warning">{{ warning }}</p>
      <article v-for="candidate in review.suggestion.output.candidates" :key="candidate.candidateId" class="candidate">
        <h3>{{ candidate.title }}</h3><p>{{ candidate.rationale }}</p>
        <section v-for="field in fields" :key="field.key" class="field-review">
          <strong>{{ field.label }}（候选，不会自动填入）</strong>
          <p class="original">当前编辑草稿：{{ targetStep?.[field.key] || '空' }}</p>
          <p class="original">原始建议：{{ candidate[field.source] || '空，不自动清空已有文字' }}</p>
          <ElInput v-if="edits[candidate.candidateId]" v-model="edits[candidate.candidateId]![field.key]" type="textarea" :rows="3" :maxlength="field.key === 'studentContent' ? 1500 : 3000" :aria-label="`修改${field.label}`"/>
          <div class="actions">
            <ElButton :disabled="review.stale || lesson.saving || !candidate[field.source]" @click="apply(candidate.candidateId, field.key)">接受{{ field.label }}</ElButton>
            <ElButton :disabled="review.stale || lesson.saving || !edits[candidate.candidateId]?.[field.key]" @click="apply(candidate.candidateId, field.key, edits[candidate.candidateId]?.[field.key])">修改后接受</ElButton>
            <ElButton :disabled="decision(candidate.candidateId,field.key) === 'accepted' || decision(candidate.candidateId,field.key) === 'modified'" @click="review.reject(candidate.candidateId, field.key)">拒绝</ElButton>
          </div><small v-if="decision(candidate.candidateId,field.key)">{{ decisionLabel[decision(candidate.candidateId,field.key)!] }} · 本地记录，尚未保存</small>
        </section>
        <div class="field-review"><strong>建议时长</strong><ElInputNumber v-if="edits[candidate.candidateId]" :model-value="Number(edits[candidate.candidateId]!.durationSeconds)" @update:model-value="value => edits[candidate.candidateId]!.durationSeconds = value ?? 10" :min="10" :max="7200"/><ElButton :disabled="review.stale || lesson.saving" @click="apply(candidate.candidateId,'durationSeconds',edits[candidate.candidateId]?.durationSeconds)">应用时长</ElButton><ElButton @click="review.reject(candidate.candidateId,'durationSeconds')">拒绝时长</ElButton></div>
        <div v-if="candidate.resourceId" class="field-review">已校验资源 #{{ candidate.resourceId }}<ElButton :disabled="review.stale || lesson.saving" @click="apply(candidate.candidateId,'resourceId')">接受资源引用</ElButton><ElButton @click="review.reject(candidate.candidateId,'resourceId')">拒绝资源</ElButton></div>
      </article>
    </template>
  </aside>
</template>

<style scoped>
.suggestions{padding:22px;border:1px solid #e8dacc;border-radius:20px;background:#fffdf8;color:#493d36;display:grid;gap:12px}.suggestions h2,.candidate h3{margin:0}.suggestions p{margin:0;line-height:1.65}.suggestions small,.source{color:#857263}.candidate{padding:16px;border-radius:16px;border:1px solid #ebdfd4;background:#fff;display:grid;gap:12px}.field-review{display:grid;gap:9px;padding-top:12px;border-top:1px solid #f1e6db}.original{white-space:pre-wrap;font-size:14px;color:#796c61}.actions{display:flex;flex-wrap:wrap;gap:7px}.actions :deep(.el-button){margin-left:0}.warning{padding:10px;border-radius:10px;background:#fff1d6;color:#8f5d24}
</style>
