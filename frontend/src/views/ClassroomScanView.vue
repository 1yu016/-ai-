<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import QRCode from 'qrcode'
import ManagementLayout from '@/components/ManagementLayout.vue'
import { platformApi, type ClassDeviceBinding, type SchoolClass } from '@/api/platform'
import { apiErrorMessage } from '@/api/http'

const classes = ref<SchoolClass[]>([])
const bindings = ref<ClassDeviceBinding[]>([])
const classId = ref(0)
const classroomId = ref(0)
const deviceId = ref(0)
const ticket = ref('')
const expiresAt = ref('')
const qrDataUrl = ref('')
const qrNetworkHint = ref('')
const loading = ref(false)
const error = ref('')
const now = ref(Date.now())
let heartbeatTimer: number | undefined
let clockTimer: number | undefined

const selectedBinding = computed(() =>
  bindings.value.find(
    (item) => item.classroomId === classroomId.value && item.deviceId === deviceId.value,
  ),
)
const secondsLeft = computed(() =>
  expiresAt.value
    ? Math.max(0, Math.ceil((new Date(expiresAt.value).getTime() - now.value) / 1000))
    : 0,
)
const canCreate = computed(() =>
  Boolean(classId.value && classroomId.value && deviceId.value && selectedBinding.value),
)

async function loadClasses() {
  error.value = ''
  try {
    const response = await platformApi.classes()
    classes.value = response.data.items
  } catch (cause) {
    error.value = apiErrorMessage(cause, '无法加载班级信息。')
  }
}

async function loadBindings(value: number) {
  bindings.value = []
  classroomId.value = 0
  deviceId.value = 0
  clearTicket()
  stopHeartbeat()
  if (!value) return
  try {
    const response = await platformApi.classDeviceBindings(value)
    bindings.value = response.data.filter((item) => item.device?.type === 'classroom_screen')
  } catch (cause) {
    error.value = apiErrorMessage(cause, '无法加载该班级绑定的大屏。')
  }
}

async function create() {
  if (!canCreate.value || !selectedBinding.value || loading.value) return
  loading.value = true
  error.value = ''
  try {
    await sendHeartbeat()
    const result = await platformApi.createTicket({
      classId: classId.value,
      classroomId: classroomId.value,
      deviceId: deviceId.value,
      expiresInSeconds: 120,
    })
    ticket.value = result.data.ticket
    expiresAt.value = result.data.expiresAt
    const configuredLanUrl = String(import.meta.env.VITE_LAN_APP_URL || '').trim()
    const configuredPublicUrl = String(import.meta.env.VITE_PUBLIC_APP_URL || '').trim()
    const url = new URL('/classroom/join', configuredLanUrl || configuredPublicUrl || window.location.origin)
    qrNetworkHint.value = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
      ? '当前二维码使用本机地址，手机实测前请配置 VITE_PUBLIC_APP_URL 为手机可访问的局域网或正式地址。'
      : ''
    url.searchParams.set('ticket', result.data.ticket)
    url.searchParams.set('deviceCode', result.data.deviceCode)
    qrDataUrl.value = await QRCode.toDataURL(url.toString(), {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 320,
      color: { dark: '#3f544c', light: '#ffffff' },
    })
    startHeartbeat()
  } catch (cause) {
    clearTicket()
    error.value = apiErrorMessage(cause, '二维码生成失败，请检查设备绑定及状态。')
  } finally {
    loading.value = false
  }
}

async function sendHeartbeat() {
  const device = selectedBinding.value?.device
  if (!device) return
  await platformApi.heartbeat(device.id, device.deviceCode)
  device.status = 'online'
  device.online = true
  device.lastOnlineAt = new Date().toISOString()
}

function startHeartbeat() {
  stopHeartbeat()
  heartbeatTimer = window.setInterval(() => {
    void sendHeartbeat().catch((cause) => {
      console.error('设备心跳上报失败：', cause)
      error.value = '大屏心跳上报失败，请检查网络后刷新二维码。'
    })
  }, 30_000)
}

function stopHeartbeat() {
  if (heartbeatTimer !== undefined) window.clearInterval(heartbeatTimer)
  heartbeatTimer = undefined
}

function clearTicket() {
  ticket.value = ''
  expiresAt.value = ''
  qrDataUrl.value = ''
  qrNetworkHint.value = ''
}

watch(classId, (value) => void loadBindings(value))
watch(classroomId, () => {
  deviceId.value = 0
  clearTicket()
  stopHeartbeat()
})
watch(deviceId, (value) => {
  clearTicket()
  stopHeartbeat()
  if (value) {
    void sendHeartbeat()
      .then(startHeartbeat)
      .catch((cause) => {
        console.error('设备心跳上报失败：', cause)
        error.value = apiErrorMessage(cause, '大屏心跳上报失败，当前设备不能参与课堂。')
      })
  }
})
watch(secondsLeft, (value) => {
  if (ticket.value && value === 0) {
    clearTicket()
  }
})

