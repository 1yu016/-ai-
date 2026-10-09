import { http } from './http'

export const DEVICE_SESSION_HEADER = 'x-device-session'

export type DeviceSessionIssued = {
  deviceId: number
  token: string
  id: number
  expiresAt: string
}

export type DeviceHeartbeatResult = {
  deviceId: number
  online: boolean
  status: string
  lastOnlineAt: string
}

// 正式大屏 Device Session：sign 使用 teacher JWT（教师负责绑定/管理设备），
// heartbeat 仅依赖受限的设备凭证 x-device-session，不携带 teacher JWT。
export const deviceSessionApi = {
  issue: (deviceId: number) =>
    http.post<DeviceSessionIssued>(`/devices/${deviceId}/device-session`),
  heartbeat: (token: string) =>
    http.post<DeviceHeartbeatResult>(
      '/device-session/heartbeat',
      null,
      { headers: { [DEVICE_SESSION_HEADER]: token } },
    ),
}