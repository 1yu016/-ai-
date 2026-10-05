import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadAvatarModel, type AvatarLoadContext } from '@/avatar/AvatarLoader'

// 受保护资产加载：验证 Authorization 只在 AvatarLoader 内部组装，token 不进入 URL。
// 解析结论由 GLB/VRM 真实文件用例覆盖（需测试资产就绪后补充）。

function mockFetch(ok = true, status = 200) {
  const fetchMock = vi.fn(async () => ({
    ok,
    status,
    arrayBuffer: async () => new ArrayBuffer(0),
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('authenticated asset loading', () => {
  it('attaches the bearer token to the model request when provided', async () => {
    const fetchMock = mockFetch(false, 404)
    const context: AvatarLoadContext = { getToken: () => 'test-token' }

    await expect(loadAvatarModel('/avatars/assets/1/content', 'glb', context)).rejects.toThrow()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/avatars/assets/1/content')
    expect(init.headers).toEqual({ Authorization: 'Bearer test-token' })
  })

  it('does not attach Authorization when no token is available', async () => {
    const fetchMock = mockFetch(false, 404)

    await expect(loadAvatarModel('/avatar/static.glb', 'glb', { getToken: () => null })).rejects.toThrow()

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.headers).toBeUndefined()
  })

  it('rejects when the protected asset returns a failed status', async () => {
    mockFetch(false, 404)
    await expect(loadAvatarModel('/avatars/assets/1/content', 'glb', { getToken: () => 't' })).rejects.toThrow(/HTTP 404/)
  })

  it('reads the token lazily at request time', async () => {
    const fetchMock = mockFetch(false, 404)
    const getToken = vi.fn(() => 'lazy-token')
    await expect(loadAvatarModel('/avatars/assets/9/content', 'glb', { getToken })).rejects.toThrow()
    expect(getToken).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})