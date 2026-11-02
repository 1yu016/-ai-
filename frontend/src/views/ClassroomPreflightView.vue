<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElButton, ElMessage, ElOption, ElSelect } from 'element-plus'
import { storeToRefs } from 'pinia'
import { useLessonPlanStore } from '@/stores/lessonPlan'
import { useLessonRunStore, type ClassroomRunPayload } from '@/stores/lessonRun'
import { platformApi, type ClassDeviceBinding, type Classroom, type Device, type SchoolClass } from '@/api/platform'
import { apiErrorMessage, http } from '@/api/http'
import BackButton from '@/components/BackButton.vue'
import { screenPreparationApi, type ScreenPreparation } from '@/api/screenPreparation'

type CheckStatus = 'checking' | 'ok' | 'degraded' | 'failed'
type CheckItem = { key: string; label: string; detail: string; status: CheckStatus }
const route = useRoute(); const router = useRouter(); const planStore = useLessonPlanStore()
const runStore = useLessonRunStore()
const { current: plan, loading: planLoading, error: planError } = storeToRefs(planStore)
const classes = ref<SchoolClass[]>([]); const classrooms = ref<Classroom[]>([]); const devices = ref<Device[]>([])
const bindings = ref<ClassDeviceBinding[]>([])
const deviceCheckError = ref('')
const activeClassrooms = ref<ClassroomRunPayload[]>([])
const activeCheckError = ref('')
const activeChecked = ref(false)
let bindingRead = 0
let activeRead = 0
const conflictingClassrooms = computed(() => activeClassrooms.value.filter(item => item.classId === classId.value || item.deviceId === deviceId.value))
async function loadActiveClassrooms() {
  const generation = ++activeRead
  try {
    const { data } = await http.get<ClassroomRunPayload | ClassroomRunPayload[] | null>('/classroom-runs/active')
    if (generation !== activeRead) return
    activeClassrooms.value = (Array.isArray(data) ? data : data ? [data] : []).filter(item => ['running', 'paused'].includes(item.status))
    activeCheckError.value = ''; activeChecked.value = true
  } catch (cause) {
    if (generation !== activeRead) return
    activeCheckError.value = apiErrorMessage(cause, '无法确认是否已有课堂，请重新检查，避免重复开课。')
    activeChecked.value = false
  }
}
function openStudentScreen() {
  const device = selectedDevice.value
  if (!device || ['disabled', 'fault'].includes(device.status) || deviceCheckError.value) return
  // User gesture opens the authorized screen route; that page issues its own restricted session.
  const url = router.resolve({ name: 'classroom-screen', params: { deviceId: device.id } }).href
  window.open(url, '_blank', 'noopener')
}
const screenConnectionUrl = computed(() => deviceId.value ? new URL('/classroom/screen/' + deviceId.value, String(import.meta.env.VITE_LAN_APP_URL || window.location.origin)).toString() : '')
const classId = ref<number | null>(null); const classroomId = ref<number | null>(null); const deviceId = ref<number | null>(null); const checking = ref(false); const starting = ref(false); const checks = ref<CheckItem[]>([])
const hasFailed = computed(() => checks.value.some((item) => item.status === 'failed'))
// 设备就绪判定：已选设备必须处于 online 才视为可用；绑定的 offline 设备不得伪装成“已完成”。
const selectedDevice = computed(() => devices.value.find((d) => d.id === deviceId.value) ?? null)
const deviceOnline = computed(() => !deviceCheckError.value && selectedDevice.value?.status === 'online')
const deviceIssueMessage = computed(() => {
  const device = selectedDevice.value
  if (deviceCheckError.value) return '大屏状态未知，请重新检查；查询失败不代表设备离线。'
  if (!device) return ''
  if (device.status === 'disabled') return `大屏设备「${device.name}」已停用，无法开始课堂，请联系管理员。`
  if (device.status === 'fault') return `大屏设备「${device.name}」故障，无法开始课堂，请联系管理员。`
  return `大屏设备「${device.name}」当前离线，请确认设备已开机并打开大屏页面后，重新尝试开始课堂。`
})
const canEnter = computed(() => Boolean(plan.value?.steps?.length && classId.value && classroomId.value && deviceId.value && deviceOnline.value && !hasFailed.value && !checking.value && !starting.value && activeChecked.value && !activeCheckError.value && !conflictingClassrooms.value.length))
const preparation = ref<ScreenPreparation | null>(null)
const preparing = ref(false)
const cancelling = ref(false)
const preparationError = ref('')
const preparationNow = ref(Date.now())
let preparationOffset = 0
let preparationQuery = 0
let preparationRequestId: string | null = null
type PendingStart = { requestId: string; lessonPlanId: number; classId: number; classroomId: number; deviceId: number; preparationId: string; preparationRevision: number }
const pendingStart = ref<PendingStart | null>(null)
const selectionLocked = computed(() => Boolean(preparation.value || preparing.value || cancelling.value || pendingStart.value || starting.value))
const secondsRemaining = computed(() => preparation.value ? Math.max(0, Math.ceil((Date.parse(preparation.value.expiresAt) - preparationNow.value - preparationOffset) / 1000)) : 0)
const canPrepare = computed(() => canEnter.value && !selectionLocked.value && !preparationError.value)
const canStart = computed(() => !starting.value && !cancelling.value && (pendingStart.value != null || (canEnter.value && preparation.value != null && secondsRemaining.value > 0)))
let preparationTimer: ReturnType<typeof setInterval> | null = null
async function refreshPreparation() {
  const selected = deviceId.value
  if (!selected || preparing.value || cancelling.value || starting.value) return
  const sequence = ++preparationQuery
  try {
    const { data } = await screenPreparationApi.get(selected)
    if (selected !== deviceId.value || sequence !== preparationQuery) return
    preparationOffset = Date.parse(data.serverNow) - Date.now()
    preparationNow.value = Date.now()
    const context = data.preparation
    if (context && (context.lessonPlanId !== plan.value?.id || context.classId !== classId.value || context.classroomId !== classroomId.value)) {
      preparationError.value = '此设备已准备其他课程，请先返回对应课程取消准备。'
      preparation.value = null
      return
    }
    preparation.value = context
    preparationError.value = ''
  } catch (cause) {
    if (selected !== deviceId.value || sequence !== preparationQuery) return
    preparationError.value = apiErrorMessage(cause, '无法核实准备状态，请重试。')
    preparation.value = null
  }
}
async function prepareScreen() {
  if (!canPrepare.value || !plan.value || !classId.value || !classroomId.value || !deviceId.value) return
  preparing.value = true; preparationError.value = ''; preparationQuery += 1
  preparationRequestId ??= newRequestId()
  try {
    const { data } = await screenPreparationApi.create(deviceId.value, { classId: classId.value, classroomId: classroomId.value, lessonPlanId: plan.value.id, lessonPlanVersion: plan.value.version, requestId: preparationRequestId })
    preparation.value = data
    preparationOffset = Date.parse(data.serverNow || data.createdAt) - Date.now()
    preparationNow.value = Date.now()
    preparationRequestId = null
  } catch (cause) {
    preparationError.value = apiErrorMessage(cause, '准备到大屏失败，请检查设备和教案。')
    if ((cause as { response?: unknown }).response) preparationRequestId = null
  } finally { preparing.value = false }
}
async function cancelPreparation() {
  if (!preparation.value || cancelling.value || starting.value || pendingStart.value) return
  cancelling.value = true; preparationQuery += 1
  try {
    await screenPreparationApi.cancel(preparation.value.deviceId, preparation.value)
    preparation.value = null; preparationError.value = ''; preparationRequestId = null
  } catch (cause) { preparationError.value = apiErrorMessage(cause, '取消准备失败，请重试。') }
  finally { cancelling.value = false }
}
let deviceRefreshTimer: ReturnType<typeof setInterval> | null = null
let deviceRefreshPending = false
onMounted(() => {
  deviceRefreshTimer = setInterval(async () => {
    if (!classId.value || deviceRefreshPending || checking.value || starting.value) return
    deviceRefreshPending = true
    try { await Promise.all([loadBindings(classId.value, false), loadActiveClassrooms()]); checks.value = buildChecks() }
    catch { checks.value = buildChecks() }
    finally { deviceRefreshPending = false }
  }, 10_000)
})
onBeforeUnmount(() => { bindingRead++; activeRead++; preparationQuery += 1; if (deviceRefreshTimer !== null) clearInterval(deviceRefreshTimer); if (preparationTimer !== null) clearInterval(preparationTimer) })
const statusText: Record<CheckStatus, string> = { checking: '检查中', ok: '正常', degraded: '可降级', failed: '异常' }
function buildChecks(): CheckItem[] { const online = typeof navigator === 'undefined' || navigator.onLine !== false; const hasSteps = Boolean(plan.value?.steps?.length); return [
  { key: 'screen', label: '学生大屏', detail: deviceCheckError.value ? '无法查询大屏状态，请重新检查' : deviceOnline.value ? '学生大屏已连接，可继续准备课堂' : '学生大屏未连接，请打开大屏页面并等待连接', status: deviceOnline.value ? 'ok' : 'failed' },
  { key: 'network', label: '网络连接', detail: online ? '浏览器网络状态正常' : '当前处于离线状态，课堂请求可能失败', status: online ? 'ok' : 'failed' },
  { key: 'lesson', label: '课堂教案', detail: hasSteps ? `已加载 ${plan.value?.steps?.length ?? 0} 个课堂环节` : '教案没有可运行的课堂步骤', status: hasSteps ? 'ok' : 'failed' },
  { key: 'resource', label: '课程资源', detail: plan.value?.steps?.some(step => step.resourceId) ? '已配置教学资源，文件将在对应环节加载；尚未验证下载和播放，异常时可切换环节。' : '本教案没有绑定需要加载的资源。', status: plan.value?.steps?.some(step => step.resourceId) ? 'degraded' : 'ok' },
  { key: 'microphone', label: '麦克风', detail: '课堂互动时按需请求麦克风权限', status: 'degraded' },
  { key: 'ai', label: 'AI 助教', detail: 'AI 服务异常时仍可按教案完成课堂', status: 'degraded' },
  { key: 'avatar', label: '数字人', detail: '数字人不可用时不影响课堂控制', status: 'degraded' },
] }
async function runChecks(refreshDevices = true) {
  checking.value = true
  checks.value = buildChecks().map((item) => ({ ...item, status: 'checking' }))
  try {
    // 大屏页面的设备心跳会在后端更新在线状态；重新检查时必须重新取数，
    // 否则这里会一直使用进入页面时缓存的 offline 状态。
    if (refreshDevices) {
      await loadActiveClassrooms()
      if (classId.value) await loadBindings(classId.value, false)
    }
    await new Promise((resolve) => window.setTimeout(resolve, 180))
    checks.value = buildChecks()
  } catch (cause) {
    ElMessage.error(apiErrorMessage(cause, '设备状态刷新失败，请稍后重试'))
    checks.value = buildChecks()
  } finally {
    checking.value = false
  }
}
function newRequestId() { return globalThis.crypto?.randomUUID?.() ?? `classroom-${Date.now()}-${Math.random().toString(36).slice(2)}` }
async function enterClassroom() {
  if (!canStart.value || !deviceId.value) return
  if (!pendingStart.value && preparation.value) {
    const p = preparation.value
    const key = `screen-preparation-start:${p.preparationId}`
    const requestId = sessionStorage.getItem(key) || newRequestId()
    sessionStorage.setItem(key, requestId)
    pendingStart.value = { requestId, preparationId: p.preparationId, preparationRevision: p.revision, lessonPlanId: p.lessonPlanId, classId: p.classId, classroomId: p.classroomId, deviceId: p.deviceId }
  }
  if (!pendingStart.value) return
  starting.value = true; preparationQuery += 1
  try {
    const { data } = await http.post<{ id: number }>('/classroom-runs/start', pendingStart.value)
    sessionStorage.setItem(`classroom-run-device:${data.id}`, String(pendingStart.value.deviceId))
    sessionStorage.removeItem(`screen-preparation-start:${pendingStart.value.preparationId}`)
    pendingStart.value = null; preparation.value = null
    runStore.newlyStarted = true
    await router.push({ name: 'lesson-classroom', params: { runId: data.id } })
  } catch (cause) {
    preparationError.value = apiErrorMessage(cause, '启动结果尚未确认，请恢复网络后点击确认启动结果。')
    if ((cause as { response?: unknown }).response) pendingStart.value = null
  } finally { starting.value = false; if (!pendingStart.value) void refreshPreparation() }
}
onMounted(async () => { try { await planStore.load(Number(route.params.planId)); classes.value = (await platformApi.listClasses()).data.items; const presetClassId = positiveQueryNumber('classId'); if (presetClassId && classes.value.some((item) => item.id === presetClassId)) classId.value = presetClassId; await loadActiveClassrooms(); await runChecks(false) } catch (cause) { ElMessage.error(apiErrorMessage(cause, '课堂准备信息加载失败')) } })
function positiveQueryNumber(key: string) { const value = Number(route.query[key]); return Number.isInteger(value) && value > 0 ? value : null }
async function loadBindings(classIdValue: number, usePreset = true) {
  const generation = ++bindingRead
  let data: ClassDeviceBinding[]
  try {
    const result = await platformApi.classDeviceBindings(classIdValue)
    if (generation !== bindingRead || classId.value !== classIdValue) return
    data = result.data.filter(item => item.device?.type === 'classroom_screen')
    deviceCheckError.value = ''
  } catch (cause) {
    if (generation !== bindingRead || classId.value !== classIdValue) return
    deviceCheckError.value = apiErrorMessage(cause, '大屏状态查询失败，请重新检查。')
    throw cause
  }
  bindings.value = data.filter((item) => item.classroom && item.device)
  classrooms.value = bindings.value.map((item) => ({ id: item.classroomId, name: item.classroom!.name, location: null, status: 'active' })).filter((item, index, values) => values.findIndex((value) => value.id === item.id) === index)
  devices.value = bindings.value.map((item) => ({ ...item.device!, binding: { id: item.id, classroomId: item.classroomId, classroomName: item.classroom!.name, classId: item.classId, className: classes.value.find((entry) => entry.id === item.classId)?.name ?? null, boundAt: '' } }))
  const current = bindings.value.find((item) => item.classroomId === classroomId.value && item.deviceId === deviceId.value)
  const presetRoomId = usePreset ? positiveQueryNumber('classroomId') : null
  const presetDeviceId = usePreset ? positiveQueryNumber('deviceId') : null
  const preset = presetRoomId && presetDeviceId ? bindings.value.find((item) => item.classroomId === presetRoomId && item.deviceId === presetDeviceId) : null
  const first = current ?? preset ?? (bindings.value.length === 1 ? bindings.value[0] : undefined)
  const selectedRoom = classrooms.value.some(room => room.id === classroomId.value) ? classroomId.value : null
  classroomId.value = first?.classroomId ?? selectedRoom
  deviceId.value = first?.deviceId ?? null
  checks.value = buildChecks()
  if (!bindings.value.length) ElMessage.warning('该班级尚未绑定可用教室和设备，请联系管理员。')
}
watch(classId, (value) => { bindings.value = []; devices.value = []; classrooms.value = []; deviceId.value = null; classroomId.value = null; preparationQuery++; if (!value) { bindingRead++; bindings.value = []; classrooms.value = []; devices.value = []; classroomId.value = null; deviceId.value = null; return } void loadBindings(value).catch((cause) => ElMessage.error(apiErrorMessage(cause, '班级设备绑定加载失败'))) })
watch(classroomId, (value) => {
  if (!value) { deviceId.value = null; return }
  const valid = bindings.value.some((item) => item.classroomId === value && item.deviceId === deviceId.value)
  if (!valid) { const candidates = bindings.value.filter(item => item.classroomId === value); deviceId.value = candidates.length === 1 ? candidates[0]!.deviceId : null }
})
watch([classId, classroomId, deviceId], () => { preparationQuery += 1; preparation.value = null; preparationError.value = ''; void refreshPreparation() })
onMounted(() => {
  let ticks = 0
  preparationTimer = setInterval(() => { preparationNow.value = Date.now(); if (++ticks % 5 === 0) void refreshPreparation() }, 1000)
})
</script>

