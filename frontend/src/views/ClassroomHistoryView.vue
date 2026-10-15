<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ManagementLayout from '@/components/ManagementLayout.vue'
import PageShell from '@/components/PageShell.vue'
import PageHeader from '@/components/PageHeader.vue'
import LoadingState from '@/components/LoadingState.vue'
import ErrorState from '@/components/ErrorState.vue'
import EmptyState from '@/components/EmptyState.vue'
import { platformApi, type SchoolClass, type ClassroomRunSummary } from '@/api/platform'
import { apiErrorMessage } from '@/api/http'
import { withNavigationSource } from '@/router/navigation'

const route = useRoute()
const router = useRouter()
const classes = ref<SchoolClass[]>([])
const items = ref<ClassroomRunSummary[]>([])
const loading = ref(false)
const error = ref('')
const total = ref(0)
function positiveInteger(value: unknown, fallback: number) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : fallback
}
const classId = computed(() => positiveInteger(route.query.classId, 0))
const page = computed(() => positiveInteger(route.query.page, 1))
const pageSize = 20
let generation = 0
let initialized = false
const labels: Record<string, string> = { prepared: '待开始', running: '进行中', paused: '已暂停', completed: '已结束', cancelled: '已中止', failed: '异常结束' }

async function load() {
  const current = ++generation
  error.value = ''
  items.value = []
  total.value = 0
  if (!classId.value) { loading.value = false; return }
  loading.value = true
  try {
    const response = await platformApi.classRuns(classId.value, { page: page.value, pageSize })
    if (current !== generation) return
    items.value = response.data.items
    total.value = response.data.total
  } catch (cause) {
    if (current === generation) error.value = apiErrorMessage(cause, '课堂记录加载失败，请重试。')
  } finally {
    if (current === generation) loading.value = false
  }
}

function selectClass(value: string) {
  void router.replace({ query: { ...(Number(value) ? { classId: value } : {}) } })
}
function changePage(value: number) {
  void router.replace({ query: { ...route.query, page: String(value) } })
}
function openRecord(id: number) {
  void router.push(withNavigationSource({ name: 'classroom-record', params: { runId: id } }, route))
}
watch(() => route.fullPath, () => { if (initialized) void load() })
async function initialize() {
  loading.value = true
  error.value = ''
  classes.value = []
  try {
    // Read only the classes the backend authorizes. Fetch every page so a class
    // outside the first page remains selectable, including after a deep link.
    let classPage = 1
    do {
      const response = await platformApi.classes({ page: classPage, pageSize: 100 })
      classes.value.push(...response.data.items)
      if (!response.data.items.length || classes.value.length >= response.data.total) break
      classPage += 1
    } while (true)
    if (!classId.value && classes.value[0]) {
      await router.replace({ query: { classId: String(classes.value[0].id) } })
    }
    initialized = true
    await load()
  } catch (cause) {
    error.value = apiErrorMessage(cause, '班级加载失败，请重新打开课堂记录。')
  } finally { loading.value = false }
}
onMounted(initialize)
</script>

<template>
  <ManagementLayout><PageShell variant="list">
    <template #header><PageHeader title="课堂记录" eyebrow="教学复盘" subtitle="选择班级，查看真实课堂时间线和教师确认的总结。" /></template>
    <section class="history-filter"><label for="history-class">班级</label><select id="history-class" :value="classId" @change="selectClass(($event.target as HTMLSelectElement).value)"><option value="0">请选择班级</option><option v-for="item in classes" :key="item.id" :value="item.id">{{ item.name }}</option></select></section>
    <LoadingState v-if="loading" />
    <ErrorState v-else-if="error" :description="error" @retry="classes.length ? load() : initialize()" />
    <EmptyState v-else-if="!items.length" title="暂无课堂记录" :description="classId ? '该班级还没有课堂记录。可以前往备课中心准备课堂。' : '请选择一个您有权限查看的班级。'" :can-act="false" />
    <template v-else><section class="history-list"><article v-for="item in items" :key="item.id"><div><h2>{{ item.title }}</h2><p>{{ item.startedAt ? new Date(item.startedAt).toLocaleString() : '尚未开始' }}</p></div><span>{{ labels[item.status] || item.status }}</span><button type="button" @click="openRecord(item.id)">查看记录</button></article></section><nav class="history-pages" aria-label="课堂记录分页"><span>共 {{ total }} 节课堂</span><button :disabled="page <= 1" @click="changePage(page - 1)">上一页</button><button :disabled="page * pageSize >= total" @click="changePage(page + 1)">下一页</button></nav></template>
  </PageShell></ManagementLayout>
</template>

<style scoped>
.history-filter,.history-list article{display:flex;align-items:center;gap:16px;padding:18px;border:1px solid #f0ddce;border-radius:16px;background:#fffdf9;margin-top:18px}.history-filter select{padding:10px;border:1px solid #efd9c8;border-radius:10px;background:white;font:inherit}.history-list article>div{flex:1}.history-list h2{margin:0;font-size:19px}.history-list p{margin:7px 0 0;color:#90796a}.history-list button,.history-pages button{padding:10px 16px;border:1px solid #efd9c8;border-radius:10px;background:#fff5e9;color:#986244;font:inherit;cursor:pointer}.history-pages{display:flex;justify-content:flex-end;gap:12px;align-items:center;margin-top:20px}.history-pages button:disabled{opacity:.45;cursor:default}@media(max-width:640px){.history-list article{flex-wrap:wrap}.history-list article>div{flex-basis:100%}}
</style>
