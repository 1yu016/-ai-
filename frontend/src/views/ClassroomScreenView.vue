<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import ResourcePlayer from '@/components/ResourcePlayer.vue'
import { apiErrorMessage, http } from '@/api/http'
import { platformApi, type Device } from '@/api/platform'
import { useCourseResourceStore } from '@/stores/courseResource'
import {
  useLessonRunStore,
  type ClassroomScreenPage,
  type ClassroomScreenState,
  type PlayerSnapshotState,
} from '@/stores/lessonRun'
import { useResourcePlayerStore } from '@/stores/resourcePlayer'
import { useUserStore } from '@/stores/user'
import { connectScreenRealtime } from '@/services/classroomRealtime'

const route = useRoute()
const router = useRouter()
const runStore = useLessonRunStore()
const resourceStore = useCourseResourceStore()
const playerStore = useResourcePlayerStore()
const userStore = useUserStore()
const { run, currentStep, currentResource, breakRemainingSeconds, busy } = storeToRefs(runStore)
const {
  currentResource: playingResource,
  playerStatus,
  currentTime,
  duration,
  volume,
  muted,
  pageIndex,
  pageCount,
  zoom,
} = storeToRefs(playerStore)

const page = ref<ClassroomScreenPage>('idle')
const screenState = ref<ClassroomScreenState | null>(null)
const devices = ref<Device[]>([])
const loading = ref(true)
const loadError = ref('')
let pollTimer: number | null = null
let realtimeAbort: AbortController | null = null
let pollInFlight = false
let snapshotTimer: number | null = null
let restoringPlayer = false
let hydratedRunId: number | null = null
let hydratedSnapshotVersion: number | null = null
const rewardPresentation = ref<import('@/stores/lessonRun').RewardPresentation | null>(null)
let rewardTimer: number | null = null
let lastRewardRecordId: number | null = null
const artworkPresentation = ref<{ id: number; imageUrl: string; comment: string } | null>(null)
let artworkObjectUrl: string | null = null
let lastSpokenSnapshot = ''

const deviceId = computed(() => {
  const value = Number(route.params.deviceId)
  return Number.isInteger(value) && value > 0 ? value : null
})
const pageMeta: Record<ClassroomScreenPage, { icon: string; eyebrow: string; title: string }> = {
  idle: { icon: '🌼', eyebrow: '课堂大屏', title: '等待老师开始课堂' },
  classroom: { icon: '🧑‍🏫', eyebrow: '正在上课', title: '课堂进行中' },
  drawing: { icon: '🎨', eyebrow: '创意表达', title: '绘画评价' },
  reward: { icon: '⭐', eyebrow: '成长时刻', title: '奖励展示' },
  break: { icon: '🌿', eyebrow: '轻松一下', title: '课间休息' },
  protection: { icon: '🌙', eyebrow: '大屏保护', title: '安静休息一会儿' },
  summary: { icon: '🎉', eyebrow: '课堂完成', title: '今天的课堂真精彩' },
  recovery: { icon: '🛟', eyebrow: '安全恢复', title: '课堂状态需要恢复' },
}
const activeMeta = computed(() => pageMeta[page.value])
const formattedBreakTime = computed(() => {
  const minutes = Math.floor(breakRemainingSeconds.value / 60)
  const seconds = String(breakRemainingSeconds.value % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
})
const summaryDuration = computed(() => {
  const seconds = run.value?.elapsedSeconds ?? 0
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
})
const rollCallDisplayName = computed(() => run.value?.rollCallState?.lastStudentDisplayName || '')

async function loadDevices() {
  try {
    const response = await platformApi.listDevices()
    devices.value = response.data.filter((device) => device.status !== 'disabled')
  } catch (error) {
    loadError.value = apiErrorMessage(error, '可用大屏加载失败，请稍后重试。')
  }
}

async function hydratePlayer(state: ClassroomScreenState) {
  const classroom = state.classroomState
  if (
    !classroom ||
    (hydratedRunId === classroom.id &&
      hydratedSnapshotVersion === (classroom.latestSnapshotVersion ?? null))
  ) return
  hydratedRunId = classroom.id
  hydratedSnapshotVersion = classroom.latestSnapshotVersion ?? null
  const snapshot = classroom.playerRecoverySuggestion
  const resourceId = Number(snapshot?.resourceId)
  if (!Number.isInteger(resourceId) || resourceId <= 0) return
  restoringPlayer = true
  try {
    const resource = await resourceStore.ensureResourceById(resourceId)
    playerStore.openResource(resource, false)
    playerStore.restorePlayerState(snapshot ?? {})
  } catch (error) {
    playerStore.setStatus('error', apiErrorMessage(error, '课堂资源恢复失败，请稍后重试。'))
  } finally {
    restoringPlayer = false
  }
}

function clearArtworkPresentation() {
  if (artworkObjectUrl) URL.revokeObjectURL(artworkObjectUrl)
  artworkObjectUrl = null
  artworkPresentation.value = null
}

async function hydrateArtwork(state: ClassroomScreenState) {
  const snapshot = state.classroomState?.playerRecoverySuggestion
  const artworkId = Number(snapshot?.artworkId)
  const fileUrl = typeof snapshot?.artworkFileUrl === 'string' ? snapshot.artworkFileUrl : ''
  const comment = typeof snapshot?.artworkComment === 'string' ? snapshot.artworkComment : ''
  if (!Number.isInteger(artworkId) || artworkId <= 0 || !fileUrl || !comment) {
    clearArtworkPresentation()
    return
  }
  if (artworkPresentation.value?.id !== artworkId) {
    const { data } = await http.get<Blob>(fileUrl, { responseType: 'blob' })
    clearArtworkPresentation()
    artworkObjectUrl = URL.createObjectURL(data)
    artworkPresentation.value = { id: artworkId, imageUrl: artworkObjectUrl, comment }
  }
  const speechKey = `${snapshot?.updatedAt || ''}:${snapshot?.ttsText || ''}`
  if (snapshot?.ttsText && speechKey !== lastSpokenSnapshot && 'speechSynthesis' in window) {
    lastSpokenSnapshot = speechKey
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(snapshot.ttsText))
  }
}

