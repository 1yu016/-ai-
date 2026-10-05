<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { ElDialog, ElMessage } from 'element-plus'
import { http, apiErrorMessage } from '@/api/http'
import { platformApi, type Student } from '@/api/platform'
import { useLessonRunStore, type ClassroomRunPayload } from '@/stores/lessonRun'
import {
  postReward,
  restoreCheckpoint,
  saveCheckpoint,
  type ActiveRun,
  type Attendance,
} from '@/services/classroomCheckpoint'
import AttendancePanel from '@/components/classroom/operations/AttendancePanel.vue'
import RewardPanel from '@/components/classroom/operations/RewardPanel.vue'
import BreakModePanel from '@/components/classroom/operations/BreakModePanel.vue'
import RemoteControlPanel from '@/components/classroom/operations/RemoteControlPanel.vue'
import QuestionRecordPanel from '@/components/classroom/operations/QuestionRecordPanel.vue'
import ArtworkReviewPanel from '@/components/classroom/operations/ArtworkReviewPanel.vue'

type Tab = 'engagement' | 'insights' | 'remote'

const route = useRoute()
const router = useRouter()
const tab = computed<Tab>(() =>
  route.name === 'classroom-insights'
    ? 'insights'
    : route.name === 'classroom-remote'
      ? 'remote'
      : 'engagement',
)

const students = ref<Student[]>([])
const selectedClassId = ref<number | null>(null)
const loading = ref(false)
const error = ref('')
const classOptions = ref<{ id: number; name: string }[]>([])
const attendance = ref<Record<number, Attendance>>({})
const selectedStudent = ref<number | null>(null)
const awards = ref<Record<number, number>>({})
const rollMessage = ref('')
// Stage 7.4：课堂/课间权威状态来自 lessonRun store（breakStartedAt/breakEndsAt + serverNow 时钟校准）。
// run 直接复用 store 的 run，保证与 LessonClassroomView/大屏通过 polling 多端同步。
const store = useLessonRunStore()
const { run, busy, isBreakActive, breakRemainingSeconds } = storeToRefs(store)
const remoteFeedback = ref('')
const pendingCommands = ref<string[]>([])
const online = ref(navigator.onLine)
// Stage 7.3：发奖励走 POST rewards 原子接口；本地先弹快速原因选择，确认后再写后端。
const QUICK_REASONS = ['积极回答', '主动参与', '乐于分享', '帮助伙伴', '认真观察']
const rewardDialogOpen = ref(false)
const rewardTarget = ref<Student | null>(null)
const rewardReason = ref('')
const rewardSubmitting = ref(false)

const displayStudents = computed(() =>
  students.value.filter((s) => s.status !== 'disabled'),
)
const presentCount = computed(
  () =>
    displayStudents.value.filter(
      (s) => attendance.value[s.id] === 'present',
    ).length,
)
const awardTotal = computed(() =>
  Object.values(awards.value).reduce((a, b) => a + b, 0),
)
const currentStep = computed(
  () =>
    run.value?.steps?.[run.value.currentStepIndex]?.title ||
    `第 ${(run.value?.currentStepIndex ?? 0) + 1} 环节`,
)
const tabItems: { key: Tab; label: string; icon: string; route: string }[] = [
  { key: 'engagement', label: '考勤与奖励', icon: '🌟', route: '/classroom/engagement' },
  { key: 'insights', label: '问题与作品', icon: '🗺️', route: '/classroom/insights' },
  { key: 'remote', label: '教师遥控', icon: '📱', route: '/classroom/remote' },
]

async function load() {
  loading.value = true
  error.value = ''
  try {
    const classes = await platformApi.classes()
    classOptions.value = classes.data.items
    selectedClassId.value ??= classOptions.value[0]?.id ?? null
    if (selectedClassId.value) {
      const result = await platformApi.students(selectedClassId.value)
      students.value = result.data.items
    }
    const active = await http.get<ClassroomRunPayload | ClassroomRunPayload[]>('/classroom-runs/active')
    const current = Array.isArray(active.data) ? (active.data[0] ?? null) : active.data
    if (current) store.adoptRun(current)
    else store.clearRun()
    if (run.value) {
      const restored = await restoreCheckpoint(run.value)
      attendance.value = restored.attendance
      awards.value = restored.rewards
    }
  } catch (e) {
    error.value = apiErrorMessage(e, '互动数据加载失败，请稍后重试。')
  } finally {
    loading.value = false
  }
}

