import { ref } from 'vue'
import { defineStore } from 'pinia'
import { apiErrorMessage, http } from '@/api/http'
import { classroomRequestId } from '@/services/classroomCommandBus'
import { useLessonRunStore } from './lessonRun'
export type DirectorSuggestionType = 'question' | 'grouping' | 'summary' | 'transition' | 'resource' | 'reward' | 'pacing'
export type DirectorSuggestion = {
  id: number
  classroomRunId: number
  type: DirectorSuggestionType
  title: string
  content: string
  originalContent: string
  rationale: string
  resourceId: number | null
  commandOperation: string | null
  status: 'pending' | 'confirmed' | 'rejected'
}

type DirectorResponse = {
  mode: 'classroom_director'
  status: 'ready' | 'safety_redirect' | 'degraded'
  message: string
  classroomRunVersion: number
  suggestions: DirectorSuggestion[]
}

export const useClassroomDirectorStore = defineStore('classroomDirector', () => {
  const lessonRun = useLessonRunStore()
  const loading = ref(false)
  const busyId = ref<number | null>(null)
  const message = ref('')
  const status = ref<DirectorResponse['status'] | ''>('')
  const suggestions = ref<DirectorSuggestion[]>([])

  async function generate(teacherGoal: string) {
    const run = lessonRun.run
    const step = lessonRun.currentStep
    if (!run || !step || loading.value) return
    loading.value = true
    message.value = ''
    try {
      const { data } = await http.post<DirectorResponse>('/ai/classroom-director', {
        classroomRunId: run.id,
        currentStep: `${step.title}：${step.content}`,
        timeline: run.steps.map((item) => ({
          stepIndex: item.stepIndex,
          title: item.title,
          durationSeconds: item.durationSeconds,
        })),
        elapsedSeconds: Math.max(0, Math.floor(lessonRun.elapsedSeconds)),
        remainingSeconds: Math.max(
          0,
          run.steps.reduce((total, item) => total + item.durationSeconds, 0)
            - Math.floor(lessonRun.elapsedSeconds),
        ),
        completedStepIndexes: run.steps
          .filter((item) => item.stepIndex < run.currentStepIndex)
          .map((item) => item.stepIndex),
        currentResource: lessonRun.currentResource
          ? { id: Number(lessonRun.currentResource.id), title: lessonRun.currentResource.title }
          : null,
        attendanceSummary: JSON.stringify(run.rollCallState ?? {}).slice(0, 1000),
        interactionSummary: JSON.stringify(run.interactionState ?? {}).slice(0, 1500),
        recentQuestions: [],
        teacherGoal: teacherGoal.trim(),
      })
      status.value = data.status
      message.value = data.message
      suggestions.value = data.suggestions
    } catch (error) {
      throw new Error(apiErrorMessage(error, 'AI课堂导演暂时无法生成建议。'), { cause: error })
    } finally {
      loading.value = false
    }
  }

  async function edit(item: DirectorSuggestion, content: string) {
    busyId.value = item.id
    try {
      const { data } = await http.post<DirectorSuggestion>(
        `/ai/classroom-director/${item.id}/edit`, { content },
      )
      replace(data)
    } finally { busyId.value = null }
  }

  async function reject(item: DirectorSuggestion) {
    busyId.value = item.id
    try {
      const { data } = await http.post<DirectorSuggestion>(
        `/ai/classroom-director/${item.id}/reject`, {},
      )
      replace(data)
    } finally { busyId.value = null }
  }

  async function confirm(item: DirectorSuggestion) {
    const run = lessonRun.run
    if (!run) return
    busyId.value = item.id
    try {
      const { data } = await http.post<{
        suggestion: DirectorSuggestion
        commandResult?: { classroomState?: unknown } | null
      }>(`/ai/classroom-director/${item.id}/confirm`, {
        requestId: classroomRequestId('director-confirm'),
        deviceId: run.deviceId,
        expectedVersion: run.version,
        ...(item.commandOperation?.includes('resource')
          ? { targetDeviceId: run.deviceId }
          : {}),
      })
      replace(data.suggestion)
      if (data.commandResult?.classroomState) {
        lessonRun.adoptRun(data.commandResult.classroomState as Parameters<typeof lessonRun.adoptRun>[0])
      }
    } finally { busyId.value = null }
  }

  function replace(item: DirectorSuggestion) {
    const index = suggestions.value.findIndex((entry) => entry.id === item.id)
    if (index >= 0) suggestions.value[index] = item
  }

  function clear() {
    suggestions.value = []
    message.value = ''
    status.value = ''
  }

  return { loading, busyId, message, status, suggestions, generate, edit, reject, confirm, clear }
})
