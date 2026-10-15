<script setup lang="ts">
import { onMounted, ref } from 'vue'
import ManagementLayout from '@/components/ManagementLayout.vue'
import { platformApi, type AiCallLogItem, type AuditLogItem } from '@/api/platform'
import { apiErrorMessage } from '@/api/http'

const auditItems = ref<AuditLogItem[]>([])
const aiItems = ref<AiCallLogItem[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const error = ref('')
const tab = ref<'operations' | 'ai'>('operations')
const filters = ref({ action: '', actorType: '', result: '' })

function metadata(value: Record<string, unknown> | null) {
  if (!value) return '—'
  const text = JSON.stringify(value)
  return text.length > 120 ? `${text.slice(0, 120)}…` : text
}

async function loadAudit(nextPage = page.value) {
  loading.value = true
  error.value = ''
  try {
    const response = await platformApi.auditLogs({
      page: nextPage,
      pageSize: 30,
      action: filters.value.action || undefined,
      actorType: filters.value.actorType || undefined,
      result: filters.value.result || undefined,
    })
    auditItems.value = response.data.items
    total.value = response.data.total
    page.value = nextPage
  } catch (cause) {
    error.value = apiErrorMessage(cause, '审计日志加载失败')
  } finally {
    loading.value = false
  }
}

async function loadAi() {
  loading.value = true
  error.value = ''
  try {
    aiItems.value = (await platformApi.aiCallLogs({ page: 1, pageSize: 50 })).data.items
  } catch (cause) {
    error.value = apiErrorMessage(cause, 'AI调用日志加载失败')
  } finally {
    loading.value = false
  }
}

function switchTab(next: 'operations' | 'ai') {
  tab.value = next
  if (next === 'ai') void loadAi()
}

onMounted(() => loadAudit())
</script>

<template>
  <ManagementLayout>
    <main class="audit-page">
      <header><div><h1>审计日志</h1><p>日志只读，敏感字段已由服务端脱敏。</p></div></header>
      <nav class="tabs"><button :class="{ active: tab === 'operations' }" @click="switchTab('operations')">操作审计</button><button :class="{ active: tab === 'ai' }" @click="switchTab('ai')">AI调用</button></nav>
      <section v-if="tab === 'operations'" class="filters">
        <input v-model="filters.action" placeholder="按操作名称筛选" @keyup.enter="loadAudit(1)" />
        <select v-model="filters.actorType"><option value="">全部操作者</option><option value="teacher">教师</option><option value="administrator">管理员</option></select>
        <select v-model="filters.result"><option value="">全部结果</option><option value="success">成功</option><option value="failure">失败</option></select>
        <button @click="loadAudit(1)">查询</button>
      </section>
      <p v-if="error" class="error">{{ error }}</p>
      <section class="panel table-wrap">
        <p v-if="loading">正在加载…</p>
        <table v-else-if="tab === 'operations'" class="table">
          <thead><tr><th>时间</th><th>操作者</th><th>操作</th><th>目标</th><th>结果</th><th>IP</th><th>详情</th></tr></thead>
          <tbody><tr v-for="item in auditItems" :key="item.id"><td>{{ new Date(item.createdAt).toLocaleString() }}</td><td>{{ item.actorType === 'administrator' ? '管理员' : '教师' }} #{{ item.actorId || '未知' }}</td><td>{{ item.action }}</td><td>{{ item.targetType || '—' }} {{ item.targetId || '' }}</td><td><span :class="item.result">{{ item.result === 'success' ? '成功' : '失败' }}</span></td><td>{{ item.ipAddress || '—' }}</td><td class="meta">{{ metadata(item.metadata) }}</td></tr></tbody>
        </table>
        <table v-else class="table">
          <thead><tr><th>时间</th><th>功能</th><th>供应商/模型</th><th>状态</th><th>耗时</th><th>错误码</th></tr></thead>
          <tbody><tr v-for="item in aiItems" :key="item.id"><td>{{ new Date(item.createdAt).toLocaleString() }}</td><td>{{ item.feature }}</td><td>{{ item.provider || '—' }} / {{ item.model || '—' }}</td><td>{{ item.status }}</td><td>{{ item.latencyMs == null ? '—' : `${item.latencyMs} ms` }}</td><td>{{ item.errorCode || '—' }}</td></tr></tbody>
        </table>
      </section>
      <footer v-if="tab === 'operations'" class="pager"><span>共 {{ total }} 条</span><button :disabled="page <= 1" @click="loadAudit(page - 1)">上一页</button><span>第 {{ page }} 页</span><button :disabled="page * 30 >= total" @click="loadAudit(page + 1)">下一页</button></footer>
    </main>
  </ManagementLayout>
</template>

<style scoped>
.audit-page{max-width:1280px;margin:auto}.audit-page h1{margin:0 0 8px;font-size:38px}.audit-page header p{margin:0;color:#987c6d}.tabs{display:flex;gap:8px;margin-top:22px}.tabs button,.filters button,.pager button{border:0;border-radius:11px;padding:10px 15px;background:#fff0e5;color:#9b654e}.tabs button.active,.filters button{background:#e99068;color:white}.filters{display:flex;gap:10px;margin-top:14px;flex-wrap:wrap}.filters input,.filters select{min-height:40px;border:1px solid #ead7c8;border-radius:10px;padding:0 11px;background:#fff}.panel{margin-top:16px;padding:18px;border:1px solid #f0ddce;border-radius:18px;background:#fffdf9}.table-wrap{overflow:auto}.table{width:100%;min-width:1000px;border-collapse:collapse}.table th,.table td{padding:12px 9px;border-bottom:1px solid #f2e4da;text-align:left;font-size:13px}.success{color:#2e825a}.failure,.error{color:#b4443d}.meta{max-width:280px;white-space:normal;overflow-wrap:anywhere}.pager{display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:14px}.pager button:disabled{opacity:.45}@media(max-width:720px){.audit-page h1{font-size:30px}}
</style>
