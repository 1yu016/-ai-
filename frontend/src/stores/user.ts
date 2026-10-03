import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export type TeacherInfo = {
  userId?: number
  teacherId?: number
  administratorId?: number
  account: string
  name: string
  role?: string
  userType?: 'teacher' | 'administrator'
  schoolId?: string | null
}

const STORAGE_KEYS = {
  accessToken: 'kindergarten-ai-access-token',
  refreshToken: 'kindergarten-ai-refresh-token',
  teacherInfo: 'kindergarten-ai-teacher-info',
  visitorId: 'kindergarten-ai-visitor-id',
} as const

function createVisitorId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()

  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-')
}

function isTeacherInfo(value: unknown): value is TeacherInfo {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<TeacherInfo>
  return (
    typeof candidate.account === 'string' &&
    candidate.account.length > 0 &&
    typeof candidate.name === 'string' &&
    candidate.name.length > 0
  )
}

function readTeacherInfo(): TeacherInfo | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.teacherInfo)
    if (!saved) return null
    const parsed: unknown = JSON.parse(saved)
    return isTeacherInfo(parsed) ? parsed : null
  } catch {
    return null
  }
}

export const useUserStore = defineStore('user', () => {
  const isLogin = ref(false)
  const teacherInfo = ref<TeacherInfo | null>(null)
  const accessToken = ref('')
  const refreshToken = ref('')
  const visitorId = ref('')

  const isAdmin = computed(
    () =>
      teacherInfo.value?.userType === 'administrator' ||
      teacherInfo.value?.role === 'admin',
  )
  let initialized = false

  function initialize() {
    if (initialized) return
    initialized = true

    const savedVisitorId = localStorage
      .getItem(STORAGE_KEYS.visitorId)
      ?.trim()
    visitorId.value = savedVisitorId || createVisitorId()
    localStorage.setItem(STORAGE_KEYS.visitorId, visitorId.value)

    const savedToken =
      localStorage.getItem(STORAGE_KEYS.accessToken)?.trim() || ''
    const savedRefreshToken =
      localStorage.getItem(STORAGE_KEYS.refreshToken)?.trim() || ''
    const savedTeacherInfo = readTeacherInfo()
    if (savedToken && savedTeacherInfo) {
      accessToken.value = savedToken
      refreshToken.value = savedRefreshToken
      teacherInfo.value = savedTeacherInfo
      isLogin.value = true
      return
    }

    localStorage.removeItem(STORAGE_KEYS.accessToken)
    localStorage.removeItem(STORAGE_KEYS.refreshToken)
    localStorage.removeItem(STORAGE_KEYS.teacherInfo)
  }

  function setLogin(token: string, info: TeacherInfo, refreshTokenValue = '') {
    accessToken.value = token
    refreshToken.value = refreshTokenValue
    teacherInfo.value = info
    isLogin.value = true
    localStorage.setItem(STORAGE_KEYS.accessToken, token)
    localStorage.setItem(STORAGE_KEYS.refreshToken, refreshTokenValue)
    localStorage.setItem(STORAGE_KEYS.teacherInfo, JSON.stringify(info))
  }

  function updateTokens(token: string, newRefreshToken = '') {
    accessToken.value = token
    if (newRefreshToken) refreshToken.value = newRefreshToken
    localStorage.setItem(STORAGE_KEYS.accessToken, token)
    if (newRefreshToken) {
      localStorage.setItem(STORAGE_KEYS.refreshToken, newRefreshToken)
    }
  }

  function logout() {
    isLogin.value = false
    accessToken.value = ''
    refreshToken.value = ''
    teacherInfo.value = null
    localStorage.removeItem(STORAGE_KEYS.accessToken)
    localStorage.removeItem(STORAGE_KEYS.refreshToken)
    localStorage.removeItem(STORAGE_KEYS.teacherInfo)
  }

  return {
    isLogin,
    teacherInfo,
    accessToken,
    refreshToken,
    visitorId,
    isAdmin,
    initialize,
    setLogin,
    updateTokens,
    logout,
  }
})

export { STORAGE_KEYS as USER_STORAGE_KEYS }
