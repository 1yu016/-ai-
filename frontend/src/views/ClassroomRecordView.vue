<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import {
  ElAlert,
  ElButton,
  ElCard,
  ElInput,
  ElMessage,
  ElMessageBox,
  ElTag,
  ElTimeline,
  ElTimelineItem,
} from 'element-plus'
import { apiErrorMessage, apiErrorStatus } from '@/api/http'
import {
  confirmClassroomSummary,
  discardClassroomSummary,
  ensureClassroomSummaryDraft,
  getClassroomReport,
  getClassroomSummary,
  getClassroomTimeline,
  type ClassroomSummaryContent,
  type ClassroomSummaryDraft,
  type ClassroomTimelineItem,
  type FormalClassroomSummary,
} from '@/services/classroomRecords'

const route = useRoute()
const router = useRouter()
const runId = computed(() => Number(route.params.runId))
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const forbidden = ref(false)
const run = ref<{ title: string; status: string; startedAt: string | null; endedAt: string | null } | null>(null)
const timeline = ref<ClassroomTimelineItem[]>([])
const draft = ref<ClassroomSummaryDraft | null>(null)
const formal = ref<FormalClassroomSummary | null>(null)
const form = reactive<ClassroomSummaryContent>({
  classroomSummary: '',
  participation: '',
  interestPoints: [],
  commonQuestions: [],
  teachingStrategies: [],
})
const timelineCategory = ref<'all' | 'objective' | 'teacher' | 'ai'>('all')
const timelinePage = ref(1)
const timelinePageSize = 12
const baselineForm = ref('')

const canEdit = computed(() => draft.value?.status !== 'discarded')
const formSnapshot = computed(() => JSON.stringify(form))
const hasUnsavedChanges = computed(() => Boolean(baselineForm.value) && formSnapshot.value !== baselineForm.value)

const timelineCategoryLabels = {
  all: '全部',
  objective: '课堂事实',
  teacher: '教师操作',
  ai: 'AI建议与决策',
} as const
const timelineCategoryOf = (item: ClassroomTimelineItem) => {
  if (item.source === 'ai_director' || item.type.startsWith('ai_')) return 'ai'
  if (item.source === 'teacher') return 'teacher'
  return 'objective'
}
const filteredTimeline = computed(() => timeline.value.filter((item) =>
  timelineCategory.value === 'all' || timelineCategoryOf(item) === timelineCategory.value,
))
const timelinePageCount = computed(() => Math.max(1, Math.ceil(filteredTimeline.value.length / timelinePageSize)))
const pagedTimeline = computed(() => {
  const start = (timelinePage.value - 1) * timelinePageSize
  return filteredTimeline.value.slice(start, start + timelinePageSize)
})

function applyContent(content: ClassroomSummaryContent | null) {
  form.classroomSummary = content?.classroomSummary ?? ''
  form.participation = content?.participation ?? ''
  form.interestPoints = [...(content?.interestPoints ?? [])]
  form.commonQuestions = [...(content?.commonQuestions ?? [])]
  form.teachingStrategies = [...(content?.teachingStrategies ?? [])]
  baselineForm.value = JSON.stringify(form)
}

async function load() {
  if (!Number.isInteger(runId.value) || runId.value <= 0) return
  loading.value = true
  error.value = ''
  forbidden.value = false
  try {
    const [timelineData, summaryData] = await Promise.all([
      getClassroomTimeline(runId.value),
      getClassroomSummary(runId.value),
    ])
    run.value = timelineData.run
    timeline.value = timelineData.items
    draft.value = summaryData.draft
    formal.value = summaryData.formalSummary
    if (!draft.value && timelineData.run.status === 'completed') {
      draft.value = await ensureClassroomSummaryDraft(runId.value)
    }
    applyContent(formal.value ?? draft.value)
  } catch (cause) {
    error.value = apiErrorMessage(cause, '课堂记录加载失败')
    forbidden.value = apiErrorStatus(cause) === 403
  } finally {
    loading.value = false
  }
}

function updateList(key: 'interestPoints' | 'commonQuestions' | 'teachingStrategies', value: string) {
  form[key] = value.split('\n').map((item) => item.trim()).filter(Boolean)
}

