<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import ManagementLayout from '@/components/ManagementLayout.vue'
import LoadingState from '@/components/LoadingState.vue'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import ForbiddenState from '@/components/ForbiddenState.vue'
import ResourceCard from '@/components/resources/ResourceCard.vue'
import FilterBar from '@/components/resources/FilterBar.vue'
import {
  AGE_GROUPS,
  RESOURCE_TYPES,
  REVIEW_STATUSES,
  resourceApi,
  type ListResourcesParams,
  type ResourceReferenceUsage,
  type ResourceResponse,
} from '@/api/resources'
import { useCourseLibraryStore } from '@/stores/library'
import { useUserStore } from '@/stores/user'
import { apiErrorMessage } from '@/api/http'
import { withNavigationSource } from '@/router/navigation'

const store = useCourseLibraryStore()
const user = useUserStore()
const route = useRoute()
const router = useRouter()

const query = ref<ListResourcesParams>({})
const isAdmin = computed(() => user.isAdmin)
const totalPages = computed(() =>
  store.pageSize > 0 ? Math.ceil(store.total / store.pageSize) : 0,
)
let ignoreNextRouteChange = false

function firstQueryValue(value: unknown): string {
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')
}

function readQueryIntoFilter(): void {
  const q = route.query as Record<string, unknown>
  const f: ListResourcesParams = {}
  const resourceType = firstQueryValue(q.resourceType)
  const reviewStatus = firstQueryValue(q.reviewStatus)
  const ageGroup = firstQueryValue(q.ageGroup)
  if (q.keyword) f.keyword = firstQueryValue(q.keyword)
  if ((RESOURCE_TYPES as readonly string[]).includes(resourceType)) f.resourceType = resourceType as ListResourcesParams['resourceType']
  if ((REVIEW_STATUSES as readonly string[]).includes(reviewStatus)) f.reviewStatus = reviewStatus as ListResourcesParams['reviewStatus']
  if ((AGE_GROUPS as readonly string[]).includes(ageGroup)) f.ageGroup = ageGroup as ListResourcesParams['ageGroup']
  if (q.domain) f.domain = firstQueryValue(q.domain)
  if (q.tag) f.tag = firstQueryValue(q.tag)
  if (q.ownerId) f.ownerId = firstQueryValue(q.ownerId)
  const favorite = firstQueryValue(q.isFavorite)
  if (favorite === 'true' || favorite === 'false') f.isFavorite = favorite === 'true'
  if (q.categoryId && Number(q.categoryId) > 0) f.categoryId = Number(q.categoryId)
  query.value = { ...f }
  store.filters = { ...f }
  const requestedPage = Number(firstQueryValue(q.page))
  store.page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
}

function buildURLQuery(): Record<string, string> {
  const f = store.filters
  const out: Record<string, string> = {}
  for (const key of ['keyword', 'resourceType', 'reviewStatus', 'ageGroup', 'domain', 'tag', 'ownerId'] as const) {
    if (f[key]) out[key] = String(f[key])
  }
  if (f.isFavorite !== undefined) out.isFavorite = String(f.isFavorite)
  if (f.categoryId) out.categoryId = String(f.categoryId)
  if (store.page > 1) out.page = String(store.page)
  return out
}

function syncQuery(): void {
  ignoreNextRouteChange = true
  void router.replace({ query: buildURLQuery() }).finally(() => {
    ignoreNextRouteChange = false
  })
}

async function search(): Promise<void> {
  store.filters = { ...query.value }
  store.page = 1
  try {
    await store.fetch()
    syncQuery()
  } catch {
    /* store.error 已记录 */
  }
}

async function reset(): Promise<void> {
  query.value = {}
  store.filters = {}
  store.page = 1
  try {
    await store.fetch()
    syncQuery()
  } catch {
    /* ignore */
  }
}

async function goPage(page: number): Promise<void> {
  if (page < 1) return
  store.page = page
  try {
    await store.fetch()
    syncQuery()
  } catch {
    /* ignore */
  }
}

onMounted(async () => {
  readQueryIntoFilter()
  try {
    await store.fetch()
  } catch {
    /* store.error 已记录，界面展示重试 */
  }
})

