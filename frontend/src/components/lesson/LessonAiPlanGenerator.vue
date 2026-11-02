<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElDialog, ElButton, ElInput, ElInputNumber, ElSelect, ElOption } from 'element-plus'
import { http, apiErrorMessage } from '@/api/http'
const open = defineModel<boolean>({ default: false })
const props = defineProps<{ theme: string; ageGroup: string; minutes: number; objectives: string; hasUnsaved: boolean }>()
const emit = defineEmits<{ created: [id: number] }>()
const theme = ref(''), objectives = ref(''), domain = ref('科学'), requirements = ref(''), age = ref('4-5'), minutes = ref(25)
const busy = ref(false), confirming = ref(false), error = ref('')
const candidate = ref<{ id: number; output: Record<string, unknown> } | null>(null)
let epoch = 0
watch(open, value => {
  epoch++; error.value = ''; candidate.value = null; busy.value = false
  if (value) { theme.value = props.theme; objectives.value = props.objectives; age.value = props.ageGroup; minutes.value = props.minutes }
})
async function generate() {
  if (busy.value || confirming.value) return
  if (!theme.value.trim() || !objectives.value.trim()) { error.value = '请填写课程主题和教学目标'; return }
  const current = ++epoch; busy.value = true; error.value = ''; candidate.value = null
  try {
    const { data } = await http.post('/lesson-plans/ai-drafts', {
      theme: theme.value.trim(), ageGroup: age.value, domain: domain.value.trim() || '综合',
      durationMinutes: minutes.value, teachingObjectives: objectives.value.trim(),
      teacherRequirements: requirements.value, resourceIds: [],
    }, { timeout: 110000 })
    if (current !== epoch || !open.value) return
    if (data.status !== 'generated' || !Number.isInteger(data.id) || !data.output || typeof data.output.title !== 'string')
      throw new Error('生成结果不完整，请重试；未创建教案')
    candidate.value = data
  } catch (e) { if (current === epoch) error.value = apiErrorMessage(e, 'AI教案生成不可用，请检查已获准的模型配置，或继续手动备课') }
  finally { if (current === epoch) busy.value = false }
}
async function confirm() {
  if (!candidate.value || busy.value || confirming.value) return
  if (props.hasUnsaved && !window.confirm('当前页面有未保存内容。确认另建AI教案并离开当前草稿？')) return
  confirming.value = true; error.value = ''
  try {
    const { data } = await http.post('/lesson-plans/ai-drafts/' + candidate.value.id + '/confirm', {})
    if (!Number.isInteger(data.id)) throw new Error('教案创建结果未确认，请检查教案列表')
    open.value = false; emit('created', data.id)
  } catch (e) { error.value = apiErrorMessage(e, '教案创建未确认，请重试或检查教案列表') }
  finally { confirming.value = false }
}
</script>
<template>
  <ElDialog v-model="open" title="AI生成教案" width="min(760px, 95vw)" :close-on-click-modal="false" :show-close="!confirming" :close-on-press-escape="!confirming">
    <p>生成完整教案草稿，先预览，再由教师确认创建。不会直接发布或启动课堂；学生展示文字仍需教师审核。</p>
    <p>需要后台已获准的模型配置；本入口不会自动开通或切换收费服务。未配置时可继续人工备课。</p>
    <label>课程主题<ElInput v-model="theme" aria-label="AI课程主题" maxlength="200" :disabled="busy || confirming" /></label>
    <label>年龄段<ElSelect v-model="age" aria-label="AI教案年龄段"><ElOption v-for="v in ['3-4','4-5','5-6']" :key="v" :value="v" :label="v+'岁'" /></ElSelect></label>
    <label>教学领域<ElInput v-model="domain" aria-label="AI教学领域" maxlength="100" /></label>
    <label>预计时长（分钟）<ElInputNumber v-model="minutes" :min="5" :max="120" /></label>
    <label>教学目标<ElInput v-model="objectives" aria-label="AI教学目标" type="textarea" maxlength="3000" /></label>
    <label>补充要求<ElInput v-model="requirements" aria-label="AI补充要求" type="textarea" maxlength="3000" /></label>
    <p v-if="error" role="alert">{{ error }}</p>
    <ElButton :loading="busy" :disabled="busy || confirming" @click="generate">生成完整教案草稿</ElButton>
    <section v-if="candidate" aria-label="AI教案预览"><h3>{{ candidate.output.title }}</h3><pre>{{ JSON.stringify(candidate.output, null, 2) }}</pre><ElButton type="primary" :loading="confirming" :disabled="confirming" @click="confirm">确认创建教案</ElButton></section>
    <template #footer><ElButton :disabled="confirming" @click="open=false">关闭，保留当前编辑内容</ElButton></template>
  </ElDialog>
</template>
<style scoped>label{display:grid;gap:6px;margin:12px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#fff8ed;padding:16px;max-height:340px;overflow:auto}[role=alert]{color:#b3423a}</style>
