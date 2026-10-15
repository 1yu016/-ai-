import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  resourceAccessErrorKind,
  resourceAccessMessage,
  resourceApi,
  type ListResourcesParams,
  type ResourceResponse,
  type UpdateResourceMetadata,
} from '@/api/resources'

export type ResourceLoadState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'empty'
  | 'stale'
  | 'error'
  | 'forbidden'
  | 'not_found'

/** 首页统计相关类型。注意：不虚构"最近使用"字段（后端无 lastUsedAt）。 */
export type LibraryStats = {
  total: number
  pendingCount: number
  latestUpload: { id: number; title: string; createdAt: string } | null
}

export const useCourseLibraryStore = defineStore('courseLibrary', () => {
  const resources = ref<ResourceResponse[]>([])
  const page = ref(1)
  const pageSize = ref(20)
  const total = ref(0)
  const loading = ref(false)
  const error = ref('')
  const listState = ref<ResourceLoadState>('idle')
  const filters = ref<ListResourcesParams>({})
  const detail = ref<ResourceResponse | null>(null)
  const detailLoading = ref(false)
  const detailError = ref('')
  const detailState = ref<ResourceLoadState>('idle')
  const categories = ref<ResourceResponse['category'][]>([])
  const favoritePendingIds = ref<number[]>([])

  /** 第一版统计：总数取接口 total；待审核=当前页 pending 计数（标注当前页，非资源库总数）；最新上传=最新 createdAt */
  const stats = computed<LibraryStats>(() => {
    const pending = resources.value.filter((r) => r.reviewStatus === 'pending_review')
    let latest: LibraryStats['latestUpload'] = null
    for (const r of resources.value) {
      if (!latest || new Date(r.createdAt).getTime() > new Date(latest.createdAt).getTime()) {
        latest = { id: r.id, title: r.title, createdAt: r.createdAt }
      }
    }
    return {
      total: total.value,
      pendingCount: pending.length,
      latestUpload: latest,
    }
  })

  async function fetch(next?: Partial<ListResourcesParams>): Promise<void> {
    if (next) filters.value = { ...filters.value, ...next }
    loading.value = true
    error.value = ''
    listState.value = 'loading'
    try {
      const { data } = await resourceApi.list({
        ...filters.value,
        page: page.value,
        pageSize: pageSize.value,
      })
      resources.value = data.items
      total.value = data.total
      page.value = data.page
      pageSize.value = data.pageSize
      listState.value = data.items.length ? 'ready' : 'empty'
    } catch (e) {
      error.value = resourceAccessMessage(e)
      const kind = resourceAccessErrorKind(e)
      listState.value = resources.value.length
        ? 'stale'
        : kind === 'forbidden'
          ? 'forbidden'
          : 'error'
      throw e
    } finally {
      loading.value = false
    }
  }

  async function getById(id: number): Promise<ResourceResponse> {
    detailLoading.value = true
    detailError.value = ''
    detail.value = null
    detailState.value = 'loading'
    try {
      const { data } = await resourceApi.get(id)
      detail.value = data
      detailState.value = 'ready'
      return data
    } catch (e) {
      detailError.value = resourceAccessMessage(e)
      const kind = resourceAccessErrorKind(e)
      detailState.value = kind === 'forbidden'
        ? 'forbidden'
        : kind === 'not_found'
          ? 'not_found'
          : 'error'
      throw e
    } finally {
      detailLoading.value = false
    }
  }

  async function toggleFavorite(id: number): Promise<boolean> {
    const current =
      resources.value.find((r) => r.id === id) ??
      (detail.value?.id === id ? detail.value : undefined)
    if (!current) return false
    if (favoritePendingIds.value.includes(id)) return current.isFavorite
    const next = !current.isFavorite
    favoritePendingIds.value = [...favoritePendingIds.value, id]
    try {
      const response = next
        ? await resourceApi.favorite(id)
        : await resourceApi.unfavorite(id)
      if (
        response.data.resourceId !== id ||
        typeof response.data.isFavorite !== 'boolean'
      ) throw new Error('收藏接口返回状态无效')
      const confirmed = response.data.isFavorite
      syncCachedResource({ ...current, isFavorite: confirmed })
      return confirmed
    } finally {
      favoritePendingIds.value = favoritePendingIds.value.filter(
        (pendingId) => pendingId !== id,
      )
    }
  }

  async function updateMetadata(
    id: number,
    payload: UpdateResourceMetadata,
  ): Promise<ResourceResponse> {
    await resourceApi.update(id, payload)
    // PATCH 成功后仍以重新读取的服务端状态为准，避免本地 DTO、默认值或
    // 服务端规范化结果与详情页不一致。
    const { data } = await resourceApi.get(id)
    syncCachedResource(data)
    return data
  }

  function matchesCurrentFilters(resource: ResourceResponse): boolean {
    const current = filters.value
    if (current.category && resource.category !== current.category) return false
    if (current.categoryId && resource.categoryId !== current.categoryId) return false
    if (current.resourceType && resource.resourceType !== current.resourceType) return false
    if (current.reviewStatus && resource.reviewStatus !== current.reviewStatus) return false
    if (current.ageGroup && resource.ageGroup !== current.ageGroup) return false
    if (current.domain && resource.domain !== current.domain) return false
    if (current.tag && !resource.tags.includes(current.tag)) return false
    if (current.isFavorite !== undefined && resource.isFavorite !== current.isFavorite) return false
    if (current.ownerId && resource.ownerId !== current.ownerId) return false
    if (current.keyword) {
      const keyword = current.keyword.trim().toLocaleLowerCase('zh-CN')
      const searchable = [
        resource.title,
        resource.description ?? '',
        ...resource.aliases,
        ...resource.tags,
      ].join(' ').toLocaleLowerCase('zh-CN')
      if (keyword && !searchable.includes(keyword)) return false
    }
    return true
  }

  function syncCachedResource(resource: ResourceResponse): void {
    const idx = resources.value.findIndex((item) => item.id === resource.id)
    if (idx >= 0) {
      if (matchesCurrentFilters(resource)) resources.value[idx] = resource
      else {
        resources.value.splice(idx, 1)
        total.value = Math.max(0, total.value - 1)
        if (!resources.value.length) listState.value = 'empty'
      }
    }
    if (detail.value?.id === resource.id) detail.value = resource
  }

  function removeCached(id: number): void {
    resources.value = resources.value.filter((r) => r.id !== id)
    if (detail.value?.id === id) detail.value = null
  }

  // 保留给上传成功后的列表更新使用：资源已在上传完成时返回，回填或置顶。
  function pushOrReplace(resource: ResourceResponse): void {
    const idx = resources.value.findIndex((r) => r.id === resource.id)
    if (idx >= 0) resources.value[idx] = resource
    else resources.value.unshift(resource)
  }

  return {
    resources,
    page,
    pageSize,
    total,
    loading,
    error,
    listState,
    filters,
    detail,
    detailLoading,
    detailError,
    detailState,
    categories,
    favoritePendingIds,
    stats,
    fetch,
    getById,
    toggleFavorite,
    updateMetadata,
    removeCached,
    pushOrReplace,
  }
})
