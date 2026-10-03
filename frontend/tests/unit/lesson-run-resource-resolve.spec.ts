import { flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '@/api/http'
import { useUserStore } from '@/stores/user'
import { useCourseResourceStore, type ServerResource } from '@/stores/courseResource'
import { useResourcePlayerStore } from '@/stores/resourcePlayer'
import { useLessonRunStore, type ClassroomRunPayload } from '@/stores/lessonRun'

// Stage 6.6：课堂大屏 —— step.resourceId 不在已加载列表时走 GET /resources/:id fallback，
// 成功打开；404/403/网络失败给出可展示提示；快速切换步骤时旧资源迟到响应不覆盖最新步骤。
const image500: ServerResource = {
  id: 500,
  title: '第 500 条资源',
  aliases: [],
  description: '',
  resourceType: 'image',
  category: '图片卡片',
  ageGroup: 'small',
  tags: [],
  fileUrl: '/resources/500/download',
  coverUrl: null,
  fileName: 'r500.jpg',
  mimeType: 'image/jpeg',
  fileSize: 300,
  duration: null,
  reviewStatus: 'approved',
  createdAt: '2026-01-01T00:00:00.000Z',
}
const image1: ServerResource = { ...image500, id: 1, title: '资源一', fileUrl: '/resources/1/download' }
const image2: ServerResource = { ...image500, id: 2, title: '资源二', fileUrl: '/resources/2/download' }

function runWithResources(
  currentStepIndex: number,
  resourceId0: number | null,
  resourceId1: number | null,
): ClassroomRunPayload {
  return {
    id: 9,
    lessonPlanId: 3,
    deviceId: 1,
    version: 1,
    status: 'running',
    currentStepIndex,
    title: '颜色课堂',
    objectives: '认识颜色',
    steps: [
      { stepIndex: 0, title: '环节一', type: 'resource', content: '看', resourceId: resourceId0, durationSeconds: 60 },
      { stepIndex: 1, title: '环节二', type: 'resource', content: '看', resourceId: resourceId1, durationSeconds: 60 },
    ],
    startedAt: '2026-10-02T07:00:00.000Z',
    updatedAt: '2026-10-02T08:00:00.000Z',
  }
}

function axiosError(status: number | undefined, message = 'request failed'): Error {
  const error = new Error(message)
  ;(error as unknown as { isAxiosError: boolean }).isAxiosError = true
  ;(error as unknown as { response?: { status?: number } }).response = status === undefined ? undefined : { status }
  return error
}

describe('lessonRun store · Stage 6.6 课堂资源解析', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const user = useUserStore()
    user.setLogin('token', { teacherId: 1, account: 'teacher', name: '老师' })
  })

  it('资源已在已加载列表 → 解析直接 ready，不触发 /resources/:id', async () => {
    vi.spyOn(http, 'get').mockResolvedValue({
      data: { items: [image1], total: 1, page: 1, pageSize: 100 },
    } as never)
    const resources = useCourseResourceStore()
    await resources.refreshLibrary()
    const get = vi.mocked(http.get)
    get.mockClear()
    const store = useLessonRunStore()
    store.adoptRun(runWithResources(0, 1, null))
    await flushPromises()
    expect(store.currentResource?.id).toBe(1)
    expect(store.resourceResolveState.status).toBe('ready')
    expect(get).not.toHaveBeenCalledWith('/resources/1')
  })

  it('列表不存在 → GET /resources/:id fallback 成功 → currentResource 可打开', async () => {
    vi.spyOn(http, 'get').mockImplementation((url) => {
      const path = String(url)
      if (path === '/resources/500') return Promise.resolve({ data: image500 })
      return Promise.resolve({ data: { items: [], total: 0, page: 1, pageSize: 100 } })
    })
    const store = useLessonRunStore()
    store.adoptRun(runWithResources(0, 500, null))
    await nextTick()
    expect(store.resourceResolveState.status).toBe('loading')
    await flushPromises()
    expect(store.resourceResolveState.status).toBe('ready')
    expect(store.currentResource?.id).toBe(500)
    expect(store.currentResource?.title).toBe('第 500 条资源')
    // 打开资源会真正进入播放器 store
    store.openResource()
    expect(useResourcePlayerStore().currentResource?.id).toBe(500)
  })

  it('fallback 404 → 明确提示资源不可用，课堂不崩', async () => {
    vi.spyOn(http, 'get').mockImplementation((url) => {
      const path = String(url)
      if (path === '/resources/500') return Promise.reject(axiosError(404))
      return Promise.resolve({ data: { items: [], total: 0, page: 1, pageSize: 100 } })
    })
    const store = useLessonRunStore()
    store.adoptRun(runWithResources(0, 500, null))
    await flushPromises()
    expect(store.resourceResolveState.status).toBe('missing')
    expect(store.resourceResolveState.message).toContain('不可用')
    // 课堂与其它步骤不受影响
    expect(store.run?.steps).toHaveLength(2)
    expect(store.run?.currentStepIndex).toBe(0)
  })

  it('fallback 403 → 提示无权访问', async () => {
    vi.spyOn(http, 'get').mockImplementation((url) => {
      const path = String(url)
      if (path === '/resources/500') return Promise.reject(axiosError(403))
      return Promise.resolve({ data: { items: [], total: 0, page: 1, pageSize: 100 } })
    })
    const store = useLessonRunStore()
    store.adoptRun(runWithResources(0, 500, null))
    await flushPromises()
    expect(store.resourceResolveState.status).toBe('missing')
    expect(store.resourceResolveState.message).toContain('无权')
  })

  it('network error → 提示加载失败可重试，不导致课堂崩溃', async () => {
    vi.spyOn(http, 'get').mockImplementation((url) => {
      const path = String(url)
      if (path === '/resources/500') return Promise.reject(axiosError(undefined, 'offline'))
      return Promise.resolve({ data: { items: [], total: 0, page: 1, pageSize: 100 } })
    })
    const store = useLessonRunStore()
    store.adoptRun(runWithResources(0, 500, null))
    await flushPromises()
    expect(store.resourceResolveState.status).toBe('missing')
    expect(store.resourceResolveState.message).toContain('网络')
    expect(store.run?.status).toBe('running')
    // 切换到无资源步骤仍可正常继续
    store.adoptRun(runWithResources(1, null, null))
    await flushPromises()
    expect(store.resourceResolveState.status).toBe('idle')
  })

  it('快速切换步骤：resourceId=1 迟到返回不覆盖 resourceId=2（stale guard）', async () => {
    let resolveOne: (value: unknown) => void = () => undefined
    vi.spyOn(http, 'get').mockImplementation((url) => {
      const path = String(url)
      if (path === '/resources/1') return new Promise((r) => { resolveOne = r })
      if (path === '/resources/2') return Promise.resolve({ data: image2 })
      return Promise.resolve({ data: { items: [], total: 0, page: 1, pageSize: 100 } })
    })
    const store = useLessonRunStore()
    // 先进入步骤 A（resourceId=1），请求挂起
    store.adoptRun(runWithResources(0, 1, 2))
    await flushPromises()
    expect(store.resourceResolveState.status).toBe('loading')
    // 快速切换到步骤 B（resourceId=2），立即解析成功
    store.adoptRun(runWithResources(1, 1, 2))
    await flushPromises()
    expect(store.resourceResolveState.status).toBe('ready')
    expect(store.currentResource?.id).toBe(2)
    // 步骤 A 的资源 1 迟到返回，不得覆盖最新状态
    resolveOne({ data: image1 })
    await flushPromises()
    expect(store.currentResource?.id).toBe(2)
    expect(store.resourceResolveState.status).toBe('ready')
  })
})
