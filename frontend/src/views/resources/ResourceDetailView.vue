<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import ManagementLayout from '@/components/ManagementLayout.vue'
import { resourceApi, type ResourceAgeGroup, type ResourceReviewStatus, type ResourceType } from '@/api/resources'
import { useCourseLibraryStore } from '@/stores/library'
import { useUserStore } from '@/stores/user'
import { apiErrorMessage } from '@/api/http'

const props = defineProps<{ id: number }>()
const store = useCourseLibraryStore()
const user = useUserStore()
const router = useRouter()

const TYPE_LABELS: Record<ResourceType, string> = {
  image: '图片', audio: '音频', video: '视频', pdf: 'PDF', ppt: 'PPT',
  picture_book: '绘本', animation: '动画', question_bank: '题库',
  experiment: '实验', model_3d: '3D模型', document: '文档',
}
const AGE_LABELS: Record<ResourceAgeGroup, string> = {
  small: '小班', middle: '中班', large: '大班', all: '全龄段',
}
const STATUS_LABELS: Record<ResourceReviewStatus, string> = {
  draft: '草稿', pending: '待审核', approved: '已通过', rejected: '已驳回', disabled: '已停用',
}

const isAdmin = computed(() => user.isAdmin)
const detail = computed(() => store.detail)

function statusClass(s: ResourceReviewStatus): string {
  if (s === 'approved') return 'ok'
  if (s === 'pending') return 'warn'
  return 'bad'
}
function typeLabel(): string {
  return detail.value ? (TYPE_LABELS[detail.value.resourceType] ?? detail.value.resourceType) : '—'
}
function ageLabel(): string {
  return detail.value ? (AGE_LABELS[detail.value.ageGroup] ?? detail.value.ageGroup) : '—'
}
function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}
async function onToggleFavorite(): Promise<void> {
  if (!detail.value) return
  try {
    const next = await store.toggleFavorite(detail.value.id)
    ElMessage.success(next ? '已收藏' : '已取消收藏')
  } catch (e) {
    ElMessage.error(apiErrorMessage(e, '操作失败'))
  }
}
async function onDelete(): Promise<void> {
  if (!detail.value) return
  try {
    await ElMessageBox.confirm(`确认删除「${detail.value.title}」？删除后不可恢复。`, '删除资源', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    await resourceApi.remove(detail.value.id)
    store.removeCached(detail.value.id)
    ElMessage.success('删除成功')
    void router.push({ name: 'resources' })
  } catch (e) {
    ElMessage.error(apiErrorMessage(e, '删除失败'))
  }
}
function goBack(): void {
  void router.push({ name: 'resources' })
}
function openPreview(): void {
  if (detail.value) void router.push({ name: 'resource-preview', params: { id: detail.value.id } })
}
function openEdit(): void {
  if (detail.value) void router.push({ name: 'resource-edit', params: { id: detail.value.id } })
}

onMounted(() => {
  void store.getById(props.id).catch(() => {
    /* store.detailError 已记录，界面展示 */
  })
})
</script>
<template>
  <ManagementLayout>
    <button class="back" @click="goBack">← 返回资源库</button>

    <p v-if="store.detailLoading" class="muted">加载中…</p>
    <p v-else-if="store.detailError" class="bad">
      {{ store.detailError }}
      <button class="retry" @click="store.getById(props.id)">重试</button>
    </p>
    <div v-else-if="detail" class="panel">
      <div class="title-row">
        <h1>{{ detail.title }}</h1>
        <span class="badge" :class="statusClass(detail.reviewStatus)">{{ STATUS_LABELS[detail.reviewStatus] ?? detail.reviewStatus }}</span>
      </div>

      <div class="cover">
        <img v-if="detail.coverUrl" :src="detail.coverUrl" alt="" />
        <span v-else class="cover-fallback">{{ typeLabel() }}</span>
      </div>

      <dl class="fields">
        <div class="row"><dt>编号</dt><dd>#{{ detail.id }}</dd></div>
        <div class="row"><dt>资源类型</dt><dd>{{ typeLabel() }}</dd></div>
        <div class="row"><dt>分类</dt><dd>{{ detail.category || '—' }}</dd></div>
        <div class="row"><dt>年龄段</dt><dd>{{ ageLabel() }}</dd></div>
        <div class="row"><dt>领域</dt><dd>{{ detail.domain || '—' }}</dd></div>
        <div class="row"><dt>文件名</dt><dd>{{ detail.fileName }}</dd></div>
        <div class="row"><dt>文件大小</dt><dd>{{ formatSize(detail.fileSize) }}</dd></div>
        <div class="row"><dt>MIME</dt><dd>{{ detail.mimeType }}</dd></div>
        <div class="row"><dt v-if="detail.duration">时长</dt><dd v-if="detail.duration">{{ detail.duration }}s</dd></div>
        <div class="row"><dt>引用数</dt><dd>{{ detail.referenceCount }}</dd></div>
        <div class="row"><dt>上传时间</dt><dd>{{ new Date(detail.createdAt).toLocaleString() }}</dd></div>
        <div class="row"><dt>更新时间</dt><dd>{{ new Date(detail.updatedAt).toLocaleString() }}</dd></div>
      </dl>

      <div class="sec">
        <h3>标签</h3>
        <div v-if="detail.tags.length" class="tags">
          <span v-for="tag in detail.tags" :key="tag" class="tag">{{ tag }}</span>
        </div>
        <p v-else class="muted">暂无标签</p>
      </div>

      <div class="sec">
        <h3>描述</h3>
        <p v-if="detail.description" class="desc">{{ detail.description }}</p>
        <p v-else class="muted">暂无描述</p>
      </div>

      <div class="actions">
        <button class="button" @click="openPreview">预览</button>
        <button class="ghost" :class="{ on: detail.isFavorite }" @click="onToggleFavorite">
          {{ detail.isFavorite ? '★ 已收藏' : '☆ 收藏' }}
        </button>
        <template v-if="isAdmin">
          <button class="ghost" @click="openEdit">编辑</button>
          <button class="danger" @click="onDelete">删除</button>
        </template>
      </div>
    </div>
    <p v-else class="muted">未找到该资源</p>
  </ManagementLayout>
</template>
<style scoped>
.back { border: 0; background: none; color: #d67b59; font-size: 14px; cursor: pointer; padding: 0 0 16px; }
.muted { color: #9a7e6e; }
.bad { background: #ffebeb; color: #c64e4e; padding: 14px 16px; border-radius: 10px; display: flex; align-items: center; gap: 12px; }
.retry { border: 0; background: #c64e4e; color: #fff; border-radius: 7px; padding: 6px 12px; cursor: pointer; }
.panel { background: #fffdf9; border: 1px solid #f0ddce; border-radius: 16px; padding: 24px; max-width: 760px; }
.title-row { display: flex; align-items: center; gap: 14px; }
.title-row h1 { margin: 0; font-size: 24px; }
.badge { border-radius: 12px; padding: 4px 10px; font-size: 12px; }
.ok { background: #e6f7ef; color: #21936f; }
.warn { background: #fff3dc; color: #b77d20; }
.bad { background: #ffebeb; color: #c64e4e; }
.cover { margin: 18px 0; max-height: 260px; border-radius: 10px; overflow: hidden; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #eef7f4, #dceee8); }
.cover img { max-width: 100%; max-height: 260px; object-fit: contain; }
.cover-fallback { font-size: 30px; font-weight: 700; color: #d67b59; padding: 40px; }
.fields { margin: 0; }
.row { display: flex; gap: 16px; padding: 9px 0; border-bottom: 1px solid #eef2f5; }
.row dt { width: 90px; color: #9a7e6e; font-size: 14px; flex-shrink: 0; }
.row dd { margin: 0; color: #26364a; font-size: 14px; }
.sec { margin-top: 20px; }
.sec h3 { margin: 0 0 8px; font-size: 15px; color: #3b526b; }
.tags { display: flex; gap: 8px; flex-wrap: wrap; }
.tag { background: #fff0e5; color: #b9684d; border-radius: 999px; padding: 3px 9px; font-size: 13px; }
.desc { color: #3b526b; font-size: 14px; line-height: 1.7; margin: 0; }
.actions { display: flex; gap: 12px; margin-top: 26px; flex-wrap: wrap; }
.button { border: 0; background: #e99168; color: #fff; border-radius: 12px; padding: 10px 18px; cursor: pointer; }
.button:hover { background: #d67b59; }
.ghost { border: 1px solid #efd9c8; background: #fffdf9; color: #876b5d; border-radius: 12px; padding: 10px 16px; cursor: pointer; }
.ghost.on { color: #b77d20; border-color: #f0c168; }
.danger { border: 1px solid #ffd7d7; background: #fff; color: #c64e4e; border-radius: 8px; padding: 10px 16px; cursor: pointer; }
</style>