async function refreshScreen(options: { initial?: boolean } = {}) {
  if (!deviceId.value || pollInFlight || busy.value) return
  pollInFlight = true
  if (options.initial) loading.value = true
  try {
    const state = await runStore.loadScreenState(deviceId.value)
    await applyScreenState(state)
  } catch (error) {
    page.value = 'recovery'
    loadError.value = apiErrorMessage(error, '无法读取课堂状态，请检查设备绑定或网络。')
  } finally {
    loading.value = false
    pollInFlight = false
  }
}

async function applyScreenState(state: ClassroomScreenState) {
    screenState.value = state
    loadError.value = ''
    if (page.value !== state.page && ['idle', 'break', 'protection', 'summary', 'recovery'].includes(state.page)) {
      playerStore.requestControl('stop')
    }
    page.value = state.page
    const presentation = state.classroomState?.interactionState?.rewardPresentation
    if (presentation && presentation.recordId !== lastRewardRecordId) {
      lastRewardRecordId = presentation.recordId
      rewardPresentation.value = presentation
      if (rewardTimer !== null) window.clearTimeout(rewardTimer)
      rewardTimer = window.setTimeout(() => { rewardPresentation.value = null; rewardTimer = null }, 4200)
      if (presentation.praiseText && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel()
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(presentation.praiseText))
      }
    }
    await hydratePlayer(state)
    await hydrateArtwork(state)
    loading.value = false
}

function startRealtime() {
  realtimeAbort?.abort()
  if (!deviceId.value || !userStore.accessToken) return
  realtimeAbort = connectScreenRealtime<ClassroomScreenState>({
    deviceId: deviceId.value,
    accessToken: userStore.accessToken,
    onState: applyScreenState,
    onDisconnect: (message) => { loadError.value = message },
  })
}

function chooseDevice(id: number) {
  void router.replace({ name: 'classroom-screen', params: { deviceId: id } })
}

async function openCurrentResource() {
  if (!currentResource.value) return
  await runStore.openResource('screen')
}