onMounted(() => {
  void loadClasses()
  clockTimer = window.setInterval(() => {
    now.value = Date.now()
  }, 1000)
})
onBeforeUnmount(() => {
  stopHeartbeat()
  if (clockTimer !== undefined) window.clearInterval(clockTimer)
})
</script>

<template>
  <ManagementLayout>
    <main class="scan-page">
      <header>
        <div>
          <p class="eyebrow">教师扫码配对</p>
          <h1>课堂设备准备</h1>
          <p class="muted">选择已绑定的大屏，生成两分钟内有效的一次性二维码。</p>
        </div>
        <button class="button secondary" type="button" @click="loadClasses">刷新设备</button>
      </header>

      <section class="panel scan-form">
        <label>
          班级
          <select v-model.number="classId">
            <option :value="0">请选择班级</option>
            <option v-for="item in classes" :key="item.id" :value="item.id">{{ item.name }}</option>
          </select>
        </label>
        <label>
          教室
          <select v-model.number="classroomId" :disabled="!classId">
            <option :value="0">请选择教室</option>
            <option v-for="item in bindings" :key="item.id" :value="item.classroomId">
              {{ item.classroom?.name || `教室 ${item.classroomId}` }}
            </option>
          </select>
        </label>
        <label>
          大屏设备
          <select v-model.number="deviceId" :disabled="!classroomId">
            <option :value="0">请选择设备</option>
            <option
              v-for="item in bindings.filter((binding) => binding.classroomId === classroomId)"
              :key="item.deviceId"
              :value="item.deviceId"
              :disabled="item.device?.status === 'disabled' || item.device?.status === 'fault'"
            >
              {{ item.device?.name || `设备 ${item.deviceId}` }}（{{ item.device?.status || '未知' }}）
            </option>
          </select>
        </label>
        <button class="button" type="button" :disabled="!canCreate || loading" @click="create">
          {{ loading ? '生成中…' : ticket ? '刷新二维码' : '生成扫码二维码' }}
        </button>
        <p v-if="error" class="bad">{{ error }}</p>

        <div v-if="qrDataUrl" class="ticket" aria-live="polite">
          <div class="qr-shell"><img :src="qrDataUrl" alt="教师扫码进入课堂二维码" /></div>
          <div class="ticket-copy">
            <strong>请使用教师手机扫码</strong>
            <p>扫码后会先检查登录状态、班级权限和设备绑定，再进入课堂准备。</p>
            <small>剩余有效时间：{{ secondsLeft }} 秒</small>
            <span class="secure">二维码不包含教师登录 Token，使用一次后立即失效</span>
            <span v-if="qrNetworkHint" class="network-hint">{{ qrNetworkHint }}</span>
            <button class="button secondary" type="button" :disabled="loading" @click="create">刷新二维码</button>
          </div>
        </div>
      </section>
    </main>
  </ManagementLayout>
</template>

<style scoped>
.scan-page{max-width:980px;margin:auto;color:#60483e}.scan-page header{display:flex;justify-content:space-between;align-items:end;gap:20px}.eyebrow{margin:0;color:#d17859;font-weight:800}.scan-page h1{margin:6px 0 8px;font-size:40px}.muted{margin:0;color:#927b6e}.panel{margin-top:22px;padding:24px;border:1px solid #efddcf;border-radius:20px;background:#fffdf9;box-shadow:0 12px 30px #a46e4d16}.scan-form{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.scan-form label{display:grid;gap:7px;font-weight:700}.scan-form select{height:44px;border:1px solid #efd9c8;background:#fff;border-radius:11px;padding:0 11px}.button{min-height:44px;border:0;border-radius:12px;padding:0 20px;background:#e99168;color:#fff;font:inherit;font-weight:700;cursor:pointer}.button:disabled{cursor:not-allowed;opacity:.5}.secondary{background:#fff1e7;color:#a9644b}.scan-form>.button,.bad,.ticket{grid-column:1/-1}.bad{margin:0;color:#bd4747}.ticket{display:grid;grid-template-columns:minmax(220px,340px) 1fr;gap:28px;align-items:center;margin-top:8px;padding:24px;border-radius:18px;background:#edf9f4;color:#347b69}.qr-shell{display:grid;place-items:center;padding:14px;border-radius:16px;background:#fff}.qr-shell img{display:block;width:min(100%,320px);height:auto}.ticket-copy{display:grid;gap:12px}.ticket-copy strong{font-size:24px}.ticket-copy p{margin:0;line-height:1.7}.ticket-copy small{font-size:16px;font-weight:800}.secure{color:#658277;font-size:13px}.ticket-copy .button{justify-self:start}@media(max-width:720px){.scan-page header{align-items:flex-start;flex-direction:column}.scan-form{grid-template-columns:1fr}.ticket{grid-template-columns:1fr}.scan-page h1{font-size:32px}}
.network-hint{padding:10px 12px;border-radius:10px;background:#fff3da;color:#9a642a;font-size:13px;line-height:1.5}
</style>