<template>
  <main class="preflight">
    <header class="topbar">
      <div><BackButton label="返回备课中心" :fallback="{ name: 'lesson-plans', query: classId ? { classId: String(classId) } : {} }" /><p class="eyebrow">课堂准备</p><h1>{{ plan?.title || '正在加载教案' }}</h1><p class="muted">确认班级与学生大屏，再准备到大屏。准备完成后才会开始上课。</p></div>
      <ElButton :loading="checking || planLoading" @click="runChecks()">重新检查</ElButton>
    </header>
    <div v-if="planError" class="error panel">{{ planError }}<ElButton @click="router.push('/lesson-plans')">返回备课中心</ElButton></div>
    <template v-else>
      <section v-if="deviceCheckError && !deviceId" class="panel" role="alert"><h2>学生大屏状态未知</h2><p>{{ deviceCheckError }}。请点击重新检查；查询失败不代表设备离线。</p></section>
      <section class="panel selectors">
        <label>当前班级<ElSelect v-model="classId" placeholder="请选择班级" clearable :disabled="selectionLocked"><ElOption v-for="item in classes" :key="item.id" :label="item.name" :value="item.id" /></ElSelect></label>
        <label>已绑定教室<ElSelect v-model="classroomId" placeholder="暂无有效绑定" clearable :disabled="selectionLocked || !classId || !classrooms.length"><ElOption v-for="item in classrooms" :key="item.id" :label="item.name" :value="item.id" /></ElSelect></label>
        <label>已绑定学生大屏<ElSelect v-model="deviceId" placeholder="请选择大屏" clearable :disabled="selectionLocked || !classroomId"><ElOption v-for="item in devices.filter(device => device.binding?.classroomId === classroomId)" :key="item.id" :label="item.name + '（' + ({ online: '已连接', offline: '未连接', disabled: '已停用', fault: '故障' }[item.status] || '待检查') + '）'" :value="item.id" /></ElSelect></label>
      </section>
      <section v-if="activeCheckError || activeClassrooms.length" class="panel" data-test="active-classrooms">
        <h2>继续已有课堂</h2><p v-if="activeCheckError" role="alert">{{ activeCheckError }}</p><p v-else>请选择要继续的课堂。相同班级或大屏正在上课时，不能重复开课。</p>
        <div v-for="item in activeClassrooms" :key="item.id" class="existing-classroom"><span>{{ item.title }} · {{ item.status === 'paused' ? '已暂停' : '正在上课' }}</span><ElButton @click="router.push({ name: 'lesson-classroom', params: { runId: item.id } })">继续课堂</ElButton></div>
      </section>
      <section v-if="deviceId" class="panel" data-test="screen-connection">
        <h2>{{ deviceCheckError ? '学生大屏状态未知' : deviceOnline ? '学生大屏已连接' : '学生大屏未连接' }}</h2>
        <p v-if="deviceCheckError" role="alert">{{ deviceCheckError }}。请重新检查，暂不能开始上课。</p>
        <p v-else-if="deviceOnline">已绑定的大屏正在保持连接，无需重复打开或绑定。</p>
        <p v-else>{{ deviceIssueMessage }}</p>
        <template v-if="!deviceOnline">
          <ElButton :disabled="!!deviceCheckError || !selectedDevice || ['disabled', 'fault'].includes(selectedDevice.status)" @click="openStudentScreen">打开学生大屏</ElButton>
          <p>本机连接投影或大屏时，点击打开独立窗口；请保留此准备页和大屏窗口。若未打开，请允许浏览器弹出窗口后重试。</p>
          <details><summary>大屏在另一台设备上？</summary><p>请在那台设备上打开下方链接，并由有权限的教师登录。系统不能远程启动另一台设备的浏览器。</p><a :href="screenConnectionUrl" target="_blank" rel="noopener">打开已绑定学生大屏</a><p>{{ screenConnectionUrl }}</p></details>
        </template>
        <small>状态来自服务端真实设备心跳，每 10 秒检查。打开大屏不会开始课堂。</small>
      </section>
      <section class="summary panel"><div><span>课堂环节</span><strong>{{ plan?.steps?.length ?? 0 }}</strong></div><div><span>预计时长</span><strong>{{ Math.ceil((plan?.steps?.reduce((sum, step) => sum + step.durationSeconds, 0) ?? 0) / 60) }} 分钟</strong></div><div><span>准备状态</span><strong>{{ deviceCheckError ? '待检查' : classId && classroomId && deviceId ? deviceOnline ? '已完成' : '待连接' : '待选择' }}</strong></div></section>
      <section class="checks panel" aria-label="教案与资源准备">
        <div v-for="item in checks.filter(item => ['lesson', 'resource', 'network'].includes(item.key))" :key="item.key" class="check" :class="'check-' + item.status"><span class="icon">{{ item.status === 'ok' ? '✓' : item.status === 'failed' ? '×' : '!' }}</span><div><strong>{{ item.label }}</strong><p>{{ item.detail }}</p></div><span class="status">{{ statusText[item.status] }}</span></div>
        <details><summary>语音、AI 与数字人使用说明</summary><p>进入课堂后可按需开启语音唤醒，麦克风需要浏览器授权。AI 或数字人不可用时，仍可使用课堂按钮继续教学。</p></details>
      </section>
      <section v-if="preparation || preparationError || pendingStart" class="panel preparation-panel" data-test="preparation-status">
        <h2>{{ pendingStart ? '正在确认启动结果' : preparation ? '已准备到大屏' : '准备状态提示' }}</h2>
        <template v-if="preparation"><p>{{ preparation.courseTitle }} · 等待教师开始</p><p>{{ secondsRemaining > 0 ? '准备有效期剩余 ' + secondsRemaining + ' 秒，点击开始上课进入数字人开场。' : '准备已过期，请取消准备后重新准备。' }}</p><small>准备不会创建课堂，也不会自动播放资源或数字人。</small></template>
        <p v-if="preparationError" class="warning" role="alert">{{ preparationError }}</p>
      </section>
      <div class="actions">
        <p v-if="!classId || !classroomId || !deviceId" class="warning">请选择具有有效绑定的班级、教室和学生大屏。</p>
        <p v-else-if="hasFailed" class="warning">请先处理上方提示，或点击重新检查。</p>
        <ElButton v-if="!preparation && !pendingStart" size="large" type="primary" :disabled="!canPrepare" :loading="preparing" @click="prepareScreen">准备到大屏</ElButton>
        <template v-else><ElButton size="large" :disabled="starting || !!pendingStart" :loading="cancelling" @click="cancelPreparation">取消准备</ElButton><ElButton size="large" type="primary" :disabled="!canStart" :loading="starting" @click="enterClassroom">{{ pendingStart ? '确认启动结果' : '开始上课' }}</ElButton></template>
      </div>
    </template>
  </main>
