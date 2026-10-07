<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElButton } from 'element-plus'
import { apiErrorMessage } from '@/api/http'
import { classroomMobileApi } from '@/api/classroomMobile'
import { useClassroomMobileStore } from '@/stores/classroomMobile'

type PairingContext = {
  classId: number
  classroomId: number
  deviceId: number
  deviceCode: string
}

const route = useRoute()
const router = useRouter()
const mobileStore = useClassroomMobileStore()
const loading = ref(true)
const error = ref('')
const context = ref<PairingContext | null>(null)

async function consume() {
  loading.value = true
  error.value = ''
  const ticket = typeof route.query.ticket === 'string' ? route.query.ticket : ''
  const deviceCode = typeof route.query.deviceCode === 'string' ? route.query.deviceCode : ''
  if (!ticket || !deviceCode) {
    error.value = '二维码内容不完整，请返回大屏刷新二维码后重试。'
    loading.value = false
    return
  }
  try {
    const { data } = await classroomMobileApi.join({ ticket, deviceCode })
    context.value = {
      classId: data.classId,
      classroomId: data.classroomId,
      deviceId: data.deviceId,
      deviceCode: data.deviceCode,
    }
    if (data.lessonRunId && data.controlSession) {
      mobileStore.setSession(data.controlSession)
      await router.replace({ name: 'classroom-remote' })
      return
    }
  } catch (cause) {
    error.value = apiErrorMessage(cause, '扫码配对失败，二维码可能已过期或已使用。')
  } finally {
    loading.value = false
  }
}

async function enterPreparation() {
  if (!context.value) return
  await router.push({
    name: 'lesson-plans',
    query: {
      classId: String(context.value.classId),
      classroomId: String(context.value.classroomId),
      deviceId: String(context.value.deviceId),
      paired: '1',
    },
  })
}

onMounted(() => void consume())
</script>

<template>
  <main class="join-page">
    <section class="join-card">
      <div class="icon" :class="{ failed: error }">{{ loading ? '…' : error ? '×' : '✓' }}</div>
      <p class="eyebrow">教师手机扫码</p>
      <h1>{{ loading ? '正在验证课堂凭证' : error ? '扫码配对未完成' : '大屏配对成功' }}</h1>
      <p v-if="loading" class="muted">正在核验登录状态、班级权限和设备绑定关系，请稍候。</p>
      <p v-else-if="error" class="error">{{ error }}</p>
      <template v-else-if="context">
        <div class="summary">
          <span>班级编号 <strong>{{ context.classId }}</strong></span>
          <span>教室编号 <strong>{{ context.classroomId }}</strong></span>
          <span>大屏编号 <strong>{{ context.deviceCode }}</strong></span>
        </div>
        <p class="muted">一次性凭证已经消费。当前没有进行中的课堂，请选择教案后带入这台大屏和对应班级。</p>
        <ElButton size="large" type="primary" @click="enterPreparation">进入课堂准备</ElButton>
      </template>
      <ElButton v-if="error" size="large" @click="router.replace('/classroom/scan')">返回二维码页面</ElButton>
    </section>
  </main>
</template>

<style scoped>
.join-page{min-height:100dvh;display:grid;place-items:center;padding:20px;box-sizing:border-box;background:linear-gradient(145deg,#fff9ef,#eaf7f2);color:#4f433b}.join-card{width:min(100%,520px);display:grid;gap:16px;justify-items:center;padding:38px;box-sizing:border-box;border:1px solid #eadccf;border-radius:26px;background:#fffefa;box-shadow:0 20px 55px #6e523219;text-align:center}.icon{display:grid;place-items:center;width:68px;height:68px;border-radius:50%;background:#dff3e8;color:#297654;font-size:36px;font-weight:900}.icon.failed{background:#ffe1dd;color:#b3423a}.eyebrow{margin:0;color:#c8795b;font-size:13px;font-weight:800;letter-spacing:.08em}.join-card h1{margin:0;font-size:30px}.muted{margin:0;color:#85756b;line-height:1.7}.error{margin:0;color:#b3423a;line-height:1.7}.summary{width:100%;display:grid;gap:8px;padding:16px;box-sizing:border-box;border-radius:15px;background:#f4faf7;text-align:left}.summary span{display:flex;justify-content:space-between;gap:16px;color:#658076}.summary strong{color:#365a4c}
</style>
