<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElButton, ElDialog, ElInput, ElOption, ElSelect } from 'element-plus'
import { normalizeServerResource, type ServerResource, type CourseResourceMediaType, type CourseResource } from '@/stores/courseResource'
import { http, apiErrorMessage } from '@/api/http'
import { useResourcePlayerStore } from '@/stores/resourcePlayer'

defineProps<{ modelValue?: number | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: number | null]; selected: [resource: CourseResource | null] }>()
const open = defineModel<boolean>('open', { default: false })
const player = useResourcePlayerStore()
const sortedResources = ref<CourseResource[]>([])
const loading = ref(false); const loadError = ref(''); const page = ref(1); const total = ref(0)
let sequence = 0
const keyword = ref('')
const resourceType = ref<CourseResourceMediaType | ''>('')
const category = ref('')
const ageGroup = ref('')
async function search(reset = true) {
  if (reset) page.value = 1
  const current = ++sequence; loading.value = true; loadError.value = ''; sortedResources.value = []
  try {
    const { data } = await http.get<{ items: ServerResource[]; total: number }>('/resources', { params: {
      keyword: keyword.value || undefined, resourceType: resourceType.value || undefined,
      category: category.value || undefined, ageGroup: ageGroup.value || undefined,
      reviewStatus: 'approved', page: page.value, pageSize: 20 } })
    if (current !== sequence) return
    sortedResources.value = data.items.map(normalizeServerResource).filter((r): r is CourseResource => !!r && r.reviewStatus === 'approved')
    total.value = data.total
  } catch (e) { if (current === sequence) loadError.value = apiErrorMessage(e, '资源加载失败，请重试') }
  finally { if (current === sequence) loading.value = false }
}
function choose(resource: CourseResource) { if (loading.value || resource.reviewStatus !== 'approved' || typeof resource.id !== 'number') return; emit('update:modelValue', resource.id); emit('selected', resource); open.value = false }
function remove() { emit('update:modelValue', null); emit('selected', null); open.value = false }
watch(open, (value) => { if (value) void search(); else { sequence++; loading.value = false } }, { immediate: true })
</script>

<template>
  <ElDialog v-model="open" title="选择课程资源" width="min(920px, 94vw)" destroy-on-close>
    <div class="filters">
      <ElInput v-model="keyword" placeholder="搜索标题、标签" clearable @keyup.enter="search" />
      <ElSelect v-model="resourceType" placeholder="类型" clearable><ElOption label="图片" value="image" /><ElOption label="音频" value="audio" /><ElOption label="视频" value="video" /><ElOption label="PDF/PPT 课件" value="document" /></ElSelect>
      <ElInput v-model="category" placeholder="分类" clearable />
      <ElSelect v-model="ageGroup" placeholder="年龄段" clearable><ElOption label="小班" value="small" /><ElOption label="中班" value="middle" /><ElOption label="大班" value="large" /><ElOption label="全年龄" value="all" /></ElSelect>
      <ElButton type="primary" :loading="loading" @click="search()">搜索</ElButton>
    </div>
    <p v-if="loadError" class="error">{{ loadError }}</p>
    <div v-else class="resource-grid">
      <article v-for="resource in sortedResources.filter((item) => item.source === 'library')" :key="resource.id" class="resource-card">
        <div class="thumb">{{ resource.mediaType === 'image' ? '🖼️' : resource.mediaType === 'audio' ? '🎵' : resource.mediaType === 'video' ? '🎬' : '📄' }}</div>
        <strong>{{ resource.title }}</strong><small>{{ resource.category }} · {{ resource.tags.join('、') || '无标签' }}</small>
        <div><ElButton size="small" @click="player.openResource(resource, false)">预览</ElButton><ElButton size="small" type="primary" @click="choose(resource)">选择</ElButton></div>
      </article>
      <p v-if="!loading && !sortedResources.length">没有找到可用资源。</p>
    </div>
    <template #footer><span>第 {{ page }} 页 · 共 {{ total }} 项</span><ElButton :disabled="page <= 1 || loading" @click="page--; search(false)">上一页</ElButton><ElButton :disabled="page * 20 >= total || loading" @click="page++; search(false)">下一页</ElButton><ElButton @click="remove">移除资源引用</ElButton><ElButton @click="open = false">取消</ElButton></template>
  </ElDialog>
</template>

<style scoped>
.filters{display:grid;grid-template-columns:2fr 1fr 1fr 1fr auto;gap:10px}.resource-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px;max-height:55vh;overflow:auto;margin-top:16px}.resource-card{display:grid;gap:8px;padding:14px;border:1px solid #ead8c9;border-radius:14px}.resource-card small{color:#8f7768;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.thumb{font-size:32px}.error{color:#c94d4d}@media(max-width:720px){.filters{grid-template-columns:1fr 1fr}.filters>*:first-child{grid-column:1/-1}}
</style>
