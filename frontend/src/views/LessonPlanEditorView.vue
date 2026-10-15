<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { ElButton, ElDialog, ElForm, ElFormItem, ElInput, ElInputNumber, ElMessage, ElOption, ElSelect } from 'element-plus'
import LessonResourceSelector from '@/components/LessonResourceSelector.vue'
import LessonAiSuggestions from '@/components/LessonAiSuggestions.vue'
import LessonReferenceSelector from '@/components/LessonReferenceSelector.vue'
import type { EvidencePack } from '@/api/lessonEvidence'
import ManagementLayout from '@/components/ManagementLayout.vue'
import PageShell from '@/components/PageShell.vue'
import BackButton from '@/components/BackButton.vue'
import ResourcePlayer from '@/components/ResourcePlayer.vue'
import { useLessonPlanStore, type LessonStep } from '@/stores/lessonPlan'
import { useCourseResourceStore, type CourseResource } from '@/stores/courseResource'

const route = useRoute(); const router = useRouter(); const store = useLessonPlanStore(); const resources = useCourseResourceStore()
const { draft, dirty, saving, loading } = storeToRefs(store)
const selectorOpen = ref(false); const selectedStepIndex = ref(-1)
const historyOpen = ref(false); const historyBusy = ref(false); const historyError = ref('')
const suggestionsOpen = ref(false)
const referencesOpen = ref(false); const referencePack = ref<EvidencePack|null>(null)
watch(()=>[store.current?.id,draft.value.version],()=>{referencePack.value=null})
async function showHistory() { historyOpen.value = true; historyBusy.value = true; historyError.value = ''; try { await store.fetchVersions() } catch { historyError.value = '版本历史加载失败，请重试。' } finally { historyBusy.value = false } }
function historySteps(json: string) { try { return JSON.parse(json).steps as LessonStep[] } catch { return [] } }
function historySources(json: string): Array<{ draftId: number; field: string; decision: string; baseVersion: number; matchesSuggestion: boolean }> { try { return JSON.parse(json).aiProvenance ?? [] } catch { return [] } }
const isEdit = computed(() => Number.isInteger(Number(route.params.id)))
const stepTypeText: Record<string,string> = { introduction:'导入', teacher_talk:'教师讲述', question:'提问', resource:'资源', activity:'活动', transition:'过渡', summary:'总结' }
// Stage 6.6：回显查找优先用缓存感知的 getResourceById（覆盖不在前 100 条已加载列表的资源）。
const selectedResource = (id?: number | null) => (id == null ? null : resources.getResourceById(id))
function selectResource(index: number) { selectedStepIndex.value = index; selectorOpen.value = true }
function updateResource(value: number | null) { const step = store.steps[selectedStepIndex.value]; if (!step) return; step.resourceId = value; store.markDirty(); if (value != null) void resources.ensureResourceById(value).catch(() => ElMessage.warning('资源详情加载失败，保存时将重新校验可用性')) }
// 编辑已有教案时预加载所有已绑定资源，保证 >100 条场景下也能正确回显标题（失败静默，回显兜底为“资源已失效”）。
function preloadBoundResources() {
  for (const step of store.steps) {
    const id = step.resourceId
    if (id != null && !resources.getResourceById(id)) {
      void resources.ensureResourceById(Number(id)).catch(() => undefined)
    }
  }
}
function preview(step: LessonStep) { const resource = selectedResource(step.resourceId); if (resource) resourcesPlayer(resource) }
function resourcesPlayer(resource: CourseResource) { import('@/stores/resourcePlayer').then(({ useResourcePlayerStore }) => useResourcePlayerStore().openResource(resource, false)) }
function validate(): string | null { if (!draft.value.title.trim()) return '请填写教案标题'; if (!draft.value.theme.trim()) return '请填写课堂主题'; if (!draft.value.objectives.trim()) return '请填写教学目标'; for (const [index, step] of store.steps.entries()) { if (!step.title.trim()) return `第 ${index + 1} 个步骤缺少标题`; if (!(step.teacherInstruction ?? '').trim()) return `第 ${index + 1} 个步骤缺少教师指导语`; if (step.stepType === 'resource' && !step.resourceId) return `第 ${index + 1} 个资源步骤尚未选择资源` } return null }
async function save() { const problem = validate(); if (problem) return ElMessage.warning(problem); try { const plan = await store.save(); ElMessage.success('教案已保存'); if (!isEdit.value) await router.replace({ name: 'lesson-plan-edit', params: { id: plan.id }, query: route.query }) } catch (e) { ElMessage.error(e instanceof Error ? e.message : '保存失败') } }
function beforeUnload(event: BeforeUnloadEvent) { if (!dirty.value) return; event.preventDefault(); event.returnValue = '' }
onBeforeRouteLeave(() => !dirty.value || window.confirm('存在未保存的内容，确定离开吗？'))
onMounted(async () => {
  window.addEventListener('beforeunload', beforeUnload)
  if (!isEdit.value) store.newDraft()
  const tasks: Promise<unknown>[] = []
  if (isEdit.value) tasks.push(store.load(Number(route.params.id)).catch((e) => ElMessage.error(e instanceof Error ? e.message : '加载失败')))
  await Promise.all(tasks)
  preloadBoundResources()
})
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
</script>

