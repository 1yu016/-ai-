<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElButton, ElForm, ElFormItem, ElInput, ElMessage, ElOption, ElSelect } from 'element-plus'
import ManagementLayout from '@/components/ManagementLayout.vue'
import { AGE_GROUPS, resourceApi, toArrayField } from '@/api/resources'
import type { ResourceAgeGroup, ResourceMeta } from '@/api/resources'
import { apiErrorMessage } from '@/api/http'
import { useCourseLibraryStore } from '@/stores/library'

const props = defineProps<{ id: number }>()
const router = useRouter()
const store = useCourseLibraryStore()

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
  saving.value = true
  try {
    const payload: Partial<ResourceMeta> = {
      title: form.title,
      aliases: toArrayField(form.aliases),
      description: form.description || undefined,
      category: form.category || undefined,
      categoryId: form.categoryId,
      ageGroup: form.ageGroup,
      domain: form.domain || undefined,
      tags: toArrayField(form.tags),
    }
    await resourceApi.update(props.id, payload)
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

    <div class="panel">
      <p v-if="store.detailLoading">加载中…</p>
      <p v-else-if="store.detailError" class="bad">{{ store.detailError }}</p>
      <ElForm v-else label-position="top" class="edit-form" @submit.prevent>
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
          <ElButton :loading="saving" type="primary" @click="save">保存</ElButton>
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
</style>