import type { AxiosHeaders, AxiosRequestConfig, AxiosResponse } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { USER_STORAGE_KEYS, useUserStore } from '@/stores/user'
import { pinia } from '@/stores'
import { apiErrorMessage, http } from '@/api/http'

function response(config: AxiosRequestConfig): AxiosResponse {
  return { data: { ok: true }, status: 200, statusText: 'OK', headers: {}, config: config as AxiosResponse['config'] }
}

// 模拟 axios 默认 XHR 适配器（供 refreshClient 调 /auth/refresh 使用）。
function installFakeXhr(body: Record<string, unknown>, status = 200, onCall?: () => void) {
  class FakeXHR {
    readyState = 0
    status = 0
    statusText = ''
    responseText = ''
    response = ''
    onreadystatechange: (() => void) | null = null
    onabort: (() => void) | null = null
    onerror: (() => void) | null = null

    open(): void {}

    setRequestHeader(): void {}

    getAllResponseHeaders(): string {
      return ''
    }

    getResponseHeader(): string | null {
      return null
    }

    send(): void {
      onCall?.()
      setTimeout(() => {
        this.readyState = 4
        this.status = status
        this.statusText = status === 200 ? 'OK' : 'Error'
        this.responseText = JSON.stringify(body)
        this.response = this.responseText
        this.onreadystatechange?.()
      }, 0)
    }

    abort(): void {
      this.readyState = 0
      this.onabort?.()
    }
  }
  vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest)
}

