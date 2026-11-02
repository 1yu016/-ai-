import { http } from './http'
import type { ClassroomCommandOperation, ClassroomCommandResult } from '@/services/classroomCommandBus'
import type { ClassroomRunPayload } from '@/stores/lessonRun'

export const CLASSROOM_CONTROL_SESSION_HEADER = 'X-Classroom-Control-Session'
export const CLASSROOM_CONTROL_SESSION_KEY = 'kindergarten-classroom-control-session-v1'
let freshnessSequence = 0
// Embedded phone browsers may reuse GET responses across control-session headers.
// Never put credentials in the URL; use a non-secret, unique cache discriminator.
export const mobileFreshness = () => `${Date.now()}-${++freshnessSequence}`

export type ClassroomControlSession = {
  id: string
  token: string
  classroomRunId: number
  targetDeviceId: number
  expiresAt: string
}

export type MobileJoinResult = {
  classId: number
  classroomId: number
  deviceId: number
  lessonRunId: number | null
  deviceCode: string
  controlSession: ClassroomControlSession | null
}

export type MobileClassroomState = {
  controlActive: boolean
  serverNow: string
  resumeCursor?: string | null
  session: { id: string; expiresAt: string; lastHeartbeatAt: string | null }
  classroom: ClassroomRunPayload & {
    timing?: { elapsedSeconds?: number }
    playerRecoverySuggestion?: Record<string, unknown>
    interactionState?: Record<string, unknown>
  }
  screen: {
    deviceId: number
    online: boolean
    status: string
    lastOnlineAt: string | null
  }
  attendance: {
    runId: number
    classId: number
    items: Array<{ studentId: number; status: string }>
    attendanceState: Record<string, string>
  }
  recentRollCall: null | {
    id: number
    studentId: number
    displayName: string
    mode: string
    createdAt: string
  }
  recentReward: null | {
    id: number
    studentId: number
    displayName: string
    category: string
    points: number
    stars: number
    revokedAt: string | null
    createdAt: string
  }
  interaction: Record<string, unknown>
}

export type MobileCommandExecutionStatus = 'queued' | 'sending' | 'received' | 'executed' | 'failed' | 'expired'
export type MobileCommandResponse = {
  commandId?: string
  requestId?: string
  executionStatus?: MobileCommandExecutionStatus
  errorCode?: string | null
  expiresAt?: string | null
  resumeCursor?: string | null
  deliveryStatus?: 'confirmed' | 'received' | 'failed'
  confirmedAt?: string
  result?: { classroomState?: ClassroomRunPayload | null }
}

export type MobileStoredCommand = {
  requestId: string
  classroomRunId: number
  targetDeviceId: number | null
  source: string
  operation: string
  status: string
  updatedAt: string
  responsePayload: ClassroomCommandResult | null
}

function sessionHeaders(token: string) {
  return { [CLASSROOM_CONTROL_SESSION_HEADER]: token }
}

export const classroomMobileApi = {
  queryCommand: (requestId: string) => http.get<MobileStoredCommand>(`/classroom-commands/${encodeURIComponent(requestId)}`),
  join: (data: { ticket: string; deviceCode: string }) =>
    http.post<MobileJoinResult>('/classroom-mobile/join', data),
  state: (token: string) =>
    http.get<MobileClassroomState>('/classroom-mobile/state', {
      params: { _fresh: mobileFreshness() },
      headers: { ...sessionHeaders(token), 'Cache-Control': 'no-cache, no-store', Pragma: 'no-cache' },
    }),
  heartbeat: (token: string) =>
    http.post('/classroom-mobile/heartbeat', null, {
      headers: sessionHeaders(token),
    }),
  revoke: (token: string) =>
    http.post('/classroom-mobile/revoke', null, {
      headers: sessionHeaders(token),
    }),
  command: (
    token: string,
    data: {
      requestId: string
      expectedVersion: number
      operation: ClassroomCommandOperation
      targetDeviceId: number
      issuedAt: string
      ttlMs: number
      parameters?: Record<string, unknown>
    },
  ) => http.post<MobileCommandResponse>('/classroom-mobile/commands', data, { headers: sessionHeaders(token) }),
}

export function apiUrl(path: string): string {
  const configured = String(http.defaults.baseURL || '').trim()
  return new URL(path, configured || window.location.origin).toString()
}