function queueSnapshot() {
  if (restoringPlayer || !run.value || busy.value) return
  if (snapshotTimer !== null) window.clearTimeout(snapshotTimer)
  if (rewardTimer !== null) window.clearTimeout(rewardTimer)
  if ('speechSynthesis' in window) window.speechSynthesis.cancel()
  snapshotTimer = window.setTimeout(async () => {
    snapshotTimer = null
    const resourceId = Number(playingResource.value?.id)
    const snapshot: PlayerSnapshotState = {
      ...(Number.isInteger(resourceId) && resourceId > 0 ? { resourceId } : {}),
      status: playerStatus.value,
      currentTime: currentTime.value,
      duration: duration.value,
      pageIndex: pageIndex.value,
      pageCount: pageCount.value,
      zoom: zoom.value,
      volume: volume.value,
      muted: muted.value,
      autoPlay: false,
      updatedAt: new Date().toISOString(),
    }
    try {
      await runStore.savePlayerState(snapshot)
    } catch (error) {
      console.warn('播放器快照保存失败，将刷新服务端课堂状态：', error)
      await refreshScreen()
    }
  }, 1800)
}

watch(
  [playingResource, playerStatus, currentTime, duration, pageIndex, pageCount, zoom, volume, muted],
  queueSnapshot,
)

watch(deviceId, async () => {
  realtimeAbort?.abort()
  hydratedRunId = null
  hydratedSnapshotVersion = null
  playerStore.close()
  if (deviceId.value) {
    await refreshScreen({ initial: true })
    startRealtime()
  }
  else {
    runStore.clearRun()
    page.value = 'idle'
    await loadDevices()
    loading.value = false
  }
})

onMounted(async () => {
  if (deviceId.value) {
    await refreshScreen({ initial: true })
    startRealtime()
  }
  else {
    await loadDevices()
    loading.value = false
  }
  pollTimer = window.setInterval(() => void refreshScreen(), 10_000)
})

onBeforeUnmount(() => {
  if (pollTimer !== null) window.clearInterval(pollTimer)
  realtimeAbort?.abort()
  if (snapshotTimer !== null) window.clearTimeout(snapshotTimer)
  playerStore.requestControl('stop')
  clearArtworkPresentation()
})
</script>

