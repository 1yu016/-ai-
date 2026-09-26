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
  id?: number
  sortOrder: number
  title: string
  stepType: LessonStepType
  instruction: string
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
  return { title: '', theme: '', ageGroup: '4-5', objectives: '', estimatedMinutes: 25, status: 'draft', version: 1, steps: [] }
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
  const steps = computed(() => draft.value.steps ?? [])

  async function fetchList() {
    loading.value = true; error.value = ''
    try {
      const { data } = await http.get<{ items: LessonPlan[]; total: number }>('/lesson-plans', { params: { page: page.value, pageSize: pageSize.value, keyword: keyword.value || undefined, ageGroup: ageGroup.value || undefined, status: status.value || undefined } })
      items.value = data.items; total.value = data.total
    } catch (cause) { console.error('加载教案失败：', cause); error.value = apiErrorMessage(cause, '教案加载失败，请稍后重试。') }
    finally { loading.value = false }
  }

  function newDraft() { current.value = null; draft.value = emptyDraft(); dirty.value = false }
  async function load(id: number) {
    loading.value = true; error.value = ''
    try { const { data } = await http.get<LessonPlan>(`/lesson-plans/${id}`); current.value = data; draft.value = { title: data.title, theme: data.theme, ageGroup: data.ageGroup, objectives: data.objectives, estimatedMinutes: data.estimatedMinutes, status: data.status, version: data.version, steps: (data.steps ?? []).map((step) => ({ ...step })) }; dirty.value = false }
    catch (cause) { error.value = apiErrorMessage(cause, '教案加载失败，请稍后重试。'); throw cause }
    finally { loading.value = false }
  }
  function markDirty() { dirty.value = true }
  function addStep(step?: Partial<LessonStep>) { steps.value.push({ sortOrder: steps.value.length + 1, title: step?.title ?? '', stepType: step?.stepType ?? 'teacher_talk', instruction: step?.instruction ?? '', expectedResponse: step?.expectedResponse ?? '', teacherTip: step?.teacherTip ?? '', resourceId: step?.resourceId ?? null, durationSeconds: step?.durationSeconds ?? 120 }); normalizeOrder(); markDirty() }
  function removeStep(index: number) { steps.value.splice(index, 1); normalizeOrder(); markDirty() }
  function copyStep(index: number) { const source = steps.value[index]; if (!source) return; steps.value.splice(index + 1, 0, { ...source, id: undefined }); normalizeOrder(); markDirty() }
  function moveStep(index: number, offset: -1 | 1) { const target = index + offset; if (target < 0 || target >= steps.value.length) return; const [step] = steps.value.splice(index, 1); if (step) steps.value.splice(target, 0, step); normalizeOrder(); markDirty() }
  function normalizeOrder() { steps.value.forEach((step, index) => { step.sortOrder = index + 1 }) }

  async function save(): Promise<LessonPlan> {
    if (saving.value) throw new Error('正在保存，请稍候')
    saving.value = true
    try {
      let plan: LessonPlan
      const metadata = { title: draft.value.title.trim(), theme: draft.value.theme.trim(), ageGroup: draft.value.ageGroup, objectives: draft.value.objectives.trim(), estimatedMinutes: draft.value.estimatedMinutes, status: draft.value.status }
      if (current.value) { const { data } = await http.patch<LessonPlan>(`/lesson-plans/${current.value.id}`, { ...metadata, version: draft.value.version }); plan = data }
      else { const { data } = await http.post<LessonPlan>('/lesson-plans', metadata); plan = data }
      const { data: savedSteps } = await http.put<{ version: number; steps: LessonStep[] }>(`/lesson-plans/${plan.id}/steps`, {
        version: plan.version,
        steps: steps.value.map((step) => ({
          sortOrder: step.sortOrder,
          title: step.title,
          stepType: step.stepType,
          instruction: step.instruction,
          expectedResponse: step.expectedResponse,
          teacherTip: step.teacherTip,
          resourceId: step.resourceId,
          durationSeconds: step.durationSeconds,
        })),
      })
      plan = { ...plan, version: savedSteps.version, steps: savedSteps.steps }
      current.value = plan; draft.value.version = plan.version; draft.value.steps = savedSteps.steps.map((step) => ({ ...step })); dirty.value = false
      return plan
    } catch (cause) { throw new Error(apiErrorMessage(cause, '教案保存失败，请稍后重试。'), { cause }) }
    finally { saving.value = false }
  }
  async function remove(id: number) { await http.delete(`/lesson-plans/${id}`); await fetchList() }
  async function copy(id: number) { await http.post(`/lesson-plans/${id}/copy`); await fetchList() }
  async function generateDraft(resourceIds: number[], input?: { theme: string; objectives?: string }) {
    loading.value = true
    try {
      const theme = input?.theme.trim() ?? draft.value.theme.trim()
      const objectives = input?.objectives?.trim() ?? draft.value.objectives.trim()
      const { data } = await http.post<LessonDraft>('/ai/lesson-plan-draft', { theme, ageGroup: draft.value.ageGroup, durationMinutes: draft.value.estimatedMinutes, objectives: objectives || undefined, resourceIds })
      draft.value = { ...data, status: draft.value.status, version: current.value?.version ?? 1, steps: (data.steps ?? []).map((step, index) => ({ ...step, sortOrder: index + 1 })) }; dirty.value = true
    } catch (cause) { throw new Error(apiErrorMessage(cause, 'AI 暂时无法生成草稿，仍可手动备课。'), { cause }) }
    finally { loading.value = false }
  }
  async function start(id: number) {
    try {
      const { data } = await http.post<{ runId: number }>(`/lesson-plans/${id}/start`)
      return data.runId
    } catch (cause) {
      throw new Error(apiErrorMessage(cause, '无法开始课堂，请检查教案步骤后重试。'), { cause })
    }
  }

  return { items, total, page, pageSize, keyword, ageGroup, status, loading, saving, error, current, draft, dirty, steps, fetchList, newDraft, load, markDirty, addStep, removeStep, copyStep, moveStep, save, remove, copy, generateDraft, start }
})
