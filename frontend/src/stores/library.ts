import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { resourceApi, type ListResourcesParams, type ResourceResponse } from '@/api/resources'

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
  const filters = ref<ListResourcesParams>({})
  const detail = ref<ResourceResponse | null>(null)
  const detailLoading = ref(false)
  const detailError = ref('')
  const categories = ref<ResourceResponse['category'][]>([])

  /** 第一版统计：总数取接口 total；待审核=当前页 pending 计数（标注当前页，非资源库总数）；最新上传=最新 createdAt */
  const stats = computed<LibraryStats>(() => {
    const pending = resources.value.filter((r) => r.reviewStatus === 'pending')
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
    try {
      const { data } = await resourceApi.list({
        ...filters.value,
        page: page.value,
        pageSize: pageSize.value,
      })
      resources.value = data.items
      total.value = data.total
      page.value = data.page
    } catch (e) {
      error.value = e instanceof Error ? e.message : '资源加载失败'
      throw e
    } finally {
      loading.value = false
    }
  }

  async function getById(id: number): Promise<ResourceResponse> {
    detailLoading.value = true
    detailError.value = ''
    try {
      const { data } = await resourceApi.get(id)
      detail.value = data
      return data
    } catch (e) {
      detailError.value = e instanceof Error ? e.message : '资源详情加载失败'
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
    const next = !current.isFavorite
    if (next) await resourceApi.favorite(id)
    else await resourceApi.unfavorite(id)
    const idx = resources.value.findIndex((r) => r.id === id)
    if (idx >= 0 && resources.value[idx]) {
      resources.value[idx] = { ...resources.value[idx]!, isFavorite: next }
    }
    if (detail.value && detail.value.id === id) {
      detail.value = { ...detail.value, isFavorite: next }
    }
    return next
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
    filters,
    detail,
    detailLoading,
    detailError,
    categories,
    stats,
    fetch,
    getById,
    toggleFavorite,
    removeCached,
    pushOrReplace,
  }
})