</template>

<style scoped>.preflight{min-height:100vh;box-sizing:border-box;padding:36px max(20px,6vw) 70px;background:linear-gradient(145deg,#fffaf1,#eef8f5);color:#493d36}.topbar{max-width:1000px;margin:auto;display:flex;justify-content:space-between;align-items:flex-end;gap:20px}.back{border:0;background:none;padding:0;color:#a56148;cursor:pointer;font-weight:700}.eyebrow{margin:22px 0 5px;color:#da805f;font-weight:800}.topbar h1{margin:0;font-size:clamp(28px,5vw,48px)}.muted{color:#88766b;line-height:1.6}.panel{max-width:1000px;margin:22px auto 0;padding:24px;border:1px solid #eadfd4;border-radius:22px;background:#fffffff0;box-shadow:0 12px 35px #6f5a3512}.selectors{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.selectors label{display:grid;gap:8px;font-weight:700}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:15px}.summary div{display:grid;gap:6px;padding:14px 16px;border-radius:14px;background:#fff7ea}.summary span{color:#997c6d;font-size:14px}.summary strong{font-size:22px}.checks{display:grid;gap:10px}.check{display:grid;grid-template-columns:38px 1fr auto;align-items:center;gap:13px;padding:14px;border-radius:14px;background:#f7faf7}.check p{margin:4px 0 0;color:#88766b;font-size:14px}.icon{display:grid;width:32px;height:32px;place-items:center;border-radius:50%;background:#d8f1e2;color:#287b55;font-weight:800}.check-degraded{background:#fffaf0}.check-degraded .icon{background:#ffe4a8;color:#976713}.check-failed{background:#fff2f0}.check-failed .icon{background:#ffd0c8;color:#a53d32}.status{font-size:14px;font-weight:700;color:#4a896a}.check-degraded .status{color:#a47720}.check-failed .status{color:#af4439}.actions{max-width:1000px;margin:24px auto;display:flex;justify-content:flex-end;align-items:center;gap:15px}.warning{margin:0;color:#ad4b3d}.error{display:flex;justify-content:center;align-items:center;gap:15px;color:#a53d32}@media(max-width:700px){.topbar{align-items:flex-start;flex-direction:column}.selectors,.summary{grid-template-columns:1fr}.check{grid-template-columns:34px 1fr}.status{grid-column:2}.actions{align-items:stretch;flex-direction:column}.actions :deep(.el-button){width:100%}}</style>

<style scoped>.existing-classroom{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-top:12px}.panel details{margin:16px 0}.panel a{overflow-wrap:anywhere}.panel small{display:block;margin-top:12px;color:#78685d}</style>
