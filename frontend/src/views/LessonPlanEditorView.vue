<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { ElButton, ElDialog, ElForm, ElFormItem, ElInput, ElInputNumber, ElMessage, ElOption, ElSelect } from 'element-plus'
import LessonResourceSelector from '@/components/LessonResourceSelector.vue'
import ResourcePlayer from '@/components/ResourcePlayer.vue'
import { useLessonPlanStore, type LessonStep } from '@/stores/lessonPlan'
import { useCourseResourceStore, type CourseResource } from '@/stores/courseResource'

const route = useRoute(); const router = useRouter(); const store = useLessonPlanStore(); const resources = useCourseResourceStore()
const { draft, dirty, saving, loading } = storeToRefs(store)
const selectorOpen = ref(false); const selectedStepIndex = ref(-1)
const aiDialogOpen = ref(false); const aiTheme = ref(''); const aiObjectives = ref(''); const aiDomain = ref('')
const isEdit = computed(() => Number.isInteger(Number(route.params.id)))
const stepTypeText: Record<string,string> = { introduction:'导入', teacher_talk:'教师讲述', question:'提问', resource:'资源', activity:'活动', transition:'过渡', summary:'总结' }
const selectedResource = (id?: number | null) => resources.sortedResources.find((item) => item.id === id)
function selectResource(index: number) { selectedStepIndex.value = index; selectorOpen.value = true }
function updateResource(value: number | null) { const step = store.steps[selectedStepIndex.value]; if (!step) return; step.resourceId = value; store.markDirty() }
function preview(step: LessonStep) { const resource = selectedResource(step.resourceId); if (resource) resourcesPlayer(resource) }
function resourcesPlayer(resource: CourseResource) { import('@/stores/resourcePlayer').then(({ useResourcePlayerStore }) => useResourcePlayerStore().openResource(resource, false)) }
function validate(): string | null { if (!draft.value.title.trim()) return '请填写教案标题'; if (!draft.value.theme.trim()) return '请填写课堂主题'; if (!draft.value.objectives.trim()) return '请填写教学目标'; for (const [index, step] of store.steps.entries()) { if (!step.title.trim()) return `第 ${index + 1} 个步骤缺少标题`; if (!step.instruction.trim()) return `第 ${index + 1} 个步骤缺少指导语`; if (step.stepType === 'resource' && !step.resourceId) return `第 ${index + 1} 个资源步骤尚未选择资源` } return null }
async function save() { const problem = validate(); if (problem) return ElMessage.warning(problem); try { const plan = await store.save(); ElMessage.success('教案已保存'); if (!isEdit.value) await router.replace(`/lesson-plans/${plan.id}/edit`) } catch (e) { ElMessage.error(e instanceof Error ? e.message : '保存失败') } }
function openAiDraftDialog() { aiTheme.value = ''; aiObjectives.value = ''; aiDomain.value = draft.value.domain ?? ''; aiDialogOpen.value = true }
async function aiDraft() { const theme = aiTheme.value.trim(); if (!theme) return ElMessage.warning('请先输入活动主题'); try { const ids = resources.sortedResources.filter((item) => typeof item.id === 'number').map((item) => Number(item.id)); await store.generateDraft(ids, { theme, domain: aiDomain.value, objectives: aiObjectives.value }); aiDialogOpen.value = false; ElMessage.success('AI 草稿已生成，请检查和编辑后再保存') } catch (e) { ElMessage.error(e instanceof Error ? e.message : 'AI 生成失败') } }
function beforeUnload(event: BeforeUnloadEvent) { if (!dirty.value) return; event.preventDefault(); event.returnValue = '' }
onBeforeRouteLeave(() => !dirty.value || window.confirm('存在未保存的内容，确定离开吗？'))
onMounted(async () => {
  window.addEventListener('beforeunload', beforeUnload)
  if (!isEdit.value) store.newDraft()
  const tasks: Promise<unknown>[] = [resources.refreshLibrary()]
  if (isEdit.value) tasks.push(store.load(Number(route.params.id)).catch((e) => ElMessage.error(e instanceof Error ? e.message : '加载失败')))
  await Promise.all(tasks)
})
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
</script>

