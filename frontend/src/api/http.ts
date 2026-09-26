import axios, { type AxiosError } from 'axios'
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
  (error: AxiosError) => {
    const path = requestPath(error.config?.url)
    if (error.response?.status === 401 && path !== '/auth/login') {
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
