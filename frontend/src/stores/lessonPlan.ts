import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { apiErrorMessage, http } from '@/api/http'

export const LESSON_AGE_GROUPS = ['3-4', '4-5', '5-6'] as const
export const LESSON_STATUSES = ['draft', 'ready', 'archived'] as const
export const LESSON_STEP_TYPES = ['introduction', 'teacher_talk', 'question', 'resource', 'activity', 'transition', 'summary'] as const
export type LessonAgeGroup = (typeof LESSON_AGE_GROUPS)[number]
export type LessonPlanStatus = (typeof LESSON_STATUSES)[number]
export type LessonStepType = (typeof LESSON_STEP_TYPES)[number]

export type LessonStep = {
  localStepId?: string
  id?: number
  sortOrder: number
  title: string
  stepType: LessonStepType
  instruction: string
  teacherInstruction?: string
  studentContent?: string
  contentReviewRequired?: boolean
  actions?: Array<{ actionType: string; actionName: string; content?: string | null; targetStudentId?: number | null }>
  recoveryPoint?: { name: string; trigger: string; recoveryStepOrder: number; prompt?: string | null; enabled?: boolean } | null
  content?: string | null
  expectedResponse?: string | null
  teacherTip?: string | null
  resourceId?: number | null
  durationSeconds: number
}

export type LessonPlan = {
  id: number
  teacherId: number
  title: string
  theme: string
  lessonType?: 'normal' | 'review' | 'activity' | 'break'
  domain?: string | null
  ageGroup: LessonAgeGroup
  objectives: string
  estimatedMinutes: number
  status: LessonPlanStatus
  version: number
  stepCount?: number
  steps?: LessonStep[]
  createdAt: string
  updatedAt: string
}

export type LessonDraft = Omit<LessonPlan, 'id' | 'teacherId' | 'createdAt' | 'updatedAt'>

function emptyDraft(): LessonDraft {
  return { title: '', theme: '', lessonType: 'normal', domain: '', ageGroup: '4-5', objectives: '', estimatedMinutes: 25, status: 'draft', version: 1, steps: [] }
}

function editableStep(step: LessonStep): LessonStep {
  return { ...step, localStepId: crypto.randomUUID(), teacherInstruction: step.teacherInstruction ?? step.instruction ?? '',
    studentContent: step.contentReviewRequired === false ? step.studentContent ?? '' : '',
    contentReviewRequired: step.contentReviewRequired !== false }
}