function seededLogin(): void {
  localStorage.setItem(USER_STORAGE_KEYS.accessToken, 'expired-token')
  localStorage.setItem(USER_STORAGE_KEYS.refreshToken, 'refresh-1')
  localStorage.setItem(USER_STORAGE_KEYS.teacherInfo, JSON.stringify({ teacherId: 1, account: 't', name: '老师' }))
  useUserStore(pinia).initialize()
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
    expect((chatConfig?.headers as AxiosHeaders | undefined)?.get('Authorization')).toBe('Bearer bearer-token')
    expect(JSON.parse(String(chatConfig?.data))).toMatchObject({ text: '你好', visitorId: user.visitorId })

    let ttsConfig: AxiosRequestConfig | undefined
    await http.post('/ai/tts', { text: '请看一看' }, { adapter: async (config) => { ttsConfig = config; return response(config) } })
    expect(JSON.parse(String(ttsConfig?.data))).toEqual({ text: '请看一看' })

    let planConfig: AxiosRequestConfig | undefined
    await http.get('/lesson-plans', { adapter: async (config) => { planConfig = config; return response(config) } })
    expect((planConfig?.headers as AxiosHeaders | undefined)?.get('Authorization')).toBe('Bearer bearer-token')
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

  it('silently refreshes the token and replays the request on 401', async () => {
    seededLogin()
    const user = useUserStore(pinia)
    installFakeXhr({
      access_token: 'fresh-token',
      refresh_token: 'refresh-2',
      expires_in: 7200,
      userType: 'teacher',
    })

    let calls = 0
    const result = await http.get('/lesson-plans', {
      adapter: async (config) => {
        calls += 1
        if (calls === 1) {
          return Promise.reject({
            config,
            response: { status: 401, data: { message: 'expired' }, statusText: 'Unauthorized', headers: {} },
            isAxiosError: true,
            toJSON: () => ({}),
          })
        }
        return response(config)
      },
    })

    expect(result.data).toEqual({ ok: true })
    expect(calls).toBe(2)
    expect(user.accessToken).toBe('fresh-token')
    expect(user.refreshToken).toBe('refresh-2')
    expect(localStorage.getItem(USER_STORAGE_KEYS.accessToken)).toBe('fresh-token')
    expect(localStorage.getItem(USER_STORAGE_KEYS.refreshToken)).toBe('refresh-2')
  })

  it('clears login when token refresh fails on 401', async () => {
    seededLogin()
    const user = useUserStore(pinia)
    installFakeXhr({ message: 'refresh failed' }, 401)

    const error = {
      config: { url: '/lesson-plans' },
      response: { status: 401, data: { message: 'expired' } },
      isAxiosError: true,
      toJSON: () => ({}),
    }
    await expect(http.get('/lesson-plans', { adapter: async () => Promise.reject(error) })).rejects.toBe(error)
    await new Promise((resolve) => window.setTimeout(resolve, 20))
    expect(user.isLogin).toBe(false)
    expect(localStorage.getItem(USER_STORAGE_KEYS.accessToken)).toBeNull()
    expect(localStorage.getItem(USER_STORAGE_KEYS.refreshToken)).toBeNull()
  })

  it('CASE A: single-flight — concurrent 401s share one refresh and all replay', async () => {
    seededLogin()
    const user = useUserStore(pinia)
    let refreshCalls = 0
    installFakeXhr(
      { access_token: 'fresh-a', refresh_token: 'refresh-a', expires_in: 7200 },
      200,
      () => { refreshCalls += 1 },
    )

    // 每个业务请求各自的适配器：第 1 次返回 401，之后重放成功。
    const mkAdapter = () => {
      let n = 0
      return async (config: AxiosRequestConfig) => {
        n += 1
        if (n === 1) {
          return Promise.reject({ config, response: { status: 401, data: { message: 'expired' } }, statusText: 'Unauthorized', headers: {}, isAxiosError: true, toJSON: () => ({}) })
        }
        return response(config)
      }
    }

    const [resultA, resultB] = await Promise.all([
      http.get('/plans/a', { adapter: mkAdapter() }),
      http.get('/plans/b', { adapter: mkAdapter() }),
    ])

    expect(resultA.data).toEqual({ ok: true })
    expect(resultB.data).toEqual({ ok: true })
    expect(refreshCalls).toBe(1)
    expect(user.accessToken).toBe('fresh-a')
  })

  it('CASE B: refresh 401 does not recurse and logs the user out', async () => {
    seededLogin()
    const user = useUserStore(pinia)
    let refreshCalls = 0
    installFakeXhr({ message: 'invalid refresh token' }, 401, () => { refreshCalls += 1 })

    const error = { config: { url: '/plans/a' }, response: { status: 401, data: { message: 'expired' } }, statusText: 'Unauthorized', headers: {}, isAxiosError: true, toJSON: () => ({}) }
    await expect(http.get('/plans/a', { adapter: async () => Promise.reject(error) })).rejects.toBe(error)

    await new Promise((resolve) => window.setTimeout(resolve, 20))
    expect(refreshCalls).toBe(1)
    expect(user.isLogin).toBe(false)
    expect(localStorage.getItem(USER_STORAGE_KEYS.refreshToken)).toBeNull()
  })

  it('CASE C: replay 401 does not refresh again and does not loop', async () => {
    seededLogin()
    const user = useUserStore(pinia)
    let refreshCalls = 0
    installFakeXhr(
      { access_token: 'fresh-c', refresh_token: 'refresh-c', expires_in: 7200 },
      200,
      () => { refreshCalls += 1 },
    )

    // 第 1 次与原请求 →401，重放后 →401；因 _retried 不再刷新。
    let n = 0
    const adapter = async (config: AxiosRequestConfig) => {
      n += 1
      if (n <= 2) {
        return Promise.reject({ config, response: { status: 401, data: { message: 'expired' } }, statusText: 'Unauthorized', headers: {}, isAxiosError: true, toJSON: () => ({}) })
      }
      return response(config)
    }

    await expect(http.get('/plans/a', { adapter })).rejects.toMatchObject({ response: { status: 401 } })
    await new Promise((resolve) => window.setTimeout(resolve, 20))
    expect(refreshCalls).toBe(1)
    expect(user.isLogin).toBe(false)
  })

  it('CASE D: 403 does not trigger refresh and keeps error semantics', async () => {
    seededLogin()
    const user = useUserStore(pinia)
    let refreshCalls = 0
    installFakeXhr({ access_token: 'fresh-d' }, 200, () => { refreshCalls += 1 })

    const error = { config: { url: '/resources' }, response: { status: 403, data: { message: 'forbidden' } }, statusText: 'Forbidden', headers: {}, isAxiosError: true, toJSON: () => ({}) }
    await expect(http.get('/resources', { adapter: async () => Promise.reject(error) })).rejects.toBe(error)

    expect(refreshCalls).toBe(0)
    expect(user.isLogin).toBe(true)
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
