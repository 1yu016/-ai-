<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElButton, ElMessage, ElOption, ElSelect } from 'element-plus'
import { storeToRefs } from 'pinia'
import { useLessonPlanStore } from '@/stores/lessonPlan'
import { useLessonRunStore } from '@/stores/lessonRun'
import { platformApi, type Classroom, type Device, type SchoolClass } from '@/api/platform'
import { apiErrorMessage, http } from '@/api/http'

type CheckStatus = 'checking' | 'ok' | 'degraded' | 'failed'
type CheckItem = { key: string; label: string; detail: string; status: CheckStatus }
const route = useRoute(); const router = useRouter(); const planStore = useLessonPlanStore()
const runStore = useLessonRunStore()
const { current: plan, loading: planLoading, error: planError } = storeToRefs(planStore)
const classes = ref<SchoolClass[]>([]); const classrooms = ref<Classroom[]>([]); const devices = ref<Device[]>([])
const classId = ref<number | null>(null); const classroomId = ref<number | null>(null); const deviceId = ref<number | null>(null); const checking = ref(false); const starting = ref(false); const checks = ref<CheckItem[]>([])
const hasFailed = computed(() => checks.value.some((item) => item.status === 'failed'))
// 设备就绪判定：已选设备必须处于 online 才视为可用；绑定的 offline 设备不得伪装成“已完成”。
const selectedDevice = computed(() => devices.value.find((d) => d.id === deviceId.value) ?? null)
const deviceOnline = computed(() => selectedDevice.value?.status === 'online')
const deviceIssueMessage = computed(() => {
  const device = selectedDevice.value
  if (!device) return ''
  if (device.status === 'disabled') return `大屏设备「${device.name}」已停用，无法开始课堂，请联系管理员。`
  if (device.status === 'fault') return `大屏设备「${device.name}」故障，无法开始课堂，请联系管理员。`
  return `大屏设备「${device.name}」当前离线，请确认设备已开机并打开大屏页面后，重新尝试开始课堂。`
})
const canEnter = computed(() => Boolean(plan.value?.steps?.length && classId.value && classroomId.value && deviceId.value && deviceOnline.value && !hasFailed.value && !checking.value && !starting.value))
const statusText: Record<CheckStatus, string> = { checking: '检查中', ok: '正常', degraded: '可降级', failed: '异常' }
function buildChecks(): CheckItem[] { const online = typeof navigator === 'undefined' || navigator.onLine !== false; const hasSteps = Boolean(plan.value?.steps?.length); return [
  { key: 'screen', label: '大屏显示', detail: '当前浏览器可以显示课堂页面', status: 'ok' },
  { key: 'network', label: '网络连接', detail: online ? '浏览器网络状态正常' : '当前处于离线状态，课堂请求可能失败', status: online ? 'ok' : 'failed' },
  { key: 'lesson', label: '课堂教案', detail: hasSteps ? `已加载 ${plan.value?.steps?.length ?? 0} 个课堂环节` : '教案没有可运行的课堂步骤', status: hasSteps ? 'ok' : 'failed' },
  { key: 'resource', label: '课程资源', detail: '资源将在对应环节按需加载，单个资源失败不会中断课堂', status: 'ok' },
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
      const selectedId = deviceId.value
      const { data } = await platformApi.listDevices()
      devices.value = data
      if (selectedId && !data.some((device) => device.id === selectedId)) deviceId.value = null
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
async function enterClassroom() { if (!canEnter.value || !plan.value || !classId.value || !classroomId.value || !deviceId.value) return; starting.value = true; try { const { data } = await http.post<{ id: number }>('/classroom-runs/start', { lessonPlanId: plan.value.id, classId: classId.value, classroomId: classroomId.value, deviceId: deviceId.value, requestId: newRequestId() }); sessionStorage.setItem(`classroom-run-device:${data.id}`, String(deviceId.value)); runStore.newlyStarted = true; await router.push({ name: 'lesson-classroom', params: { runId: data.id } }) } catch (cause) { ElMessage.error(apiErrorMessage(cause, '课堂启动失败，请重新选择班级、教室和设备。')) } finally { starting.value = false } }
onMounted(async () => { try { await planStore.load(Number(route.params.planId)); const [classRes, roomRes, deviceRes] = await Promise.all([platformApi.listClasses(), platformApi.listClassrooms(), platformApi.listDevices()]); classes.value = classRes.data.items; classrooms.value = roomRes.data; devices.value = deviceRes.data; const presetClassId = positiveQueryNumber('classId'); if (presetClassId && classes.value.some((item) => item.id === presetClassId)) classId.value = presetClassId; await runChecks(false) } catch (cause) { ElMessage.error(apiErrorMessage(cause, '课堂准备信息加载失败')) } })
function positiveQueryNumber(key: string) { const value = Number(route.query[key]); return Number.isInteger(value) && value > 0 ? value : null }
async function autoFillBindings(classIdValue: number) { try { const { data } = await platformApi.classDeviceBindings(classIdValue); const presetRoomId = positiveQueryNumber('classroomId'); const presetDeviceId = positiveQueryNumber('deviceId'); const preset = presetRoomId && presetDeviceId ? data.find((item) => item.classroomId === presetRoomId && item.deviceId === presetDeviceId) : null; const first = preset ?? data?.[0]; classroomId.value = first?.classroomId ?? null; deviceId.value = first?.deviceId ?? null; if (!first) ElMessage.warning('该班级尚未绑定教室/设备，请手动选择或联系管理员。') } catch { /* 静默失败，保留手动选择 */ } }
watch(classId, (value) => { if (!value) { classroomId.value = null; deviceId.value = null; return } void autoFillBindings(value) })
</script>

<template><main class="preflight"><header class="topbar"><div><button class="back" @click="router.push(classId ? `/lesson-plans?classId=${classId}` : '/lesson-plans')">← 备课中心</button><p class="eyebrow">上课前检查</p><h1>{{ plan?.title || '课堂准备' }}</h1><p class="muted">选择本次课堂的班级、教室和大屏设备，然后开始课堂。</p></div><ElButton :loading="checking || planLoading" @click="runChecks()">重新检查</ElButton></header><div v-if="planError" class="error panel">{{ planError }}<ElButton @click="router.push('/lesson-plans')">返回备课中心</ElButton></div><template v-else><section class="panel selectors"><label>班级<ElSelect v-model="classId" placeholder="请选择班级" clearable><ElOption v-for="item in classes" :key="item.id" :label="item.name" :value="item.id" /></ElSelect></label><label>教室<ElSelect v-model="classroomId" placeholder="请选择教室" clearable><ElOption v-for="item in classrooms" :key="item.id" :label="item.name" :value="item.id" /></ElSelect></label><label>大屏设备<ElSelect v-model="deviceId" placeholder="请选择设备" clearable><ElOption v-for="item in devices" :key="item.id" :label="`${item.name}（${item.status}）`" :value="item.id" /></ElSelect></label></section><section class="summary panel"><div><span>课堂环节</span><strong>{{ plan?.steps?.length ?? 0 }}</strong></div><div><span>预计时长</span><strong>{{ Math.ceil((plan?.steps?.reduce((sum, step) => sum + step.durationSeconds, 0) ?? 0) / 60) }} 分钟</strong></div><div><span>选择状态</span><strong>{{ classId && classroomId && deviceId ? (deviceOnline ? '已完成' : '待选择') : '待选择' }}</strong></div></section><section class="checks panel"><div v-for="item in checks" :key="item.key" class="check" :class="`check-${item.status}`"><span class="icon">{{ item.status === 'ok' ? '✓' : item.status === 'degraded' ? '!' : item.status === 'failed' ? '×' : '…' }}</span><div><strong>{{ item.label }}</strong><p>{{ item.detail }}</p></div><span class="status">{{ statusText[item.status] }}</span></div></section><div class="actions"><p v-if="deviceId && !deviceOnline" class="warning">⚠️ {{ deviceIssueMessage }}</p><p v-if="hasFailed" class="warning">请先处理异常项目后再进入课堂。</p><p v-else-if="!classId || !classroomId || !deviceId" class="warning">请选择班级、教室和大屏设备。</p><ElButton size="large" type="primary" :disabled="!canEnter" :loading="starting" @click="enterClassroom">进入课堂</ElButton></div></template></main></template>

<style scoped>.preflight{min-height:100vh;box-sizing:border-box;padding:36px max(20px,6vw) 70px;background:linear-gradient(145deg,#fffaf1,#eef8f5);color:#493d36}.topbar{max-width:1000px;margin:auto;display:flex;justify-content:space-between;align-items:flex-end;gap:20px}.back{border:0;background:none;padding:0;color:#a56148;cursor:pointer;font-weight:700}.eyebrow{margin:22px 0 5px;color:#da805f;font-weight:800}.topbar h1{margin:0;font-size:clamp(28px,5vw,48px)}.muted{color:#88766b;line-height:1.6}.panel{max-width:1000px;margin:22px auto 0;padding:24px;border:1px solid #eadfd4;border-radius:22px;background:#fffffff0;box-shadow:0 12px 35px #6f5a3512}.selectors{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.selectors label{display:grid;gap:8px;font-weight:700}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:15px}.summary div{display:grid;gap:6px;padding:14px 16px;border-radius:14px;background:#fff7ea}.summary span{color:#997c6d;font-size:14px}.summary strong{font-size:22px}.checks{display:grid;gap:10px}.check{display:grid;grid-template-columns:38px 1fr auto;align-items:center;gap:13px;padding:14px;border-radius:14px;background:#f7faf7}.check p{margin:4px 0 0;color:#88766b;font-size:14px}.icon{display:grid;width:32px;height:32px;place-items:center;border-radius:50%;background:#d8f1e2;color:#287b55;font-weight:800}.check-degraded{background:#fffaf0}.check-degraded .icon{background:#ffe4a8;color:#976713}.check-failed{background:#fff2f0}.check-failed .icon{background:#ffd0c8;color:#a53d32}.status{font-size:14px;font-weight:700;color:#4a896a}.check-degraded .status{color:#a47720}.check-failed .status{color:#af4439}.actions{max-width:1000px;margin:24px auto;display:flex;justify-content:flex-end;align-items:center;gap:15px}.warning{margin:0;color:#ad4b3d}.error{display:flex;justify-content:center;align-items:center;gap:15px;color:#a53d32}@media(max-width:700px){.topbar{align-items:flex-start;flex-direction:column}.selectors,.summary{grid-template-columns:1fr}.check{grid-template-columns:34px 1fr}.status{grid-column:2}.actions{align-items:stretch;flex-direction:column}.actions :deep(.el-button){width:100%}}</style>