async function confirm() {
  if (!form.classroomSummary.trim() || !form.participation.trim()) {
    ElMessage.warning('请填写课堂摘要和参与情况')
    return
  }
  saving.value = true
  try {
    const confirmed = await confirmClassroomSummary(runId.value, {
      classroomSummary: form.classroomSummary.trim(),
      participation: form.participation.trim(),
      interestPoints: form.interestPoints,
      commonQuestions: form.commonQuestions,
      teachingStrategies: form.teachingStrategies,
    })
    formal.value = confirmed
    if (draft.value) draft.value.status = 'confirmed'
    baselineForm.value = JSON.stringify(form)
    ElMessage.success('教师正式总结已保存')
  } catch (cause) {
    ElMessage.error(apiErrorMessage(cause, '总结保存失败'))
  } finally {
    saving.value = false
  }
}

async function discard() {
  try {
    await ElMessageBox.confirm('放弃后，该AI草稿不会成为正式课堂记录。', '放弃总结草稿', {
      type: 'warning',
      confirmButtonText: '确认放弃',
      cancelButtonText: '继续编辑',
    })
    await discardClassroomSummary(runId.value)
    if (draft.value) draft.value.status = 'discarded'
    baselineForm.value = formSnapshot.value
    ElMessage.success('已放弃总结草稿')
  } catch (cause) {
    if (cause === 'cancel' || cause === 'close') return
    ElMessage.error(apiErrorMessage(cause, '操作失败'))
  }
}

