import { computed, onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'
import { apiErrorMessage, http } from '@/api/http'
import type { CourseResource } from './courseResource'
import { useCourseResourceStore } from './courseResource'
import { useResourcePlayerStore } from './resourcePlayer'
import { useClassroomAssistantStore } from './classroomAssistant'

export type LessonRunStatus = 'prepared' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed'
export type RunStep = { stepIndex: number; title: string; type: string; content: string; durationSeconds: number; resourceId: number | null; actionConfig?: unknown; recoveryPointConfig?: unknown; expectedResponse?: string | null; teacherTip?: string | null }
export type LessonRun = { id: number; runId?: number; lessonPlanId: number; deviceId: number; version: number; status: LessonRunStatus; currentStepIndex: number; lessonTitle: string; lessonObjectives: string; ageGroup: string; steps: RunStep[]; startedAt: string; endedAt?: string | null; updatedAt: string; elapsedSeconds?: number; breakStartedAt?: string | null; breakEndsAt?: string | null }

// 后端 GET/POST /classroom-runs 返回的原始结构：标题字段为 title，不返回 ageGroup，但返回 objectives（教案教学目标）。
export type ClassroomRunPayload = { id: number; lessonPlanId: number; deviceId: number; version: number; status: LessonRunStatus; currentStepIndex: number; title: string; objectives?: string; steps: RunStep[]; startedAt: string; endedAt?: string | null; updatedAt: string; elapsedSeconds?: number; serverNow?: string; breakStartedAt?: string | null; breakEndsAt?: string | null }

// 将后端返回映射为前端 LessonRun：title → lessonTitle，缺失字段使用安全默认值。objectives 即教案教学目标，做 trim 防空白。
function adaptRun(data: ClassroomRunPayload): LessonRun {
  return {
    id: data.id,
    lessonPlanId: data.lessonPlanId,
    deviceId: data.deviceId,
    version: data.version,
    status: data.status,
    currentStepIndex: data.currentStepIndex,
    lessonTitle: data.title ?? '',
    lessonObjectives: (data.objectives ?? '').trim(),
    ageGroup: '',
    steps: data.steps,
    startedAt: data.startedAt,
    endedAt: data.endedAt ?? null,
    updatedAt: data.updatedAt,
    elapsedSeconds: data.elapsedSeconds,
    breakStartedAt: data.breakStartedAt ?? null,
    breakEndsAt: data.breakEndsAt ?? null,
  }
}

function requestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `classroom-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export const useLessonRunStore = defineStore('lessonRun', () => {
  const player = useResourcePlayerStore(); const assistant = useClassroomAssistantStore(); const resources = useCourseResourceStore()
  const run = ref<LessonRun | null>(null); const loading = ref(false); const busy = ref(false); const error = ref(''); const elapsedSeconds = ref(0); let timer: number | null = null
  // serverNow 时钟校准：serverOffset = 服务器时间 - 本机时间；nowTick 每秒递增驱动倒计时重算
  const serverOffset = ref(0); const nowTick = ref(0); const polling = ref(false); let pollTimer: number | null = null; let pollInFlight = false
  const currentStep = computed(() => run.value?.steps.find((step) => step.stepIndex === run.value?.currentStepIndex) ?? null)
  const currentResource = computed<CourseResource | null>(() => { const id = currentStep.value?.resourceId; return id == null ? null : resources.sortedResources.find((item) => Number(item.id) === id) ?? null })
  const progress = computed(() => run.value?.steps.length ? ((run.value.currentStepIndex + 1) / run.value.steps.length) * 100 : 0)
  function stopTimer() { if (timer !== null) window.clearInterval(timer); timer = null }
  function syncTimer() { stopTimer(); if (!run.value) return; elapsedSeconds.value = run.value.elapsedSeconds ?? Math.max(0, Math.floor((new Date(run.value.status === 'paused' ? run.value.updatedAt : Date.now()).getTime() - new Date(run.value.startedAt).getTime()) / 1000)); if (run.value.status === 'running') timer = window.setInterval(() => { elapsedSeconds.value += 1; nowTick.value += 1 }, 1000) }
  // 课间判定：status running 且 breakEndsAt 未到期。依赖 nowTick，倒计时每秒重算。
  const effectiveNow = () => Date.now() + serverOffset.value
  const isBreakActive = computed(() => { void nowTick.value; const r = run.value; return r != null && r.status === 'running' && r.breakEndsAt != null && new Date(r.breakEndsAt).getTime() > effectiveNow() })
  const breakRemainingSeconds = computed(() => { void nowTick.value; const r = run.value; if (r?.breakEndsAt == null) return 0; return Math.max(0, Math.floor((new Date(r.breakEndsAt).getTime() - effectiveNow()) / 1000)) })
  function applyServerNow(now?: string) { if (now) serverOffset.value = new Date(now).getTime() - Date.now() }
  function syncAssistantContext() { if (!run.value || !currentStep.value) return; assistant.theme = run.value.lessonTitle; if (run.value.lessonObjectives) assistant.objective = run.value.lessonObjectives; assistant.currentStep = `${currentStep.value.title}：${currentStep.value.content}` }
  // 应用后端返回的最新 run：更新 run/version + serverNow 偏移 + 重新同步计时与助手上下文
  function adoptRun(data: ClassroomRunPayload) { run.value = adaptRun(data); applyServerNow(data.serverNow); syncTimer(); syncAssistantContext() }
  function clearRun() { stopTimer(); stopPolling(); run.value = null; elapsedSeconds.value = 0; serverOffset.value = 0 }
  async function load(id: number) { loading.value = true; error.value = ''; try { const { data } = await http.get<ClassroomRunPayload>(`/classroom-runs/${id}`); adoptRun(data); await resources.refreshLibrary() } catch (cause) { error.value = apiErrorMessage(cause, '课堂恢复失败，请返回教案列表重试。'); throw cause } finally { loading.value = false } }
  async function move(index: number) { if (!run.value || run.value.status !== 'running' || busy.value || isBreakActive.value) return; busy.value = true; player.requestControl('stop'); try { const { data } = await http.post<ClassroomRunPayload>(`/classroom-runs/${run.value.id}/steps/${index}`, { version: run.value.version, deviceId: run.value.deviceId, requestId: requestId() }); adoptRun(data); assistant.endInteraction() } finally { busy.value = false } }
  async function previous() { if (run.value?.status === 'running' && run.value.currentStepIndex > 0) await move(run.value.currentStepIndex - 1) }
  async function next() { if (run.value?.status === 'running' && run.value.currentStepIndex < run.value.steps.length - 1) await move(run.value.currentStepIndex + 1) }
  function repeat() { if (run.value?.status === 'running') { player.requestControl('stop'); assistant.endInteraction() } }
  async function action(name: 'pause' | 'resume' | 'complete' | 'cancel') { if (!run.value || busy.value) return; const allowed = name === 'pause' ? run.value.status === 'running' : name === 'resume' ? run.value.status === 'paused' : run.value.status === 'running' || run.value.status === 'paused'; if (!allowed) return; busy.value = true; player.requestControl('stop'); try { const { data } = await http.post<ClassroomRunPayload>(`/classroom-runs/${run.value.id}/${name}`, { version: run.value.version, deviceId: run.value.deviceId, requestId: requestId() }); adoptRun(data); if (name === 'complete' || name === 'cancel') assistant.endInteraction() } finally { busy.value = false } }
  async function startBreak(durationSeconds: number) { if (!run.value || busy.value || isBreakActive.value) return; busy.value = true; try { const { data } = await http.post<ClassroomRunPayload>(`/classroom-runs/${run.value.id}/break`, { version: run.value.version, deviceId: run.value.deviceId, requestId: requestId(), durationSeconds }); adoptRun(data) } finally { busy.value = false } }
  async function endBreak() { if (!run.value || busy.value || !isBreakActive.value) return; busy.value = true; try { const { data } = await http.post<ClassroomRunPayload>(`/classroom-runs/${run.value.id}/break/end`, { version: run.value.version, deviceId: run.value.deviceId, requestId: requestId() }); adoptRun(data) } finally { busy.value = false } }
  // 多端同步：轻量轮询刷新 run + serverNow。防并发堆积：pollInFlight 期间跳过，busy 时跳过。
  function stopPolling() { if (pollTimer !== null) { window.clearInterval(pollTimer); pollTimer = null } polling.value = false }
  function startPolling(intervalMs = 2000) { if (polling.value || !run.value) return; polling.value = true; pollTimer = window.setInterval(async () => { if (pollInFlight || busy.value || !run.value) return; pollInFlight = true; try { const { data } = await http.get<ClassroomRunPayload>(`/classroom-runs/${run.value.id}`); run.value = adaptRun(data); applyServerNow(data.serverNow); syncTimer() } catch { /* 轮询失败静默，不打断课堂 */ } finally { pollInFlight = false } }, intervalMs) }
  function openResource() { if (currentResource.value) player.openResource(currentResource.value, false) }
  function clear() { clearRun(); player.requestControl('stop'); assistant.endInteraction() }
  onScopeDispose(() => { stopTimer(); stopPolling() })
  return { run, loading, busy, error, elapsedSeconds, serverOffset, isBreakActive, breakRemainingSeconds, polling, currentStep, currentResource, progress, load, adoptRun, clearRun, move, previous, next, repeat, pause: () => action('pause'), resume: () => action('resume'), complete: () => action('complete'), cancel: () => action('cancel'), startBreak, endBreak, startPolling, stopPolling, openResource, clear }
})
