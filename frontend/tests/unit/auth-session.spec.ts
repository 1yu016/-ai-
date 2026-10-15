import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '@/api/http'
import {
  logoutAuthenticatedSession,
  restoreAuthenticatedProfile,
} from '@/services/authSession'
import { pinia } from '@/stores'
import { useUserStore } from '@/stores/user'

describe('登录会话服务', () => {
  beforeEach(() => {
    useUserStore(pinia).$dispose()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('页面恢复时通过 profile 更新持久化用户资料', async () => {
    const user = useUserStore(pinia)
    user.setLogin('token-1', { account: 'teacher', name: '旧名称' }, 'refresh-1')
    vi.spyOn(http, 'get').mockResolvedValue({
      data: { account: 'teacher', name: '王老师', role: 'teacher', userType: 'teacher' },
    })

    await restoreAuthenticatedProfile()

    expect(http.get).toHaveBeenCalledWith('/auth/profile', { timeout: 8000 })
    expect(user.teacherInfo?.name).toBe('王老师')
    expect(user.isLogin).toBe(true)
  })

  it('退出时调用服务端 logout 并清除本地凭证', async () => {
    const user = useUserStore(pinia)
    user.setLogin('token-1', { account: 'teacher', name: '王老师' }, 'refresh-1')
    const post = vi.spyOn(http, 'post').mockResolvedValue({ data: undefined })

    const revoked = await logoutAuthenticatedSession()

    expect(post).toHaveBeenCalledWith('/auth/logout', { refreshToken: 'refresh-1' })
    expect(revoked).toBe(true)
    expect(user.isLogin).toBe(false)
    expect(user.accessToken).toBe('')
  })

  it('服务端暂时不可用时仍清除本地凭证', async () => {
    const user = useUserStore(pinia)
    user.setLogin('token-1', { account: 'teacher', name: '王老师' }, 'refresh-1')
    vi.spyOn(http, 'post').mockRejectedValue(new Error('network down'))

    const revoked = await logoutAuthenticatedSession()

    expect(revoked).toBe(false)
    expect(user.isLogin).toBe(false)
  })
})