<template>
  <ManagementLayout>
  <PageShell variant="wide">
  <main class="editor"><header><div><BackButton label="返回备课中心" /><h1>{{ isEdit ? '编辑教案' : '新建教案' }}</h1><p>教师指导与学生展示分开编写 · {{ store.current ? `当前版本 v${draft.version}` : '尚未保存' }}</p></div><div class="top-actions"><ElButton :disabled="!store.current" @click="referencesOpen=true">参考课堂经验</ElButton><ElButton @click="suggestionsOpen = !suggestionsOpen">{{ suggestionsOpen ? '收起AI建议' : 'AI备课建议' }}</ElButton><ElButton :disabled="!store.current" @click="showHistory">版本历史</ElButton><ElButton type="primary" :loading="saving" :disabled="saving || loading || !!store.error" @click="save">保存教案</ElButton></div></header>
    <section v-if="suggestionsOpen" class="ai-review-sidebar"><LessonAiSuggestions @close="suggestionsOpen=false"/></section>
    <p v-if="referencePack" class="reference-notice">本地参考：已选 {{referencePack.sourceManifest.length}} 次课堂 · 基础 v{{referencePack.baseVersion}}（不修改教案，不发送AI）<ElButton text @click="referencePack=null">移除参考</ElButton></p>
    <LessonReferenceSelector v-model:open="referencesOpen" :plan-id="store.current?.id ?? null" :base-version="draft.version" @selected="referencePack=$event"/>
    <p v-if="store.error" role="alert">{{ store.error }}</p>
    <section class="panel"><h2>课堂基础信息</h2><ElForm label-position="top" class="form"><ElFormItem label="教案标题"><ElInput v-model="draft.title" maxlength="200" @input="store.markDirty"/></ElFormItem><ElFormItem label="主题"><ElInput v-model="draft.theme" maxlength="200" @input="store.markDirty"/></ElFormItem><ElFormItem label="年龄段"><ElSelect v-model="draft.ageGroup" @change="store.markDirty"><ElOption label="3-4岁" value="3-4"/><ElOption label="4-5岁" value="4-5"/><ElOption label="5-6岁" value="5-6"/></ElSelect></ElFormItem><ElFormItem label="预计时长（分钟）"><ElInputNumber v-model="draft.estimatedMinutes" :min="5" :max="120" @change="store.markDirty"/></ElFormItem><ElFormItem class="wide" label="教学目标"><ElInput v-model="draft.objectives" type="textarea" :rows="3" maxlength="3000" show-word-limit @input="store.markDirty"/></ElFormItem><ElFormItem label="状态"><ElSelect v-model="draft.status" @change="store.markDirty"><ElOption label="草稿" value="draft"/><ElOption label="可上课" value="ready"/><ElOption label="已归档" value="archived"/></ElSelect></ElFormItem></ElForm></section>
    <section class="panel"><div class="section-head"><div><h2>课堂步骤</h2><p>使用上移、下移调整顺序，无需拖拽。</p></div><ElButton type="primary" plain @click="store.addStep()">新增步骤</ElButton></div>
      <div v-if="!store.steps.length" class="empty">还没有步骤。请新增环节，再选择已有审核资源。</div>
      <article v-for="(step,index) in store.steps" :key="step.localStepId" class="step"><div class="step-index">{{ index + 1 }}</div><div class="step-body"><div class="step-row"><ElInput v-model="step.title" class="step-title-input" placeholder="环节标题" maxlength="200" @input="store.markDirty"/><ElSelect v-model="step.stepType" class="step-type-select" @change="store.markDirty"><ElOption v-for="(text,type) in stepTypeText" :key="type" :label="text" :value="type"/></ElSelect><ElInputNumber v-model="step.durationSeconds" :min="10" :max="7200" :step="30" @change="store.markDirty"/><span>秒</span></div><ElInput v-model="step.teacherInstruction" type="textarea" :rows="2" maxlength="3000" placeholder="教师指导语（仅教师可见，必填）" @input="store.markDirty"/><p v-if="step.contentReviewRequired" role="note">历史教案需要复核：学生内容未自动填充，留空则不展示该段文字。</p><label>学生展示内容（可留空，不会用教师指导语补齐）</label><ElInput v-model="step.studentContent" type="textarea" :rows="2" maxlength="3000" placeholder="学生在大屏上看到的文字" @input="store.markDirty"/><small v-if="step.actions?.length || step.recoveryPoint">动作 {{ step.actions?.length || 0 }} 项 · 恢复点 {{ step.recoveryPoint?.name || '无' }}（保存时保留）</small><div v-if="step.stepType === 'question'" class="step-row"><ElInput v-model="step.expectedResponse" placeholder="预期回答" @input="store.markDirty"/><ElInput v-model="step.teacherTip" placeholder="教师提示" @input="store.markDirty"/></div><div v-if="step.stepType === 'resource'" class="resource-line"><span>{{ selectedResource(step.resourceId)?.title ?? (step.resourceId ? '资源已失效' : '尚未选择资源') }}</span><ElButton @click="selectResource(index)">{{ step.resourceId ? '更换资源' : '选择资源' }}</ElButton><ElButton :disabled="!selectedResource(step.resourceId)" @click="preview(step)">预览</ElButton></div></div><div class="step-actions"><ElButton circle :disabled="index===0" @click="store.moveStep(index,-1)">↑</ElButton><ElButton circle :disabled="index===store.steps.length-1" @click="store.moveStep(index,1)">↓</ElButton><ElButton circle @click="store.copyStep(index)">⧉</ElButton><ElButton circle type="danger" plain @click="store.removeStep(index)">×</ElButton></div></article>
    </section>
    <section class="panel"><h2>本次修改说明</h2><ElInput v-model="store.changeSummary" maxlength="500" placeholder="例如：调整互动顺序，更换图片" @input="store.markDirty"/></section>
    <ElDialog v-model="historyOpen" title="教案版本历史（只读）" width="min(800px,94vw)">
      <p v-if="historyBusy">正在加载…</p><p v-if="historyError" role="alert">{{ historyError }}<ElButton @click="showHistory">重试</ElButton></p>
      <details v-for="version in store.versions" :key="version.id"><summary>v{{ version.versionNo }} · {{ version.changeSummary }} · {{ version.createdAt }}</summary>
        <p v-for="(source,i) in historySources(version.snapshotJson)" :key="`source-${i}`">AI来源 Draft #{{ source.draftId }} · 基础 v{{ source.baseVersion }} · {{ source.field }} · {{ source.decision }} · {{ source.matchesSuggestion ? '保留建议内容' : '未按原建议保存／教师有调整' }}</p>
        <article v-for="(step,i) in historySteps(version.snapshotJson)" :key="i"><strong>{{ i+1 }}. {{ step.title }}</strong><p>教师指导：{{ step.instruction }}</p><p>存档内容：{{ step.content || '空' }}</p><small>历史存档仅供教师查看，不代表已复核的学生展示内容。</small></article>
      </details>
    </ElDialog>
    <LessonResourceSelector v-model:open="selectorOpen" :model-value="store.steps[selectedStepIndex]?.resourceId" @update:model-value="updateResource" />
    <ResourcePlayer :resources="resources.sortedResources" />
  </main>
  </PageShell>
  </ManagementLayout>
