<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import ManagementLayout from '@/components/ManagementLayout.vue'
import LoadingState from '@/components/LoadingState.vue'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import ForbiddenState from '@/components/ForbiddenState.vue'
import { resourceApi, type ResourceAgeGroup, type ResourceReferenceUsage, type ResourceReviewStatus, type ResourceType } from '@/api/resources'
import { useCourseLibraryStore } from '@/stores/library'
import { useUserStore } from '@/stores/user'
import { apiErrorMessage } from '@/api/http'
import BackButton from '@/components/BackButton.vue'
import { withNavigationSource } from '@/router/navigation'

const props = defineProps<{ id: string | number }>()
const store = useCourseLibraryStore()
const user = useUserStore()
const route = useRoute()
const router = useRouter()

const TYPE_LABELS: Record<ResourceType, string> = {
  image: '图片', audio: '音频', video: '视频', pdf: 'PDF', ppt: 'PPT',
  picture_book: '绘本', nursery_rhyme: '儿歌', animation: '动画', question_bank: '题库',
  experiment: '实验', model_3d: '3D模型', document: '文档', unknown: '未知类型',
}
const AGE_LABELS: Record<ResourceAgeGroup, string> = {
  small: '小班', middle: '中班', large: '大班', all: '全龄段',
}
const STATUS_LABELS: Record<ResourceReviewStatus, string> = {
  draft: '草稿', pending_review: '待审核', approved: '已通过', rejected: '已驳回', archived: '已归档',
}

const isAdmin = computed(() => user.isAdmin)
const detail = computed(() => store.detail)
const currentUserId = computed(() =>
  user.teacherInfo?.teacherId ?? user.teacherInfo?.userId ?? user.teacherInfo?.administratorId,
)
const canEdit = computed(() => {
  if (!detail.value) return false
  if (isAdmin.value) return true
  return detail.value.ownerType === 'teacher' && detail.value.ownerId === String(currentUserId.value)
})
const editBlockedReason = computed(() => {
  if (!detail.value) return ''
  if (detail.value.reviewStatus === 'archived') return '该资源已归档，不能编辑元数据。'
  if (!canEdit.value) return '该资源由其他教师或园所共享，当前账号只能查看和收藏。'
  return ''
})
const canSubmitReview = computed(() =>
  !isAdmin.value && canEdit.value &&
  Boolean(detail.value && ['draft', 'rejected'].includes(detail.value.reviewStatus)),
)
const favoritePending = computed(() =>
  detail.value ? store.favoritePendingIds.includes(detail.value.id) : false,
)
const references = ref<ResourceReferenceUsage[]>([])
const referencesLoading = ref(false)
const referencesError = ref('')
const submittingReview = ref(false)

function statusClass(s: ResourceReviewStatus): string {
  if (s === 'approved') return 'ok'
  if (s === 'pending_review') return 'warn'
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
  if (!detail.value || favoritePending.value) return
  try {
    const next = await store.toggleFavorite(detail.value.id)
    ElMessage.success(next ? '已收藏' : '已取消收藏')
  } catch (e) {
    ElMessage.error(apiErrorMessage(e, '操作失败'))
  }
}
async function onDelete(): Promise<void> {
  if (!detail.value) return
  await loadReferences()
  if (referencesError.value) {
    ElMessage.error('无法确认资源引用状态，已取消删除')
    return
  }
  if (references.value.length) {
    await ElMessageBox.alert(referenceMessage(references.value), '资源正在使用中', {
      type: 'warning',
      confirmButtonText: '知道了',
    })
    return
  }
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
    const payload = (e as { response?: { data?: { references?: ResourceReferenceUsage[] } } })
      ?.response?.data
    if (payload?.references?.length) references.value = payload.references
    ElMessage.error(
      payload?.references?.length
        ? referenceMessage(payload.references)
        : apiErrorMessage(e, '删除失败'),
    )
  }
}
async function loadReferences(): Promise<void> {
  if (!detail.value || !canEdit.value) return
  referencesLoading.value = true
  referencesError.value = ''
  try {
    references.value = (await resourceApi.listReferences(detail.value.id)).data
  } catch (error) {
    references.value = []
    referencesError.value = apiErrorMessage(error, '引用关系加载失败')
  } finally {
    referencesLoading.value = false
  }
}
function referenceMessage(items: ResourceReferenceUsage[]): string {
  const details = items.slice(0, 3).map((reference) => {
    const plan = reference.lessonPlanTitle || `引用 ${reference.referenceId}`
    const steps = reference.steps.length
      ? `（步骤：${reference.steps.map((step) => `${step.sortOrder}.${step.title}`).join('、')}）`
      : ''
    return `${plan}${steps}`
  })
  const more = items.length > 3 ? `，另有 ${items.length - 3} 处引用` : ''
  return `该资源被 ${items.length} 个教案或业务记录引用：${details.join('；')}${more}。请先在对应业务中移除引用。`
}
async function onSubmitReview(): Promise<void> {
  if (!detail.value || !canSubmitReview.value || submittingReview.value) return
  submittingReview.value = true
  try {
    await resourceApi.submitReview(detail.value.id)
    await store.getById(detail.value.id)
    ElMessage.success('已提交审核')
  } catch (error) {
    ElMessage.error(apiErrorMessage(error, '提交审核失败'))
  } finally {
    submittingReview.value = false
  }
}
function openPreview(): void {
  if (detail.value) void router.push(withNavigationSource({ name: 'resource-preview', params: { id: detail.value.id } }, route))
}
function openEdit(): void {
  if (detail.value) void router.push(withNavigationSource({ name: 'resource-edit', params: { id: detail.value.id } }, route))
}
function openReview(): void {
  if (detail.value) void router.push(withNavigationSource({ name: 'resource-review', params: { id: detail.value.id } }, route))
}

