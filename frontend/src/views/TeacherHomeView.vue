<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import ManagementLayout from '@/components/ManagementLayout.vue'
import PageHeader from '@/components/PageHeader.vue'
import PageShell from '@/components/PageShell.vue'
import LoadingState from '@/components/LoadingState.vue'
import ErrorState from '@/components/ErrorState.vue'
import EmptyState from '@/components/EmptyState.vue'
import { platformApi, type SchoolClass } from '@/api/platform'
import { http, apiErrorMessage } from '@/api/http'
import type { ClassroomRunPayload } from '@/stores/lessonRun'

const router = useRouter()
const classes = ref<SchoolClass[]>([])
const active = ref<ClassroomRunPayload[]>([])
const loading = ref(true)
const error = ref('')
async function load() {
  loading.value = true
  error.value = ''
  const results = await Promise.allSettled([
    platformApi.classes({ page: 1, pageSize: 6 }),
    http.get<ClassroomRunPayload | ClassroomRunPayload[] | null>('/classroom-runs/active'),
  ])
  if (results[0].status === 'fulfilled') classes.value = results[0].value.data.items
  else error.value = apiErrorMessage(results[0].reason, '班级信息暂时无法读取。')
  if (results[1].status === 'fulfilled') {
    const value = results[1].value.data
    active.value = (Array.isArray(value) ? value : value ? [value] : []).filter((item) => ['running', 'paused'].includes(item.status))
  } else {
    active.value = []
    error.value ||= apiErrorMessage(results[1].reason, '进行中的课堂暂时无法读取。')
  }
  loading.value = false
}
onMounted(load)
</script>

<template>
  <ManagementLayout><PageShell variant="list"><template #header><PageHeader title="今天的教学" eyebrow="教师工作台" subtitle="选择班级、准备教案，或继续正在进行的课堂。" /></template>
    <LoadingState v-if="loading" />
    <template v-else>
      <ErrorState v-if="error" :description="error" @retry="load" />
      <section v-if="active.length" class="home-section"><h2>继续课堂</h2><article v-for="item in active" :key="item.id"><strong>{{ item.title }}</strong><p>{{ item.status === 'paused' ? '已暂停' : '正在上课' }}</p><button @click="router.push({ name: 'lesson-classroom', params: { runId: item.id } })">继续控制课堂</button></article></section>
      <section class="home-section"><h2>我的班级</h2><EmptyState v-if="!classes.length && !error" title="暂未分配班级" description="请联系管理员分配班级后，再开始准备课堂。" :can-act="false" /><div class="home-grid"><article v-for="item in classes" :key="item.id"><h3>{{ item.name }}</h3><p>{{ item.grade || '我的教学班级' }}</p><button @click="router.push({ name: 'class-detail', params: { classId: item.id } })">进入班级</button><button @click="router.push({ name: 'lesson-plans', query: { classId: String(item.id) } })">准备课堂</button></article></div><button @click="router.push({ name: 'my-classes' })">查看全部班级 →</button></section>
      <section class="home-section"><h2>教学工具</h2><div class="home-grid"><button @click="router.push({ name: 'lesson-plans' })">备课中心</button><button @click="router.push({ name: 'resources' })">课程资源</button><button @click="router.push({ name: 'classroom-history' })">课堂记录</button></div></section>
    </template>
  </PageShell></ManagementLayout>
</template>

<style scoped>
.home-section{margin-top:26px}.home-section h2{font-size:20px}.home-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}.home-section article{padding:20px;border:1px solid #f0ddce;border-radius:18px;background:#fffdf9;margin-bottom:14px}.home-grid h3{margin:0;font-size:19px}.home-section p{color:#90796a}.home-section button{padding:12px 16px;margin:4px;border:1px solid #efd9c8;border-radius:12px;background:#fff2e7;color:#a66243;font:inherit;font-weight:700;cursor:pointer}.home-grid>button{padding:22px}
</style>