export const useLessonPlanStore = defineStore('lessonPlan', () => {
  const items = ref<LessonPlan[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const keyword = ref('')
  const ageGroup = ref<LessonAgeGroup | ''>('')
  const status = ref<LessonPlanStatus | ''>('')
  const loading = ref(false)
  const saving = ref(false)
  const error = ref('')
  const current = ref<LessonPlan | null>(null)
  const draft = ref<LessonDraft>(emptyDraft())
  const dirty = ref(false)
  const editRevision = ref(0)
  const aiProvenance = ref<Array<{ draftId: number; candidateId: string; targetLocalStepId: string;
    field: 'teacherInstruction' | 'studentContent' | 'durationSeconds' | 'resourceId' | 'title'; decision: 'accepted' | 'modified' | 'rejected' }>>([])
  const changeSummary = ref('')
  const versions = ref<Array<{ id: number; versionNo: number; changeSummary: string; createdAt: string; snapshotJson: string }>>([])
  let pendingSave: { fingerprint: string; requestId: string } | null = null
  const aiDraftId = ref<number | null>(null)
  const steps = computed(() => draft.value.steps ?? [])

  async function fetchList() {
    loading.value = true; error.value = ''
    try {
      const { data } = await http.get<{ items: LessonPlan[]; total: number }>('/lesson-plans', { params: { page: page.value, pageSize: pageSize.value, keyword: keyword.value || undefined, ageGroup: ageGroup.value || undefined, status: status.value || undefined } })
      items.value = data.items; total.value = data.total
    } catch (cause) { console.error('加载教案失败：', cause); error.value = apiErrorMessage(cause, '教案加载失败，请稍后重试。') }
    finally { loading.value = false }
  }

  function newDraft() { aiProvenance.value = []; editRevision.value++; current.value = null; aiDraftId.value = null; draft.value = emptyDraft(); dirty.value = false; changeSummary.value = ''; versions.value = []; pendingSave = null }
  async function load(id: number) {
    aiProvenance.value = []; editRevision.value++;
    loading.value = true; error.value = ''
    try { const { data } = await http.get<LessonPlan>(`/lesson-plans/${id}`); current.value = data; aiDraftId.value = null; draft.value = { title: data.title, theme: data.theme, lessonType: data.lessonType ?? 'normal', domain: data.domain ?? '', ageGroup: data.ageGroup, objectives: data.objectives, estimatedMinutes: data.estimatedMinutes, status: data.status, version: data.version, steps: (data.steps ?? []).map(editableStep) }; dirty.value = false; changeSummary.value = ''; pendingSave = null; versions.value = [] }
    catch (cause) { error.value = apiErrorMessage(cause, '教案加载失败，请稍后重试。'); throw cause }
    finally { loading.value = false }
  }
  function markDirty() { dirty.value = true; editRevision.value++ }
  function addStep(step?: Partial<LessonStep>) { steps.value.push({ localStepId: crypto.randomUUID(), sortOrder: steps.value.length + 1, title: step?.title ?? '', stepType: step?.stepType ?? 'teacher_talk', instruction: step?.instruction ?? '', expectedResponse: step?.expectedResponse ?? '', teacherTip: step?.teacherTip ?? '', resourceId: step?.resourceId ?? null, durationSeconds: step?.durationSeconds ?? 120 }); normalizeOrder(); markDirty() }
  function removeStep(index: number) { steps.value.splice(index, 1); normalizeOrder(); markDirty() }
  function copyStep(index: number) { const source = steps.value[index]; if (!source) return; steps.value.splice(index + 1, 0, { ...JSON.parse(JSON.stringify(source)), id: undefined, localStepId: crypto.randomUUID() }); normalizeOrder(); markDirty() }
  function moveStep(index: number, offset: -1 | 1) { const target = index + offset; if (target < 0 || target >= steps.value.length) return; const [step] = steps.value.splice(index, 1); if (step) steps.value.splice(target, 0, step); normalizeOrder(); markDirty() }
  function normalizeOrder() { steps.value.forEach((step, index) => { step.sortOrder = index + 1 }) }

  async function save(): Promise<LessonPlan> {
    if (saving.value) throw new Error('正在保存，请稍候')
    saving.value = true
    try {
      const metadata = { title: draft.value.title.trim(), theme: draft.value.theme.trim(), lessonType: draft.value.lessonType ?? 'normal', domain: draft.value.domain?.trim() || '综合', ageGroup: draft.value.ageGroup, objectives: draft.value.objectives.trim(), estimatedMinutes: draft.value.estimatedMinutes, status: draft.value.status }
      const payload = { ...metadata, ...(current.value ? { version: draft.value.version } : {}),
        aiProvenance: aiProvenance.value.filter(entry => steps.value.some(s => s.localStepId === entry.targetLocalStepId)),
        changeSummary: changeSummary.value.trim() || (current.value ? '教师修改教案' : '创建人工备课教案'),
        steps: steps.value.map((step) => ({
          localStepId: step.localStepId,
          sourceStepId: step.id,
          sortOrder: step.sortOrder,
          title: step.title,
          stepType: step.stepType,
          teacherInstruction: step.teacherInstruction ?? step.instruction ?? '',
          studentContent: step.studentContent ?? '',
          expectedResponse: step.expectedResponse,
          teacherTip: step.teacherTip,
          resourceId: step.resourceId,
          durationSeconds: step.durationSeconds,
          actions: step.actions?.map(action => ({ ...action, content: action.content ?? undefined, targetStudentId: action.targetStudentId ?? undefined })),
          recoveryPoint: step.recoveryPoint ? { ...step.recoveryPoint, prompt: step.recoveryPoint.prompt ?? undefined } : undefined,
        })),
      }
      const fingerprint = JSON.stringify({ id: current.value?.id, payload })
      if (pendingSave?.fingerprint !== fingerprint) pendingSave = { fingerprint, requestId: crypto.randomUUID() }
      const body = { ...payload, requestId: pendingSave.requestId }
      const { data: plan } = current.value
        ? await http.put<LessonPlan>(`/lesson-plans/${current.value.id}/authoring`, body)
        : await http.post<LessonPlan>('/lesson-plans/authoring', body)
      current.value = plan; aiDraftId.value = null; draft.value.version = plan.version; draft.value.steps = (plan.steps ?? []).map(editableStep); dirty.value = false; aiProvenance.value = []; editRevision.value++; pendingSave = null; changeSummary.value = ''
      return plan
    } catch (cause) { throw new Error(apiErrorMessage(cause, '教案保存失败，请稍后重试。'), { cause }) }
    finally { saving.value = false }
  }
  async function remove(id: number) { await http.delete(`/lesson-plans/${id}`); await fetchList() }
  async function fetchVersions() { if (!current.value) return; const { data } = await http.get<typeof versions.value>(`/lesson-plans/${current.value.id}/versions`); versions.value = data }
  async function copy(id: number) { await http.post(`/lesson-plans/${id}/copy`); await fetchList() }
  return { items, total, page, pageSize, keyword, ageGroup, status, loading, saving, error, current, draft, dirty, steps, changeSummary, versions, fetchVersions, fetchList, newDraft, load, markDirty, addStep, removeStep, copyStep, moveStep, save, remove, copy, editRevision, aiProvenance }
})
