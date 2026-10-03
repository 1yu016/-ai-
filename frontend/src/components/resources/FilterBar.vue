<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import {
  AGE_GROUPS,
  RESOURCE_TYPES,
  REVIEW_STATUSES,
  resourceApi,
  type ListResourcesParams,
  type ResourceAgeGroup,
  type ResourceCategory,
  type ResourceReviewStatus,
  type ResourceType,
} from '@/api/resources'

const props = defineProps<{ modelValue: ListResourcesParams }>()
const emit = defineEmits<{
  (e: 'update:modelValue', value: ListResourcesParams): void
  (e: 'search'): void
  (e: 'reset'): void
}>()

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

const form = reactive<ListResourcesParams>({ ...props.modelValue })
const categories = ref<ResourceCategory[]>([])

// 父级回填(如路由 query 恢复)时同步本地副本；本地编辑仅触发 update:modelValue 单向，不在此自动查询。
watch(
  () => props.modelValue,
  (value) => {
    for (const key in value) {
      ;(form as Record<string, unknown>)[key] = (value as Record<string, unknown>)[key]
    }
  },
  { deep: true },
)

onMounted(async () => {
  try {
    categories.value = (await resourceApi.categories()).data
  } catch {
    categories.value = []
  }
})

function commit(): void {
  emit('update:modelValue', { ...form })
}
function change(field: keyof ListResourcesParams, value: unknown): void {
  const normalized = value === '' || value === null ? undefined : value
  ;(form as unknown as Record<keyof ListResourcesParams, unknown>)[field] = normalized
  commit()
}
function doSearch(): void {
  emit('search')
}
function doReset(): void {
  for (const key in form) delete (form as Record<string, unknown>)[key]
  commit()
  emit('reset')
}
</script>
<template>
  <div class="filterbar">
    <label class="field">
      <span>关键词</span>
      <input
        v-model="form.keyword"
        type="text"
        placeholder="标题 / 标签"
        @keyup.enter="doSearch"
        @blur="commit"
      />
    </label>
    <label class="field">
      <span>资源类型</span>
      <select
        :value="form.resourceType"
        @change="change('resourceType', ($event.target as HTMLSelectElement).value)"
      >
        <option value="">全部</option>
        <option v-for="t in RESOURCE_TYPES" :key="t" :value="t">{{ TYPE_LABELS[t] }}</option>
      </select>
    </label>
    <label class="field">
      <span>年龄段</span>
      <select
        :value="form.ageGroup"
        @change="change('ageGroup', ($event.target as HTMLSelectElement).value)"
      >
        <option value="">全部</option>
        <option v-for="g in AGE_GROUPS" :key="g" :value="g">{{ AGE_LABELS[g] }}</option>
      </select>
    </label>
    <label class="field">
      <span>领域</span>
      <input v-model="form.domain" type="text" placeholder="如 语言 / 科学" @blur="commit" />
    </label>
    <label class="field">
      <span>审核状态</span>
      <select
        :value="form.reviewStatus"
        @change="change('reviewStatus', ($event.target as HTMLSelectElement).value)"
      >
        <option value="">全部</option>
        <option v-for="s in REVIEW_STATUSES" :key="s" :value="s">{{ STATUS_LABELS[s] }}</option>
      </select>
    </label>
    <label class="field">
      <span>分类</span>
      <select
        :value="form.categoryId"
        @change="change('categoryId', Number(($event.target as HTMLSelectElement).value) || undefined)"
      >
        <option value="">全部分类</option>
        <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
    </label>
    <div class="buttons">
      <button class="button" @click="doSearch">搜索</button>
      <button class="ghost" @click="doReset">重置</button>
    </div>
  </div>
</template>
<style scoped>
.filterbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 14px;
  background: #fff;
  border: 1px solid #e7edf3;
  border-radius: 12px;
  padding: 16px 18px;
}
.field { display: flex; flex-direction: column; gap: 6px; min-width: 150px; flex: 1; max-width: 220px; }
.field > span { font-size: 12px; color: #8191a2; }
.field input,
.field select {
  height: 38px;
  border: 1px solid #dce5ed;
  border-radius: 8px;
  padding: 0 11px;
  background: #fff;
  color: #26364a;
  outline: none;
}
.field input:focus,
.field select:focus { border-color: #36aa89; }
.buttons { display: flex; gap: 8px; }
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
.ghost:hover { color: #229a7d; border-color: #229a7d; }
</style>