<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import ManagementLayout from '@/components/ManagementLayout.vue'
import ResourceCard from '@/components/resources/ResourceCard.vue'
import FilterBar from '@/components/resources/FilterBar.vue'
import { resourceApi, type ListResourcesParams, type ResourceAgeGroup, type ResourceResponse, type ResourceReviewStatus, type ResourceType } from '@/api/resources'
import { useCourseLibraryStore } from '@/stores/library'
import { useUserStore } from '@/stores/user'
import { apiErrorMessage } from '@/api/http'

const store = useCourseLibraryStore()
const user = useUserStore()
const route = useRoute()
const router = useRouter()

const query = ref<ListResourcesParams>({})
const isAdmin = computed(() => user.isAdmin)
const totalPages = computed(() =>
  store.pageSize > 0 ? Math.ceil(store.total / store.pageSize) : 0,
)
const firstPending = computed(() => store.resources.find((r) => r.reviewStatus === 'pending'))

function readQueryIntoFilter(): void {
  const q = route.query as Record<string, unknown>
  const f: ListResourcesParams = {}
  if (q.keyword) f.keyword = String(q.keyword)
  if (q.resourceType) f.resourceType = String(q.resourceType) as ResourceType
  if (q.reviewStatus) f.reviewStatus = String(q.reviewStatus) as ResourceReviewStatus
  if (q.ageGroup) f.ageGroup = String(q.ageGroup) as ResourceAgeGroup
  if (q.domain) f.domain = String(q.domain)
  if (q.tag) f.tag = String(q.tag)
  if (q.categoryId) f.categoryId = Number(q.categoryId)
  query.value = { ...f }
  store.filters = { ...f }
  if (q.page) store.page = Math.max(1, Number(q.page))
}

function buildURLQuery(): Record<string, string> {
  const f = store.filters
  const out: Record<string, string> = {}
  for (const key of ['keyword', 'resourceType', 'reviewStatus', 'ageGroup', 'domain', 'tag'] as const) {
    if (f[key]) out[key] = String(f[key])
  }
  if (f.categoryId) out.categoryId = String(f.categoryId)
  if (store.page > 1) out.page = String(store.page)
  return out
}

function syncQuery(): void {
  void router.replace({ query: buildURLQuery() })
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
  void router.push({ name: 'resource-detail', params: { id: r.id } })
}
function openPreview(r: ResourceResponse): void {
  void router.push({ name: 'resource-preview', params: { id: r.id } })
}
async function onToggleFavorite(r: ResourceResponse): Promise<void> {
  try {
    const next = await store.toggleFavorite(r.id)
    ElMessage.success(next ? '已收藏' : '已取消收藏')
  } catch (e) {
    ElMessage.error(apiErrorMessage(e, '操作失败'))
  }
}
async function onDelete(r: ResourceResponse): Promise<void> {
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
    ElMessage.error(apiErrorMessage(e, '删除失败'))
  }
}
function goReview(): void {
  const target = firstPending.value
  if (target) void router.push({ name: 'resource-review', params: { id: target.id } })
}
</script>
<template>
  <ManagementLayout>
    <div class="head">
      <div>
        <h1>课程资源库</h1>
        <p class="muted">检索、预览与维护课程资源</p>
      </div>
      <div class="head-actions">
        <button v-if="isAdmin" class="ghost" :disabled="!firstPending" @click="goReview">
          审核资源{{ firstPending ? `（${firstPending.id}）` : '' }}
        </button>
        <button class="button" @click="router.push({ name: 'resource-upload' })">上传资源</button>
      </div>
    </div>

    <div class="stats">
      <div class="stat"><span class="num">{{ store.stats.total }}</span><span class="label">总资源数</span></div>
      <div class="stat"><span class="num warn">{{ store.stats.pendingCount }}</span><span class="label">待审核（当前页）</span></div>
      <div class="stat wide"><span class="label">最新上传</span><span class="value" :title="store.stats.latestUpload?.title || ''">{{ store.stats.latestUpload?.title || '暂无' }}</span></div>
    </div>

    <FilterBar v-model="query" @search="search" @reset="reset" />

    <div class="grid-wrap">
      <p v-if="store.loading" class="muted">加载中…</p>
      <p v-else-if="store.error" class="bad">
        {{ store.error }}
        <button class="retry" @click="search">重试</button>
      </p>
      <p v-else-if="!store.resources.length" class="muted">暂无资源</p>
      <div v-else class="grid">
        <ResourceCard
          v-for="r in store.resources"
          :key="r.id"
          :resource="r"
          @open-detail="openDetail"
          @preview="openPreview"
          @toggle-favorite="onToggleFavorite"
        />
      </div>
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
  </ManagementLayout>
</template>
<style scoped>
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.head h1 { margin: 0 0 6px; font-size: 28px; }
.head-actions { display: flex; gap: 10px; }
.muted { color: #8191a2; }
.stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
  margin: 20px 0;
}
.stat {
  background: #fff;
  border: 1px solid #e7edf3;
  border-radius: 12px;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.stat .num { font-size: 26px; font-weight: 700; color: #229a7d; }
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
.panel { background: #fff; border: 1px solid #e7edf3; border-radius: 12px; padding: 18px; }
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 18px;
}
.bad { background: #ffebeb; color: #c64e4e; padding: 14px 16px; border-radius: 10px; display: flex; align-items: center; gap: 12px; }
.retry { border: 0; background: #c64e4e; color: #fff; border-radius: 7px; padding: 6px 12px; cursor: pointer; }
.button {
  border: 0;
  background: #36aa89;
  color: #fff;
  border-radius: 8px;
  padding: 10px 18px;
  cursor: pointer;
}
.button:hover { background: #229a7d; }
.ghost {
  border: 1px solid #dce5ed;
  background: #fff;
  color: #66788c;
  border-radius: 8px;
  padding: 10px 14px;
  cursor: pointer;
}
.ghost:hover:not(:disabled) { color: #229a7d; border-color: #229a7d; }
.ghost:disabled { opacity: 0.5; cursor: not-allowed; }
.danger { border: 1px solid #ffd7d7; background: #fff; color: #c64e4e; border-radius: 8px; padding: 8px 12px; cursor: pointer; margin: 4px; }
.pager { display: flex; align-items: center; justify-content: center; gap: 14px; margin: 26px 0; }
.page-info { font-size: 13px; color: #8191a2; }
</style>