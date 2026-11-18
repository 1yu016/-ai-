import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  apiUrl,
  CLASSROOM_CONTROL_SESSION_HEADER,
  CLASSROOM_CONTROL_SESSION_KEY,
  classroomMobileApi,
  mobileFreshness,
  type ClassroomControlSession,
  type MobileClassroomState,
} from '@/api/classroomMobile'
import { apiErrorMessage, apiErrorStatus } from '@/api/http'
import { useUserStore } from '@/stores/user'
import {
  classroomRequestId,
  type ClassroomCommandOperation,
} from '@/services/classroomCommandBus'

type ConnectionState = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'offline' | 'expired'
type DeliveryState = 'queued' | 'sending' | 'received' | 'executed' | 'failed' | 'expired'
export type MobileCommandStatus = {
  commandId: string
  operation: ClassroomCommandOperation
  expectedVersion: number
  targetDeviceId: number
  executionStatus: DeliveryState
  issuedAt: string
  expiresAt: string
  confirmedAt?: string
  errorCode?: string
}

function readSession(): ClassroomControlSession | null {
  try {
    const raw = sessionStorage.getItem(CLASSROOM_CONTROL_SESSION_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<ClassroomControlSession>
    return value.token && value.classroomRunId && value.targetDeviceId && value.expiresAt
      ? value as ClassroomControlSession
      : null
  } catch {
    return null
  }
}

export const useClassroomMobileStore = defineStore('classroom-mobile', () => {
  const session = ref<ClassroomControlSession | null>(readSession())
  const state = ref<MobileClassroomState | null>(null)
  const connection = ref<ConnectionState>('idle')
  const lastError = ref('')
  const delivery = ref<Record<string, DeliveryState>>({})
  const commands = ref<MobileCommandStatus[]>([])
  const lastConfirmedAt = ref<string | null>(null)
  let streamAbort: AbortController | null = null
  let heartbeatTimer: number | null = null
  let reconnectTimer: number | null = null
  let reconnectAttempt = 0
  let stopped = true
  let serverClock: { epochMs: number; monotonicMs: number } | null = null
  let requireFullRefresh = true
  let sessionGeneration = 0

  const connected = computed(() => connection.value === 'online')
  const canControl = computed(() => connected.value && !!state.value?.screen.online)

  function setSession(value: ClassroomControlSession) {
    // A new scan owns a new connection. Old state/streams must never expire it.
    stop(true)
    connection.value = 'idle'
    lastError.value = ''
    delivery.value = {}
    commands.value = []
    lastConfirmedAt.value = null
    reconnectAttempt = 0
    session.value = value
    sessionStorage.setItem(CLASSROOM_CONTROL_SESSION_KEY, JSON.stringify(value))
  }

  function serverNowMs() {
    return serverClock ? serverClock.epochMs + performance.now() - serverClock.monotonicMs : NaN
  }

  function isSessionExpired() {
    // Before a server sample, a fast phone clock must not destroy a valid session.
    return !session.value || (serverClock !== null && Date.parse(session.value.expiresAt) <= serverNowMs())
  }

  function updateAuthoritativeState(next: MobileClassroomState) {
    if (!session.value || next.classroom.id !== session.value.classroomRunId ||
      next.screen.deviceId !== session.value.targetDeviceId || next.session.id !== session.value.id) {
      throw new Error('连接数据与本次扫码课堂不一致，正在重新获取。')
    }
    // A stream read can finish after a newer command response. Never roll this Run back.
    // Revocation/terminal facts must still take effect even if their snapshot is older.
    const terminal = !next.controlActive || ['completed', 'cancelled', 'failed'].includes(next.classroom.status)
    if (!terminal && state.value && next.classroom.version < state.value.classroom.version) return
    const serverNow = Date.parse(next.serverNow)
    if (Number.isFinite(serverNow)) serverClock = { epochMs: serverNow, monotonicMs: performance.now() }
    state.value = next
    if (!next.controlActive || ['completed', 'cancelled', 'failed'].includes(next.classroom.status)) {
      lastError.value = '课堂已结束，手机控制权限已失效。'
      connection.value = 'expired'
      stop(true)
    }
  }

  async function refreshState() {
    if (!session.value) throw new Error('请先扫码连接课堂')
    const current = session.value
    const generation = sessionGeneration
    try {
      const response = await classroomMobileApi.state(current.token)
      if (generation !== sessionGeneration || session.value?.token !== current.token) return response.data
      updateAuthoritativeState(response.data)
      return response.data
    } catch (error) {
      if (generation !== sessionGeneration || session.value?.token !== current.token) throw error
      const status = apiErrorStatus(error)
      if (status === 401 || status === 403 || status === 410) {
        lastError.value = apiErrorMessage(error, '手机课堂控制会话已失效，请重新扫码。')
        connection.value = 'expired'
        stop(true)
      }
      throw error
    }
  }

  function start() {
    if (!session.value) {
      connection.value = 'expired'
      return
    }
    if (isSessionExpired()) {
      clearLocalSession()
      connection.value = 'expired'
      return
    }
    stopped = false
    connection.value = state.value ? 'reconnecting' : 'connecting'
    requireFullRefresh = true
    startHeartbeat()
    void connectStream()
  }

  async function connectStream() {
    const current = session.value
    const generation = sessionGeneration
    const user = useUserStore()
    if (stopped || !current || !user.accessToken) return
    if (isSessionExpired()) {
      lastError.value = '手机课堂控制会话已过期，请重新扫码。'
      connection.value = 'expired'
      stop(true)
      return
    }
    streamAbort?.abort()
    const controller = new AbortController()
    streamAbort = controller
    const ownsConnection = () => generation === sessionGeneration && session.value?.token === current.token && streamAbort === controller && !controller.signal.aborted
    try {
      if (requireFullRefresh) {
        await refreshState()
        if (stopped || !ownsConnection()) return
        if (isSessionExpired()) {
          connection.value = 'expired'
          stop(true)
          return
        }
        requireFullRefresh = false
      }
      const response = await fetch(apiUrl(`/classroom-mobile/events?_fresh=${mobileFreshness()}`), {
        headers: {
          Authorization: `Bearer ${user.accessToken}`,
          [CLASSROOM_CONTROL_SESSION_HEADER]: current.token,
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache, no-store',
        },
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!ownsConnection()) { await response.body?.cancel(); return }
      if (!response.ok || !response.body) {
        const error = new Error(`实时通道连接失败（${response.status}）`)
        ;(error as Error & { status?: number }).status = response.status
        throw error
      }
      connection.value = 'online'
      reconnectAttempt = 0
      lastError.value = ''
      await readEventStream(response.body, ownsConnection)
      if (!stopped && ownsConnection()) scheduleReconnect('实时通道已断开')
    } catch (error) {
      if (!ownsConnection() || stopped) return
      const status = apiErrorStatus(error) || (error as Error & { status?: number }).status
      if (status === 401 || status === 403 || status === 410) {
        lastError.value = error instanceof Error ? error.message : '手机课堂控制会话已失效'
        connection.value = 'expired'
        stop(true)
        return
      }
      scheduleReconnect(error instanceof Error ? error.message : '实时通道连接失败')
    }
  }

  async function readEventStream(stream: ReadableStream<Uint8Array>, ownsConnection: () => boolean) {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let eventType = 'message'
    while (!stopped && ownsConnection()) {
      const { done, value } = await reader.read()
      if (!ownsConnection()) { await reader.cancel(); return }
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const blocks = buffer.split(/\r?\n\r?\n/)
      buffer = blocks.pop() || ''
      for (const block of blocks) {
        let data = ''
        eventType = 'message'
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith('event:')) eventType = line.slice(6).trim()
          if (line.startsWith('data:')) data += line.slice(5).trim()
        }
        if (!data) continue
        const parsed = JSON.parse(data) as unknown
        if (eventType === 'state') {
          updateAuthoritativeState(parsed as MobileClassroomState)
          if (connection.value !== 'expired') connection.value = 'online'
        } else if (eventType === 'session_invalid') {
          lastError.value = String((parsed as { message?: unknown }).message || '课堂控制会话已失效')
          connection.value = 'expired'
          stop(true)
          return
        }
      }
    }
  }

  function scheduleReconnect(message: string) {
    if (stopped) return
    connection.value = navigator.onLine ? 'reconnecting' : 'offline'
    lastError.value = message
    requireFullRefresh = true
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer)
    const waitMs = Math.min(15_000, 1000 * 2 ** reconnectAttempt++)
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null
      void connectStream()
    }, waitMs)
  }

  function startHeartbeat() {
    if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer)
    heartbeatTimer = window.setInterval(() => {
      if (!session.value || stopped) return
      const current = session.value
      const generation = sessionGeneration
      void classroomMobileApi.heartbeat(current.token).catch((error) => {
        if (generation !== sessionGeneration || session.value?.token !== current.token) return
        const status = apiErrorStatus(error)
        if (status === 401 || status === 403 || status === 410) {
          lastError.value = apiErrorMessage(error, '手机课堂控制会话已失效，请重新扫码。')
          connection.value = 'expired'
          stop(true)
        } else if (connection.value === 'online') {
          connection.value = 'reconnecting'
        }
      })
    }, 15_000)
  }

  async function execute(
    operation: ClassroomCommandOperation,
    parameters?: Record<string, unknown>,
  ) {
    const currentSession = session.value
    const currentState = state.value
    if (!currentSession || !currentState) throw new Error('课堂控制状态尚未同步')
    if (!serverClock) {
      const sample = Date.parse(currentState.serverNow)
      if (!Number.isFinite(sample)) throw new Error('服务器时间尚未同步，请刷新课堂状态')
      serverClock = { epochMs: sample, monotonicMs: performance.now() }
    }
    if (!currentState.screen.online) throw new Error('大屏离线，指令不会发送')
    const requestId = classroomRequestId(`mobile-${operation}`)
    const issuedAt = new Date(serverNowMs()).toISOString()
    const ttlMs = 30_000
    const expiresAtMs = Date.parse(issuedAt) + ttlMs
    const entry: MobileCommandStatus = {
      commandId: requestId,
      operation,
      expectedVersion: currentState.classroom.version,
      targetDeviceId: currentSession.targetDeviceId,
      executionStatus: 'queued',
      issuedAt,
      expiresAt: new Date(expiresAtMs).toISOString(),
    }
    commands.value = [entry, ...commands.value.filter((item) => item.commandId !== requestId)].slice(0, 20)
    delivery.value[requestId] = 'queued'
    const payload = {
      requestId,
      expectedVersion: currentState.classroom.version,
      operation,
      targetDeviceId: currentSession.targetDeviceId,
      issuedAt,
      ttlMs,
      ...(parameters ? { parameters } : {}),
    }
    let firstError: unknown
    let terminalStatus: DeliveryState | null = null
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const connectionClosed = stopped && connection.value !== 'idle'
      if (serverNowMs() >= expiresAtMs || connectionClosed) {
        entry.executionStatus = 'expired'
        delivery.value[requestId] = 'expired'
        throw new Error('指令已过期，未执行')
      }
      entry.executionStatus = 'sending'
      delivery.value[requestId] = 'sending'
      try {
        let response
        try {
          response = await classroomMobileApi.command(currentSession.token, payload)
        } catch (sendError) {
          // A lost response is not proof of failure. Read the original command
          // before considering an identical, idempotent retry.
          if (apiErrorStatus(sendError) !== null) throw sendError
          const stored = await classroomMobileApi.queryCommand(requestId).catch(() => null)
          const record = stored?.data
          const result = record?.responsePayload
          if (!record || record.requestId !== requestId || record.classroomRunId !== currentSession.classroomRunId ||
            record.targetDeviceId !== currentSession.targetDeviceId || record.source !== 'mobile' ||
            record.operation !== operation || record.status !== 'success' || result?.status !== 'success' ||
            result.requestId !== requestId || result.runId !== currentSession.classroomRunId || result.operation !== operation) throw sendError
          response = { data: { deliveryStatus: 'confirmed' as const, confirmedAt: record.updatedAt, result } }
        }
        const executionStatus = response.data.executionStatus
          ?? (response.data.deliveryStatus === 'confirmed' ? 'executed' : response.data.deliveryStatus === 'received' ? 'received' : 'failed')
        entry.executionStatus = executionStatus
        entry.errorCode = response.data.errorCode ?? undefined
        delivery.value[requestId] = executionStatus
        if (executionStatus !== 'executed') {
          terminalStatus = executionStatus
          throw new Error(response.data.errorCode || '服务端尚未确认指令执行')
        }
        // The formal command response is authoritative too. Adopt it before a state
        // read or an SSE frame can reintroduce the pre-command classroom version.
        const confirmedClassroom = response.data.result?.classroomState
        if (session.value?.token === currentSession.token && state.value && confirmedClassroom &&
          confirmedClassroom.id === currentSession.classroomRunId &&
          confirmedClassroom.deviceId === currentSession.targetDeviceId &&
          confirmedClassroom.version >= state.value.classroom.version) {
          updateAuthoritativeState({
            ...state.value,
            serverNow: response.data.confirmedAt ?? state.value.serverNow,
            classroom: confirmedClassroom,
            interaction: confirmedClassroom.interactionState ?? state.value.interaction,
          })
        }
        entry.confirmedAt = response.data.confirmedAt
        lastConfirmedAt.value = response.data.confirmedAt ?? null
        try {
          await refreshState()
        } catch (refreshError) {
          if (operation === 'complete_class' || operation === 'cancel_class') {
            stop(true)
            connection.value = 'expired'
          } else {
            scheduleReconnect(apiErrorMessage(refreshError, '操作已确认，正在重新同步课堂状态'))
          }
        }
        return response.data
      } catch (error) {
        firstError ??= error
        if (apiErrorStatus(error) === 409) {
          const message = apiErrorMessage(error, '课堂操作被拒绝')
          const versionConflict = /版本|VERSION_CONFLICT/i.test(message)
          entry.executionStatus = 'failed'
          entry.errorCode = versionConflict ? 'VERSION_CONFLICT' : 'COMMAND_REJECTED'
          delivery.value[requestId] = 'failed'
          for (const pending of commands.value) {
            if (versionConflict && pending.commandId !== requestId && (pending.executionStatus === 'queued' || pending.executionStatus === 'sending')) {
              pending.executionStatus = 'failed'
              pending.errorCode = 'VERSION_CONFLICT'
              delivery.value[pending.commandId] = 'failed'
            }
          }
          await refreshState().catch(() => undefined)
          break
        }
        const hasServerResponse = !!(error && typeof error === 'object' && 'response' in error && (error as { response?: unknown }).response)
        if (attempt === 0 && !hasServerResponse && serverNowMs() < expiresAtMs && !(stopped && connection.value !== 'idle')) {
          await new Promise((resolve) => window.setTimeout(resolve, 900))
          continue
        }
        break
      }
    }
    const expired = serverNowMs() >= expiresAtMs
    entry.executionStatus = terminalStatus ?? (expired ? 'expired' : 'failed')
    delivery.value[requestId] = entry.executionStatus
    throw new Error(apiErrorMessage(firstError, expired ? '指令已过期，未执行' : '指令发送失败'))
  }

  async function revoke() {
    if (session.value) {
      try {
        await classroomMobileApi.revoke(session.value.token)
      } catch {
        // 本地仍立即清理；服务端还会在令牌/课堂到期时撤销。
      }
    }
    stop(true)
  }

  function stop(clear = false) {
    sessionGeneration++
    const preserveExpired = connection.value === 'expired'
    stopped = true
    streamAbort?.abort()
    streamAbort = null
    if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer)
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer)
    heartbeatTimer = null
    reconnectTimer = null
    connection.value = clear ? (preserveExpired ? 'expired' : 'idle') : connection.value
    if (clear) clearLocalSession()
  }

  function clearLocalSession() {
    serverClock = null
    session.value = null
    state.value = null
    sessionStorage.removeItem(CLASSROOM_CONTROL_SESSION_KEY)
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      if (!stopped) {
        connection.value = 'reconnecting'
        requireFullRefresh = true
        void connectStream()
      }
    })
    window.addEventListener('offline', () => { connection.value = 'offline' })
    window.addEventListener('classroom-mobile-logout', () => stop(true))
  }

  return {
    session,
    state,
    connection,
    connected,
    canControl,
    lastError,
    delivery,
    lastConfirmedAt,
    commands,
    setSession,
    start,
    stop,
    revoke,
    refreshState,
    execute,
  }
})
