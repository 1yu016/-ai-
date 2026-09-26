import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '@/api/http'
import { useUserStore } from '@/stores/user'
import { normalizeServerResource, useCourseResourceStore, type ServerResource } from '@/stores/courseResource'
import { useResourcePlayerStore } from '@/stores/resourcePlayer'

const serverResource: ServerResource = {
  id: 12,
  title: '春天图片',
  aliases: ['春景'],
  description: '观察春天',
  resourceType: 'image',
  category: '图片卡片',
  ageGroup: 'middle',
  tags: ['春天'],
  fileUrl: '/uploads/resources/spring.jpg',
  coverUrl: null,
  fileName: 'spring.jpg',
  mimeType: 'image/jpeg',
  fileSize: 20,
  duration: null,
  reviewStatus: 'approved',
  createdAt: '2026-01-01T00:00:00.000Z',
}

describe('course resource store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const user = useUserStore()
    user.setLogin('token', { teacherId: 1, account: 'teacher', name: '老师' })
  })

  it('normalizes and loads accessible server resources', async () => {
    vi.spyOn(http, 'get').mockResolvedValue({ data: { items: [serverResource], total: 1, page: 1, pageSize: 20 } })
    const store = useCourseResourceStore()
    await store.refreshLibrary({ keyword: '春天' })
    expect(store.total).toBe(1)
    expect(store.sortedResources[0]).toMatchObject({ id: 12, mediaType: 'image', source: 'library' })
    expect(http.get).toHaveBeenCalledWith('/resources', expect.objectContaining({ params: expect.objectContaining({ keyword: '春天' }) }))
  })

  it('reports network failures without retaining stale resources', async () => {
    vi.spyOn(http, 'get').mockRejectedValue(new Error('offline'))
    const store = useCourseResourceStore()
    await store.refreshLibrary()
    expect(store.sortedResources).toEqual([])
    expect(store.loadError).toBe('offline')
  })

  it('rejects malformed server resources', () => {
    expect(normalizeServerResource({ ...serverResource, resourceType: 'bad' as never })).toBeNull()
  })
})

describe('resource player store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('opens without autoplay, tracks errors, and closes cleanly', () => {
    const resource = normalizeServerResource(serverResource)!
    const store = useResourcePlayerStore()
    store.openResource(resource, false)
    expect(store.currentResource?.id).toBe(12)
    expect(store.autoPlayOnOpen).toBe(false)
    store.setStatus('error', '资源加载失败')
    expect(store.errorMessage).toBe('资源加载失败')
    store.close()
    expect(store.currentResource).toBeNull()
    expect(store.playerStatus).toBe('idle')
  })

  it('clamps volume and emits monotonic control requests', () => {
    const store = useResourcePlayerStore()
    store.setVolume(2)
    expect(store.volume).toBe(1)
    store.requestControl('pause')
    const first = store.controlRequest?.id ?? 0
    store.requestControl('stop')
    expect(store.controlRequest?.id).toBeGreaterThan(first)
  })
})
