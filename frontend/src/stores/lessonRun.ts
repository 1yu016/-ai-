import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { defineStore } from 'pinia'
import { apiErrorStatus, apiErrorMessage, http } from '@/api/http'
import { commandCapability } from '@/services/classroomCapabilities'
import { resourceAccessMessage } from '@/api/resources'
import type { ScreenPreparation } from '@/api/screenPreparation'
import type { CourseResource } from './courseResource'
import { useCourseResourceStore } from './courseResource'
import { presentationOrigin, type PresentationOrigin, useResourcePlayerStore } from './resourcePlayer'
import { useClassroomAssistantStore } from './classroomAssistant'
import {
  classroomRequestId,
  executeClassroomCommand,
  type ClassroomCommandOperation,
  type ClassroomCommandSource,
  type ClassroomCommandResult,
  type CommandRun,
} from '@/services/classroomCommandBus'

export type LessonRunStatus = 'prepared' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed'
export type BreakContentType = 'water' | 'toilet' | 'movement' | 'eye_exercise' | 'light_music' | 'safety'
export type BreakContent = { type: BreakContentType; title: string; message: string; icon: string; avatarAction: 'idle' | 'happy' | 'encourage' | 'wave' }
export type StartBreakOptions = { durationSeconds: number; contentType: BreakContentType; idleProtectionSeconds?: number }
export type RunStep = { stepIndex: number; title: string; type: string; content: string; durationSeconds: number; resourceId: number | null; actionConfig?: unknown; recoveryPointConfig?: unknown; expectedResponse?: string | null; teacherTip?: string | null }
export type RewardPresentation = { recordId: number; studentId: number; displayName: string; rewardCategory: string; rewardForms: string[]; points: number; stars: number; badgeCode?: string | null; praiseText?: string | null; animationKey?: string | null; createdAt: string }
export type LessonRun = { allowedActions?: string[]; attendanceState?: Record<string, string>; manualInterventionRequired?: boolean; id: number; runId?: number; lessonPlanId: number; classId?: number; deviceId: number; version: number; status: LessonRunStatus; currentStepIndex: number; lessonTitle: string; lessonObjectives: string; ageGroup: string; steps: RunStep[]; startedAt: string; endedAt?: string | null; updatedAt: string; elapsedSeconds?: number; breakStartedAt?: string | null; breakEndsAt?: string | null; breakContentType?: BreakContentType | null; breakDurationSeconds?: number | null; breakProtectionAt?: string | null; breakContent?: BreakContent | null; rollCallState?: { lastStudentId?: number; lastStudentDisplayName?: string; updatedAt?: string; [key: string]: unknown }; rewardState?: Record<string, unknown>; interactionState?: { rewardPresentation?: RewardPresentation; [key: string]: unknown } } & { playerRecoverySuggestion?: PlayerSnapshotState; latestSnapshotVersion?: number | null }

