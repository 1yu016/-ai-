<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElButton, ElForm, ElFormItem, ElInput, ElMessage, ElOption, ElSelect } from 'element-plus'
import ManagementLayout from '@/components/ManagementLayout.vue'
import LoadingState from '@/components/LoadingState.vue'
import ErrorState from '@/components/ErrorState.vue'
import ForbiddenState from '@/components/ForbiddenState.vue'
import EmptyState from '@/components/EmptyState.vue'
import { AGE_GROUPS, toArrayField } from '@/api/resources'
import type { ResourceAgeGroup, UpdateResourceMetadata } from '@/api/resources'
import { apiErrorMessage } from '@/api/http'
import { useCourseLibraryStore } from '@/stores/library'
import { useUserStore } from '@/stores/user'

const props = defineProps<{ id: number }>()
const router = useRouter()
const store = useCourseLibraryStore()
const user = useUserStore()

const AGE_LABELS: Record<ResourceAgeGroup, string> = {
  small: '小班',
  middle: '中班',
  large: '大班',
  all: '通用',
}

const form = reactive<{
  title: string
  aliases: string
  description: string
  category: string
  categoryId: number | undefined
  ageGroup: ResourceAgeGroup
  domain: string
  tags: string
}>({
  title: '',
  aliases: '',
  description: '',
  category: '',
  categoryId: undefined,
  ageGroup: 'all',
  domain: '',
  tags: '',
})

const saving = ref(false)
const currentUserId = computed(() =>
  user.teacherInfo?.teacherId ?? user.teacherInfo?.userId ?? user.teacherInfo?.administratorId,
)
const canEdit = computed(() => {
  const resource = store.detail
  if (!resource) return false
  if (user.isAdmin) return true
  return resource.ownerType === 'teacher' && resource.ownerId === String(currentUserId.value)
})
const editBlockedReason = computed(() => {
  const resource = store.detail
  if (!resource) return ''
  if (resource.reviewStatus === 'archived') return '该资源已归档，不能编辑元数据。'
  if (!canEdit.value) return '只有资源所有者或有权管理员可以编辑该资源。'
  return ''
})

onMounted(async () => {
  try {
    const data = await store.getById(props.id)
    form.title = data.title
    form.aliases = (data.aliases ?? []).join(',')
    form.description = data.description ?? ''
    form.category = data.category ?? ''
    form.categoryId = data.categoryId ?? undefined
    form.ageGroup = data.ageGroup
    form.domain = data.domain ?? ''
    form.tags = (data.tags ?? []).join(',')
  } catch {
    // detailError 由 store 负责，模板展示
  }
})

async function save(): Promise<void> {
  if (saving.value || editBlockedReason.value) return
  if (!form.title.trim()) {
    ElMessage.warning('请填写资源标题')
    return
  }
  if (!form.category.trim()) {
    ElMessage.warning('请填写资源分类')
    return
  }
  saving.value = true
  try {
    const payload: UpdateResourceMetadata = {
      title: form.title.trim(),
      aliases: toArrayField(form.aliases),
      description: form.description.trim(),
      category: form.category.trim(),
      ageGroup: form.ageGroup,
      domain: form.domain.trim(),
      tags: toArrayField(form.tags),
    }
    if (Number.isInteger(form.categoryId) && Number(form.categoryId) > 0) {
      payload.categoryId = Number(form.categoryId)
    }
    await store.updateMetadata(props.id, payload)
    ElMessage.success('资源信息已保存')
    void router.push({ name: 'resource-detail', params: { id: props.id } })
  } catch (error) {
    ElMessage.error(apiErrorMessage(error, '保存失败，请稍后重试。'))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <ManagementLayout>
    <h1>编辑资源</h1>
    <p class="muted">修改资源的元数据信息（文件本体不可在此修改）</p>
    <div class="toolbar">
      <button class="button" @click="router.push({ name: 'resource-detail', params: { id } })">返回详情</button>
    </div>

    <LoadingState v-if="store.detailLoading" title="正在加载资源" description="正在读取资源元数据和编辑权限。" />
    <ForbiddenState
      v-else-if="store.detailState === 'forbidden'"
      description="当前账号没有权限访问或编辑该资源。"
      action-label="返回资源库"
      @action="router.push({ name: 'resources' })"
    />
    <EmptyState
      v-else-if="store.detailState === 'not_found'"
      title="资源不可编辑"
      description="资源可能已经归档、删除或地址已经失效。"
      action-label="返回资源库"
      @action="router.push({ name: 'resources' })"
    />
    <ErrorState
      v-else-if="store.detailError"
      :description="store.detailError"
      @retry="store.getById(id)"
    />
    <div v-else-if="store.detail" class="panel">
      <div class="file-boundary">
        <strong>文件本体</strong>
        <span>{{ store.detail.fileName }} · {{ store.detail.mimeType }}</span>
        <small>此页面只修改元数据。如需替换文件，请使用资源版本功能。</small>
      </div>
      <p v-if="editBlockedReason" class="blocked" role="alert">{{ editBlockedReason }}</p>
      <ElForm v-else label-position="top" class="edit-form" @submit.prevent="save">
        <ElFormItem label="标题（必填）">
          <ElInput v-model="form.title" placeholder="资源标题" />
        </ElFormItem>
        <ElFormItem label="别名">
          <ElInput v-model="form.aliases" placeholder="多个别名用逗号分隔" />
        </ElFormItem>
        <ElFormItem label="描述">
          <ElInput
            v-model="form.description"
            type="textarea"
            :rows="3"
            placeholder="资源用途与内容说明"
          />
        </ElFormItem>
        <ElFormItem label="分类名称">
          <ElInput v-model="form.category" placeholder="如：语言 / 科学" />
        </ElFormItem>
        <ElFormItem label="分类 ID">
          <ElInput v-model.number="form.categoryId" placeholder="可选" />
        </ElFormItem>
        <ElFormItem label="年龄段">
          <ElSelect v-model="form.ageGroup" class="full">
            <ElOption
              v-for="group in AGE_GROUPS"
              :key="group"
              :label="AGE_LABELS[group] ?? group"
              :value="group"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="学科领域">
          <ElInput v-model="form.domain" placeholder="如：科学 / 艺术" />
        </ElFormItem>
        <ElFormItem label="标签">
          <ElInput v-model="form.tags" placeholder="多个标签用逗号分隔" />
        </ElFormItem>
        <div class="form-actions">
          <ElButton :loading="saving" :disabled="saving" type="primary" native-type="submit">保存</ElButton>
          <ElButton @click="router.push({ name: 'resource-detail', params: { id } })">取消</ElButton>
        </div>
      </ElForm>
    </div>
  </ManagementLayout>
</template>

<style scoped>
.panel {
  padding: 20px;
}

.edit-form {
  max-width: 560px;
}

.edit-form .full {
  width: 100%;
}

.form-actions {
  display: flex;
  gap: 10px;
  margin-top: 8px;
}

.file-boundary { display: grid; gap: 5px; margin-bottom: 20px; padding: 14px 16px; border-radius: 12px; background: #f6f2ed; color: #66564d; }
.file-boundary span, .file-boundary small { color: #8b7568; }
.blocked { padding: 14px 16px; border-radius: 10px; background: #fff3dc; color: #9b6818; }
</style>
