import type { AxiosRequestConfig, AxiosResponse } from 'axios'
import { beforeEach, describe, expect, it } from 'vitest'
import { USER_STORAGE_KEYS, useUserStore } from '@/stores/user'
import { pinia } from '@/stores'
import { apiErrorMessage, http } from '@/api/http'

function response(config: AxiosRequestConfig): AxiosResponse {
  return { data: { ok: true }, status: 200, statusText: 'OK', headers: {}, config: config as AxiosResponse['config'] }
}

describe('HTTP interceptors', () => {
  beforeEach(() => {
    useUserStore(pinia).$dispose()
    localStorage.clear()
  })

  it('injects bearer token and visitor id only where required', async () => {
    const user = useUserStore(pinia)
    user.initialize()
    user.setLogin('bearer-token', { teacherId: 1, account: 'teacher', name: '老师' })
    let chatConfig: AxiosRequestConfig | undefined
    await http.post('/ai/chat', { text: '你好' }, { adapter: async (config) => { chatConfig = config; return response(config) } })
    expect(chatConfig?.headers?.get?.('Authorization')).toBe('Bearer bearer-token')
    expect(JSON.parse(String(chatConfig?.data))).toMatchObject({ text: '你好', visitorId: user.visitorId })

    let ttsConfig: AxiosRequestConfig | undefined
    await http.post('/ai/tts', { text: '请看一看' }, { adapter: async (config) => { ttsConfig = config; return response(config) } })
    expect(JSON.parse(String(ttsConfig?.data))).toEqual({ text: '请看一看' })

    let planConfig: AxiosRequestConfig | undefined
    await http.get('/lesson-plans', { adapter: async (config) => { planConfig = config; return response(config) } })
    expect(planConfig?.headers?.get?.('Authorization')).toBe('Bearer bearer-token')
    expect(planConfig?.data).toBeUndefined()
  })

  it('clears login state after a 401 response', async () => {
    localStorage.setItem(USER_STORAGE_KEYS.accessToken, 'expired')
    localStorage.setItem(USER_STORAGE_KEYS.teacherInfo, JSON.stringify({ teacherId: 1, account: 't', name: '老师' }))
    const user = useUserStore(pinia)
    user.initialize()
    const error = { config: { url: '/lesson-plans' }, response: { status: 401, data: { message: 'expired' } }, isAxiosError: true, toJSON: () => ({}) }
    await expect(http.get('/lesson-plans', { adapter: async () => Promise.reject(error) })).rejects.toBe(error)
    await new Promise((resolve) => window.setTimeout(resolve, 20))
    expect(user.isLogin).toBe(false)
    expect(localStorage.getItem(USER_STORAGE_KEYS.accessToken)).toBeNull()
  })

  it.each([
    [409, '教案已在其他页面修改，请刷新后重试'],
    [429, '请求过于频繁，请稍后再试'],
    [500, '服务器暂时不可用'],
  ])('surfaces safe API messages for status %i', (status, message) => {
    const error = { isAxiosError: true, response: { status, data: { message } } }
    expect(apiErrorMessage(error, '操作失败')).toBe(message)
  })

  it('uses a friendly message for a network interruption', () => {
    expect(apiErrorMessage({ isAxiosError: true }, '操作失败')).toContain('网络连接失败')
  })
})
