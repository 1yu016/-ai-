import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { ElMessage } from 'element-plus'
import router from '@/router'
import { pinia } from '@/stores'
import { USER_STORAGE_KEYS, useUserStore } from '@/stores/user'

const PUBLIC_VISITOR_ENDPOINTS = new Set([
  '/ai/chat',
  '/ai/asr',
  '/ai/voice-chat',
  '/emotion/report',
])

function requestPath(url?: string): string {
  if (!url) return ''
  return new URL(url, window.location.origin).pathname
}

function appendVisitorId(data: unknown, visitorId: string): unknown {
  if (data instanceof FormData) {
    data.set('visitorId', visitorId)
    return data
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return { ...data, visitorId }
  }
  return { visitorId }
}

export const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '',
})

// 独立的 axios 实例用于静默续期，避免触发自身拦截器的递归 401 处理。
const refreshClient = axios.create({
  baseURL: http.defaults.baseURL,
})

// 单飞(single-flight)：并发多个 401 时共享同一次刷新请求。
let refreshPromise: Promise<RefreshOutcome> | null = null
let authRedirectPromise: Promise<unknown> | null = null
let forbiddenRedirectPromise: Promise<unknown> | null = null

// 续期结果必须区分「凭证真的失效」和「网络/上游临时异常」，
// 后者不能把教师踢回登录页，否则合法菜单也会被误报为登录状态已失效。
type RefreshOutcome =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'network' }

const REFRESH_LOCK_NAME = 'kindergarten-ai-auth-refresh'

type LockManagerLike = {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>
}

function storedAccessToken(): string {
  if (typeof localStorage === 'undefined') return ''
  return localStorage.getItem(USER_STORAGE_KEYS.accessToken)?.trim() || ''
}

function storedRefreshToken(): string {
  if (typeof localStorage === 'undefined') return ''
  return localStorage.getItem(USER_STORAGE_KEYS.refreshToken)?.trim() || ''
}

// 多个标签页共享 localStorage；另一个标签页完成续期后，本页必须先接受它的新 token，
// 否则会用已被轮换的旧 refreshToken 再次续期，被服务端判定为失效并整体登出。
function syncTokensFromStorage(): void {
  const accessToken = storedAccessToken()
  if (!accessToken) return
  const userStore = useUserStore(pinia)
  if (accessToken === userStore.accessToken) return
  userStore.updateTokens(accessToken, storedRefreshToken())
}

function bearerTokenOf(config?: InternalAxiosRequestConfig): string {
  const header = config?.headers as
    | ({ get?: (name: string) => unknown } & Record<string, unknown>)
    | undefined
  const value = typeof header?.get === 'function'
    ? header.get('Authorization')
    : header?.Authorization
  return typeof value === 'string' ? value.replace(/^Bearer\s+/i, '').trim() : ''
}

async function performRefresh(refreshToken: string): Promise<RefreshOutcome> {
  const userStore = useUserStore(pinia)
  if (!refreshToken) return { ok: false, reason: 'invalid' }
  try {
    const response = await refreshClient.post('/auth/refresh', { refreshToken })
    const data: {
      access_token?: string
      refresh_token?: string
    } = response.data ?? {}
    if (typeof data.access_token === 'string' && data.access_token) {
      userStore.updateTokens(data.access_token, data.refresh_token ?? '')
      return { ok: true }
    }
    return { ok: false, reason: 'invalid' }
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      // 服务端已明确拒绝该 refresh token：这是真正的会话失效。
      // 但如果期间其他标签页已经写入新的 token，则按成功处理，直接重放请求。
      const latestRefresh = storedRefreshToken()
      if (latestRefresh && latestRefresh !== refreshToken && storedAccessToken()) {
        syncTokensFromStorage()
        return { ok: true }
      }
      return { ok: false, reason: 'invalid' }
    }
    // 无响应：断网、超时或后端暂时不可达，保留登录态，提示用户稍后重试。
    return { ok: false, reason: 'network' }
  }
}

function refreshAccessToken(refreshToken: string): Promise<RefreshOutcome> {
  if (refreshPromise) return refreshPromise

  const run = () => performRefresh(refreshToken)
  const locks = typeof navigator !== 'undefined'
    ? (navigator as Navigator & { locks?: LockManagerLike }).locks
    : undefined
  const request = locks ? locks.request(REFRESH_LOCK_NAME, run) : run()

  refreshPromise = request.finally(() => {
    refreshPromise = null
  })
  return refreshPromise
}