const resourceId = () => Number(props.id)

onMounted(() => {
  void store.getById(resourceId()).then(() => loadReferences()).catch(() => {
    /* store.detailError 已记录，界面展示 */
  })
})
</script>
<template>
  <ManagementLayout>
    <BackButton label="返回资源库" />

    <LoadingState v-if="store.detailLoading" title="正在加载资源" description="正在读取资源详情和访问权限。" />
    <ForbiddenState
      v-else-if="store.detailState === 'forbidden'"
      description="当前账号没有权限查看该资源。"
      action-label="返回资源库"
      @action="router.push({ name: 'resources' })"
    />
    <EmptyState
      v-else-if="store.detailState === 'not_found'"
      title="资源不存在"
      description="该资源可能已被删除或地址已经失效。"
      action-label="返回资源库"
      @action="router.push({ name: 'resources' })"
    />
    <ErrorState
      v-else-if="store.detailError"
      :description="store.detailError"
      @retry="store.getById(resourceId())"
    />
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

      <div v-if="canEdit" class="sec">
        <h3>引用关系</h3>
        <p v-if="referencesLoading" class="muted">正在查询教案和步骤引用…</p>
        <p v-else-if="referencesError" class="reference-error">
          {{ referencesError }}
          <button class="link-button" @click="loadReferences">重试</button>
        </p>
        <p v-else-if="!references.length" class="muted">当前没有教案或步骤引用此资源。</p>
        <ul v-else class="reference-list">
          <li v-for="reference in references" :key="`${reference.referenceType}:${reference.referenceId}`">
            <strong>{{ reference.lessonPlanTitle || `${reference.referenceType} #${reference.referenceId}` }}</strong>
            <span v-if="reference.steps.length">
              步骤：{{ reference.steps.map((step) => `${step.sortOrder}.${step.title}`).join('、') }}
            </span>
            <span v-else>引用详情不可见或暂无步骤信息</span>
          </li>
        </ul>
      </div>

      <div class="actions">
        <button v-if="detail.resourceType !== 'unknown'" class="button" @click="openPreview">预览</button>
        <button class="ghost" :class="{ on: detail.isFavorite }" :disabled="favoritePending" @click="onToggleFavorite">
          {{ favoritePending ? '处理中…' : detail.isFavorite ? '★ 已收藏' : '☆ 收藏' }}
        </button>
        <button v-if="canEdit && detail.reviewStatus !== 'archived'" class="ghost" @click="openEdit">编辑</button>
        <button v-if="canSubmitReview" class="ghost" :disabled="submittingReview" @click="onSubmitReview">
          {{ submittingReview ? '提交中…' : detail.reviewStatus === 'rejected' ? '重新提交审核' : '提交审核' }}
        </button>
        <template v-if="isAdmin">
          <button v-if="detail.reviewStatus === 'pending_review'" class="ghost" @click="openReview">审核</button>
        </template>
        <button v-if="canEdit" class="danger" @click="onDelete">删除</button>
      </div>
      <p v-if="editBlockedReason" class="edit-reason">{{ editBlockedReason }}</p>
    </div>
    <p v-else class="muted">未找到该资源</p>
  </ManagementLayout>
</template>
<style scoped>
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
.ghost:disabled { cursor: wait; opacity: 0.65; }
.edit-reason { margin: 12px 0 0; color: #9a7e6e; font-size: 13px; }
.reference-error { color: #c64e4e; }
.link-button { border: 0; background: transparent; color: #b9684d; cursor: pointer; text-decoration: underline; }
.reference-list { display: grid; gap: 9px; margin: 0; padding: 0; list-style: none; }
.reference-list li { display: grid; gap: 4px; padding: 10px 12px; border: 1px solid #f0ddce; border-radius: 10px; }
.reference-list li span { color: #9a7e6e; font-size: 13px; }
.danger { border: 1px solid #ffd7d7; background: #fff; color: #c64e4e; border-radius: 8px; padding: 10px 16px; cursor: pointer; }
</style>