<template>
  <main class="editor"><header><div><button class="back" @click="router.push('/lesson-plans')">← 返回备课中心</button><h1>{{ isEdit ? '编辑教案' : '新建教案' }}</h1><p>AI 生成的是本地草稿，只有点击保存才会写入教案库。</p></div><div class="top-actions"><ElButton :loading="loading" @click="openAiDraftDialog">✨ AI 生成草稿</ElButton><ElButton type="primary" :loading="saving" :disabled="saving" @click="save">保存教案</ElButton></div></header>
    <section class="panel"><h2>课堂基础信息</h2><ElForm label-position="top" class="form"><ElFormItem label="教案标题"><ElInput v-model="draft.title" maxlength="200" @input="store.markDirty"/></ElFormItem><ElFormItem label="主题"><ElInput v-model="draft.theme" maxlength="200" @input="store.markDirty"/></ElFormItem><ElFormItem label="年龄段"><ElSelect v-model="draft.ageGroup" @change="store.markDirty"><ElOption label="3-4岁" value="3-4"/><ElOption label="4-5岁" value="4-5"/><ElOption label="5-6岁" value="5-6"/></ElSelect></ElFormItem><ElFormItem label="预计时长（分钟）"><ElInputNumber v-model="draft.estimatedMinutes" :min="5" :max="120" @change="store.markDirty"/></ElFormItem><ElFormItem class="wide" label="教学目标"><ElInput v-model="draft.objectives" type="textarea" :rows="3" maxlength="3000" show-word-limit @input="store.markDirty"/></ElFormItem><ElFormItem label="状态"><ElSelect v-model="draft.status" @change="store.markDirty"><ElOption label="草稿" value="draft"/><ElOption label="可上课" value="ready"/><ElOption label="已归档" value="archived"/></ElSelect></ElFormItem></ElForm></section>
    <section class="panel"><div class="section-head"><div><h2>课堂步骤</h2><p>使用上移、下移调整顺序，无需拖拽。</p></div><ElButton type="primary" plain @click="store.addStep()">新增步骤</ElButton></div>
      <div v-if="!store.steps.length" class="empty">还没有步骤。可以手动新增，或让 AI 生成草稿。</div>
      <article v-for="(step,index) in store.steps" :key="step.id ?? `new-${index}`" class="step"><div class="step-index">{{ index + 1 }}</div><div class="step-body"><div class="step-row"><ElInput v-model="step.title" class="step-title-input" placeholder="环节标题" maxlength="200" @input="store.markDirty"/><ElSelect v-model="step.stepType" class="step-type-select" @change="store.markDirty"><ElOption v-for="(text,type) in stepTypeText" :key="type" :label="text" :value="type"/></ElSelect><ElInputNumber v-model="step.durationSeconds" :min="10" :max="7200" :step="30" @change="store.markDirty"/><span>秒</span></div><ElInput v-model="step.instruction" type="textarea" :rows="2" maxlength="3000" placeholder="教师指导语（必填）" @input="store.markDirty"/><div v-if="step.stepType === 'question'" class="step-row"><ElInput v-model="step.expectedResponse" placeholder="预期回答" @input="store.markDirty"/><ElInput v-model="step.teacherTip" placeholder="教师提示" @input="store.markDirty"/></div><div v-if="step.stepType === 'resource'" class="resource-line"><span>{{ selectedResource(step.resourceId)?.title ?? (step.resourceId ? '资源已失效' : '尚未选择资源') }}</span><ElButton @click="selectResource(index)">{{ step.resourceId ? '更换资源' : '选择资源' }}</ElButton><ElButton :disabled="!selectedResource(step.resourceId)" @click="preview(step)">预览</ElButton></div></div><div class="step-actions"><ElButton circle :disabled="index===0" @click="store.moveStep(index,-1)">↑</ElButton><ElButton circle :disabled="index===store.steps.length-1" @click="store.moveStep(index,1)">↓</ElButton><ElButton circle @click="store.copyStep(index)">⧉</ElButton><ElButton circle type="danger" plain @click="store.removeStep(index)">×</ElButton></div></article>
    </section>
    <ElDialog v-model="aiDialogOpen" title="AI 生成教案草稿" width="min(520px, 92vw)" :close-on-click-modal="false" :teleported="false">
      <div class="ai-draft-dialog">
        <p>先告诉 AI 本次活动的主题，它会生成教案标题、教学目标和完整课堂步骤。</p>
        <ElForm label-position="top">
          <ElFormItem label="活动主题（必填）" required>
            <ElInput v-model="aiTheme" maxlength="200" show-word-limit autofocus placeholder="例如：春天里的小花" @keyup.enter="aiDraft" />
          </ElFormItem>
          <ElFormItem label="教学领域"><ElInput v-model="aiDomain" maxlength="100" placeholder="例如：科学、语言、艺术" /></ElFormItem>
          <ElFormItem label="教学目标或补充要求（可选）">
            <ElInput v-model="aiObjectives" type="textarea" :rows="3" maxlength="1000" show-word-limit placeholder="可以留空，由 AI 根据主题自动编写" />
          </ElFormItem>
        </ElForm>
        <div class="ai-context">将按当前设置生成：{{ draft.ageGroup }}岁 · {{ draft.estimatedMinutes }}分钟</div>
      </div>
      <template #footer><ElButton :disabled="loading" @click="aiDialogOpen=false">取消</ElButton><ElButton type="primary" :loading="loading" :disabled="!aiTheme.trim()" @click="aiDraft">开始生成</ElButton></template>
    </ElDialog>
    <LessonResourceSelector v-model:open="selectorOpen" :model-value="store.steps[selectedStepIndex]?.resourceId" @update:model-value="updateResource" />
    <ResourcePlayer :resources="resources.sortedResources" />
  </main>
