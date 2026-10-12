<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import ManagementLayout from '@/components/ManagementLayout.vue'
import ErrorState from '@/components/ErrorState.vue'
import EmptyState from '@/components/EmptyState.vue'
import ForbiddenState from '@/components/ForbiddenState.vue'
import LoadingState from '@/components/LoadingState.vue'
import PageHeader from '@/components/PageHeader.vue'
import PageShell from '@/components/PageShell.vue'
import { platformApi, type AdminDashboard } from '@/api/platform'
import { apiErrorMessage, apiErrorStatus } from '@/api/http'

const data = ref<AdminDashboard | null>(null)
const loading = ref(false)
const error = ref('')
const forbidden = ref(false)
const unavailable = ref(false)

const cards = computed(() => data.value ? [
  { label: '教师', value: data.value.teachers, hint: '启用及停用账号总量' },
  { label: '班级', value: data.value.classes, hint: '园所班级总量' },
  { label: '幼儿', value: data.value.students, hint: '仅展示聚合数量' },
  { label: '设备', value: data.value.devices.total, hint: '园所登记设备总量' },
  { label: '在线设备', value: data.value.devices.online, hint: `共 ${data.value.devices.total} 台` },
  { label: '离线设备', value: data.value.devices.offline, hint: '含停用和故障设备' },
  { label: '今日课堂', value: data.value.classrooms.today, hint: '按服务端时间统计' },
  { label: '进行中课堂', value: data.value.classrooms.active, hint: '准备、运行或暂停' },
  { label: '异常课堂', value: data.value.classrooms.abnormal, hint: '需要管理员排查' },
  { label: '待审核资源', value: data.value.resources.pending, hint: `已停用 ${data.value.resources.disabled} 项` },
] : [])

function bytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`
  return `${(value / 1024 ** 3).toFixed(2)} GB`
}

async function load() {
  loading.value = true
  error.value = ''
  forbidden.value = false
  unavailable.value = false
  try {
    data.value = (await platformApi.adminDashboard()).data
  } catch (cause) {
    const status = apiErrorStatus(cause)
    if (status === 403) forbidden.value = true
    else if (status === 404 || status === 501) unavailable.value = true
    else error.value = apiErrorMessage(cause, '管理看板加载失败')
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <ManagementLayout>
    <PageShell variant="list" class="dashboard">
      <PageHeader eyebrow="平台管理" title="数据看板" subtitle="仅展示园所运营聚合数据，不展示幼儿个人隐私。">
        <template v-if="!forbidden" #actions><button class="button" :disabled="loading" @click="load">刷新数据</button></template>
      </PageHeader>
      <ForbiddenState v-if="forbidden" class="state" description="当前账号没有查看管理员看板的权限。" />
      <LoadingState v-else-if="loading && !data" class="state" title="正在汇总平台数据" description="正在统计教师、班级、设备、课堂和资源数据。" />
      <EmptyState v-else-if="unavailable" class="state" title="暂无统计接口" description="当前服务端尚未提供管理员聚合统计，请联系管理员完成接口部署。" :can-act="false" />
      <ErrorState v-else-if="error" class="state" :description="error" @retry="load" />
      <template v-else-if="data">
        <section class="cards">
          <article v-for="card in cards" :key="card.label" class="card">
            <span>{{ card.label }}</span><strong>{{ card.value }}</strong><small>{{ card.hint }}</small>
          </article>
        </section>
        <section class="detail-grid">
          <article class="panel">
            <h2>AI调用质量</h2>
            <dl>
              <div><dt>调用量</dt><dd>{{ data.ai.total }}</dd></div>
              <div><dt>成功率</dt><dd class="good">{{ data.ai.successRate }}%</dd></div>
              <div><dt>错误率</dt><dd :class="{ danger: data.ai.errorRate > 10 }">{{ data.ai.errorRate }}%</dd></div>
              <div><dt>平均耗时</dt><dd>{{ data.ai.averageLatencyMs }} ms</dd></div>
            </dl>
          </article>
          <article class="panel">
            <h2>存储使用</h2>
            <dl>
              <div><dt>资源索引容量</dt><dd>{{ bytes(data.storage.indexedResourceBytes) }}</dd></div>
              <div><dt>数据库与上传目录</dt><dd>{{ bytes(data.storage.physicalBytes) }}</dd></div>
            </dl>
            <p class="note">物理容量以服务端可访问目录为准。</p>
          </article>
        </section>
        <p class="updated">更新时间：{{ new Date(data.generatedAt).toLocaleString() }}</p>
      </template>
    </PageShell>
  </ManagementLayout>
</template>

<style scoped>
.state{margin-top:24px}.button{border:0;border-radius:12px;padding:11px 18px;background:#e99068;color:#fff;cursor:pointer}.button:disabled{opacity:.6;cursor:not-allowed}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin-top:24px}.card{display:grid;gap:8px;padding:20px;border:1px solid #f0ddce;border-radius:18px;background:#fffdf9}.card span{color:#8d7668}.card strong{font-size:32px;color:#5b463c}.card small{color:#a78f81}.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:18px}.panel{margin-top:20px;padding:20px;border:1px solid #f0ddce;border-radius:18px;background:#fffdf9}.panel h2{margin:0 0 16px}.panel dl{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:0}.panel dl div{padding:14px;border-radius:14px;background:#fff5ec}.panel dt{font-size:12px;color:#92796a}.panel dd{margin:7px 0 0;font-size:20px;font-weight:800}.good{color:#33835e}.danger{color:#b4443d}.updated,.note{color:#987c6d}.updated{margin-top:16px;text-align:right;font-size:12px}@media(max-width:720px){.detail-grid{grid-template-columns:1fr}}
</style>
