<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { platformApi, type Student } from '@/api/platform'
import { useClassroomMobileStore } from '@/stores/classroomMobile'
import type { ClassroomCommandOperation } from '@/services/classroomCommandBus'

const router = useRouter()
const mobile = useClassroomMobileStore()
const { session, state, connection, canControl, lastError, lastConfirmedAt } = storeToRefs(mobile)
const students = ref<Student[]>([])
const selectedStudentId = ref(0)
const busy = ref(false)

const classroom = computed(() => state.value?.classroom ?? null)
const currentStep = computed(() => classroom.value?.steps?.[classroom.value.currentStepIndex] ?? null)
const playerState = computed(() => classroom.value?.playerRecoverySuggestion ?? {})
const currentResourceId = computed(() => Number(currentStep.value?.resourceId || playerState.value.resourceId || 0))
const elapsed = computed(() => {
  const total = Number(classroom.value?.elapsedSeconds || classroom.value?.timing?.elapsedSeconds || 0)
  const minutes = Math.floor(total / 60)
  return `${String(minutes).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
})
const connectionLabel = computed(() => ({
  idle: '未连接', connecting: '连接中', online: '实时在线', reconnecting: '正在重连', offline: '网络离线', expired: '连接已失效',
}[connection.value]))
const attendanceRows = computed(() => {
  const map = state.value?.attendance.attendanceState ?? {}
  return students.value.map((student) => ({
    ...student,
    attendanceStatus: map[String(student.id)] || map[student.id] || '未标记',
  }))
})
const interactionSummary = computed(() => {
  const value = state.value?.interaction ?? {}
  const count = Object.keys(value).length
  return count ? `已同步 ${count} 项课堂互动状态` : '暂无新的幼儿互动'
})

async function loadStudents(classId: number) {
  try {
    const response = await platformApi.students(classId)
    students.value = response.data.items.filter((item) => item.status === 'active')
    if (!selectedStudentId.value && students.value[0]) selectedStudentId.value = students.value[0].id
  } catch {
    students.value = []
  }
}

async function send(operation: ClassroomCommandOperation, parameters?: Record<string, unknown>, success = '操作已由服务端确认') {
  if (busy.value) return
  busy.value = true
  try {
    await mobile.execute(operation, parameters)
    ElMessage.success(success)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '操作未执行')
  } finally {
    busy.value = false
  }
}

function attendance(status: 'present' | 'absent' | 'late' | 'leave') {
  if (!selectedStudentId.value) return ElMessage.warning('请先选择幼儿')
  return send('attendance_update', {
    updates: [{ studentId: selectedStudentId.value, status }],
    attendanceSource: 'manual',
  }, '考勤已保存并同步到大屏')
}

function reward() {
  if (!selectedStudentId.value) return ElMessage.warning('请先选择幼儿')
  return send('reward_student', {
    studentId: selectedStudentId.value,
    rewardCategory: 'progress',
    rewardForms: ['points', 'flower', 'animation'],
    points: 1,
    stars: 1,
    animationKey: 'encourage',
  }, '奖励已确认并同步到大屏')
}

async function completeClass() {
  await ElMessageBox.confirm('确定结束本节课堂吗？结束后手机控制权限立即失效。', '结束课堂', { type: 'warning' })
  await send('complete_class', undefined, '课堂已结束')
}

async function leaveRemote() {
  await mobile.revoke()
  await router.replace('/chat')
}

watch(() => state.value?.attendance.classId, (classId) => {
  if (classId) void loadStudents(classId)
}, { immediate: true })

watch(connection, (value) => {
  if (value === 'expired') ElMessage.warning(lastError.value || '课堂控制会话已失效，请重新扫码')
})

onMounted(() => mobile.start())
onBeforeUnmount(() => mobile.stop(false))
</script>

<template>
  <main class="mobile-remote">
    <header class="remote-head">
      <div>
        <span class="eyebrow">教师手机控制端</span>
        <h1>{{ classroom?.title || '连接课堂大屏' }}</h1>
      </div>
      <button class="leave" type="button" @click="leaveRemote">退出控制</button>
    </header>

    <section class="connection-card" :class="connection">
      <div class="connection-title"><i></i><strong>{{ connectionLabel }}</strong></div>
      <span>大屏：{{ state?.screen.online ? '在线' : '离线' }}</span>
      <span>课堂计时：{{ elapsed }}</span>
      <button v-if="connection !== 'online' && session" type="button" @click="mobile.start">立即重连</button>
    </section>
    <p v-if="lastError" class="network-error">{{ lastError }}</p>

    <section v-if="!session" class="empty-card">
      <div>📱</div><h2>请先扫描大屏二维码</h2>
      <p>手机控制会话只在当前课堂和当前教师账号下有效。</p>
      <button type="button" @click="router.push('/classroom/scan')">前往扫码配对</button>
    </section>

    <template v-else-if="state">
      <section class="now-card">
        <div><span>当前步骤</span><strong>{{ (classroom?.currentStepIndex ?? 0) + 1 }} / {{ classroom?.steps?.length || 0 }}</strong></div>
        <h2>{{ currentStep?.title || '课堂准备' }}</h2>
        <p>{{ currentStep?.content || '等待教师开始课堂内容' }}</p>
        <div class="resource-line">
          <span>当前资源</span>
          <b>{{ currentResourceId ? `资源 #${currentResourceId}` : '未打开' }}</b>
          <em>{{ String(playerState.status || 'stopped') }}</em>
        </div>
      </section>

      <section class="control-card">
        <h2>步骤与资源</h2>
        <div class="button-grid cols-3">
          <button :disabled="busy || !canControl" @click="send('previous_step')">← 上一步</button>
          <button :disabled="busy || !canControl || !currentResourceId" @click="send('play_resource', { resourceId: currentResourceId })">▶ 播放</button>
          <button :disabled="busy || !canControl" @click="send('next_step')">下一步 →</button>
          <button :disabled="busy || !canControl" @click="send('pause_media')">暂停媒体</button>
          <button :disabled="busy || !canControl" @click="send('resume_media')">继续媒体</button>
          <button :disabled="busy || !canControl" @click="send('stop_media')">停止媒体</button>
          <button :disabled="busy || !canControl" @click="send('previous_page')">上一页</button>
          <button :disabled="busy || !canControl" @click="send('next_page')">下一页</button>
          <button :disabled="busy || !canControl" @click="send(playerState.muted ? 'unmute' : 'mute')">{{ playerState.muted ? '取消静音' : '静音' }}</button>
        </div>
      </section>

      <section class="control-card">
        <h2>考勤、点名与奖励</h2>
        <select v-model.number="selectedStudentId" aria-label="选择幼儿">
          <option :value="0">请选择幼儿</option>
          <option v-for="student in attendanceRows" :key="student.id" :value="student.id">
            {{ student.nickname || student.name }} · {{ student.attendanceStatus }}
          </option>
        </select>
        <div class="button-grid cols-4 attendance-buttons">
          <button :disabled="busy || !canControl" @click="attendance('present')">出勤</button>
          <button :disabled="busy || !canControl" @click="attendance('late')">迟到</button>
          <button :disabled="busy || !canControl" @click="attendance('leave')">请假</button>
          <button :disabled="busy || !canControl" @click="attendance('absent')">缺勤</button>
        </div>
        <div class="button-grid cols-2">
          <button class="accent" :disabled="busy || !canControl" @click="send('random_roll_call')">🎲 随机点名</button>
          <button class="reward" :disabled="busy || !canControl || !selectedStudentId" @click="reward">🌸 奖励幼儿</button>
        </div>
      </section>

      <section class="control-card">
        <h2>课间与课堂</h2>
        <div class="button-grid cols-2">
          <button :disabled="busy || !canControl" @click="send('start_break', { durationSeconds: 300, contentType: 'water' })">开始 5 分钟课间</button>
          <button :disabled="busy || !canControl" @click="send('end_break')">提前结束课间</button>
          <button class="danger" :disabled="busy || !canControl" @click="completeClass">结束课堂</button>
        </div>
      </section>

      <section class="status-grid">
        <article><span>最近点名</span><strong>{{ state.recentRollCall?.displayName || '暂无' }}</strong></article>
        <article><span>最近奖励</span><strong>{{ state.recentReward?.displayName || '暂无' }}</strong></article>
        <article><span>幼儿互动</span><strong>{{ interactionSummary }}</strong></article>
        <article><span>送达状态</span><strong>{{ lastConfirmedAt ? '服务端已确认' : '暂无操作' }}</strong></article>
      </section>
      <p class="privacy-note">局域网实时通道只传递当前课堂状态，不在二维码中包含教师 Token 或幼儿信息。</p>
    </template>

    <section v-else class="empty-card"><div class="spinner"></div><h2>正在拉取服务端课堂状态</h2></section>
  </main>
</template>

<style scoped>
.mobile-remote{min-height:100dvh;box-sizing:border-box;padding:18px;background:linear-gradient(150deg,#fff8ee,#edf8f3);color:#50443d}.remote-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;max-width:780px;margin:auto}.eyebrow{color:#d87959;font-size:12px;font-weight:900;letter-spacing:.12em}.remote-head h1{margin:5px 0 0;font-size:26px}.leave{border:0;border-radius:12px;padding:10px 14px;background:#fff;color:#8c6b5c;box-shadow:0 8px 22px #76543812}.connection-card,.now-card,.control-card,.empty-card,.status-grid{max-width:780px;margin:14px auto 0;box-sizing:border-box;border:1px solid #eadccf;border-radius:20px;background:#fffefa;box-shadow:0 12px 36px #76543810}.connection-card{display:flex;align-items:center;gap:16px;padding:13px 16px;color:#61786d;font-size:13px}.connection-title{display:flex;align-items:center;gap:8px;margin-right:auto}.connection-title i{width:10px;height:10px;border-radius:50%;background:#56b886;box-shadow:0 0 0 5px #56b8861c}.connection-card.reconnecting i,.connection-card.connecting i{background:#e2a24b}.connection-card.offline i,.connection-card.expired i{background:#d75d57}.connection-card button{border:0;background:#e9f5ef;color:#37775c;border-radius:9px;padding:7px 10px}.network-error{max-width:750px;margin:10px auto 0;padding:10px 14px;border-radius:11px;background:#fff0ed;color:#a64c46}.now-card{padding:20px}.now-card>div:first-child{display:flex;justify-content:space-between;color:#8f7c70;font-size:13px}.now-card h2{margin:12px 0 7px;font-size:24px}.now-card p{margin:0;color:#85766d;line-height:1.55}.resource-line{display:flex;align-items:center;gap:10px;margin-top:15px;padding:12px;border-radius:13px;background:#f0f8f4}.resource-line span{color:#678072;font-size:12px}.resource-line b{flex:1}.resource-line em{font-size:11px;font-style:normal;color:#d27858}.control-card{padding:18px}.control-card h2{margin:0 0 14px;font-size:18px}.button-grid{display:grid;gap:9px;margin-top:10px}.cols-2{grid-template-columns:repeat(2,1fr)}.cols-3{grid-template-columns:repeat(3,1fr)}.cols-4{grid-template-columns:repeat(4,1fr)}.button-grid button,.control-card select,.empty-card button{min-height:44px;border:1px solid #ecd9cb;border-radius:12px;background:#fff;color:#68554b;font:inherit;font-weight:750}.button-grid button:active{transform:scale(.98)}.button-grid button:disabled{opacity:.42}.control-card select{width:100%;padding:0 12px}.button-grid .accent{background:#eaf7f1;color:#36785d}.button-grid .reward{background:#fff2cd;color:#96671f}.button-grid .danger{grid-column:1/-1;background:#fff0ed;color:#ad4e47}.status-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:1px;overflow:hidden}.status-grid article{display:grid;gap:7px;padding:17px;background:#fff}.status-grid span{color:#937f72;font-size:12px}.status-grid strong{font-size:15px}.privacy-note{max-width:760px;margin:14px auto;color:#8b7d74;font-size:12px;line-height:1.6;text-align:center}.empty-card{display:grid;justify-items:center;gap:10px;padding:50px 24px;text-align:center}.empty-card>div:first-child{font-size:52px}.empty-card h2,.empty-card p{margin:0}.empty-card p{color:#8a796e}.empty-card button{padding:0 18px;background:#e9f6f0;color:#3b765e}.spinner{width:36px;height:36px;border:4px solid #eaded5;border-top-color:#dd825f;border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:560px){.connection-card{display:grid;grid-template-columns:1fr 1fr}.connection-title{grid-column:1/-1}.cols-3{grid-template-columns:repeat(2,1fr)}.cols-4{grid-template-columns:repeat(2,1fr)}.status-grid{grid-template-columns:1fr}.remote-head h1{font-size:22px}}
</style>
