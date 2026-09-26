import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { USER_STORAGE_KEYS, useUserStore } from '@/stores/user'

describe('user store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('restores a valid login and clears it on logout', () => {
    localStorage.setItem(USER_STORAGE_KEYS.accessToken, 'token-1')
    localStorage.setItem(USER_STORAGE_KEYS.teacherInfo, JSON.stringify({ teacherId: 7, account: 'teacher', name: '王老师' }))
    const store = useUserStore()
    store.initialize()
    expect(store.isLogin).toBe(true)
    expect(store.teacherInfo?.teacherId).toBe(7)
    store.logout()
    expect(store.isLogin).toBe(false)
    expect(localStorage.getItem(USER_STORAGE_KEYS.accessToken)).toBeNull()
  })

  it('persists one visitor id across store recreation', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('123e4567-e89b-42d3-a456-426614174000')
    const first = useUserStore()
    first.initialize()
    expect(first.visitorId).toBe('123e4567-e89b-42d3-a456-426614174000')
    expect(localStorage.getItem(USER_STORAGE_KEYS.visitorId)).toBe(first.visitorId)
    setActivePinia(createPinia())
    const restored = useUserStore()
    restored.initialize()
    expect(restored.visitorId).toBe(first.visitorId)
  })

  it('rejects malformed persisted teacher information', () => {
    localStorage.setItem(USER_STORAGE_KEYS.accessToken, 'stale-token')
    localStorage.setItem(USER_STORAGE_KEYS.teacherInfo, '{"teacherId":"bad"}')
    const store = useUserStore()
    store.initialize()
    expect(store.isLogin).toBe(false)
    expect(localStorage.getItem(USER_STORAGE_KEYS.accessToken)).toBeNull()
  })
})