function openDetail(r: ResourceResponse): void {
  void router.push(withNavigationSource({ name: 'resource-detail', params: { id: r.id } }, route))
}
function openPreview(r: ResourceResponse): void {
  void router.push(withNavigationSource({ name: 'resource-preview', params: { id: r.id } }, route))
}
async function onToggleFavorite(r: ResourceResponse): Promise<void> {
  if (store.favoritePendingIds.includes(r.id)) return
  try {
    const next = await store.toggleFavorite(r.id)
    ElMessage.success(next ? '已收藏' : '已取消收藏')
  } catch (e) {
    ElMessage.error(apiErrorMessage(e, '操作失败'))
  }
}
async function onDelete(r: ResourceResponse): Promise<void> {
  let references: ResourceReferenceUsage[]
  try {
    references = (await resourceApi.listReferences(r.id)).data
  } catch (e) {
    ElMessage.error(apiErrorMessage(e, '无法检查资源引用，已取消删除'))
    return
  }
  if (references.length) {
    await ElMessageBox.alert(referenceMessage(references), '资源正在使用中', {
      type: 'warning',
      confirmButtonText: '知道了',
    })
    return
  }
  try {
    await ElMessageBox.confirm(`确认删除「${r.title}」？删除后不可恢复。`, '删除资源', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    await resourceApi.remove(r.id)
    store.removeCached(r.id)
    ElMessage.success('删除成功')
  } catch (e) {
    ElMessage.error(deleteErrorMessage(e))
  }
}
function referenceMessage(references: ResourceReferenceUsage[]): string {
  const items = references.slice(0, 3).map((reference) => {
    const plan = reference.lessonPlanTitle || `引用 ${reference.referenceId}`
    const steps = reference.steps.length
      ? `（步骤：${reference.steps.map((step) => `${step.sortOrder}.${step.title}`).join('、')}）`
      : ''
    return `${plan}${steps}`
  })
  const more = references.length > 3 ? `，另有 ${references.length - 3} 处引用` : ''
  return `该资源被 ${references.length} 个教案或业务记录引用：${items.join('；')}${more}。请先在对应业务中移除引用。`
}
function deleteErrorMessage(error: unknown): string {
  const payload = (error as { response?: { data?: { references?: ResourceReferenceUsage[] } } })
    ?.response?.data
  return payload?.references?.length
    ? referenceMessage(payload.references)
    : apiErrorMessage(error, '删除失败')
}
function goReview(): void {
  query.value = { ...query.value, reviewStatus: 'pending_review' }
  void search()
}

watch(
  () => route.fullPath,
  () => {
    if (ignoreNextRouteChange || route.name !== 'resources') return
    readQueryIntoFilter()
    void store.fetch().catch(() => undefined)
  },
)
</script>
<template>
  <ManagementLayout>
    <div class="resource-library">
    <div class="head">
      <div>
        <h1>课程资源库</h1>
        <p class="muted">检索、预览与维护课程资源</p>
      </div>
      <div class="head-actions">
        <button v-if="isAdmin" class="ghost" @click="goReview">
          查看待审核资源
        </button>
        <button class="button" @click="router.push(withNavigationSource({ name: 'resource-upload' }, route))">上传资源</button>
      </div>
    </div>

    <div class="stats">
      <div class="stat"><span class="num">{{ store.stats.total }}</span><span class="label">总资源数</span></div>
      <div class="stat"><span class="num warn">{{ store.stats.pendingCount }}</span><span class="label">待审核（当前页）</span></div>
      <div class="stat wide"><span class="label">最新上传</span><span class="value" :title="store.stats.latestUpload?.title || ''">{{ store.stats.latestUpload?.title || '暂无' }}</span></div>
    </div>

    <FilterBar v-model="query" @search="search" @reset="reset" />

    <div class="grid-wrap">
      <LoadingState v-if="store.loading && !store.resources.length" compact title="正在加载资源" description="正在读取资源列表和筛选结果。" />
      <ForbiddenState v-else-if="store.listState === 'forbidden'" compact description="当前账号不能查看资源库。" />
      <ErrorState v-else-if="store.error && !store.resources.length" compact :description="store.error" @retry="search" />
      <EmptyState
        v-else-if="!store.resources.length"
        compact
        title="没有找到资源"
        description="当前筛选条件下没有可访问的资源，可以清除筛选后重试。"
        action-label="清除筛选"
        @action="reset"
      />
      <template v-else>
        <ErrorState
          v-if="store.listState === 'stale'"
          compact
          title="刷新失败，正在显示上次结果"
          :description="store.error"
          @retry="search"
        />
      <div class="grid">
        <ResourceCard
          v-for="r in store.resources"
          :key="r.id"
          :resource="r"
          :favorite-pending="store.favoritePendingIds.includes(r.id)"
          @open-detail="openDetail"
          @preview="openPreview"
          @toggle-favorite="onToggleFavorite"
        />
      </div>
      </template>
    </div>

    <div v-if="isAdmin && !store.loading && !store.error && store.resources.length" class="admin-panel panel">
      <h4>管理员 · 删除资源</h4>
      <div class="admin-row" v-for="r in store.resources" :key="`del-${r.id}`">
        <span class="admin-title" :title="r.title">{{ r.title }}</span>
        <button class="danger" @click="onDelete(r)">删除</button>
      </div>
    </div>

    <div v-if="!store.loading && !store.error && store.resources.length" class="pager">
      <button class="ghost" :disabled="store.page <= 1" @click="goPage(store.page - 1)">上一页</button>
      <span class="page-info">第 {{ store.page }} / {{ totalPages || 1 }} 页 · 共 {{ store.total }} 条</span>
      <button class="ghost" :disabled="store.page >= totalPages" @click="goPage(store.page + 1)">下一页</button>
    </div>
    </div>
  </ManagementLayout>
</template>
<style scoped>
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.head h1 { margin: 0 0 6px; font-size: 28px; }
.head-actions { display: flex; gap: 10px; }
.muted { color: #9a7e6e; }
.stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
  margin: 20px 0;
}
.stat {
  background: #fffdf9;
  border: 1px solid #f0ddce;
  border-radius: 16px;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.stat .num { font-size: 26px; font-weight: 700; color: #d67b59; }
.stat .num.warn { color: #b77d20; }
.stat .label { font-size: 12px; color: #8191a2; }
.stat.wide .value { font-size: 15px; font-weight: 600; color: #26364a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.toolbar-right { display: flex; justify-content: flex-end; margin: 14px 0; }
.grid-wrap { min-height: 200px; }
.admin-panel { margin-top: 18px; }
.admin-panel h4 { margin: 0 0 10px; color: #b77d20; }
.admin-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid #eef2f5; }
.admin-row:last-child { border-bottom: 0; }
.admin-title { font-size: 14px; color: #26364a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.panel { background: #fffdf9; border: 1px solid #f0ddce; border-radius: 16px; padding: 18px; }
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 18px;
}
.bad { background: #ffebeb; color: #c64e4e; padding: 14px 16px; border-radius: 10px; display: flex; align-items: center; gap: 12px; }
.retry { border: 0; background: #c64e4e; color: #fff; border-radius: 7px; padding: 6px 12px; cursor: pointer; }
.button {
  border: 0;
  background: #e99168;
  color: #fff;
  border-radius: 8px;
  padding: 10px 18px;
  cursor: pointer;
}
.button:hover { background: #d67b59; }
.ghost {
  border: 1px solid #efd9c8;
  background: #fffdf9;
  color: #876b5d;
  border-radius: 8px;
  padding: 10px 14px;
  cursor: pointer;
}
.ghost:hover:not(:disabled) { color: #d67b59; border-color: #e99168; }
.ghost:disabled { opacity: 0.5; cursor: not-allowed; }
.danger { border: 1px solid #ffd7d7; background: #fff; color: #c64e4e; border-radius: 8px; padding: 8px 12px; cursor: pointer; margin: 4px; }
.pager { display: flex; align-items: center; justify-content: center; gap: 14px; margin: 26px 0; }
.page-info { font-size: 13px; color: #9a7e6e; }
</style>