<template>
  <main class="classroom-screen" :class="`page-${page}`">
    <header class="screen-header">
      <div class="brand"><span>🌼</span><strong>幼儿园数字人课堂</strong></div>
      <div class="screen-status">
        <span class="status-dot"></span>
        {{ deviceId ? `大屏设备 #${deviceId}` : '请选择大屏设备' }}
      </div>
    </header>

    <section v-if="loading" class="state-card loading-card">
      <div class="loader"></div>
      <h1>正在同步课堂状态…</h1>
      <p>页面会以服务端记录为准自动恢复。</p>
    </section>

    <section v-else-if="!deviceId" class="state-card idle-card">
      <div class="state-icon">{{ activeMeta.icon }}</div>
      <span class="eyebrow">{{ activeMeta.eyebrow }}</span>
      <h1>{{ activeMeta.title }}</h1>
      <p>选择已绑定的大屏后，系统会自动显示当前课堂状态。</p>
      <div v-if="devices.length" class="device-grid">
        <button v-for="device in devices" :key="device.id" type="button" @click="chooseDevice(device.id)">
          <span>{{ device.online ? '🟢' : '⚪' }}</span>
          <strong>{{ device.name }}</strong>
          <small>{{ device.binding?.className || '未绑定班级' }}</small>
        </button>
      </div>
      <p v-else class="empty-hint">当前账号还没有可用的大屏设备。</p>
    </section>

    <section v-else-if="page === 'idle'" class="state-card idle-card">
      <div class="state-icon">{{ activeMeta.icon }}</div>
      <span class="eyebrow">{{ activeMeta.eyebrow }}</span>
      <h1>{{ activeMeta.title }}</h1>
      <p>老师开始上课后，这里会自动进入课堂画面。</p>
      <button class="soft-button" type="button" @click="refreshScreen({ initial: true })">刷新状态</button>
    </section>

    <section v-else-if="page === 'break'" class="state-card break-card">
      <div class="state-icon">{{ run?.breakContent?.icon || activeMeta.icon }}</div>
      <span class="eyebrow">{{ activeMeta.eyebrow }}</span>
      <h1>{{ run?.breakContent?.title || activeMeta.title }}</h1>
      <div class="countdown">{{ formattedBreakTime }}</div>
      <p>{{ run?.breakContent?.message || '喝口水、看看远处，让眼睛休息一下。' }}</p>
      <small class="companion-hint">数字人陪伴动作：{{ run?.breakContent?.avatarAction || 'idle' }}</small>
    </section>

    <section v-else-if="page === 'protection'" class="state-card protection-card">
      <div class="state-icon">{{ activeMeta.icon }}</div>
      <span class="eyebrow">{{ activeMeta.eyebrow }}</span>
      <h1>{{ activeMeta.title }}</h1>
      <div class="countdown">{{ formattedBreakTime }}</div>
      <p>大屏已进入低刺激保护状态，请听老师安排，慢慢走、不奔跑。</p>
    </section>

    <section v-else-if="page === 'summary'" class="state-card summary-card">
      <div class="state-icon">{{ activeMeta.icon }}</div>
      <span class="eyebrow">{{ activeMeta.eyebrow }}</span>
      <h1>{{ run?.lessonTitle || activeMeta.title }}</h1>
      <div class="summary-grid">
        <div><strong>{{ run?.steps.length || 0 }}</strong><span>课堂环节</span></div>
        <div><strong>{{ summaryDuration }}</strong><span>课堂用时</span></div>
        <div><strong>完成</strong><span>课堂状态</span></div>
      </div>
    </section>

    <section v-else-if="page === 'recovery'" class="state-card recovery-card">
      <div class="state-icon">{{ activeMeta.icon }}</div>
      <span class="eyebrow">{{ activeMeta.eyebrow }}</span>
      <h1>{{ activeMeta.title }}</h1>
      <p>{{ loadError || '系统检测到课堂快照需要教师确认，其他课堂功能仍可安全使用。' }}</p>
      <button class="primary-button" type="button" @click="refreshScreen({ initial: true })">重新读取课堂状态</button>
    </section>

    <section v-else class="lesson-stage">
      <div class="lesson-copy">
        <span class="eyebrow">{{ activeMeta.icon }} {{ activeMeta.eyebrow }}</span>
        <h1>{{ currentStep?.title || activeMeta.title }}</h1>
        <p>{{ currentStep?.content || '请跟随老师一起探索今天的课堂内容。' }}</p>
        <div v-if="run" class="progress-summary">
          <span>第 {{ run.currentStepIndex + 1 }} / {{ run.steps.length }} 环节</span>
          <div><i :style="{ width: `${Math.max(4, ((run.currentStepIndex + 1) / run.steps.length) * 100)}%` }"></i></div>
        </div>
        <button v-if="currentResource" class="primary-button" type="button" :disabled="busy" @click="openCurrentResource">
          打开课堂资源 · {{ currentResource.title }}
        </button>
      </div>
      <div class="stage-visual" :class="`visual-${page}`">
        <span>{{ page === 'drawing' ? '🖍️' : page === 'reward' ? '🏆' : '🌈' }}</span>
        <strong>{{ page === 'drawing' ? '大胆画出你的想法' : page === 'reward' ? '为小朋友鼓掌' : '一起观察、思考、发现' }}</strong>
      </div>
    </section>

    <div v-if="loadError && page !== 'recovery'" class="safe-error" role="alert">
      {{ loadError }}
    </div>

    <aside v-if="rollCallDisplayName && page === 'classroom'" class="roll-call-card" aria-live="polite">
      <span>🎤 请这位小朋友回答</span>
      <strong>{{ rollCallDisplayName }}</strong>
    </aside>

    <aside v-if="rewardPresentation" class="reward-celebration" aria-live="polite">
      <div class="reward-burst">✨</div>
      <span>一起为小朋友鼓掌</span>
      <strong>{{ rewardPresentation.displayName }}</strong>
      <p>+{{ rewardPresentation.points }} 成长能量<span v-if="rewardPresentation.stars"> · 🌸 {{ rewardPresentation.stars }}</span></p>
      <small>{{ rewardPresentation.praiseText || '你的努力被老师看见啦！' }}</small>
    </aside>

    <aside v-if="artworkPresentation" class="artwork-presentation" aria-live="polite">
      <img :src="artworkPresentation.imageUrl" alt="幼儿绘画作品">
      <div>
        <span>🎨 我们一起来看看这幅作品</span>
        <p>{{ artworkPresentation.comment }}</p>
      </div>
    </aside>

    <ResourcePlayer :resources="resourceStore.sortedResources" />
  </main>
