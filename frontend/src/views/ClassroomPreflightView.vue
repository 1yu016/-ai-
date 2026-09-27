<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElButton, ElMessage } from 'element-plus'
import { storeToRefs } from 'pinia'
import { useLessonRunStore } from '@/stores/lessonRun'

type CheckStatus = 'checking' | 'ok' | 'degraded' | 'failed'
type CheckItem = { key: string; label: string; detail: string; status: CheckStatus }

const route = useRoute()
const router = useRouter()
const store = useLessonRunStore()
const { run, loading, error } = storeToRefs(store)
const checking = ref(false)
const checks = ref<CheckItem[]>([])
const hasFailed = computed(() => checks.value.some((item) => item.status === 'failed'))
const statusText: Record<CheckStatus, string> = { checking: '检查中', ok: '正常', degraded: '可降级', failed: '异常' }

function buildChecks(): CheckItem[] {
  const online = typeof navigator === 'undefined' || navigator.onLine !== false
  const hasSteps = Boolean(run.value?.steps.length)
  return [
    { key: 'screen', label: '大屏显示', detail: '当前浏览器可以显示课堂页面', status: 'ok' },
    { key: 'network', label: '网络连接', detail: online ? '浏览器网络状态正常' : '当前处于离线状态，课堂请求可能失败', status: online ? 'ok' : 'failed' },
    { key: 'lesson', label: '课堂教案', detail: hasSteps ? `已加载 ${run.value?.steps.length ?? 0} 个课堂环节` : '教案没有可运行的课堂步骤', status: hasSteps ? 'ok' : 'failed' },
    { key: 'resource', label: '课程资源', detail: '资源将在对应环节按需加载，单个资源失败不会中断课堂', status: 'ok' },
    { key: 'microphone', label: '麦克风', detail: '麦克风由课堂互动按需请求权限', status: 'degraded' },
    { key: 'ai', label: 'AI 助教', detail: 'AI 服务异常时仍可按教案完成课堂', status: 'degraded' },
    { key: 'avatar', label: '数字人', detail: '当前使用课堂占位形象，数字人不可用时不影响课堂控制', status: 'degraded' },
  ]
}

async function runChecks(): Promise<void> {
  checking.value = true
  checks.value = buildChecks().map((item) => ({ ...item, status: 'checking' }))
  await new Promise((resolve) => window.setTimeout(resolve, 180))
  checks.value = buildChecks()
  checking.value = false
}

async function enterClassroom(): Promise<void> {
  if (hasFailed.value || !run.value) return
  await router.push({ name: 'lesson-classroom', params: { runId: run.value.id } })
}

onMounted(async () => {
  try {
    await store.load(Number(route.params.runId))
    await runChecks()
  } catch {
    ElMessage.error(error.value || '课堂加载失败，请返回教案列表重试')
  }
})
</script>

<template>
  <main class="preflight">
    <header class="topbar">
      <div>
        <button class="back" @click="router.push('/lesson-plans')">← 返回教案列表</button>
        <p class="eyebrow">上课前检查</p>
        <h1>{{ run?.lessonTitle || '课堂准备' }}</h1>
        <p class="muted">确认课堂环境后再开始，AI 和数字人异常时仍可使用教案完成教学。</p>
      </div>
      <ElButton :loading="checking || loading" @click="runChecks">重新检查</ElButton>
    </header>
    <div v-if="error && !run" class="error panel">{{ error }}<ElButton @click="router.push('/lesson-plans')">返回教案列表</ElButton></div>
    <template v-else>
      <section class="summary panel">
        <div><span>课堂环节</span><strong>{{ run?.steps.length ?? 0 }}</strong></div>
        <div><span>预计时长</span><strong>{{ Math.ceil((run?.steps.reduce((sum, step) => sum + step.durationSeconds, 0) ?? 0) / 60) }} 分钟</strong></div>
        <div><span>当前状态</span><strong>{{ run?.status === 'paused' ? '已暂停' : '待开始' }}</strong></div>
      </section>
      <section class="checks panel">
        <div v-for="item in checks" :key="item.key" class="check" :class="`check-${item.status}`">
          <span class="icon">{{ item.status === 'ok' ? '✓' : item.status === 'degraded' ? '!' : item.status === 'failed' ? '×' : '…' }}</span>
          <div><strong>{{ item.label }}</strong><p>{{ item.detail }}</p></div>
          <span class="status">{{ statusText[item.status] }}</span>
        </div>
      </section>
      <div class="actions"><p v-if="hasFailed" class="warning">请先处理异常项目后再进入课堂。</p><ElButton size="large" type="primary" :disabled="hasFailed || !run || checking" :loading="checking" @click="enterClassroom">进入课堂</ElButton></div>
    </template>
  </main>
</template>

<style scoped>
.preflight{min-height:100vh;box-sizing:border-box;padding:36px max(20px,6vw) 70px;background:linear-gradient(145deg,#fffaf1,#eef8f5);color:#493d36}.topbar{max-width:1000px;margin:auto;display:flex;justify-content:space-between;align-items:flex-end;gap:20px}.back{border:0;background:none;padding:0;color:#a56148;cursor:pointer;font-weight:700}.eyebrow{margin:22px 0 5px;color:#da805f;font-weight:800}.topbar h1{margin:0;font-size:clamp(28px,5vw,48px)}.muted{color:#88766b;line-height:1.6}.panel{max-width:1000px;margin:22px auto 0;padding:24px;border:1px solid #eadfd4;border-radius:22px;background:#fffffff0;box-shadow:0 12px 35px #6f5a3512}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:15px}.summary div{display:grid;gap:6px;padding:14px 16px;border-radius:14px;background:#fff7ea}.summary span{color:#997c6d;font-size:14px}.summary strong{font-size:22px}.checks{display:grid;gap:10px}.check{display:grid;grid-template-columns:38px 1fr auto;align-items:center;gap:13px;padding:14px;border-radius:14px;background:#f7faf7}.check strong{font-size:17px}.check p{margin:4px 0 0;color:#88766b;font-size:14px}.icon{display:grid;width:32px;height:32px;place-items:center;border-radius:50%;background:#d8f1e2;color:#287b55;font-weight:800}.check-degraded{background:#fffaf0}.check-degraded .icon{background:#ffe4a8;color:#976713}.check-failed{background:#fff2f0}.check-failed .icon{background:#ffd0c8;color:#a53d32}.status{font-size:14px;font-weight:700;color:#4a896a}.check-degraded .status{color:#a47720}.check-failed .status{color:#af4439}.actions{max-width:1000px;margin:24px auto;display:flex;justify-content:flex-end;align-items:center;gap:15px}.warning{margin:0;color:#ad4b3d}.error{display:flex;justify-content:center;align-items:center;gap:15px;color:#a53d32}@media(max-width:700px){.topbar{align-items:flex-start;flex-direction:column}.summary{grid-template-columns:1fr}.check{grid-template-columns:34px 1fr}.status{grid-column:2}.actions{align-items:stretch;flex-direction:column}.actions :deep(.el-button){width:100%}}
</style>