function isAuthEndpoint(path: string): boolean {
  return path === '/auth/login' ||
    path === '/auth/admin/login' ||
    path === '/auth/refresh' ||
    path === '/auth/logout'
}

function protectedRedirectTarget(): string | null {
  const current = router.currentRoute.value
  if (current.name !== 'login' && current.meta.requiresAuth) return current.fullPath
  return null
}

function redirectExpiredSession(): void {
  const target = protectedRedirectTarget()
  useUserStore(pinia).logout()
  if (router.currentRoute.value.name === 'login' || authRedirectPromise) return

  authRedirectPromise = router
    .replace({
      name: 'login',
      query: target ? { redirect: target, reason: 'expired' } : { reason: 'expired' },
    })
    .finally(() => {
      authRedirectPromise = null
    })
  ElMessage.error('登录状态已失效，请重新登录')
}

function redirectForbidden(): void {
  const current = router.currentRoute.value
  if (current.name === 'forbidden' || current.name === 'login' || forbiddenRedirectPromise) return
  forbiddenRedirectPromise = router
    .replace({ name: 'forbidden', query: { from: current.fullPath } })
    .finally(() => {
      forbiddenRedirectPromise = null
    })
}

http.interceptors.request.use((config) => {
  const userStore = useUserStore(pinia)
  const path = requestPath(config.url)

  if (PUBLIC_VISITOR_ENDPOINTS.has(path)) {
    config.data = appendVisitorId(config.data, userStore.visitorId)
  }
  if (userStore.accessToken) {
    config.headers.set(
      'Authorization',
      `Bearer ${userStore.accessToken}`,
    )
  }

  return config
})

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined
    const path = requestPath(config?.url)

    const shouldRefresh =
      error.response?.status === 401 &&
      !!config &&
      !config._retried &&
      !isAuthEndpoint(path)

    if (shouldRefresh) {
      config._retried = true
      const usedToken = bearerTokenOf(config)
      // 另一个标签页可能已经完成续期：直接接受它的新 token 并重放，避免用旧凭证再续期。
      syncTokensFromStorage()
      const latestToken = storedAccessToken()
      if (latestToken && usedToken && latestToken !== usedToken) {
        return http.request(config)
      }
      const outcome = await refreshAccessToken(storedRefreshToken() || useUserStore(pinia).refreshToken)
      if (outcome.ok) {
        // 重放原请求；请求拦截器会用新 token 覆盖 Authorization。
        return http.request(config)
      }
      if (!outcome.reason || outcome.reason === 'network') {
        // 网络或后端暂时不可达：保留登录态，不假装会话失效。
        ElMessage.error('网络异常，暂时无法续期登录，请检查网络后重试')
        return Promise.reject(error)
      }
    }

    if (error.response?.status === 401 && !isAuthEndpoint(path)) {
      redirectExpiredSession()
    }
    // A consent rejection may follow an already committed display command.
    // Keep the panel alive to query both original command IDs; never resend.
    const body = error.response?.data
    const artworkConsentRejected = /^\/artworks\/\d+\/deliver$/.test(path) &&
      body !== null && typeof body === 'object' && 'code' in body && body.code === 'ARTWORK_CONSENT_REQUIRED'
    if (error.response?.status === 403 && !isAuthEndpoint(path) && !artworkConsentRejected) {
      redirectForbidden()
    }
    return Promise.reject(error)
  },
)

export function apiErrorMessage(error: unknown, fallback: string): string {
  if (!axios.isAxiosError(error)) {
    return error instanceof Error && error.message ? error.message : fallback
  }
  if (!error.response) return '网络连接失败，请确认后端服务已启动后重试。'

  const body: unknown = error.response.data
  if (body && typeof body === 'object' && 'message' in body) {
    const message = (body as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
    if (Array.isArray(message) && message.length > 0) {
      return message.map(String).join('；')
    }
  }
  return fallback
}

export function apiErrorStatus(error: unknown): number | null {
  return axios.isAxiosError(error) ? (error.response?.status ?? null) : null
}
