import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pinia } from '@/stores'
import { useCourseLibraryStore } from '@/stores/library'
import { resourceApi, type ResourceResponse } from '@/api/resources'

vi.mock('@/api/resources', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/resources')>()
  return {
    ...actual,
    resourceApi: {
      list: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      favorite: vi.fn(),
      unfavorite: vi.fn(),
    },
  }
})

function makeResource(overrides: Partial<ResourceResponse> = {}): ResourceResponse {
  return {
    id: 1,
    title: '测试资源',
    aliases: [],
    description: null,
    resourceType: 'image',
    category: '阅读',
    categoryId: null,
    ageGroup: 'all',
    domain: null,
    tags: [],
    fileUrl: '/r/1',
    coverUrl: null,
    fileName: 'a.png',
    mimeType: 'image/png',
    fileSize: 100,
    duration: null,
    sha256: null,
    reviewStatus: 'approved',
    ownerId: null,
    ownerType: null,
    schoolId: null,
    currentVersionId: null,
    referenceCount: 0,
    isFavorite: false,
    createdAt: '2026-09-27T00:00:00.000Z',
    updatedAt: '2026-09-27T00:00:00.000Z',
    ...overrides,
  }
}

describe('courseLibrary store', () => {
  beforeEach(() => {
    useCourseLibraryStore(pinia).$dispose()
    vi.clearAllMocks()
  })

  it('aggregates stats from loaded resources (pending is current-page only)', () => {
    const store = useCourseLibraryStore()
    store.resources = [
      makeResource({ id: 1, reviewStatus: 'pending_review', createdAt: '2026-09-27T01:00:00Z' }),
      makeResource({ id: 2, reviewStatus: 'approved', createdAt: '2026-09-27T02:00:00Z' }),
    ]
    store.total = 40
    expect(store.stats.total).toBe(40)
    expect(store.stats.pendingCount).toBe(1)
    expect(store.stats.latestUpload?.id).toBe(2)
  })

  it('does not fabricate a "recently used" field', () => {
    const store = useCourseLibraryStore()
    store.resources = [makeResource()]
    expect(store.stats).not.toHaveProperty('recentlyUsed')
  })

  it('toggles favorite on a listed resource', async () => {
    const store = useCourseLibraryStore()
    store.resources = [makeResource({ id: 5, isFavorite: false })]
    const mocked = vi.mocked(resourceApi.favorite).mockResolvedValue({
      data: { resourceId: 5, isFavorite: true },
    } as never)
    const next = await store.toggleFavorite(5)
    expect(next).toBe(true)
    expect(mocked).toHaveBeenCalledWith(5)
    expect(store.resources[0]!.isFavorite).toBe(true)
  })

  it('uses the server favorite state and prevents duplicate requests', async () => {
    const store = useCourseLibraryStore()
    store.resources = [makeResource({ id: 5, isFavorite: false })]
    let resolve!: (value: never) => void
    const request = vi.mocked(resourceApi.favorite).mockImplementation(
      () => new Promise((done) => { resolve = done }),
    )
    const first = store.toggleFavorite(5)
    const duplicate = store.toggleFavorite(5)
    expect(request).toHaveBeenCalledTimes(1)
    expect(await duplicate).toBe(false)
    resolve({ data: { resourceId: 5, isFavorite: true } } as never)
    expect(await first).toBe(true)
    expect(store.resources[0]!.isFavorite).toBe(true)
  })

  it('does not show a false favorite success when the request fails', async () => {
    const store = useCourseLibraryStore()
    store.resources = [makeResource({ id: 5, isFavorite: false })]
    vi.mocked(resourceApi.favorite).mockRejectedValue(new Error('network'))
    await expect(store.toggleFavorite(5)).rejects.toThrow('network')
    expect(store.resources[0]!.isFavorite).toBe(false)
    expect(store.favoritePendingIds).toEqual([])
  })

  it('removes an unfavorited item from the active favorite filter', async () => {
    const store = useCourseLibraryStore()
    store.filters = { isFavorite: true }
    store.total = 1
    store.resources = [makeResource({ id: 5, isFavorite: true })]
    vi.mocked(resourceApi.unfavorite).mockResolvedValue({
      data: { resourceId: 5, isFavorite: false },
    } as never)
    await expect(store.toggleFavorite(5)).resolves.toBe(false)
    expect(store.resources).toEqual([])
    expect(store.total).toBe(0)
  })

  it('re-reads server data after metadata update and keeps input fields out of file data', async () => {
    const store = useCourseLibraryStore()
    const confirmed = makeResource({ id: 7, title: '服务端标题', fileName: 'kept.png' })
    vi.mocked(resourceApi.update).mockResolvedValue({ data: confirmed } as never)
    vi.mocked(resourceApi.get).mockResolvedValue({ data: confirmed } as never)
    const result = await store.updateMetadata(7, { title: '用户输入标题' })
    expect(resourceApi.update).toHaveBeenCalledWith(7, { title: '用户输入标题' })
    expect(resourceApi.get).toHaveBeenCalledWith(7)
    expect(result.title).toBe('服务端标题')
    expect(result.fileName).toBe('kept.png')
  })

  it('does not call API when the id is unknown', async () => {
    const store = useCourseLibraryStore()
    store.resources = []
    const favorite = vi.mocked(resourceApi.favorite)
    const unfavorite = vi.mocked(resourceApi.unfavorite)
    const next = await store.toggleFavorite(999)
    expect(next).toBe(false)
    expect(favorite).not.toHaveBeenCalled()
    expect(unfavorite).not.toHaveBeenCalled()
  })

  it('replaces a cached resource by id in place', () => {
    const store = useCourseLibraryStore()
    store.resources = [makeResource({ id: 1, title: '旧' })]
    store.pushOrReplace(makeResource({ id: 1, title: '新' }))
    expect(store.resources).toHaveLength(1)
    expect(store.resources[0]!.title).toBe('新')

    store.pushOrReplace(makeResource({ id: 2, title: '新资源' }))
    expect(store.resources).toHaveLength(2)
    expect(store.resources[0]!.id).toBe(2)
  })

  it('loads a list and records total/pagination', async () => {
    const store = useCourseLibraryStore()
    const items = [makeResource(), makeResource({ id: 2 })]
    vi.mocked(resourceApi.list).mockResolvedValue({
      data: { items, total: 33, page: 1, pageSize: 20 },
    } as never)
    await store.fetch()
    expect(store.resources).toHaveLength(2)
    expect(store.total).toBe(33)
    expect(store.loading).toBe(false)
    expect(store.listState).toBe('ready')
  })

  it('distinguishes forbidden and deleted resource detail states', async () => {
    const store = useCourseLibraryStore()
    vi.mocked(resourceApi.get).mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 403 },
    })
    await expect(store.getById(8)).rejects.toBeTruthy()
    expect(store.detailState).toBe('forbidden')

    vi.mocked(resourceApi.get).mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 404 },
    })
    await expect(store.getById(9)).rejects.toBeTruthy()
    expect(store.detailState).toBe('not_found')
  })

  it('marks an empty response explicitly instead of leaving a blank page', async () => {
    const store = useCourseLibraryStore()
    vi.mocked(resourceApi.list).mockResolvedValue({
      data: { items: [], total: 0, page: 1, pageSize: 20 },
    } as never)
    await store.fetch()
    expect(store.listState).toBe('empty')
    expect(store.resources).toEqual([])
  })
})
