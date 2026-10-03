import { computed, onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'
import { apiErrorMessage, http } from '@/api/http'
import type { CourseResource } from './courseResource'
import { useCourseResourceStore } from './courseResource'
import { useResourcePlayerStore } from './resourcePlayer'
import { useClassroomAssistantStore } from './classroomAssistant'

export type LessonRunStatus = 'prepared' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed'
export type RunStep = { stepIndex: number; title: string; type: string; content: string; durationSeconds: number; resourceId: number | null; actionConfig?: unknown; recoveryPointConfig?: unknown; expectedResponse?: string | null; teacherTip?: string | null }
export type LessonRun = { id: number; runId?: number; lessonPlanId: number; deviceId: number; version: number; status: LessonRunStatus; currentStepIndex: number; lessonTitle: string; lessonObjectives: string; ageGroup: string; steps: RunStep[]; startedAt: string; endedAt?: string | null; updatedAt: string; elapsedSeconds?: number }

function requestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `classroom-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export const useLessonRunStore = defineStore('lessonRun', () => {
  const player = useResourcePlayerStore(); const assistant = useClassroomAssistantStore(); const resources = useCourseResourceStore()
  const run = ref<LessonRun | null>(null); const loading = ref(false); const busy = ref(false); const error = ref(''); const elapsedSeconds = ref(0); let timer: number | null = null
  const currentStep = computed(() => run.value?.steps.find((step) => step.stepIndex === run.value?.currentStepIndex) ?? null)
  const currentResource = computed<CourseResource | null>(() => { const id = currentStep.value?.resourceId; return id == null ? null : resources.sortedResources.find((item) => Number(item.id) === id) ?? null })
  const progress = computed(() => run.value?.steps.length ? ((run.value.currentStepIndex + 1) / run.value.steps.length) * 100 : 0)
  function stopTimer() { if (timer !== null) window.clearInterval(timer); timer = null }
  function syncTimer() { stopTimer(); if (!run.value) return; elapsedSeconds.value = run.value.elapsedSeconds ?? Math.max(0, Math.floor((new Date(run.value.status === 'paused' ? run.value.updatedAt : Date.now()).getTime() - new Date(run.value.startedAt).getTime()) / 1000)); if (run.value.status === 'running') timer = window.setInterval(() => { elapsedSeconds.value += 1 }, 1000) }
  function syncAssistantContext() { if (!run.value || !currentStep.value) return; assistant.theme = run.value.lessonTitle; assistant.objective = run.value.lessonObjectives; assistant.currentStep = `${currentStep.value.title}：${currentStep.value.content}` }
  async function load(id: number) { loading.value = true; error.value = ''; try { const key = `classroom-run-device:${id}`; const storedDeviceId = Number(sessionStorage.getItem(key)); let data: LessonRun; if (Number.isInteger(storedDeviceId) && storedDeviceId > 0) { ({ data } = await http.get<LessonRun>(`/classroom-runs/${id}/restore`, { params: { deviceId: storedDeviceId } })) } else { ({ data } = await http.get<LessonRun>(`/classroom-runs/${id}`)); if (data.deviceId) sessionStorage.setItem(key, String(data.deviceId)) } run.value = data; await resources.refreshLibrary(); syncTimer(); syncAssistantContext() } catch (cause) { error.value = apiErrorMessage(cause, '课堂恢复失败，请返回教案列表重试。'); throw cause } finally { loading.value = false } }
  async function move(index: number) { if (!run.value || run.value.status !== 'running' || busy.value) return; busy.value = true; player.requestControl('stop'); try { const { data } = await http.post<LessonRun>(`/classroom-runs/${run.value.id}/steps/${index}`, { version: run.value.version, deviceId: run.value.deviceId, requestId: requestId() }); run.value = data; assistant.endInteraction(); syncAssistantContext() } finally { busy.value = false } }
  async function previous() { if (run.value?.status === 'running' && run.value.currentStepIndex > 0) await move(run.value.currentStepIndex - 1) }
  async function next() { if (run.value?.status === 'running' && run.value.currentStepIndex < run.value.steps.length - 1) await move(run.value.currentStepIndex + 1) }
  function repeat() { if (run.value?.status === 'running') { player.requestControl('stop'); assistant.endInteraction() } }
  async function action(name: 'pause' | 'resume' | 'complete' | 'cancel') { if (!run.value || busy.value) return; const allowed = name === 'pause' ? run.value.status === 'running' : name === 'resume' ? run.value.status === 'paused' : run.value.status === 'running' || run.value.status === 'paused'; if (!allowed) return; busy.value = true; player.requestControl('stop'); try { const { data } = await http.post<LessonRun>(`/classroom-runs/${run.value.id}/${name}`, { version: run.value.version, deviceId: run.value.deviceId, requestId: requestId() }); run.value = data; if (name === 'complete' || name === 'cancel') assistant.endInteraction(); syncTimer() } finally { busy.value = false } }
  function openResource() { if (currentResource.value) player.openResource(currentResource.value, false) }
  function clear() { stopTimer(); player.requestControl('stop'); assistant.endInteraction(); run.value = null; elapsedSeconds.value = 0 }
  onScopeDispose(stopTimer)
  return { run, loading, busy, error, elapsedSeconds, currentStep, currentResource, progress, load, move, previous, next, repeat, pause: () => action('pause'), resume: () => action('resume'), complete: () => action('complete'), cancel: () => action('cancel'), openResource, clear }
})