</template>

<style scoped>
.classroom-screen { min-height: 100dvh; position: relative; overflow: hidden; color: #40372f; background: radial-gradient(circle at 85% 15%, #fff2c9 0, transparent 30%), linear-gradient(145deg, #fffaf0, #f7efe6); }
.screen-header { height: 74px; display: flex; align-items: center; justify-content: space-between; padding: 0 34px; border-bottom: 1px solid rgb(126 93 65 / 12%); background: rgb(255 253 248 / 82%); backdrop-filter: blur(14px); }
.brand,.screen-status { display: flex; align-items: center; gap: 10px; }.brand span { font-size: 30px; }.brand strong { font-size: 18px; }.screen-status { color: #806d5e; font-size: 13px; }.status-dot { width: 9px; height: 9px; border-radius: 50%; background: #55b88b; box-shadow: 0 0 0 5px rgb(85 184 139 / 13%); }
.state-card { min-height: calc(100dvh - 74px); display: grid; place-content: center; justify-items: center; padding: 48px; text-align: center; }.state-icon { display: grid; width: 118px; height: 118px; place-items: center; border-radius: 38px; background: #fff; box-shadow: 0 22px 60px rgb(92 66 45 / 13%); font-size: 58px; }.eyebrow { margin-top: 24px; color: #df825f; font-weight: 800; letter-spacing: .12em; }.state-card h1 { margin: 10px 0; font-size: clamp(36px, 5vw, 66px); }.state-card p { max-width: 660px; margin: 5px 0 24px; color: #8c796a; font-size: 18px; line-height: 1.7; }
.device-grid { display: grid; width: min(820px, 90vw); grid-template-columns: repeat(auto-fit,minmax(220px,1fr)); gap: 14px; }.device-grid button { display: grid; justify-items: start; gap: 5px; padding: 20px; border: 1px solid #ead8c9; border-radius: 18px; background: #fff; color: inherit; cursor: pointer; box-shadow: 0 10px 30px rgb(91 64 43 / 7%); }.device-grid button:hover { transform: translateY(-2px); border-color: #e7a483; }.device-grid strong { font-size: 17px; }.device-grid small { color: #9b8879; }.empty-hint { padding: 13px 20px; border-radius: 12px; background: #fff3df; }
.soft-button,.primary-button { min-height: 48px; padding: 0 24px; border: 0; border-radius: 14px; cursor: pointer; font-size: 16px; font-weight: 800; }.soft-button { background: #fff; color: #8e6e5d; box-shadow: 0 10px 30px rgb(88 60 42 / 10%); }.primary-button { background: linear-gradient(135deg,#ef9b72,#e77f5f); color: #fff; box-shadow: 0 12px 28px rgb(222 119 82 / 26%); }.primary-button:disabled { cursor: wait; opacity: .6; }
.break-card { background: radial-gradient(circle at 50% 35%,#eaffdb,transparent 35%); }.countdown { margin: 14px 0; color: #429269; font-size: clamp(70px,12vw,150px); font-weight: 900; font-variant-numeric: tabular-nums; }.summary-grid { display: grid; width: min(720px,90vw); grid-template-columns: repeat(3,1fr); gap: 16px; margin-top: 20px; }.summary-grid div { display: grid; gap: 7px; padding: 24px; border-radius: 20px; background: #fff; box-shadow: 0 12px 36px rgb(90 65 44 / 9%); }.summary-grid strong { color: #de7f5d; font-size: 27px; }.summary-grid span { color: #8d7b6d; }.recovery-card { background: linear-gradient(145deg,#fff8ef,#fff0e6); }
.protection-card { color:#f9f4e8;background:radial-gradient(circle at 50% 30%,#263d56,#101923 66%); }.protection-card .state-icon { background:#223449;box-shadow:0 22px 60px #0006; }.protection-card h1,.protection-card p { color:#f9f4e8; }.protection-card .eyebrow { color:#b9d4e7; }.protection-card .countdown { color:#d8ebdb; }.companion-hint { color:#789281;font-size:14px; }
.lesson-stage { min-height: calc(100dvh - 74px); display: grid; grid-template-columns: minmax(0,1.1fr) minmax(360px,.9fr); align-items: center; gap: 54px; padding: 6vh 7vw; }.lesson-copy h1 { max-width: 760px; margin: 14px 0 18px; font-size: clamp(42px,6vw,78px); line-height: 1.12; }.lesson-copy p { max-width: 760px; color: #716257; font-size: clamp(20px,2.2vw,30px); line-height: 1.75; }.progress-summary { display: grid; gap: 9px; max-width: 620px; margin: 28px 0; color: #927665; font-weight: 700; }.progress-summary div { height: 10px; overflow: hidden; border-radius: 999px; background: #eadfd5; }.progress-summary i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg,#f3a074,#efcf6b); }.stage-visual { aspect-ratio: 1; display: grid; place-content: center; justify-items: center; gap: 18px; border-radius: 42px; background: linear-gradient(145deg,#fff,#fff0ca); box-shadow: 0 30px 80px rgb(102 75 51 / 16%); text-align: center; transform: rotate(1.5deg); }.stage-visual span { font-size: clamp(100px,15vw,190px); }.stage-visual strong { max-width: 80%; font-size: clamp(22px,2.4vw,34px); }.visual-drawing { background: linear-gradient(145deg,#fff,#f5e4ff); }.visual-reward { background: linear-gradient(145deg,#fffbe8,#ffe4a3); }
.safe-error { position: fixed; right: 24px; bottom: 24px; max-width: 460px; padding: 14px 18px; border-radius: 14px; background: #fff0f0; color: #a84444; box-shadow: 0 12px 40px rgb(90 44 44 / 18%); }.loading-card h1 { font-size: 34px; }.loader { width: 54px; height: 54px; border: 5px solid #f0ded0; border-top-color: #e88d67; border-radius: 50%; animation: spin .8s linear infinite; }
.roll-call-card { position:fixed; left:50%; bottom:34px; z-index:20; display:grid; min-width:min(520px,86vw); justify-items:center; gap:8px; padding:18px 28px; border:2px solid #f3c763; border-radius:24px; background:#fff9d9; color:#7f5e18; box-shadow:0 18px 55px rgb(98 72 30 / 22%); transform:translateX(-50%); }
.roll-call-card span { font-size:16px; }.roll-call-card strong { font-size:clamp(30px,5vw,54px); }
.reward-celebration { position:fixed;inset:0;z-index:40;display:grid;place-content:center;justify-items:center;gap:10px;background:radial-gradient(circle,#fff9c9 0,#ffd9a7dd 46%,#8d6036aa 100%);text-align:center;animation:rewardIn .35s ease-out; }
.reward-celebration .reward-burst { font-size:100px;animation:rewardPulse .8s ease-in-out infinite alternate; }.reward-celebration>span { color:#9b5c20;font-size:24px;font-weight:800; }.reward-celebration>strong { color:#6f421d;font-size:clamp(54px,9vw,120px); }.reward-celebration p { margin:0;color:#b56828;font-size:32px;font-weight:900; }.reward-celebration small { max-width:720px;color:#6f5138;font-size:24px; }
.artwork-presentation { position:fixed;inset:74px 0 0;z-index:35;display:grid;grid-template-columns:minmax(0,1.25fr) minmax(340px,.75fr);align-items:center;gap:4vw;padding:4vw;background:linear-gradient(135deg,#fff9ef,#f4e9ff); }
.artwork-presentation img { width:100%;height:calc(100dvh - 150px);object-fit:contain;border-radius:28px;background:#fff;box-shadow:0 24px 70px rgb(81 58 45 / 18%); }
.artwork-presentation div { display:grid;gap:20px; }.artwork-presentation span { color:#b46e4e;font-size:24px;font-weight:900; }.artwork-presentation p { margin:0;color:#59483d;font-size:clamp(24px,3vw,42px);line-height:1.65; }
@keyframes rewardIn { from { opacity:0;transform:scale(.96) } } @keyframes rewardPulse { to { transform:scale(1.12) rotate(4deg) } }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width:900px) { .lesson-stage { grid-template-columns: 1fr; padding: 34px 24px; }.stage-visual { max-height: 38vh; aspect-ratio: auto; min-height: 260px; }.summary-grid { grid-template-columns: 1fr; }.screen-header { padding: 0 18px; } }
</style>