// 后端 GET/POST /classroom-runs 返回的原始结构：标题字段为 title，不返回 ageGroup，但返回 objectives（教案教学目标）。
export type PlayerSnapshotState = { resourceId?: number; status?: string; currentTime?: number; duration?: number; pageIndex?: number; pageCount?: number | null; zoom?: number; volume?: number; muted?: boolean; updatedAt?: string; autoPlay?: boolean; artworkId?: number; artworkFileUrl?: string; artworkComment?: string; ttsText?: string; operation?: string } & { presentationCommandId?: string; presentationRevision?: number; observation?: Record<string, unknown>; presentationItemId?: string | null; presentationMode?: 'resource' | 'avatar' | 'leaderboard' }
export type ClassroomRunPayload = { allowedActions?: string[]; attendanceState?: Record<string, string>; id: number; lessonPlanId: number; classId?: number; deviceId: number; version: number; status: LessonRunStatus; currentStepIndex: number; title: string; objectives?: string; steps: RunStep[]; startedAt: string; endedAt?: string | null; updatedAt: string; elapsedSeconds?: number; serverNow?: string; breakStartedAt?: string | null; breakEndsAt?: string | null; breakContentType?: BreakContentType | null; breakDurationSeconds?: number | null; breakProtectionAt?: string | null; breakContent?: BreakContent | null; latestSnapshotVersion?: number | null; playerRecoverySuggestion?: PlayerSnapshotState; rewardState?: Record<string, unknown>; interactionState?: { rewardPresentation?: RewardPresentation; [key: string]: unknown }; rollCallState?: { lastStudentId?: number; lastStudentDisplayName?: string; updatedAt?: string; [key: string]: unknown }; manualInterventionRequired?: boolean }
export type ClassroomScreenPage = 'idle' | 'ready' | 'classroom' | 'drawing' | 'reward' | 'break' | 'protection' | 'summary' | 'recovery'
export type ScreenLifecycle = { schemaVersion: 1; phase: 'opening' | 'teaching' | 'summary' | 'dismissed'; runId: number; deviceId: number; bindingId: number; revision: number; enteredAt: string; expiresAt: string | null }
export type ClassroomScreenState = { page: ClassroomScreenPage; deviceId: number; classroomState: ClassroomRunPayload | null; preparation?: ScreenPreparation | null; phase?: 'opening' | 'teaching' | 'paused' | 'summary'; lifecycle?: ScreenLifecycle | null; handoff?: { id: string }; summary?: { runId: number; courseTitle: string; endedAt: string | null }; serverNow: string }

// 当前步骤绑定资源的解析状态：loading（fallback 请求中）/ ready（可用）/ missing（404/403/网络失败，给出可展示提示）。
export type ResourceResolveState = { status: 'idle' | 'loading' | 'ready' | 'missing'; message: string }

// 将后端返回映射为前端 LessonRun：title → lessonTitle，缺失字段使用安全默认值。objectives 即教案教学目标，做 trim 防空白。
function adaptRun(data: ClassroomRunPayload): LessonRun {
  return {
    id: data.id,
    lessonPlanId: data.lessonPlanId,
    classId: data.classId,
    deviceId: data.deviceId,
    version: data.version,
    status: data.status,
    currentStepIndex: data.currentStepIndex,
    lessonTitle: data.title ?? '',
    lessonObjectives: (data.objectives ?? '').trim(),
    ageGroup: '',
    steps: Array.isArray(data.steps) ? data.steps : [],
    startedAt: data.startedAt,
    endedAt: data.endedAt ?? null,
    updatedAt: data.updatedAt,
    elapsedSeconds: data.elapsedSeconds,
    breakStartedAt: data.breakStartedAt ?? null,
    breakEndsAt: data.breakEndsAt ?? null,
    breakContentType: data.breakContentType ?? null,
    breakDurationSeconds: data.breakDurationSeconds ?? null,
    breakProtectionAt: data.breakProtectionAt ?? null,
    breakContent: data.breakContent ?? null,
    rollCallState: data.rollCallState,
    rewardState: data.rewardState,
    interactionState: data.interactionState,
    playerRecoverySuggestion: data.playerRecoverySuggestion,
    latestSnapshotVersion: data.latestSnapshotVersion,
    allowedActions: data.allowedActions, attendanceState: data.attendanceState,
    manualInterventionRequired: data.manualInterventionRequired,
  }
}

