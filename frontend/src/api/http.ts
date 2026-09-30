import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { ElMessage } from 'element-plus'
import router from '@/router'
import { pinia } from '@/stores'
import { useUserStore } from '@/stores/user'

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
let refreshPromise: Promise<boolean> | null = null

function refreshAccessToken(): Promise<boolean> {
  if (!refreshPromise) {
    const userStore = useUserStore(pinia)
    const refreshToken = userStore.refreshToken
    if (!refreshToken) {
      refreshPromise = Promise.resolve(false)
    } else {
      refreshPromise = refreshClient
        .post('/auth/refresh', { refreshToken })
        .then((response) => {
          const data: {
            access_token?: string
            refresh_token?: string
          } = response.data ?? {}
          if (typeof data.access_token === 'string' && data.access_token) {
            userStore.updateTokens(data.access_token, data.refresh_token ?? '')
            return true
          }
          return false
        })
        .catch(() => false)
    }
    // 无论成功失败都释放单飞锁，避免无 refreshToken 时锁被永久占住。
    refreshPromise = refreshPromise.finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

function isAuthEndpoint(path: string): boolean {
  return path === '/auth/login' || path === '/auth/refresh'
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
      const ok = await refreshAccessToken()
      if (ok) {
        // 重放原请求；请求拦截器会用新 token 覆盖 Authorization。
        return http.request(config)
      }
    }

    if (error.response?.status === 401 && !isAuthEndpoint(path)) {
      useUserStore(pinia).logout()
      if (router.currentRoute.value.path !== '/chat') void router.push('/')
      ElMessage.error('登录状态已失效，请重新登录')
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