</template>

<style scoped>
.ai-review-sidebar{position:fixed;z-index:20;right:18px;top:110px;bottom:20px;width:min(430px,calc(100vw - 36px));overflow:auto;box-shadow:0 16px 48px #493d3620;border-radius:20px}.editor{min-width:0;padding-bottom:42px;box-sizing:border-box;color:#493d36;position:relative}header{display:flex;justify-content:space-between;align-items:end;gap:20px}h1{margin:8px 0 4px;font-size:30px}header p,.section-head p{margin:0;color:#90796a}.back{border:0;background:none;color:#ad684d;cursor:pointer;font-weight:700}.top-actions{display:flex;gap:10px}.panel{margin:22px auto 0;padding:24px;box-sizing:border-box;border:1px solid #f0dfd0;border-radius:22px;background:#fff;box-shadow:0 10px 32px #82542d0d}.panel h2{margin:0 0 18px}.form{display:grid;grid-template-columns:2fr 1.3fr 1fr 1fr;gap:0 15px}.form .wide{grid-column:1/4}.section-head{display:flex;justify-content:space-between;align-items:center}.step{display:grid;grid-template-columns:42px minmax(0,1fr) auto;gap:14px;margin-top:14px;padding:16px;border:1px solid #ead8ca;border-radius:16px;background:#fffcf8}.step-index{display:grid;width:36px;height:36px;place-items:center;border-radius:12px;background:#ffe6d6;color:#a95e43;font-weight:800}.step-body{display:grid;gap:10px;min-width:0}.step-row{display:flex;align-items:center;gap:10px}.step-row>:first-child{flex:1}.step-title-input{min-width:200px}.step-type-select{width:220px;flex:none}.step-actions{display:flex;flex-direction:column;gap:5px}.resource-line{display:flex;align-items:center;gap:8px;padding:10px;border-radius:11px;background:#fff3e9}.resource-line span{flex:1;color:#80695b}.empty{text-align:center;padding:34px;color:#9a8373;background:#fffaf4;border-radius:14px}.ai-draft-dialog>p{margin:0 0 18px;color:#80695b;line-height:1.65}.ai-context{padding:11px 13px;border-radius:10px;background:#fff5e9;color:#9a674e;font-size:14px}@media(max-width:760px){header{align-items:flex-start;flex-direction:column}.form{grid-template-columns:1fr}.form .wide{grid-column:auto}.step{grid-template-columns:36px minmax(0,1fr)}.step-actions{grid-column:2;flex-direction:row}.step-row{align-items:stretch;flex-direction:column}.step-title-input,.step-type-select{width:100%;min-width:0}.resource-line{flex-wrap:wrap}}
</style>
