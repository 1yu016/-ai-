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
      makeResource({ id: 1, reviewStatus: 'pending', createdAt: '2026-09-27T01:00:00Z' }),
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
    const mocked = vi.mocked(resourceApi.favorite).mockResolvedValue({ data: {} as never } as never)
    const next = await store.toggleFavorite(5)
    expect(next).toBe(true)
    expect(mocked).toHaveBeenCalledWith(5)
    expect(store.resources[0]!.isFavorite).toBe(true)
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
  })
})