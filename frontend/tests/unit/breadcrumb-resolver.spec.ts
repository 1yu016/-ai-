import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/router'

const classDetail = vi.fn()
const students = vi.fn()
const getResource = vi.fn()

vi.mock('@/api/platform', async (loadOriginal) => {
  const original = await loadOriginal<typeof import('@/api/platform')>()
  return { ...original, platformApi: { ...original.platformApi, classDetail, students } }
})
vi.mock('@/api/resources', async (loadOriginal) => {
  const original = await loadOriginal<typeof import('@/api/resources')>()
  return { ...original, resourceApi: { ...original.resourceApi, get: getResource } }
})

describe('breadcrumbResolver', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const { clearBreadcrumbCache } = await import('@/router/breadcrumbResolver')
    clearBreadcrumbCache()
    classDetail.mockResolvedValue({ data: { id: 7, name: '阳光中班' } })
    students.mockResolvedValue({ data: { items: [{ id: 9, name: '小雨' }] } })
    getResource.mockResolvedValue({ data: { id: 12, title: '两只老虎' } })
  })

  it('异步解析班级名和学生名', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/classes/7/students/9')
    const route = router.currentRoute.value
    const { resolveBreadcrumbs } = await import('@/router/breadcrumbResolver')
    const items = await resolveBreadcrumbs(route, { account: 't', name: '教师', userType: 'teacher' })
    expect(items.map((item) => item.label)).toEqual(['我的班级', '阳光中班', '学生', '小雨'])
  })

  it('异步解析资源名并保留详情入口', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/resources/12/preview')
    const route = router.currentRoute.value
    const { resolveBreadcrumbs } = await import('@/router/breadcrumbResolver')
    const items = await resolveBreadcrumbs(route, { account: 't', name: '教师', userType: 'teacher' })
    expect(items.map((item) => item.label)).toEqual(['资源库', '两只老虎', '预览'])
    expect(items[1]?.to).toEqual({ name: 'resource-detail', params: { id: '12' } })
  })
})
