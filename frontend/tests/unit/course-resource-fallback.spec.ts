import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '@/api/http'
import { useUserStore } from '@/stores/user'
import { useCourseResourceStore, type ServerResource } from '@/stores/courseResource'

// Stage 6.6：单资源按 id 解析 fallback —— 先查已加载列表/缓存，再 GET /resources/:id。
const imageResource: ServerResource = {
  id: 12,
  title: '红色圆形卡片',
  aliases: [],
  description: '颜色认知',
  resourceType: 'image',
  category: '图片卡片',
  ageGroup: 'small',
  tags: ['颜色'],
  fileUrl: '/resources/12/download',
  coverUrl: null,
  fileName: 'red.jpg',
  mimeType: 'image/jpeg',
  fileSize: 300,
  duration: null,
  reviewStatus: 'approved',
  createdAt: '2026-01-01T00:00:00.000Z',
}
const resource500: ServerResource = {
  ...imageResource,
  id: 500,
  title: '第 500 条资源（不在第一页）',
  fileUrl: '/resources/500/download',
}

const emptyPage = { data: { items: [], total: 0, page: 1, pageSize: 100 } }

describe('courseResource store · Stage 6.6 按 id fallback', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const user = useUserStore()
    user.setLogin('token', { teacherId: 1, account: 'teacher', name: '老师' })
  })

  it('资源已在已加载列表 → 不重复请求 GET /resources/:id', async () => {
    vi.spyOn(http, 'get').mockResolvedValue({
      data: { items: [imageResource], total: 1, page: 1, pageSize: 100 },
    } as never)
    const store = useCourseResourceStore()
    await store.refreshLibrary()
    const result = await store.ensureResourceById(12)
    expect(result.id).toBe(12)
    const singleGet = vi
      .mocked(http.get)
      .mock.calls.filter(([url]) => String(url) === '/resources/12')
    expect(singleGet).toHaveLength(0)
  })

  it('列表缺失 → GET /resources/:id fallback 成功，二次访问命中缓存不再请求', async () => {
    const get = vi.spyOn(http, 'get').mockResolvedValue(emptyPage as never)
    const store = useCourseResourceStore()
    await store.refreshLibrary()
    get.mockResolvedValue({ data: resource500 } as never)
    const first = await store.ensureResourceById(500)
    expect(first.id).toBe(500)
    expect(get).toHaveBeenCalledWith('/resources/500')
    // 同步查找命中缓存
    expect(store.getResourceById(500)?.id).toBe(500)
    // 二次访问命中缓存，不再发请求
    get.mockClear()
    const second = await store.ensureResourceById(500)
    expect(second.id).toBe(500)
    expect(get).not.toHaveBeenCalledWith('/resources/500')
  })

  it('同一 resourceId 并发请求合并（in-flight 去重）', async () => {
    const get = vi.spyOn(http, 'get').mockResolvedValue(emptyPage as never)
    const store = useCourseResourceStore()
    await store.refreshLibrary()
    get.mockClear()
    let resolveFetch: (value: unknown) => void = () => undefined
    get.mockImplementation((url) => {
      if (String(url) === '/resources/500') return new Promise((r) => { resolveFetch = r })
      return Promise.resolve(emptyPage)
    })
    const first = store.ensureResourceById(500)
    const second = store.ensureResourceById(500)
    resolveFetch({ data: resource500 })
    const [a, b] = await Promise.all([first, second])
    expect(a.id).toBe(500)
    expect(b.id).toBe(500)
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('404 等后端错误原样抛出，交由调用方映射提示', async () => {
    const get = vi.spyOn(http, 'get').mockResolvedValue(emptyPage as never)
    const store = useCourseResourceStore()
    await store.refreshLibrary()
    get.mockRejectedValue(
      Object.assign(new Error('404'), { isAxiosError: true, response: { status: 404 } }),
    )
    await expect(store.ensureResourceById(500)).rejects.toThrow('404')
  })
})
