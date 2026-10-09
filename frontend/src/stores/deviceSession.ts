import { defineStore } from 'pinia'
import { deviceSessionApi } from '@/api/deviceSession'

export const DEVICE_SESSION_STORAGE_KEY = 'kindergarten-device-session-v1'
export const DEVICE_HEARTBEAT_INTERVAL_MS = 30_000

type StoredTokens = Record<string, string>

function readStoredTokens(): StoredTokens {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(DEVICE_SESSION_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as StoredTokens) : {}
  } catch {
    return {}
  }
}

function writeStoredTokens(tokens: StoredTokens) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(DEVICE_SESSION_STORAGE_KEY, JSON.stringify(tokens))
}

// 正式大屏在线链路：页面打开期间每 ~30s 用受限设备凭证心跳一次，
// 页面关闭（stopHeartbeat）即停止，从而维护设备权威 online。
export const useDeviceSessionStore = defineStore('deviceSession', {
  state: () => ({
    tokens: {} as Record<number, string>,
    online: {} as Record<number, boolean>,
    error: {} as Record<number, string>,
    heartbeatTimer: null as ReturnType<typeof setInterval> | null,
    activeDeviceId: null as number | null,
  }),
  actions: {
    ensureSession(deviceId: number) {
      if (this.tokens[deviceId]) return this.tokens[deviceId]
      const persisted = readStoredTokens()
      const persistedToken = persisted[String(deviceId)]
      if (persistedToken) {
        this.tokens[deviceId] = persistedToken
        return persistedToken
      }
      return null
    },

    async issue(deviceId: number): Promise<string> {
      if (this.tokens[deviceId]) return this.tokens[deviceId]
      const { data } = await deviceSessionApi.issue(deviceId)
      this.tokens[deviceId] = data.token
      this.error[deviceId] = ''
      writeStoredTokens({ ...readStoredTokens(), [String(deviceId)]: data.token })
      return data.token
    },

    clear(deviceId: number) {
      delete this.tokens[deviceId]
      const persisted = readStoredTokens()
      delete persisted[String(deviceId)]
      writeStoredTokens(persisted)
    },

    // 返回 lastError，失败时返回 null；成功时为心跳结果 status。
    async beat(deviceId: number, token: string): Promise<string | null> {
      try {
        const { data } = await deviceSessionApi.heartbeat(token)
        this.online[deviceId] = data.online
        this.error[deviceId] = ''
        return data.status
      } catch (cause) {
        const status = (cause as { response?: { status?: number } })?.response?.status
        this.online[deviceId] = false
        this.error[deviceId] = String(status ?? 'unknown')
        // 凭证失效/过期/找不到：清除本地凭证，便于下次重新 issue。
        if (status === 401 || status === 404 || status === 410) this.clear(deviceId)
        return null
      }
    },

    startHeartbeat(deviceId: number, intervalMs: number = DEVICE_HEARTBEAT_INTERVAL_MS) {
      this.stopHeartbeat()
      if (!deviceId) return
      this.activeDeviceId = deviceId
      const kickOff = async () => {
        let token = this.ensureSession(deviceId)
        if (!token) {
          try {
            token = await this.issue(deviceId)
          } catch {
            this.error[deviceId] = 'issue-failed'
            return
          }
        }
        await this.beat(deviceId, token)
      }
      void kickOff()
      this.heartbeatTimer = setInterval(() => {
        const current = this.tokens[deviceId]
        if (current) void this.beat(deviceId, current)
      }, intervalMs)
    },

    stopHeartbeat() {
      if (this.heartbeatTimer !== null) {
        clearInterval(this.heartbeatTimer)
        this.heartbeatTimer = null
      }
      this.activeDeviceId = null
    },
  },
})
