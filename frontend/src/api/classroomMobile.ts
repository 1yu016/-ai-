import { http } from './http'
import type { ClassroomCommandOperation } from '@/services/classroomCommandBus'
import type { ClassroomRunPayload } from '@/stores/lessonRun'

export const CLASSROOM_CONTROL_SESSION_HEADER = 'X-Classroom-Control-Session'
export const CLASSROOM_CONTROL_SESSION_KEY = 'kindergarten-classroom-control-session-v1'

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

function sessionHeaders(token: string) {
  return { [CLASSROOM_CONTROL_SESSION_HEADER]: token }
}

export const classroomMobileApi = {
  join: (data: { ticket: string; deviceCode: string }) =>
    http.post<MobileJoinResult>('/classroom-mobile/join', data),
  state: (token: string) =>
    http.get<MobileClassroomState>('/classroom-mobile/state', {
      headers: sessionHeaders(token),
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
  ) => http.post<{
    deliveryStatus: 'confirmed'
    confirmedAt: string
    result: { classroomState: ClassroomRunPayload }
  }>('/classroom-mobile/commands', data, { headers: sessionHeaders(token) }),
}

export function apiUrl(path: string): string {
  const configured = String(http.defaults.baseURL || '').trim()
  return new URL(path, configured || window.location.origin).toString()
}