async function chooseClass() {
  if (!selectedClassId.value) return
  const result = await platformApi.students(selectedClassId.value)
  students.value = result.data.items
  attendance.value = {}
  awards.value = {}
  if (run.value) {
    const restored = await restoreCheckpoint(run.value)
    attendance.value = restored.attendance
    awards.value = restored.rewards
  }
}

function setAttendance(student: Student, value: Attendance) {
  attendance.value = { ...attendance.value, [student.id]: value }
  void saveCheckpoint('roll_call', run.value, attendance.value)
}

function randomRoll() {
  const pool = displayStudents.value.filter((s) => s.id !== selectedStudent.value)
  const target =
    pool[Math.floor(Math.random() * Math.max(pool.length, 1))] ??
    displayStudents.value[0]
  if (target) {
    selectedStudent.value = target.id
    rollMessage.value = `请 ${target.nickname || target.name} 小朋友回答问题！`
    setAttendance(target, 'present')
  }
}

function award(student: Student) {
  rewardTarget.value = student
  rewardReason.value = ''
  rewardDialogOpen.value = true
}

async function confirmReward() {
  const student = rewardTarget.value
  if (!student || !run.value) {
    rewardDialogOpen.value = false
    rewardTarget.value = null
    ElMessage.warning('当前没有进行中的课堂，暂不能发奖励。')
    return
  }
  rewardSubmitting.value = true
  try {
    const result = await postReward(run.value, student.id, 1, rewardReason.value)
    awards.value = { ...awards.value, [student.id]: result.studentTotal }
    selectedStudent.value = student.id
    rollMessage.value = `已奖励 ${student.nickname || student.name} 1 朵小红花！`
    rewardDialogOpen.value = false
    rewardTarget.value = null
  } catch (e) {
    // 后端失败：不更新 UI，避免乐观 +1 后回滚不一致。
    ElMessage.error(apiErrorMessage(e, '奖励未发送成功，请重试。'))
  } finally {
    rewardSubmitting.value = false
  }
}

// Stage 7.4：课间休息走真实 API。POST 成功（store 应用后端新 run）后才显示课间 UI。
async function startBreak(durationSeconds: number) {
  try {
    await store.startBreak(durationSeconds)
  } catch (e) {
    ElMessage.error(apiErrorMessage(e, '课间休息未开启，请重试。'))
  }
}

async function endBreak() {
  try {
    await store.endBreak()
  } catch (e) {
    ElMessage.error(apiErrorMessage(e, '提前结束课间失败，请重试。'))
  }
}