</template>

<style scoped>
.editor{min-height:100vh;padding:30px max(20px,5vw) 70px;box-sizing:border-box;background:#fffaf2;color:#493d36;position:relative}header{max-width:1200px;margin:auto;display:flex;justify-content:space-between;align-items:end;gap:20px}h1{margin:8px 0 4px;font-size:30px}header p,.section-head p{margin:0;color:#90796a}.back{border:0;background:none;color:#ad684d;cursor:pointer;font-weight:700}.top-actions{display:flex;gap:10px}.panel{max-width:1200px;margin:22px auto 0;padding:24px;box-sizing:border-box;border:1px solid #f0dfd0;border-radius:22px;background:#fff;box-shadow:0 10px 32px #82542d0d}.panel h2{margin:0 0 18px}.form{display:grid;grid-template-columns:2fr 1.3fr 1fr 1fr;gap:0 15px}.form .wide{grid-column:1/4}.section-head{display:flex;justify-content:space-between;align-items:center}.step{display:grid;grid-template-columns:42px 1fr auto;gap:14px;margin-top:14px;padding:16px;border:1px solid #ead8ca;border-radius:16px;background:#fffcf8}.step-index{display:grid;width:36px;height:36px;place-items:center;border-radius:12px;background:#ffe6d6;color:#a95e43;font-weight:800}.step-body{display:grid;gap:10px;min-width:0}.step-row{display:flex;align-items:center;gap:10px}.step-row>:first-child{flex:1}.step-title-input{min-width:200px}.step-type-select{width:220px;flex:none}.step-actions{display:flex;flex-direction:column;gap:5px}.resource-line{display:flex;align-items:center;gap:8px;padding:10px;border-radius:11px;background:#fff3e9}.resource-line span{flex:1;color:#80695b}.empty{text-align:center;padding:34px;color:#9a8373;background:#fffaf4;border-radius:14px}.ai-draft-dialog>p{margin:0 0 18px;color:#80695b;line-height:1.65}.ai-context{padding:11px 13px;border-radius:10px;background:#fff5e9;color:#9a674e;font-size:14px}@media(max-width:760px){header{align-items:flex-start;flex-direction:column}.form{grid-template-columns:1fr}.form .wide{grid-column:auto}.step{grid-template-columns:36px 1fr}.step-actions{grid-column:2;flex-direction:row}.step-row{align-items:stretch;flex-direction:column}.step-title-input,.step-type-select{width:100%;min-width:0}.resource-line{flex-wrap:wrap}}
</style>