async function exportReport() {
  try {
    const report = await getClassroomReport(runId.value)
    const url = URL.createObjectURL(new Blob([report.content], { type: 'text/plain;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = report.fileName
    anchor.click()
    URL.revokeObjectURL(url)
    ElMessage.success('课堂报告已导出')
  } catch (cause) {
    ElMessage.error(apiErrorMessage(cause, '报告导出失败'))
  }
}

function timelineType(type: string) {
  if (type === 'error') return 'danger'
  if (type.includes('reward')) return 'warning'
  if (type.includes('question') || type.includes('ai_')) return 'primary'
  return 'success'
}

function changeTimelineCategory(category: 'all' | 'objective' | 'teacher' | 'ai') {
  timelineCategory.value = category
  timelinePage.value = 1
}

function changeTimelinePage(next: number) {
  timelinePage.value = Math.min(Math.max(1, next), timelinePageCount.value)
}

function warnBeforeLeaving(event: BeforeUnloadEvent) {
  if (!hasUnsavedChanges.value) return
  event.preventDefault()
  event.returnValue = ''
}

onBeforeRouteLeave(() => {
  if (!hasUnsavedChanges.value || saving.value) return true
  return window.confirm('当前总结有未保存修改，确定离开吗？')
})

onMounted(() => window.addEventListener('beforeunload', warnBeforeLeaving))
onBeforeUnmount(() => window.removeEventListener('beforeunload', warnBeforeLeaving))

onMounted(load)
</script>

<template>
  <main class="record-page">
    <header>
      <div>
        <small>正式课堂记录</small>
        <h1>{{ run?.title || '课堂记录' }}</h1>
        <p>课堂时间线来自服务端真实操作记录，AI总结需要教师确认后才成为正式记录。</p>
      </div>
      <div class="header-actions">
        <ElButton @click="router.push('/lesson-plans')">返回备课中心</ElButton>
        <ElButton type="primary" :disabled="!formal" @click="exportReport">导出TXT报告</ElButton>
      </div>
    </header>

    <ElAlert v-if="forbidden" title="你没有权限查看这节课堂记录。" type="warning" show-icon :closable="false" />
    <ElAlert v-else-if="error" :title="error" type="error" show-icon :closable="false" />
    <div v-if="loading" class="state">正在汇总课堂记录…</div>
    <section v-else class="record-grid">
      <ElCard class="summary-card" shadow="never">
        <template #header>
          <div class="card-title">
            <strong>{{ formal ? '教师正式总结' : 'AI总结草稿' }}</strong>
            <ElTag v-if="formal" type="success">已确认</ElTag>
            <ElTag v-else-if="draft" :type="draft.status === 'discarded' ? 'info' : 'warning'">
              {{ draft.status === 'discarded' ? '已放弃' : draft.source === 'ai' ? 'AI草稿·待确认' : '安全规则草稿·待确认' }}
            </ElTag>
          </div>
        </template>

        <ElAlert
          title="请只记录课堂事实和教学线索，不填写医疗、心理、智力、人格或品行诊断。"
          type="info"
          :closable="false"
          show-icon
        />
        <label>课堂摘要<ElInput v-model="form.classroomSummary" type="textarea" :rows="4" :disabled="!canEdit" /></label>
        <label>参与情况<ElInput v-model="form.participation" type="textarea" :rows="3" :disabled="!canEdit" /></label>
        <label>兴趣点（每行一项）<ElInput :model-value="form.interestPoints.join('\n')" type="textarea" :rows="3" :disabled="!canEdit" @update:model-value="updateList('interestPoints', String($event))" /></label>
        <label>常见问题（每行一项）<ElInput :model-value="form.commonQuestions.join('\n')" type="textarea" :rows="3" :disabled="!canEdit" @update:model-value="updateList('commonQuestions', String($event))" /></label>
        <label>教学策略建议（每行一项）<ElInput :model-value="form.teachingStrategies.join('\n')" type="textarea" :rows="4" :disabled="!canEdit" @update:model-value="updateList('teachingStrategies', String($event))" /></label>
        <div class="summary-actions">
          <ElButton v-if="!formal && draft?.status === 'pending'" @click="discard">放弃草稿</ElButton>
          <ElButton v-if="canEdit" type="primary" :loading="saving" @click="confirm">
            {{ formal ? '保存正式总结修改' : '确认成为正式总结' }}
          </ElButton>
        </div>
      </ElCard>

      <ElCard class="timeline-card" shadow="never">
        <template #header>
          <div class="timeline-header">
            <strong>课堂时间线</strong>
            <div class="timeline-filters" role="tablist" aria-label="时间线分类">
              <button
                v-for="(label, key) in timelineCategoryLabels"
                :key="key"
                type="button"
                :class="{ active: timelineCategory === key }"
                @click="changeTimelineCategory(key)"
              >{{ label }}</button>
            </div>
          </div>
        </template>
        <ElTimeline v-if="pagedTimeline.length">
          <ElTimelineItem
            v-for="item in pagedTimeline"
            :key="item.key"
            :timestamp="new Date(item.occurredAt).toLocaleString()"
            :type="timelineType(item.type)"
          >
            <div class="timeline-entry">
              <strong>{{ item.title }}</strong>
              <p>{{ item.description }}</p>
              <small>{{ item.source }}</small>
            </div>
          </ElTimelineItem>
        </ElTimeline>
        <div v-else class="state">{{ timeline.length ? '当前分类暂无课堂事件' : '暂无课堂事件' }}</div>
        <div v-if="timelinePageCount > 1" class="timeline-pager">
          <ElButton size="small" :disabled="timelinePage <= 1" @click="changeTimelinePage(timelinePage - 1)">上一页</ElButton>
          <span>第 {{ timelinePage }} / {{ timelinePageCount }} 页 · 共 {{ filteredTimeline.length }} 条</span>
          <ElButton size="small" :disabled="timelinePage >= timelinePageCount" @click="changeTimelinePage(timelinePage + 1)">下一页</ElButton>
        </div>
      </ElCard>
    </section>
  </main>
</template>

<style scoped>
.record-page{min-height:100vh;padding:32px max(20px,4vw);box-sizing:border-box;background:#fffaf2;color:#493d36}header{max-width:1400px;margin:0 auto 24px;display:flex;justify-content:space-between;align-items:flex-start;gap:24px}header small{color:#c27b59;font-weight:800;letter-spacing:.12em}h1{margin:6px 0;font-size:32px}header p{margin:0;color:#8e7768}.header-actions,.card-title,.summary-actions,.timeline-header{display:flex;align-items:center;gap:10px}.timeline-header{justify-content:space-between;flex-wrap:wrap}.timeline-filters{display:flex;gap:6px;flex-wrap:wrap}.timeline-filters button{border:1px solid #efd9c8;border-radius:999px;padding:5px 10px;background:#fffdf9;color:#8e6e5d;cursor:pointer}.timeline-filters button.active{background:#e99168;color:#fff;border-color:#e99168}.record-grid{max-width:1400px;margin:auto;display:grid;grid-template-columns:minmax(0,1fr) minmax(380px,.9fr);gap:22px}.summary-card label{display:grid;gap:7px;margin-top:16px;font-weight:700}.summary-actions{justify-content:flex-end;margin-top:20px}.timeline-card{max-height:calc(100vh - 160px);overflow:auto}.timeline-entry p{margin:5px 0;color:#67564c;line-height:1.6}.timeline-entry small{color:#a08777}.timeline-pager{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:18px;color:#9a7e6e;font-size:13px}.state{padding:32px;text-align:center;color:#967f70}@media(max-width:920px){header{flex-direction:column}.record-grid{grid-template-columns:1fr}.timeline-card{max-height:none}}
</style>
