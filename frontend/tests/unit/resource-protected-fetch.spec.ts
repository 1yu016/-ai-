import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '@/api/http'
import { fetchAuthedBlob } from '@/api/resources'

// 受保护媒体下载：验证走 axios http 客户端（其拦截器注入 Authorization 头），
// token 绝不进入 URL，并返回可释放的 object URL。
const originalCreate = URL.createObjectURL
const originalRevoke = URL.revokeObjectURL

function setupBlobGlobals() {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-0' as unknown as string)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
}

describe('fetchAuthedBlob (protected media download)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setupBlobGlobals()
  })
  afterEach(() => {
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
  })

  it('downloads through the axios http client (which injects Authorization via interceptor) as a blob', async () => {
    vi.spyOn(http, 'get').mockResolvedValue({ data: new Blob(['media']) })
    const { url, revoke } = await fetchAuthedBlob(2)
    expect(http.get).toHaveBeenCalledWith('/resources/2/download', expect.objectContaining({ responseType: 'blob' }))
    expect(url).toBe('blob:mock-0')
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    revoke()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-0')
  })

  it('never puts a token or query string into the request URL', async () => {
    vi.spyOn(http, 'get').mockResolvedValue({ data: new Blob(['m']) })
    await fetchAuthedBlob(7)
    const call = vi.mocked(http.get).mock.calls[0] as unknown as [string]
    expect(call[0]).toBe('/resources/7/download')
    expect(call[0]).not.toContain('token')
    expect(call[0]).not.toContain('?')
  })

  it('rejects (propagates) when the protected download fails', async () => {
    vi.spyOn(http, 'get').mockRejectedValue(new Error('401'))
    await expect(fetchAuthedBlob(9)).rejects.toThrow('401')
  })
})