async function remote(action: 'pause' | 'resume' | 'next') {
  if (!run.value) {
    remoteFeedback.value = '当前没有进行中的课堂，请先从教案进入课堂。'
    return
  }
  try {
    const path =
      action === 'next'
        ? `/classroom-runs/${run.value.id}/steps/${run.value.currentStepIndex + 1}`
        : `/classroom-runs/${run.value.id}/${action}`
    const result = await http.post<ActiveRun>(path, {
      requestId: `ops-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      version: run.value.version,
      deviceId: run.value.deviceId,
    })
    store.adoptRun(result.data as unknown as ClassroomRunPayload)
    remoteFeedback.value =
      action === 'next'
        ? '已切换到下一环节。'
        : action === 'pause'
          ? '课堂已暂停。'
          : '课堂已恢复。'
  } catch (e) {
    remoteFeedback.value = apiErrorMessage(e, '指令未执行，请重试。')
  }
}

async function sendCommand(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return
  if (!online.value) {
    pendingCommands.value.push(trimmed)
    persistPendingCommands()
    remoteFeedback.value = '当前离线，指令已加入待重发队列，网络恢复后自动重试。'
    return
  }
  try {
    const result = await http.post<{ reply?: string }>('/ai/command', {
      text: trimmed,
      context: { currentPage: 'chat', playerStatus: 'idle' },
    })
    remoteFeedback.value = result.data.reply || '已识别课堂指令，请确认后执行。'
  } catch (e) {
    remoteFeedback.value = apiErrorMessage(e, '语音指令服务暂时不可用。')
  }
}

function persistPendingCommands() {
  localStorage.setItem('classroom-command-queue', JSON.stringify(pendingCommands.value))
}

// 网络恢复后自动重发待队列指令；每条失败都再次保留，供下次重试。
async function replayPendingCommands() {
  if (!online.value || !pendingCommands.value.length) return
  const pending = pendingCommands.value
  pendingCommands.value = []
  persistPendingCommands()
  for (const text of pending) {
    // 逐条尝试，避免一条异常打断后续指令。
    remoteFeedback.value = `正在重发离线指令：${text}`
    try {
      await http.post<{ reply?: string }>('/ai/command', {
        text,
        context: { currentPage: 'chat', playerStatus: 'idle' },
      })
    } catch {
      pendingCommands.value.push(text)
    }
  }
  persistPendingCommands()
  remoteFeedback.value = pendingCommands.value.length
    ? `仍有 ${pendingCommands.value.length} 条指令待重发。`
    : '离线指令已全部重发完成。'
}

function go(item: (typeof tabItems)[number]) {
  void router.push(item.route)
}

function onlineChanged() {
  online.value = navigator.onLine
  if (online.value) void replayPendingCommands()
}

onMounted(() => {
  pendingCommands.value = JSON.parse(localStorage.getItem('classroom-command-queue') || '[]')
  window.addEventListener('online', onlineChanged)
  window.addEventListener('offline', onlineChanged)
  void load().finally(() => store.startPolling())
})

onBeforeUnmount(() => {
  store.stopPolling()
  window.removeEventListener('online', onlineChanged)
  window.removeEventListener('offline', onlineChanged)
})
</script>

<template>
  <main class="ops-shell">
    <header class="ops-header">
      <div>
        <p class="eyebrow">课堂运营中心</p>
        <h1>互动、记录与遥控</h1>
        <p class="muted">
          把课堂中的考勤、奖励、问题和设备控制集中在一个清晰的工作区。
        </p>
      </div>
      <div class="header-actions">
        <span class="connection" :class="{ offline: !online }">
          ● {{ online ? '在线' : '离线' }}
        </span>
        <button class="ghost" @click="router.push('/chat')">返回助教</button>
      </div>
    </header>
    <nav class="tabs" aria-label="课堂运营功能">
      <button
        v-for="item in tabItems"
        :key="item.key"
        :class="{ active: tab === item.key }"
        @click="go(item)"
      >
        <span>{{ item.icon }}</span>{{ item.label }}
      </button>
    </nav>
    <p v-if="error" class="alert">
      {{ error }}
      <button @click="load">重试</button>
    </p>

    <template v-if="tab === 'engagement'">
      <section class="toolbar panel">
        <label>
          当前班级
          <select v-model.number="selectedClassId" @change="chooseClass">
            <option v-for="item in classOptions" :key="item.id" :value="item.id">
              {{ item.name }}
            </option>
          </select>
        </label>
        <div class="stats">
          <span>已到 {{ presentCount }}/{{ displayStudents.length }}</span>
          <span>小红花 {{ awardTotal }}</span>
          <span>课堂 {{ run ? '进行中' : '未开始' }}</span>
        </div>
      </section>
      <div class="engagement-grid">
        <AttendancePanel
          :students="displayStudents"
          :attendance="attendance"
          :selected-student="selectedStudent"
          :roll-message="rollMessage"
          @set-attendance="setAttendance"
          @random-roll="randomRoll"
          @award="award"
        />
        <aside class="side-stack">
          <RewardPanel :award-total="awardTotal" />
          <BreakModePanel
            :active="isBreakActive"
            :remaining-seconds="breakRemainingSeconds"
            :busy="busy"
            :can-start="!!run && run.status === 'running'"
            @start-break="startBreak"
            @end-break="endBreak"
          />
        </aside>
      </div>
    </template>

    <template v-else-if="tab === 'insights'">
      <div class="insights-grid">
        <QuestionRecordPanel
          v-if="run"
          :run-id="run.id"
          :lesson-step-index="run.currentStepIndex"
          :students="students"
        />
        <section v-else class="panel">
          <h2>幼儿问题记录</h2>
          <p class="muted">请先从教案点击"进入课堂"开始上课，再记录本节问题。</p>
        </section>
        <ArtworkReviewPanel
          v-if="run"
          :run-id="run.id"
          :lesson-step-index="run.currentStepIndex"
          :students="students"
        />
      </div>
    </template>

    <template v-else>
      <RemoteControlPanel
        :run="run"
        :current-step="currentStep"
        :online="online"
        :pending-command-count="pendingCommands.length"
        :remote-feedback="remoteFeedback"
        @remote="remote"
        @send-command="sendCommand"
      />
    </template>

    <ElDialog
      v-model="rewardDialogOpen"
      :title="rewardTarget ? `奖励 ${rewardTarget.nickname || rewardTarget.name} 🌟` : '奖励'"
      width="360px"
      append-to-body
    >
      <p class="muted">快速原因（可跳过）</p>
      <div class="reason-chips">
        <button
          v-for="reason in QUICK_REASONS"
          :key="reason"
          :class="{ active: rewardReason === reason }"
          @click="rewardReason = reason"
        >
          {{ reason }}
        </button>
      </div>
      <label class="reason-custom">
        其它
        <input
          v-model="rewardReason"
          maxlength="200"
          placeholder="选一个，或直接输入原因…"
        >
      </label>
      <template #footer>
        <button class="ghost" :disabled="rewardSubmitting" @click="rewardDialogOpen = false">
          取消
        </button>
        <button class="button" :disabled="rewardSubmitting" @click="confirmReward">
          {{ rewardSubmitting ? '发送中…' : '+1 小红花' }}
        </button>
      </template>
    </ElDialog>
  </main>
</template>

<style scoped>
.ops-shell {
  min-height: 100dvh;
  padding: 36px max(20px, 6vw) 70px;
  background: linear-gradient(145deg, #fffaf1, #fff1e8);
  color: #60483e;
}
.ops-header {
  max-width: 1180px;
  margin: auto;
  display: flex;
  justify-content: space-between;
  gap: 24px;
  align-items: flex-end;
}
.eyebrow {
  margin: 0 0 6px;
  color: #d67b59;
  font-weight: 800;
  letter-spacing: 0.08em;
}
.ops-header h1 {
  margin: 0;
  font-size: clamp(30px, 4vw, 46px);
}
.muted {
  color: #9a7e6e;
  line-height: 1.6;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.connection {
  color: #4d9a69;
  font-size: 13px;
  font-weight: 700;
}
.connection.offline {
  color: #b77d20;
}
.tabs {
  max-width: 1180px;
  margin: 28px auto 18px;
  display: flex;
  gap: 10px;
  overflow: auto;
}
.tabs button {
  border: 1px solid #efd9c8;
  background: #fffdf9;
  color: #876b5d;
  padding: 13px 18px;
  border-radius: 14px;
  cursor: pointer;
  white-space: nowrap;
}
.tabs button.active {
  background: #ffe6d6;
  border-color: #e99168;
  color: #b9684d;
  font-weight: 800;
}
.tabs span {
  margin-right: 7px;
}
.panel {
  border: 1px solid #f0ddce;
  border-radius: 18px;
  background: #fffdf9;
  padding: 20px;
  box-shadow: 0 10px 28px #b9795114;
}
.toolbar {
  max-width: 1180px;
  margin: 0 auto 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}
.toolbar label {
  display: grid;
  gap: 6px;
  font-weight: 700;
}
.toolbar select,
.question-form select,
.question-form input {
  height: 40px;
  border: 1px solid #efd9c8;
  border-radius: 10px;
  padding: 0 11px;
  background: #fff;
  color: #60483e;
}
.stats {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.stats span,
.pill {
  padding: 7px 11px;
  border-radius: 999px;
  background: #fff0e4;
  color: #a9654c;
  font-size: 13px;
}
.engagement-grid,
.insights-grid {
  max-width: 1180px;
  margin: auto;
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr);
  gap: 18px;
}
.section-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.section-head h2,
.panel h2 {
  margin: 0 0 6px;
}
.button,
.ghost {
  border: 0;
  border-radius: 11px;
  padding: 10px 16px;
  cursor: pointer;
}
.button {
  background: #e99168;
  color: #fff;
}
.button:hover {
  background: #d67b59;
}
.side-stack {
  display: grid;
  gap: 18px;
  align-content: start;
}
.insights-grid {
  grid-template-columns: minmax(0, 1.5fr) minmax(300px, 1fr);
}
.question-form {
  display: grid;
  grid-template-columns: 1fr 130px auto;
  gap: 8px;
  margin: 18px 0;
}
.question-list {
  display: grid;
  gap: 8px;
}
.question-list article {
  display: flex;
  gap: 10px;
  padding: 12px;
  border-bottom: 1px solid #f4e6dc;
}
.question-list small {
  display: block;
  color: #a38270;
  margin-top: 3px;
}
.topic {
  align-self: start;
  padding: 4px 8px;
  border-radius: 8px;
  background: #edf7f0;
  color: #4d9a69;
  font-size: 12px;
  white-space: nowrap;
}
.empty {
  padding: 28px;
  text-align: center;
  color: #a38270;
}
.upload-box {
  display: grid;
  place-items: center;
  gap: 6px;
  margin: 18px 0;
  padding: 30px;
  border: 1px dashed #e9b995;
  border-radius: 14px;
  background: #fff8f0;
  cursor: pointer;
  text-align: center;
}
.upload-box span {
  font-size: 34px;
}
.upload-box small {
  color: #a38270;
}
.upload-box input {
  display: none;
}
.draft {
  display: grid;
  gap: 10px;
  margin-top: 16px;
  padding: 14px;
  border-radius: 12px;
  background: #fff4e9;
}
.draft textarea {
  width: 100%;
  border: 1px solid #efd9c8;
  border-radius: 10px;
  padding: 10px;
  resize: vertical;
  color: #60483e;
}
.draft div {
  display: flex;
  gap: 8px;
}
.blocked-notice {
  padding: 14px 16px;
  border: 1px dashed #d9a77e;
  border-radius: 12px;
  background: #fff6ec;
  color: #876b5d;
  margin-top: 12px;
}
.tag {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 999px;
  background: #f5d9bf;
  color: #a9654c;
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 6px;
}
.feedback,
.alert {
  padding: 11px 13px;
  border-radius: 10px;
  background: #fff3dc;
  color: #926d22;
}
.reason-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 4px 0 14px;
}
.reason-chips button {
  border: 1px solid #efd9c8;
  background: #fffdf9;
  color: #876b5d;
  border-radius: 999px;
  padding: 7px 13px;
  cursor: pointer;
}
.reason-chips button.active {
  background: #ffe6d6;
  border-color: #e99168;
  color: #b9684d;
  font-weight: 800;
}
.reason-custom {
  display: grid;
  gap: 6px;
  color: #876b5d;
  font-size: 13px;
  font-weight: 700;
}
.reason-custom input {
  height: 40px;
  border: 1px solid #efd9c8;
  border-radius: 10px;
  padding: 0 11px;
  background: #fff;
  color: #60483e;
}
.alert {
  max-width: 1180px;
  margin: 0 auto 14px;
}
@media (max-width: 800px) {
  .ops-header,
  .toolbar {
    align-items: flex-start;
    flex-direction: column;
  }
  .engagement-grid,
  .insights-grid {
    grid-template-columns: 1fr;
  }
  .question-form {
    grid-template-columns: 1fr;
  }
}
</style>
