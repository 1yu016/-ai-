<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import QRCode from 'qrcode'
import { platformApi } from '@/api/platform'
import { apiErrorMessage, http } from '@/api/http'
import type { ClassroomRunPayload } from '@/stores/lessonRun'

const props = defineProps<{ classId: number; classroomId: number; deviceId: number; runId?: number; title?: string; autoCreate?: boolean }>()
const qr = ref('')
const error = ref('')
const busy = ref(false)
const expiresAt = ref(0)
const now = ref(Date.now())
const seconds = computed(() => Math.max(0, Math.ceil((expiresAt.value - now.value) / 1000)))
const origin = String(import.meta.env.VITE_LAN_APP_URL || import.meta.env.VITE_PUBLIC_APP_URL || window.location.origin).trim()
const loopback = computed(() => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(new URL(origin).hostname))
let generation = 0
const timer = window.setInterval(() => { now.value = Date.now() }, 1000)
watch(() => [props.classId, props.classroomId, props.deviceId, props.runId], () => {
  generation++; qr.value = ''; error.value = ''; expiresAt.value = 0; busy.value = false
})
onBeforeUnmount(() => { generation++; window.clearInterval(timer) })
onMounted(() => { if (props.autoCreate) void create() })
async function create() {
  if (busy.value || loopback.value) return
  const current = ++generation
  const context = { classId: props.classId, classroomId: props.classroomId, deviceId: props.deviceId, lessonRunId: props.runId }
  busy.value = true; error.value = ''; qr.value = ''; expiresAt.value = 0
  try {
    // Bind to this classroom, never silently select a different active lesson.
    if (context.lessonRunId) {
      const { data } = await http.get<ClassroomRunPayload>(`/classroom-runs/${context.lessonRunId}`)
      if (data.id !== context.lessonRunId || data.classId !== context.classId || data.deviceId !== context.deviceId || !['running', 'paused'].includes(data.status)) {
        throw new Error('当前课堂已经结束或设备已变更，请关闭面板并刷新课堂状态。')
      }
    }
    if (current !== generation) return
    const { data } = await platformApi.createTicket({ ...context, expiresInSeconds: 120 })
    if (current !== generation) return
    const url = new URL('/classroom/join', origin)
    url.searchParams.set('ticket', data.ticket)
    url.searchParams.set('deviceCode', data.deviceCode)
    const image = await QRCode.toDataURL(url.toString(), { width: 300, margin: 2, errorCorrectionLevel: 'M' })
    if (current !== generation) return
    expiresAt.value = Date.parse(data.expiresAt); now.value = Date.now(); qr.value = image
  } catch (cause) {
    if (current === generation) error.value = apiErrorMessage(cause, '连接凭证生成失败，请检查网络与大屏状态后重试。')
  } finally { if (current === generation) busy.value = false }
}
</script>

<template>
  <section class="pairing-panel" aria-label="手机连接二维码">
    <h3>{{ title || '连接教师手机' }}</h3>
    <p>手机与课堂电脑连接同一 Wi-Fi，扫码后使用当前课堂教师账号登录。</p>
    <p v-if="runId">手机将控制本节课堂。关闭此面板不会结束课堂，也不会退出已授权的手机。</p>
    <p v-if="loopback" role="alert">尚未取得手机可访问的地址，请连接 Wi-Fi 后重新启动统一版前端，再打开此面板。</p>
    <template v-else>
      <p class="address">手机访问地址：{{ origin }}。若无法打开，请检查同一 Wi-Fi 和网络隔离情况。</p>
      <img v-if="qr && seconds > 0" :src="qr" alt="教师手机连接课堂的一次性二维码" />
      <p v-if="qr" role="status">{{ seconds > 0 ? `二维码剩余 ${seconds} 秒；仅可使用一次` : '二维码已过期，请重新生成' }}</p>
      <button type="button" :disabled="busy" @click="create">{{ busy ? '正在生成…' : qr ? '重新生成二维码' : '生成二维码' }}</button>
    </template>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p class="status">电脑端暂不能查询手机是否已连接。请以手机显示“实时连接”为准；授权失败或会话过期会在手机端提示。</p>
    <small>重新生成仅生成新的限时凭证；不会撤销已登录手机的控制权限。不要分享二维码。退出手机控制不会结束课堂。</small>
  </section>
</template>

<style scoped>
.pairing-panel{display:grid;gap:14px;color:#493d36}.pairing-panel h3,.pairing-panel p{margin:0;line-height:1.65}.pairing-panel img{width:min(300px,100%);justify-self:center}.pairing-panel button{min-height:44px;border:0;border-radius:12px;background:#e99168;color:#fff;font:inherit;font-weight:700;cursor:pointer}.pairing-panel button:disabled{opacity:.6}.pairing-panel small,.status,.address{color:#78685d}.pairing-panel .error{color:#a53d32}
</style>
