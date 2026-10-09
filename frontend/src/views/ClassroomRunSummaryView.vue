<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { http, apiErrorMessage } from '@/api/http'
import type { ClassroomRunPayload } from '@/stores/lessonRun'
import { listRunRewards, formatRewardTime, type RewardRecord } from '@/services/classroomCheckpoint'
import { summarizeRunRewards } from '@/services/rewardSummary'
import { buildRunRewardLeaderboard } from '@/services/rewardLeaderboard'
import ClassRewardLeaderboard from '@/components/classroom/operations/ClassRewardLeaderboard.vue'
import { platformApi } from '@/api/platform'
import { useUserStore } from '@/stores/user'

// 课堂总结＝「课堂结束舞台」，脱离 ManagementLayout：不进教师管理侧边栏/后台顶栏。
// 只依赖 backend 权威数据（run + 本节 RewardRecord）；不读 localStorage/sessionStorage，刷新自动重拉。
const route = useRoute()
const router = useRouter()
const user = useUserStore()
const runId = Number(route.params.runId)

const run = ref<ClassroomRunPayload | null>(null)
const rewards = ref<RewardRecord[]>([])
const loading = ref(true)
const error = ref('')
// 班级名称：run 只带 classId，名称走轻量只读按 id 匹配；获取失败不阻塞总结页。
const className = ref('')

// 本节奖励是总结页唯一展示来源（严禁混用班级累计榜）。
const summary = computed(() => summarizeRunRewards(rewards.value))
const topItems = computed(() => buildRunRewardLeaderboard(rewards.value))
const withRewardCount = computed(() => summary.value.byStudent.length)
// 教师名称：登录教师即开课人；无登录态时为空，不出错。
const teacherName = computed(() => user.teacherInfo?.name ?? '')

