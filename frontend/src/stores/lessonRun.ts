import { computed, onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'
import { apiErrorMessage, http } from '@/api/http'
import type { CourseResource, ServerResource } from './courseResource'
import { normalizeServerResource } from './courseResource'
import type { LessonStep } from './lessonPlan'
import { useResourcePlayerStore } from './resourcePlayer'
import { useClassroomAssistantStore } from './classroomAssistant'

export type LessonRunStatus = 'running' | 'paused' | 'completed' | 'cancelled'
export type RunStep = LessonStep & { resource?: ServerResource | null }
export type LessonRun = { id: number; runId: number; lessonPlanId: number; status: LessonRunStatus; currentStepOrder: number; lessonTitle: string; lessonObjectives: string; ageGroup: string; steps: RunStep[]; startedAt: string; endedAt?: string | null; updatedAt: string; elapsedSeconds?: number }

export const useLessonRunStore = defineStore('lessonRun', () => {
  const player = useResourcePlayerStore()
  const assistant = useClassroomAssistantStore()
  const run = ref<LessonRun | null>(null)
  const loading = ref(false)
  const error = ref('')
  const elapsedSeconds = ref(0)
  let timer: number | null = null
  const currentStep = computed(() => run.value?.steps.find((step) => step.sortOrder === run.value?.currentStepOrder) ?? null)
  const currentResource = computed<CourseResource | null>(() => currentStep.value?.resource ? normalizeServerResource(currentStep.value.resource) : null)
  const progress = computed(() => run.value?.steps.length ? (run.value.currentStepOrder / run.value.steps.length) * 100 : 0)

  function stopTimer() { if (timer !== null) window.clearInterval(timer); timer = null }
  function syncTimer() { stopTimer(); if (!run.value) return; elapsedSeconds.value = run.value.elapsedSeconds ?? Math.max(0, Math.floor((new Date(run.value.status === 'paused' ? run.value.updatedAt : Date.now()).getTime() - new Date(run.value.startedAt).getTime()) / 1000)); if (run.value.status === 'running') timer = window.setInterval(() => { elapsedSeconds.value += 1 }, 1000) }
  async function load(id: number) { loading.value = true; error.value = ''; try { const { data } = await http.get<LessonRun>(`/lesson-runs/${id}`); run.value = data; syncTimer(); syncAssistantContext() } catch (cause) { error.value = apiErrorMessage(cause, '课堂恢复失败，请返回教案列表重试。'); throw cause } finally { loading.value = false } }
  function syncAssistantContext() { if (!run.value || !currentStep.value) return; assistant.theme = run.value.lessonTitle; assistant.objective = run.value.lessonObjectives; assistant.currentStep = currentStep.value.title }
  async function move(order: number) { if (!run.value) return; player.requestControl('stop'); const { data } = await http.patch<LessonRun>(`/lesson-runs/${run.value.id}/progress`, { currentStepOrder: order }); run.value = data; assistant.endInteraction(); syncAssistantContext() }
  async function previous() { if (run.value && run.value.currentStepOrder > 1) await move(run.value.currentStepOrder - 1) }
  async function next() { if (run.value && run.value.currentStepOrder < run.value.steps.length) await move(run.value.currentStepOrder + 1) }
  function repeat() { player.requestControl('stop'); assistant.endInteraction() }
  async function action(name: 'pause' | 'resume' | 'complete' | 'cancel') { if (!run.value) return; player.requestControl('stop'); const { data } = await http.post<LessonRun>(`/lesson-runs/${run.value.id}/${name}`); run.value = data; if (name === 'complete' || name === 'cancel') assistant.endInteraction(); syncTimer() }
  function openResource() { if (currentResource.value) player.openResource(currentResource.value, false) }
  function clear() { stopTimer(); player.requestControl('stop'); assistant.endInteraction(); run.value = null; elapsedSeconds.value = 0 }
  onScopeDispose(stopTimer)
  return { run, loading, error, elapsedSeconds, currentStep, currentResource, progress, load, move, previous, next, repeat, pause: () => action('pause'), resume: () => action('resume'), complete: () => action('complete'), cancel: () => action('cancel'), openResource, clear }
})
