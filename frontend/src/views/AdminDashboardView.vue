<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import ManagementLayout from '@/components/ManagementLayout.vue'
import { platformApi, type AdminDashboard } from '@/api/platform'
import { apiErrorMessage } from '@/api/http'

const data = ref<AdminDashboard | null>(null)
const loading = ref(false)
const error = ref('')

const cards = computed(() => data.value ? [
  { label: '教师', value: data.value.teachers, hint: '启用及停用账号总量' },
  { label: '班级', value: data.value.classes, hint: '园所班级总量' },
  { label: '幼儿', value: data.value.students, hint: '仅展示聚合数量' },
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
  try {
    data.value = (await platformApi.adminDashboard()).data
  } catch (cause) {
    error.value = apiErrorMessage(cause, '管理看板加载失败')
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <ManagementLayout>
    <main class="dashboard">
      <header>
        <div><h1>数据看板</h1><p>仅展示园所运营聚合数据，不展示幼儿个人隐私。</p></div>
        <button class="button" :disabled="loading" @click="load">刷新数据</button>
      </header>
      <section v-if="loading && !data" class="panel">正在汇总平台数据…</section>
      <section v-else-if="error" class="panel error">{{ error }}</section>
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
    </main>
  </ManagementLayout>
</template>

<style scoped>
.dashboard{max-width:1180px;margin:auto}.dashboard header{display:flex;justify-content:space-between;align-items:flex-end;gap:16px}.dashboard h1{margin:0 0 8px;font-size:38px}.dashboard header p,.updated,.note{margin:0;color:#987c6d}.button{border:0;border-radius:12px;padding:11px 18px;background:#e99068;color:#fff}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin-top:24px}.card{display:grid;gap:8px;padding:20px;border:1px solid #f0ddce;border-radius:18px;background:#fffdf9}.card span{color:#8d7668}.card strong{font-size:32px;color:#5b463c}.card small{color:#a78f81}.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:18px}.panel{margin-top:20px;padding:20px;border:1px solid #f0ddce;border-radius:18px;background:#fffdf9}.panel h2{margin:0 0 16px}.panel dl{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:0}.panel dl div{padding:14px;border-radius:14px;background:#fff5ec}.panel dt{font-size:12px;color:#92796a}.panel dd{margin:7px 0 0;font-size:20px;font-weight:800}.good{color:#33835e}.danger,.error{color:#b4443d}.updated{margin-top:16px;text-align:right;font-size:12px}@media(max-width:720px){.dashboard header,.detail-grid{display:grid;grid-template-columns:1fr}.dashboard h1{font-size:30px}}
</style>