function formatDuration(elapsedSeconds?: number): string {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds == null) return '—'
  const total = Math.max(0, Math.floor(elapsedSeconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}小时${pad(m)}分` : `${pad(m)}分${pad(s)}秒`
}

// 优先用 endedAt - startedAt 精确时长，缺失则回退到 elapsedSeconds。
const duration = computed(() => {
  if (run.value?.endedAt && run.value?.startedAt) {
    const ms = new Date(run.value.endedAt).getTime() - new Date(run.value.startedAt).getTime()
    if (Number.isFinite(ms) && ms >= 0) return formatDuration(ms / 1000)
  }
  return formatDuration(run.value?.elapsedSeconds)
})

async function resolveClassName() {
  const classId = run.value?.classId
  if (classId == null) return
  try {
    const page = await platformApi.listClasses()
    const items = Array.isArray(page.data.items) ? page.data.items : []
    const found = items.find((c) => c.id === classId)
    if (found?.name) className.value = found.name
  } catch {
    // 班级名获取失败不影响总结页展示与离开流程。
  }
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [runRes, rewardRes] = await Promise.all([
      http.get<ClassroomRunPayload>(`/classroom-runs/${runId}`),
      listRunRewards(runId),
    ])
    run.value = runRes.data
    rewards.value = rewardRes.items
    void resolveClassName()
  } catch (e) {
    error.value = apiErrorMessage(e, '课堂总结加载失败，请稍后重试。')
  } finally {
    loading.value = false
  }
}

onMounted(load)

// 离开出口：只有点击「结束并返回班级」才回到当前班级工作区；查看成长榜为独立入口。
function leaveToClassManagement() {
  const classId = run.value?.classId
  if (classId != null) {
    void router.push(`/classes/${classId}/students`)
  } else {
    void router.push('/my-classes')
  }
}
</script>

<template>
  <div class="summary" data-test="summary-view">
    <div class="stage-glow" aria-hidden="true"></div>
    <div class="container">
      <header class="head">
        <span class="badge">🎉 课堂结束</span>
        <span v-if="className || teacherName" class="head-meta">
          {{ className }}<template v-if="teacherName"> · {{ teacherName }}</template>
        </span>
      </header>

      <p v-if="loading" class="state">课堂总结加载中…</p>
      <p v-else-if="error" class="state bad">
        {{ error }}
        <button class="retry" type="button" @click="load">重试</button>
      </p>

      <template v-else>
        <section class="hero">
          <h1 class="hero-title">🎉 本节课完成啦</h1>
          <h2 class="hero-lesson">{{ run?.title || '本节课堂' }}</h2>
          <p v-if="className || teacherName" class="hero-meta">
            {{ className }}<template v-if="teacherName"> · {{ teacherName }}</template>
          </p>
          <!-- 数字人收尾：纯文案轻量形象，绝不影响总结展示与离开 -->
          <div class="closing" aria-label="数字人收尾">
            <span class="closing-face">🌼</span>
            <p>今天大家表现得很棒，我们下次见！</p>
          </div>
        </section>

        <section class="stats" data-test="summary-stats">
          <div class="stat">
            <span class="label">本节奖励</span>
            <strong class="value stars">🌟 {{ summary.totalStars }}</strong>
          </div>
          <div class="stat">
            <span class="label">课堂时长</span>
            <strong class="value">{{ duration }}</strong>
          </div>
          <div class="stat">
            <span class="label">奖励次数</span>
            <strong class="value">{{ summary.rewardCount }}</strong>
          </div>
        </section>

        <section class="panel" data-test="summary-top">
          <ClassRewardLeaderboard
            :items="topItems"
            :loading="false"
            :error="''"
            title="本节课奖励榜"
            empty-text="本节课暂无奖励记录"
            :collapsible="false"
          />
          <p v-if="withRewardCount > topItems.length" class="muted more">
            仅展示前 {{ topItems.length }} 名，共 {{ withRewardCount }} 位幼儿获得奖励。
          </p>
        </section>

        <section class="panel" data-test="summary-detail">
          <div class="block-head">
            <h2>🧾 奖励明细</h2>
          </div>
          <p v-if="!rewards.length" class="state muted">本节课暂无奖励记录</p>
          <ul v-else class="reward-list">
            <li v-for="record in rewards" :key="record.id" class="reward-item">
              <div class="reward-body">
                <span class="reward-student">👧 {{ record.studentName || `幼儿 ${record.studentId}` }}</span>
                <span class="reward-stars">🌟 +{{ record.stars }}</span>
              </div>
              <span class="reward-meta">{{ formatRewardTime(record.createdAt) }}</span>
              <p class="reward-reason">{{ record.reason || '（未填原因）' }}</p>
            </li>
          </ul>
        </section>

        <footer class="foot">
          <button class="retry" type="button" @click="router.push({ name: 'classroom-record', params: { runId } })">
            查看课堂记录与 AI 总结
          </button>
          <button
            class="ghost"
            :disabled="run?.classId == null"
            @click="router.push(`/classes/${run!.classId}/rewards`)"
          >
            👀 查看班级成长榜
          </button>
          <button class="primary" data-test="leave-class" @click="leaveToClassManagement">
            结束并返回{{ className ? ' ' + className : '班级' }}
          </button>
        </footer>
      </template>
    </div>
  </div>
</template>

<style scoped>
.summary {
  width: 100%;
  min-height: 100vh;
  position: relative;
  overflow-x: hidden;
  background:
    radial-gradient(120% 90% at 78% 12%, rgba(255, 246, 226, 0.8), transparent 60%),
    linear-gradient(165deg, #fffaf3 0%, #fff7ec 100%);
  color: #4f3d31;
}
.stage-glow {
  position: fixed; inset: 0; pointer-events: none;
  background: radial-gradient(50% 42% at 50% 16%, rgba(224, 170, 108, 0.16), transparent 70%);
}
.container {
  position: relative;
  max-width: 960px;
  margin: 0 auto;
  padding: 34px 32px 56px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.head {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 13px;
}
.badge { font-weight: 800; color: #c07a3e; letter-spacing: 0.1em; }
.head-meta { color: #9b8779; font-weight: 600; }

.hero { text-align: center; margin-top: 10px; }
.hero-title { margin: 0; font-size: clamp(36px, 4.5vw, 50px); font-weight: 800; line-height: 1.15; color: #43352c; }
.hero-lesson { margin: 10px 0 0; font-size: clamp(22px, 2.6vw, 30px); font-weight: 700; color: #d9833f; }
.hero-meta { margin: 8px 0 0; color: #9b8779; font-weight: 600; font-size: 14px; }

.closing {
  display: inline-flex; align-items: center; gap: 10px;
  margin: 20px auto 0; padding: 12px 22px; border-radius: 999px;
  background: rgba(255, 253, 249, 0.92); border: 1px solid #f0ddce;
  box-shadow: 0 8px 22px rgba(79, 61, 49, 0.06);
}
.closing-face { font-size: 22px; animation: bob 2.6s ease-in-out infinite; }
.closing p { margin: 0; color: #7d6250; font-size: 16px; font-weight: 600; }
@keyframes bob { 50% { transform: translateY(-4px); } }

.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.stat {
  display: flex; flex-direction: column; gap: 6px; padding: 18px;
  border: 1px solid #f0ddce; border-radius: 18px; background: rgba(255, 253, 249, 0.9);
  text-align: center;
}
.stat .label { color: #9a7e6e; font-size: 12px; }
.stat .value { color: #60483e; font-size: 22px; }
.stat .value.stars { color: #c07a3e; }

.panel {
  padding: 20px; border: 1px solid #f0ddce; border-radius: 20px;
  background: rgba(255, 253, 249, 0.9); box-shadow: 0 10px 28px rgba(185, 121, 81, 0.1);
}
.block-head h2 { margin: 0 0 12px; color: #60483e; font-size: 19px; }
.muted { color: #9a7e6e; }
.state { padding: 20px; text-align: center; color: #9a7e6e; }
.state.bad { color: #c64e4e; }
.retry { margin-left: 10px; border: 1px solid #efd9c8; background: #fff; color: #876b5d; border-radius: 10px; padding: 4px 12px; cursor: pointer; }

.reward-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.reward-item {
  display: grid; grid-template-columns: 1fr auto; gap: 6px 16px;
  padding: 12px 16px; border: 1px solid #f0ddce; border-radius: 14px; background: #fffdf9;
}
.reward-body { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.reward-student { color: #60483e; font-size: 16px; font-weight: 600; }
.reward-stars { color: #c07a3e; font-weight: 800; white-space: nowrap; }
.reward-meta { color: #9a7e6e; font-size: 12px; font-variant-numeric: tabular-nums; }
.reward-reason { grid-column: 1 / -1; margin: 0; color: #6b584c; }

.foot { display: flex; justify-content: center; align-items: center; gap: 14px; margin-top: 6px; flex-wrap: wrap; }
.ghost, .primary { border: 0; border-radius: 16px; padding: 0 24px; height: 52px; font-size: 16px; font-weight: 700; cursor: pointer; }
.ghost { border: 1px solid #efd9c8; background: #fffdf9; color: #876b5d; }
.ghost:disabled { opacity: 0.55; cursor: not-allowed; }
.primary {
  background: linear-gradient(135deg, #f0a06a, #e07e4e); color: #fff;
  box-shadow: 0 12px 26px rgba(224, 126, 78, 0.26); transition: transform .18s ease, box-shadow .18s ease;
}
.primary:hover { transform: translateY(-2px); box-shadow: 0 16px 32px rgba(224, 126, 78, 0.32); }
.primary:active { transform: translateY(0); }

@media (max-width: 640px) {
  .container { padding: 24px 16px 40px; }
  .stats { grid-template-columns: 1fr; }
  .foot { flex-direction: column; width: 100%; }
  .foot .ghost, .foot .primary { width: 100%; }
}
</style>
