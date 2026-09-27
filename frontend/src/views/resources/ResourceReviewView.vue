<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElButton, ElInput, ElMessage } from 'element-plus'
import ManagementLayout from '@/components/ManagementLayout.vue'
import { resourceApi } from '@/api/resources'
import type { ResourceResponse, ResourceReviewStatus } from '@/api/resources'
import { apiErrorMessage } from '@/api/http'
import { useCourseLibraryStore } from '@/stores/library'
import { useUserStore } from '@/stores/user'

const props = defineProps<{ id: string | number }>()
const router = useRouter()
const store = useCourseLibraryStore()
const user = useUserStore()

const STATUS_LABELS: Record<ResourceReviewStatus, string> = {
  draft: '草稿',
  pending: '待审核',
  approved: '已通过',
  rejected: '已驳回',
  disabled: '已停用',
}

const rejectComment = ref('')
const acting = ref(false)
const pendingList = ref<ResourceResponse[]>([])
const pendingLoading = ref(false)
const resourceId = computed(() => Number(props.id))

const canSubmitReview = computed(() => {
  const status = store.detail?.reviewStatus
  return status === 'draft' || status === 'rejected'
})
const canReview = computed(() => store.detail?.reviewStatus === 'pending')

async function loadDetail(): Promise<void> {
  if (!user.isAdmin) return
  rejectComment.value = ''
  try {
    await store.getById(resourceId.value)
  } catch {
    // detailError 由 store 负责
  }
}

onMounted(() => {
  void loadDetail()
  void loadPending()
})

watch(resourceId, () => {
  void loadDetail()
})

async function loadPending(): Promise<void> {
  pendingLoading.value = true
  try {
    const { data } = await resourceApi.list({ reviewStatus: 'pending', pageSize: 20 })
    pendingList.value = data.items
  } catch {
    pendingList.value = []
  } finally {
    pendingLoading.value = false
  }
}

async function submitForReview(): Promise<void> {
  acting.value = true
  try {
    await resourceApi.submitReview(resourceId.value)
    ElMessage.success('已提交审核')
    await store.getById(resourceId.value)
  } catch (error) {
    ElMessage.error(apiErrorMessage(error, '提交审核失败'))
  } finally {
    acting.value = false
  }
}

async function approve(): Promise<void> {
  acting.value = true
  try {
    await resourceApi.review(resourceId.value, { status: 'approved' })
    ElMessage.success('已通过审核')
    await store.getById(resourceId.value)
  } catch (error) {
    ElMessage.error(apiErrorMessage(error, '审核操作失败'))
  } finally {
    acting.value = false
  }
}

async function reject(): Promise<void> {
  if (!rejectComment.value.trim()) {
    ElMessage.warning('请填写驳回意见')
    return
  }
  acting.value = true
  try {
    await resourceApi.review(resourceId.value, { status: 'rejected', comment: rejectComment.value.trim() })
    ElMessage.success('已驳回')
    await store.getById(resourceId.value)
  } catch (error) {
    ElMessage.error(apiErrorMessage(error, '审核操作失败'))
  } finally {
    acting.value = false
  }
}

function openReview(id: number): void {
  void router.push({ name: 'resource-review', params: { id } })
}
</script>

<template>
  <ManagementLayout>
    <template v-if="!user.isAdmin">
      <h1>资源审核</h1>
      <div class="panel">
        <p class="bad">您无权限访问审核功能，请联系管理员。</p>
      </div>
    </template>

    <template v-else>
      <h1>资源审核</h1>
      <p class="muted">审核资源是否符合发布要求</p>
      <div class="toolbar">
        <button class="button" @click="router.push({ name: 'resource-detail', params: { id } })">返回详情</button>
      </div>

      <div class="panel">
        <p v-if="store.detailLoading">加载中…</p>
        <p v-else-if="store.detailError" class="bad">{{ store.detailError }}</p>
        <template v-else-if="store.detail">
          <dl class="info">
            <div><dt>标题</dt><dd>{{ store.detail.title }}</dd></div>
            <div><dt>类型</dt><dd>{{ store.detail.resourceType }}</dd></div>
            <div><dt>状态</dt><dd>{{ STATUS_LABELS[store.detail.reviewStatus] ?? store.detail.reviewStatus }}</dd></div>
            <div><dt>分类</dt><dd>{{ store.detail.category || '—' }}</dd></div>
            <div><dt>文件</dt><dd>{{ store.detail.fileName }}</dd></div>
          </dl>

          <div class="review-actions">
            <ElButton v-if="canSubmitReview" type="primary" :loading="acting" @click="submitForReview">
              提交审核
            </ElButton>
            <template v-if="canReview">
              <ElButton type="success" :loading="acting" @click="approve">通过</ElButton>
              <ElButton type="danger" :loading="acting" @click="reject">驳回</ElButton>
            </template>
            <span v-if="store.detail.reviewStatus === 'approved'" class="ok-badge">已通过</span>
            <span v-if="store.detail.reviewStatus === 'pending'" class="warn-badge">等待审核</span>
          </div>

          <div v-if="canReview" class="reject-box">
            <label>驳回意见（必填）</label>
            <ElInput
              v-model="rejectComment"
              type="textarea"
              :rows="3"
              placeholder="请说明驳回原因"
            />
          </div>
        </template>
      </div>

      <div class="panel pending-panel">
        <div class="pending-head">
          <h3>待审核列表</h3>
          <button class="button" :disabled="pendingLoading" @click="loadPending">刷新</button>
        </div>
        <p v-if="pendingLoading">加载中…</p>
        <ul v-else-if="pendingList.length" class="pending-list">
          <li v-for="item in pendingList" :key="item.id">
            <span>{{ item.title }}</span>
            <span class="muted">{{ item.resourceType }}</span>
            <a @click="openReview(item.id)">去审核 →</a>
          </li>
        </ul>
        <p v-else class="muted">暂无待审核资源。</p>
      </div>
    </template>
  </ManagementLayout>
</template>

<style scoped>
.panel {
  padding: 20px;
  margin-bottom: 16px;
}

.info {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px 24px;
  margin: 0 0 18px;
}

.info div dt {
  color: #82958b;
  font-size: 12px;
  margin-bottom: 2px;
}

.info div dd {
  margin: 0;
  font-size: 14px;
  overflow-wrap: anywhere;
}

.review-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.ok-badge {
  border-radius: 12px;
  padding: 4px 10px;
  background: #e6f7ef;
  color: #21936f;
  font-size: 12px;
}

.warn-badge {
  border-radius: 12px;
  padding: 4px 10px;
  background: #fff3dc;
  color: #b77d20;
  font-size: 12px;
}

.reject-box {
  max-width: 480px;
  margin-top: 16px;
  display: grid;
  gap: 6px;
}

.reject-box label {
  color: #5c7168;
  font-size: 13px;
}

.pending-panel .pending-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.pending-panel h3 {
  margin: 0;
  font-size: 16px;
}

.pending-list {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
}

.pending-list li {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 6px;
  border-bottom: 1px solid #eef2f5;
  font-size: 14px;
}

.pending-list li:last-child {
  border-bottom: 0;
}

.pending-list a {
  margin-left: auto;
  color: #2e8d6e;
  cursor: pointer;
}
</style>