export const useLessonRunStore = defineStore('lessonRun', () => {
  const capabilities = ref<{ runId: number; deviceId: number; version: number; snapshotVersion: number | null; actions: string[]; at: number } | null>(null)
  const capabilityMessage = ref('操作能力尚未确认，请刷新课堂状态。')
  const capabilityLoading = ref(false)
  let capabilitySequence = 0
  let capabilityExpiryTimer: number | null = null
  function expireCapabilitiesLater() {
    if (capabilityExpiryTimer !== null) window.clearTimeout(capabilityExpiryTimer)
    const saved = capabilities.value
    capabilityExpiryTimer = window.setTimeout(() => {
      capabilityExpiryTimer = null
      if (capabilities.value === saved) { capabilities.value = null; capabilityMessage.value = '操作能力已过期，请刷新课堂状态。' }
    }, 6000)
  }
  function can(action: string): boolean {
    const c = capabilities.value; const r = run.value
    return !!r && !!c && c.runId === r.id && c.deviceId === r.deviceId && c.version === r.version &&
      c.snapshotVersion === (r.latestSnapshotVersion ?? null) && Date.now() - c.at < 6000 &&
      commandStateRefresh.value.status === 'idle' && c.actions.includes(action)
  }
  function requireAction(action: string) {
    if (!can(action)) throw new Error(capabilityMessage.value || '当前课堂阶段不允许此操作，请刷新状态。')
  }
  async function refreshCapabilities() {
    const r = run.value
    if (!r) return
    const sequence = ++capabilitySequence; const epoch = stateEpoch
    capabilityLoading.value = true
    try {
      const { data } = await http.get<{ schemaVersion: number; run: { id: number; deviceId: number }; versions: { runVersion: number; snapshotVersion: number | null }; capabilities: { allowedActions: string[] } }>(`/classroom-runs/${r.id}/cockpit`)
      if (sequence !== capabilitySequence || epoch !== stateEpoch || run.value?.id !== r.id || run.value.deviceId !== r.deviceId) return
      if (data.schemaVersion !== 1 || data.run?.id !== r.id || data.run.deviceId !== r.deviceId ||
        data.versions?.runVersion !== r.version || data.versions.snapshotVersion !== (r.latestSnapshotVersion ?? null) ||
        !Array.isArray(data.capabilities?.allowedActions) || !data.capabilities.allowedActions.every(a => typeof a === 'string')) {
        capabilities.value = null; capabilityMessage.value = '课堂状态或能力版本尚未同步，请刷新课堂状态。'; return
      }
      capabilities.value = { runId: r.id, deviceId: r.deviceId, version: r.version, snapshotVersion: r.latestSnapshotVersion ?? null, actions: [...data.capabilities.allowedActions], at: Date.now() }
      expireCapabilitiesLater()
      capabilityMessage.value = '操作受当前课堂阶段、课间或恢复状态限制；执行时服务端仍会重新校验。'
    } catch (cause) {
      if (sequence === capabilitySequence && epoch === stateEpoch) { capabilities.value = null; capabilityMessage.value = apiErrorMessage(cause, '操作能力查询失败，请刷新课堂状态。') }
    } finally { if (sequence === capabilitySequence) capabilityLoading.value = false }
  }
  async function refreshTeacherState() {
    const r = run.value
    if (!r) return
    if (pendingRecovery) { await retryCommandStateRefresh(); return }
    const epoch = stateEpoch
    try {
      const { data } = await http.get<ClassroomRunPayload>(`/classroom-runs/${r.id}`)
      if (epoch !== stateEpoch || run.value?.id !== r.id || data.id !== r.id || data.deviceId !== r.deviceId || data.version < r.version) return
      adoptRun(data); await refreshCapabilities()
    } catch (cause) { capabilityMessage.value = apiErrorMessage(cause, '课堂刷新失败，请重新查询。') }
  }
  async function handleTeacherRejection(cause: unknown) {
    if ([403, 409].includes(apiErrorStatus(cause) ?? 0)) {
      capabilities.value = null; capabilityMessage.value = apiErrorMessage(cause, '权限、阶段或版本已变化，请刷新。')
      await refreshTeacherState()
    }
  }
  function attendanceAction(parameters?: Record<string, unknown>): string {
    const updates = Array.isArray(parameters?.updates) ? parameters.updates : [parameters]
    const existing = run.value?.attendanceState
    return updates.length > 0 && updates.every(u => u && existing && Object.hasOwn(existing, String(u.studentId))) ? 'attendance_correction' : 'attendance_new'
  }
  async function teacherCommand(operation: ClassroomCommandOperation, parameters?: Record<string, unknown>, source: ClassroomCommandSource = 'teacher_panel', deviceId?: number, requestId?: string) {
    const action = operation === 'attendance_update' ? attendanceAction(parameters) : commandCapability(operation)
    if (!action) throw new Error('该操作尚无已确认的服务端能力映射。')
    requireAction(action)
    try { return await command(operation, parameters, source, deviceId, requestId) }
    catch (cause) { await handleTeacherRejection(cause); throw cause }
  }
  const player = useResourcePlayerStore(); const assistant = useClassroomAssistantStore(); const resources = useCourseResourceStore()
  const run = ref<LessonRun | null>(null); const loading = ref(false); const busy = ref(false); const error = ref(''); const elapsedSeconds = ref(0); let timer: number | null = null
  const lastCommandResult = shallowRef<ClassroomCommandResult | null>(null)
  const commandStateRefresh = ref<{ status: 'idle' | 'refreshing' | 'failed'; runId: number | null; requestId: string | null; message: string }>({ status: 'idle', runId: null, requestId: null, message: '' })
  let refreshSequence = 0
  let stateEpoch = 0
  let pendingRecovery: { runId: number; deviceId: number; requestId: string; committedRunVersion: number } | null = null
  function clearCommandRefresh() {
    refreshSequence += 1; pendingRecovery = null
    commandStateRefresh.value = { status: 'idle', runId: null, requestId: null, message: '' }
  }
  // 一次性开场标记：仅在“刚创建并通过 /classroom-runs/start 进入”的下一次挂载生效；
  // 刷新后 store 重建、标记归零，不会重复播放开场。绝不把永久状态写入 localStorage。
  const newlyStarted = ref(false)
  // serverNow 时钟校准：serverOffset = 服务器时间 - 本机时间；nowTick 每秒递增驱动倒计时重算
  const serverOffset = ref(0); const nowTick = ref(0); const polling = ref(false); let pollTimer: number | null = null; let pollInFlight = false
  const currentStep = computed(() => run.value?.steps.find((step) => step.stepIndex === run.value?.currentStepIndex) ?? null)
  // Stage 6.6：当前步骤绑定的资源。先从已加载列表/按 id 缓存同步解析；
  // 不在列表中时由 resolveCurrentResource() 走 GET /resources/:id fallback 后再命中缓存。
  const currentResource = computed<CourseResource | null>(() => {
    const id = currentStep.value?.resourceId
    return id == null ? null : resources.getResourceById(id)
  })
  // 资源解析状态：loading（fallback 请求中）/ ready（可用）/ missing（404/403/网络失败，给出可展示提示）。
  const resourceResolveState = ref<ResourceResolveState>({ status: 'idle', message: '' })
  // 世代号：快速切换步骤时，丢弃旧步骤资源的迟到响应，防止其覆盖最新步骤的状态。
  let resourceResolveSeq = 0
  async function resolveCurrentResource() {
    const step = currentStep.value
    const id = step?.resourceId == null ? null : Number(step.resourceId)
    const seq = ++resourceResolveSeq
    if (id == null || !Number.isInteger(id)) {
      resourceResolveState.value = { status: 'idle', message: '' }
      return
    }
    if (resources.getResourceById(id)) {
      resourceResolveState.value = { status: 'ready', message: '' }
      return
    }
    resourceResolveState.value = { status: 'loading', message: '' }
    try {
      await resources.ensureResourceById(id)
      if (seq !== resourceResolveSeq) return
      resourceResolveState.value = { status: 'ready', message: '' }
    } catch (cause) {
      if (seq !== resourceResolveSeq) return
      resourceResolveState.value = { status: 'missing', message: resourceAccessMessage(cause) }
    }
  }
  watch(currentStep, (step, previous) => {
    if (!step || !run.value) {
      resourceResolveState.value = { status: 'idle', message: '' }
      return
    }
    const changed =
      !previous || previous.stepIndex !== step.stepIndex || previous.resourceId !== step.resourceId
    if (changed) void resolveCurrentResource()
  })
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
  function adoptRun(data: ClassroomRunPayload) {
    if (run.value?.id === data.id && data.version < run.value.version) return
    if (run.value && (run.value.id !== data.id || run.value.deviceId !== data.deviceId)) { clearCommandRefresh(); lastCommandResult.value = null }
    stateEpoch += 1; run.value = adaptRun(data);
    if (Array.isArray(data.allowedActions)) {
      capabilities.value = { runId: data.id, deviceId: data.deviceId, version: data.version, snapshotVersion: data.latestSnapshotVersion ?? null, actions: [...data.allowedActions], at: Date.now() }
      expireCapabilitiesLater()
      capabilityMessage.value = '操作受当前课堂阶段、课间或恢复状态限制；执行时服务端仍会重新校验。'
    } else if (capabilities.value && (capabilities.value.runId !== data.id || capabilities.value.deviceId !== data.deviceId || capabilities.value.version !== data.version || capabilities.value.snapshotVersion !== (data.latestSnapshotVersion ?? null))) {
      capabilities.value = null; capabilityMessage.value = '操作能力版本已变化，请刷新课堂状态。'
    }
    applyServerNow(data.serverNow); syncTimer(); syncAssistantContext()
  }
  function clearRun() { if (capabilityExpiryTimer !== null) window.clearTimeout(capabilityExpiryTimer); capabilityExpiryTimer = null; capabilitySequence += 1; capabilities.value = null; capabilityLoading.value = false; clearCommandRefresh(); lastCommandResult.value = null; stateEpoch += 1; stopTimer(); stopPolling(); resourceResolveSeq += 1; resourceResolveState.value = { status: 'idle', message: '' }; newlyStarted.value = false; run.value = null; elapsedSeconds.value = 0; serverOffset.value = 0 }
  async function load(id: number) { const epoch = stateEpoch; loading.value = true; error.value = ''; try { const { data } = await http.get<ClassroomRunPayload>(`/classroom-runs/${id}`); if (epoch !== stateEpoch) return; adoptRun(data); await resources.refreshLibrary() } catch (cause) { error.value = apiErrorMessage(cause, '课堂恢复失败，请返回教案列表重试。'); throw cause } finally { loading.value = false } }
  async function loadScreenState(deviceId: number, handoffId?: string) { const { data } = await http.get<ClassroomScreenState>('/classroom-runs/screen-state', { params: { deviceId, handoffId } }); return data }
  async function restore(id: number, deviceId: number) { const { data } = await http.get<ClassroomRunPayload>(`/classroom-runs/${id}/restore`, { params: { deviceId } }); adoptRun(data); await resources.refreshLibrary(); return data }
  async function savePlayerState(playerState: PlayerSnapshotState, context?: PresentationOrigin | null) {
    const origin = run.value
    if (!origin || !context || busy.value || ['completed', 'cancelled', 'failed'].includes(origin.status)) return null
    const matches = () => run.value?.id === context.runId && run.value.deviceId === context.deviceId &&
      run.value.playerRecoverySuggestion?.presentationCommandId === context.presentationCommandId &&
      run.value.playerRecoverySuggestion?.presentationRevision === context.presentationRevision
    if (!matches()) return null
    const epoch = stateEpoch
    busy.value = true
    try {
      // Observation whitelist only. Never merge current control JSON into an old event.
      const { status, currentTime, duration, pageIndex, pageCount } = playerState
      const { data } = await http.post<ClassroomRunPayload>(`/classroom-runs/${context.runId}/checkpoints`, {
        requestId: classroomRequestId('player-state'), version: origin.version, deviceId: context.deviceId,
        checkpointType: 'command', playerState: { status, currentTime, duration, pageIndex, pageCount,
          presentationCommandId: context.presentationCommandId, presentationRevision: context.presentationRevision },
      })
      if (matches() && stateEpoch === epoch && data.version >= run.value!.version) adoptRun(data)
      // HTTP acceptance is not evidence that this observation matched the current control.
      const observation = data.playerRecoverySuggestion?.observation
      return observation?.presentationCommandId === context.presentationCommandId &&
        observation?.presentationRevision === context.presentationRevision ? data : null
    } finally { busy.value = false }
  }
  /** Query-only retry. Failure here must never turn an already committed write into failure. */
  async function retryCommandStateRefresh(): Promise<boolean> {
    const pending = pendingRecovery
    if (!pending || !run.value || run.value.id !== pending.runId || run.value.deviceId !== pending.deviceId) return false
    const sequence = ++refreshSequence; const epoch = stateEpoch
    const relevant = () => sequence === refreshSequence && pendingRecovery === pending && run.value?.id === pending.runId && run.value.deviceId === pending.deviceId
    commandStateRefresh.value = { status: 'refreshing', runId: pending.runId, requestId: pending.requestId, message: '业务操作已成功，正在重新查询课堂状态。' }
    try {
      // Reuse GET /classroom-runs/:id: full steps/state, supports authorized terminal reads.
      // Do not use currentClassroomState or load(), whose resource-library refresh is unrelated.
      const { data } = await http.get<ClassroomRunPayload>(`/classroom-runs/${pending.runId}`)
      if (!relevant()) return false
      if (!data || data.id !== pending.runId || data.deviceId !== pending.deviceId || !Array.isArray(data.steps) || !Number.isSafeInteger(data.version) || data.version < pending.committedRunVersion) throw new Error('Incomplete or stale classroom projection')
      if (stateEpoch !== epoch || data.version < run.value!.version) {
        if (run.value!.version < pending.committedRunVersion) throw new Error('Current classroom has not caught up')
        // A newer authoritative update won. Never overwrite it with this late query.
        clearCommandRefresh(); return true
      }
      adoptRun(data); clearCommandRefresh(); return true
    } catch {
      if (relevant()) commandStateRefresh.value = { status: 'failed', runId: pending.runId, requestId: pending.requestId, message: '业务操作已成功，课堂状态尚未刷新。请重新查询状态，不要重复执行操作。' }
      return false
    }
  }
  /** Shared by Store commands and the direct random-roll-call UI consumer. */
  function applyCommandResult<T>(result: ClassroomCommandResult<T>, origin: CommandRun): Promise<boolean> | void {
    if (!run.value || run.value.id !== origin.id || run.value.deviceId !== origin.deviceId) return
    lastCommandResult.value = result
    if (result.classroomState) {
      if (result.classroomState.version >= run.value.version) { clearCommandRefresh(); adoptRun(result.classroomState) }
      return
    }
    const recovery = result.recovery
    if (result.status === 'success' && recovery?.source === 'canonical_business_receipt' && recovery.contractVersion === 1 && recovery.refreshRequired === true && Number.isSafeInteger(recovery.committedRunVersion)) {
      pendingRecovery = { runId: origin.id, deviceId: origin.deviceId, requestId: result.requestId, committedRunVersion: recovery.committedRunVersion }
      return retryCommandStateRefresh()
    }
  }
  async function command(operation: ClassroomCommandOperation, parameters?: Record<string, unknown>, source: ClassroomCommandSource = 'screen', targetDeviceId?: number, requestId?: string) {
    if (!run.value) return null
    const origin = { id: run.value.id, deviceId: run.value.deviceId, version: run.value.version }
    const result = await executeClassroomCommand(origin, operation, { source, parameters, targetDeviceId, requestId })
    const refresh = applyCommandResult(result, origin)
    if (refresh) await refresh
    return result // Immutable first execution result, never replaced by the refreshed Run.
  }
  async function move(index: number, source: ClassroomCommandSource = 'screen') { if (!run.value || run.value.status !== 'running' || busy.value || isBreakActive.value) return; busy.value = true; player.requestControl('stop'); try { await command('switch_step', { stepIndex: index }, source); assistant.endInteraction() } finally { busy.value = false } }
  async function previous(source: ClassroomCommandSource = 'screen') { if (!run.value || run.value.status !== 'running' || run.value.currentStepIndex <= 0 || busy.value) return; busy.value = true; player.requestControl('stop'); try { await command('previous_step', undefined, source); assistant.endInteraction() } finally { busy.value = false } }
  async function next(source: ClassroomCommandSource = 'screen') { if (!run.value || run.value.status !== 'running' || run.value.currentStepIndex >= run.value.steps.length - 1 || busy.value) return; busy.value = true; player.requestControl('stop'); try { await command('next_step', undefined, source); assistant.endInteraction() } finally { busy.value = false } }
  function repeat() { if (run.value?.status === 'running') { player.requestControl('stop'); assistant.endInteraction() } }
  async function action(name: 'pause' | 'resume' | 'complete' | 'cancel', source: ClassroomCommandSource = 'screen') { if (!run.value || busy.value) return; const allowed = name === 'pause' ? run.value.status === 'running' : name === 'resume' ? run.value.status === 'paused' : run.value.status === 'running' || run.value.status === 'paused'; if (!allowed) return; busy.value = true; player.requestControl('stop'); try { const operation: ClassroomCommandOperation = name === 'pause' ? 'pause_class' : name === 'resume' ? 'resume_class' : name === 'complete' ? 'complete_class' : 'cancel_class'; await command(operation, undefined, source); if (name === 'complete' || name === 'cancel') assistant.endInteraction() } finally { busy.value = false } }
  async function startBreak(options: number | StartBreakOptions, source: ClassroomCommandSource = 'screen') { if (!run.value || busy.value || isBreakActive.value) return; const config: StartBreakOptions = typeof options === 'number' ? { durationSeconds: options, contentType: 'water' } : options; const resourceId = Number(player.currentResource?.id); if (Number.isInteger(resourceId) && resourceId > 0) await savePlayerState({ resourceId, status: player.playerStatus, currentTime: player.currentTime, duration: player.duration, pageIndex: player.pageIndex, pageCount: player.pageCount, zoom: player.zoom, volume: player.volume, muted: player.muted, autoPlay: false, updatedAt: new Date().toISOString() }, player.origin); busy.value = true; player.requestControl('stop'); try { await command('start_break', config, source) } finally { busy.value = false } }
  async function endBreak(source: ClassroomCommandSource = 'screen') { if (!run.value || busy.value || !isBreakActive.value) return; busy.value = true; try { await command('end_break', undefined, source) } finally { busy.value = false } }
  // 多端同步：轻量轮询刷新 run + serverNow。防并发堆积：pollInFlight 期间跳过，busy 时跳过。
  function stopPolling() { if (pollTimer !== null) { window.clearInterval(pollTimer); pollTimer = null } polling.value = false }
  function startPolling(intervalMs = 2000) { if (polling.value || !run.value) return; polling.value = true; pollTimer = window.setInterval(async () => { if (pollInFlight || busy.value || !run.value) return; pollInFlight = true; const origin = run.value; const epoch = stateEpoch; try { const { data } = await http.get<ClassroomRunPayload>(`/classroom-runs/${origin.id}`); if (!run.value || run.value.id !== origin.id || run.value.deviceId !== origin.deviceId || epoch !== stateEpoch || data.version < run.value.version) return; stateEpoch += 1; run.value = adaptRun(data); applyServerNow(data.serverNow); syncTimer() } catch { /* 轮询失败静默，不打断课堂 */ } finally { pollInFlight = false } }, intervalMs) }
  async function openResource(source: ClassroomCommandSource = 'screen') { if (!currentResource.value || !run.value || busy.value) return; busy.value = true; try { await command('open_resource', { resourceId: Number(currentResource.value.id) }, source, run.value.deviceId); player.openResource(currentResource.value, false, presentationOrigin(run.value!.id, run.value!.deviceId, run.value!.playerRecoverySuggestion)) } finally { busy.value = false } }
  function clear() { clearRun(); player.requestControl('stop'); assistant.endInteraction() }
  onScopeDispose(() => { if (capabilityExpiryTimer !== null) window.clearTimeout(capabilityExpiryTimer); stopTimer(); stopPolling() })
  return { capabilities, capabilityMessage, capabilityLoading, can, requireAction, attendanceAction, refreshCapabilities, refreshTeacherState, handleTeacherRejection, teacherCommand, run, loading, busy, error, elapsedSeconds, serverOffset, isBreakActive, breakRemainingSeconds, polling, currentStep, currentResource, resourceResolveState, progress, newlyStarted, load, loadScreenState, restore, savePlayerState, adoptRun, clearRun, command, applyCommandResult, lastCommandResult, commandStateRefresh, retryCommandStateRefresh, move, previous, next, repeat, pause: (source?: ClassroomCommandSource) => action('pause', source), resume: (source?: ClassroomCommandSource) => action('resume', source), complete: (source?: ClassroomCommandSource) => action('complete', source), cancel: (source?: ClassroomCommandSource) => action('cancel', source), startBreak, endBreak, startPolling, stopPolling, openResource, resolveCurrentResource, clear }
})
