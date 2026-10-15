import { apiErrorStatus, http } from '@/api/http'
import { pinia } from '@/stores'
import { useUserStore, type TeacherInfo } from '@/stores/user'

/**
 * 用服务端资料校验本地恢复的会话。网络暂时不可用时保留本地状态；
 * 401 由统一 HTTP 拦截器清理并跳转登录页。
 */
export async function restoreAuthenticatedProfile(): Promise<void> {
  const user = useUserStore(pinia)
  user.initialize()
  if (!user.isLogin || !user.accessToken) return

  try {
    const profile = await http.get<TeacherInfo>('/auth/profile', { timeout: 8000 })
    user.updateProfile(profile.data)
  } catch (cause) {
    if (apiErrorStatus(cause) !== 401) {
      console.warn('登录资料校验暂时不可用，将保留本地会话。', cause)
    }
  }
}

/** 先撤销服务端刷新会话，再无条件清理本地凭证。 */
export async function logoutAuthenticatedSession(): Promise<boolean> {
  const user = useUserStore(pinia)
  const refreshToken = user.refreshToken
  let serverRevoked = true

  try {
    if (user.accessToken && refreshToken) {
      await http.post('/auth/logout', { refreshToken })
    }
  } catch {
    serverRevoked = false
  } finally {
    user.logout()
  }

  return serverRevoked
}
