<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { platformApi, type Student } from '@/api/platform'
import { resourceApi } from '@/api/resources'
import { useClassroomMobileStore } from '@/stores/classroomMobile'
import type { ClassroomCommandOperation } from '@/services/classroomCommandBus'
import ChildQaPanel from '@/components/classroom/ChildQaPanel.vue'

const router = useRouter()
const mobile = useClassroomMobileStore()
const { session, state, connection, canControl, lastError, lastConfirmedAt, commands } = storeToRefs(mobile)
const students = ref<Student[]>([])
const selectedStudentId = ref(0)
const panel = ref('')
const showMore = ref(false)
const qaActive = ref(false)
const pendingQa = computed(() => playerState.value.childQaAnswerStatus === 'pending')
const mediaLabel = computed(() => ({playing:'播放中',paused:'媒体已暂停',stopped:'已停止',ready:'已就绪'}[String(playerState.value.status)] || '未播放'))
function togglePanel(value: string) { panel.value = panel.value === value ? '' : value }
const busy = ref(false)
const leaving = ref(false)
const exited = ref(false)
const preloadedResourceIds = new Set<number>()

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
const commandStatusLabel = (status: string) => ({
  queued: '待发送', sending: '发送中', received: '已接收，等待执行', executed: '已执行',
  failed: '执行失败', expired: '已过期',
}[status] || status)
const operationLabel = (operation: string) => ({
  previous_step: '上一步', next_step: '下一步', switch_step: '切换步骤',
  open_resource: '打开资源', play_resource: '播放资源', pause_media: '暂停媒体',
  resume_media: '继续媒体', stop_media: '停止媒体', previous_page: '上一页', next_page: '下一页',
  mute: '静音', unmute: '取消静音', start_break: '开始课间', end_break: '结束课间',
  complete_class: '结束课堂', attendance_update: '更新考勤', random_roll_call: '随机点名', reward_student: '奖励幼儿',
}[operation] || operation)

async function loadStudents(classId: number) {
  try {
    const response = await platformApi.students(classId)
    students.value = response.data.items.filter((item) => item.status === 'active')
    if (!selectedStudentId.value && students.value[0]) selectedStudentId.value = students.value[0].id
  } catch {
    students.value = []
  }
}

function preloadUpcomingResources() {
  const steps = classroom.value?.steps ?? []
  const index = classroom.value?.currentStepIndex ?? 0
  const ids = [currentResourceId.value, Number(steps[index + 1]?.resourceId || 0)]
  for (const id of ids) {
    if (!Number.isInteger(id) || id <= 0 || preloadedResourceIds.has(id)) continue
    preloadedResourceIds.add(id)
    void resourceApi.get(id).catch(() => { preloadedResourceIds.delete(id) })
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
    animationKey: 'stars',
  }, '奖励已确认并同步到大屏')
}

async function completeClass() {
  try {
    await ElMessageBox.confirm('确定结束本节课堂吗？结束后手机控制权限立即失效。', '结束课堂', { type: 'warning' })
  } catch { return }
  await send('complete_class', undefined, '课堂已结束')
}

async function leaveRemote() {
  if (leaving.value) return
  leaving.value = true
  try {
    await mobile.revoke()
    exited.value = true
  } finally { leaving.value = false }
}

watch(() => state.value?.attendance.classId, (classId) => {
  if (classId) void loadStudents(classId)
}, { immediate: true })

watch(() => [currentResourceId.value, classroom.value?.currentStepIndex, classroom.value?.steps?.length], preloadUpcomingResources, { immediate: true })

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
      <button v-if="session" class="leave" type="button" :disabled="leaving" @click="leaveRemote">{{ leaving ? '正在退出…' : '退出手机控制' }}</button>
    </header>

    <section class="connection-card" :class="connection">
      <div class="connection-title"><i></i><strong>{{ connectionLabel }}</strong></div>
      <span>大屏：{{ !state ? '未知（未连接）' : state.screen.online ? '在线' : '离线' }}</span>
      <span>{{ classroom?.status === 'paused' ? '课堂已暂停' : classroom?.status === 'running' ? '正在上课' : '课堂状态待同步' }} · {{ state ? elapsed : '--:--' }}</span>
      <button v-if="connection !== 'online' && session" type="button" @click="mobile.start">立即重连</button>
    </section>
    <p v-if="lastError" class="network-error">{{ lastError }}</p>

    <section v-if="!session" class="empty-card">
      <div>📱</div><h2>{{ exited ? '已退出本机遥控' : '请先扫描大屏二维码' }}</h2>
      <p v-if="exited">本节课堂继续进行，本机控制会话已清除。再次控制需要重新授权；网络异常时，服务端撤销状态需重新核实。</p>
      <p>手机控制会话只在当前课堂和当前教师账号下有效。</p>
      <button type="button" @click="router.push('/classroom/scan')">前往扫码配对</button>
      <button type="button" @click="router.push({ name: 'teacher-home' })">返回教师工作台</button>
    </section>

    <template v-else-if="state">
      <section class="now-card">
        <div><span>当前步骤</span><strong>{{ (classroom?.currentStepIndex ?? 0) + 1 }} / {{ classroom?.steps?.length || 0 }}</strong></div>
        <h2>{{ currentStep?.title || '课堂准备' }}</h2>
        <details><summary>本环节教学提示</summary><p>{{ currentStep?.content || '等待教师开始课堂内容' }}</p></details>
        <div class="button-grid cols-2">
          <button :disabled="busy || !canControl" @click="send('previous_step')">← 上一步</button>
          <button :disabled="busy || !canControl" @click="send('next_step')">下一步 →</button>
        </div>
        <div class="resource-line">
          <span>当前资源</span>
          <b>{{ currentResourceId ? `资源 #${currentResourceId}` : '未打开' }}</b>
          <em>{{ mediaLabel }}</em>
        </div>
        <div v-if="['avatar','digital_human','child_qa'].includes(currentStep?.type || '')" class="digital-human-step" aria-label="数字人当前教学提示">
          <strong>数字人教学提示</strong><p>{{ currentStep?.teacherTip || currentStep?.content || '请结合本环节教案引导孩子观察和表达。' }}</p>
        </div>
      </section>

      <nav class="quick-tools button-grid cols-4" aria-label="课堂快捷功能">
        <button @click="togglePanel('students')" :aria-expanded="panel === 'students'">🎲 点名</button>
        <button @click="togglePanel('students')" :aria-expanded="panel === 'students'">🌸 奖励</button>
        <button @click="togglePanel('qa')" :aria-expanded="panel === 'qa'">问答{{ pendingQa ? ' · 待审核' : '' }}</button>
        <button @click="togglePanel('voice')" :aria-expanded="panel === 'voice'">语音控制</button>
      </nav>
      <p v-if="pendingQa || qaActive" class="qa-reminder" role="status"><button @click="panel = 'qa'">{{ pendingQa ? '有儿童问题待教师审核，点击处理' : '儿童问答进行中，点击管理或结束' }}</button></p>
      <section v-show="panel === 'voice'" class="control-card"><h2>教师语音控制</h2><p>手机端暂不支持教师语音识别。请在电脑课堂页开启语音控制；手机仍可使用点名、奖励和问答按钮。</p></section>
      <section v-if="classroom" v-show="panel === 'qa' || pendingQa" class="control-card" aria-label="数字人和儿童问答">
        <h2>数字人课堂互动</h2>
        <details><summary>数字人状态与使用说明</summary><p>数字人沿用本班身份。儿童问答需教师显式开启和审核，手机不自动开启麦克风。{{ classroom.manualInterventionRequired ? '请先在电脑端恢复课堂。' : '' }}</p></details>
        <ChildQaPanel @active="qaActive = $event" :run-id="classroom.id" :step-index="classroom.currentStepIndex" :identity="JSON.stringify([classroom.id,classroom.deviceId,classroom.currentStepIndex])" :allowed="canControl && classroom.status === 'running' && !classroom.breakStartedAt && !classroom.manualInterventionRequired" :speaking="false" mobile :step-config="currentStep?.actionConfig" />
      </section>

      <details v-show="showMore" class="control-card" open><summary>媒体与资源</summary>
        <div class="button-grid cols-3">
          <button :disabled="busy || !canControl || !currentResourceId" @click="send('play_resource', { resourceId: currentResourceId })">▶ 播放</button>
          <button :disabled="busy || !canControl" @click="send('pause_media')">暂停媒体</button>
          <button :disabled="busy || !canControl" @click="send('resume_media')">继续媒体</button>
          <button :disabled="busy || !canControl" @click="send('previous_page')">上一页</button>
          <button :disabled="busy || !canControl" @click="send('next_page')">下一页</button>
        </div>
      </details>

      <section v-show="panel === 'students' || showMore" class="control-card">
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
          <button :disabled="busy || !canControl || !selectedStudentId" @click="send('specified_roll_call', { studentId: selectedStudentId })">指定点名</button>
          <button class="reward" :disabled="busy || !canControl || !selectedStudentId" @click="reward">🌸 奖励幼儿</button>
        </div>
      </section>

      <details v-show="showMore" class="control-card"><summary>课间与课堂</summary>
        <div class="button-grid cols-2">
          <button :disabled="busy || !canControl" @click="send('start_break', { durationSeconds: 300, contentType: 'water' })">开始 5 分钟课间</button>
          <button :disabled="busy || !canControl" @click="send('end_break')">提前结束课间</button>
          <button class="danger" :disabled="busy || !canControl" @click="completeClass">结束课堂</button>
        </div>
      </details>

      <section v-show="showMore" class="status-grid">
        <article><span>最近点名</span><strong>{{ state.recentRollCall?.displayName || '暂无' }}</strong></article>
        <article><span>最近奖励</span><strong>{{ state.recentReward?.displayName || '暂无' }}</strong></article>
        <article><span>幼儿互动</span><strong>{{ interactionSummary }}</strong></article>
        <article><span>送达状态</span><strong>{{ lastConfirmedAt ? '服务端已确认' : '暂无操作' }}</strong></article>
      </section>
      <section v-show="showMore" v-if="commands.length" class="control-card command-history">
        <div class="command-history-head"><h2>最近指令</h2><span>以服务端回执为准</span></div>
        <ul>
          <li v-for="command in commands.slice(0, 6)" :key="command.commandId">
            <span>{{ operationLabel(command.operation) }}</span>
            <strong :class="`status-${command.executionStatus}`">{{ commandStatusLabel(command.executionStatus) }}</strong>
            <small v-if="command.errorCode">{{ command.errorCode }}</small>
          </li>
        </ul>
      </section>
      <nav class="remote-dock" aria-label="常用课堂控制">

        <div class="button-grid cols-4">
          <button class="accent" :disabled="busy || !canControl || !['running', 'paused'].includes(classroom?.status || '')" @click="send(classroom?.status === 'paused' ? 'resume_class' : 'pause_class')">{{ classroom?.status === 'paused' ? '继续课堂' : '暂停课堂' }}</button>
          <button :disabled="busy || !canControl" @click="send(playerState.muted ? 'unmute' : 'mute')">{{ playerState.muted ? '取消静音' : '静音' }}</button>
          <button :disabled="busy || !canControl" @click="send('stop_media')">停止媒体</button>
          <button @click="showMore = !showMore" :aria-expanded="showMore">更多工具</button>
        </div>
      </nav>
      <p class="privacy-note">局域网实时通道只传递当前课堂状态，不在二维码中包含教师 Token 或幼儿信息。</p>
    </template>

    <section v-else class="empty-card"><div class="spinner"></div><h2>正在拉取服务端课堂状态</h2></section>
  </main>
</template>

<style scoped>
.mobile-remote{min-height:100dvh;box-sizing:border-box;padding:18px;background:linear-gradient(150deg,#fff8ee,#edf8f3);color:#50443d}.remote-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;max-width:780px;margin:auto}.eyebrow{color:#d87959;font-size:12px;font-weight:900;letter-spacing:.12em}.remote-head h1{margin:5px 0 0;font-size:26px}.leave{border:0;border-radius:12px;padding:10px 14px;background:#fff;color:#8c6b5c;box-shadow:0 8px 22px #76543812}.connection-card,.now-card,.control-card,.empty-card,.status-grid{max-width:780px;margin:14px auto 0;box-sizing:border-box;border:1px solid #eadccf;border-radius:20px;background:#fffefa;box-shadow:0 12px 36px #76543810}.connection-card{display:flex;align-items:center;gap:16px;padding:13px 16px;color:#61786d;font-size:13px}.connection-title{display:flex;align-items:center;gap:8px;margin-right:auto}.connection-title i{width:10px;height:10px;border-radius:50%;background:#56b886;box-shadow:0 0 0 5px #56b8861c}.connection-card.reconnecting i,.connection-card.connecting i{background:#e2a24b}.connection-card.offline i,.connection-card.expired i{background:#d75d57}.connection-card button{border:0;background:#e9f5ef;color:#37775c;border-radius:9px;padding:7px 10px}.network-error{max-width:750px;margin:10px auto 0;padding:10px 14px;border-radius:11px;background:#fff0ed;color:#a64c46}.now-card{padding:20px}.now-card>div:first-child{display:flex;justify-content:space-between;color:#8f7c70;font-size:13px}.now-card h2{margin:12px 0 7px;font-size:24px}.now-card p{margin:0;color:#85766d;line-height:1.55}.resource-line{display:flex;align-items:center;gap:10px;margin-top:15px;padding:12px;border-radius:13px;background:#f0f8f4}.resource-line span{color:#678072;font-size:12px}.resource-line b{flex:1}.resource-line em{font-size:11px;font-style:normal;color:#d27858}.control-card{padding:18px}.control-card h2{margin:0 0 14px;font-size:18px}.button-grid{display:grid;gap:9px;margin-top:10px}.cols-2{grid-template-columns:repeat(2,1fr)}.cols-3{grid-template-columns:repeat(3,1fr)}.cols-4{grid-template-columns:repeat(4,1fr)}.button-grid button,.control-card select,.empty-card button{min-height:44px;border:1px solid #ecd9cb;border-radius:12px;background:#fff;color:#68554b;font:inherit;font-weight:750}.button-grid button:active{transform:scale(.98)}.button-grid button:disabled{opacity:.42}.control-card select{width:100%;padding:0 12px}.button-grid .accent{background:#eaf7f1;color:#36785d}.button-grid .reward{background:#fff2cd;color:#96671f}.button-grid .danger{grid-column:1/-1;background:#fff0ed;color:#ad4e47}.status-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:1px;overflow:hidden}.status-grid article{display:grid;gap:7px;padding:17px;background:#fff}.status-grid span{color:#937f72;font-size:12px}.status-grid strong{font-size:15px}.privacy-note{max-width:760px;margin:14px auto;color:#8b7d74;font-size:12px;line-height:1.6;text-align:center}.empty-card{display:grid;justify-items:center;gap:10px;padding:50px 24px;text-align:center}.empty-card>div:first-child{font-size:52px}.empty-card h2,.empty-card p{margin:0}.empty-card p{color:#8a796e}.empty-card button{padding:0 18px;background:#e9f6f0;color:#3b765e}.spinner{width:36px;height:36px;border:4px solid #eaded5;border-top-color:#dd825f;border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:560px){.connection-card{display:grid;grid-template-columns:1fr 1fr}.connection-title{grid-column:1/-1}.cols-3{grid-template-columns:repeat(2,1fr)}.cols-4{grid-template-columns:repeat(2,1fr)}.status-grid{grid-template-columns:1fr}.remote-head h1{font-size:22px}}
.command-history-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.command-history-head h2{margin:0}.command-history-head span,.command-history li small{color:#9a7e70;font-size:12px}.command-history ul{display:grid;gap:8px;margin:12px 0 0;padding:0;list-style:none}.command-history li{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:10px;background:#fff8f0}.command-history li span{flex:1}.command-history li strong{font-size:12px}.status-executed{color:#3f835b}.status-sending,.status-received,.status-queued{color:#aa7527}.status-failed,.status-expired{color:#b5514b}
.mobile-remote{padding:12px 12px calc(96px + env(safe-area-inset-bottom));font-size:14px}.remote-head{gap:8px;align-items:center}.remote-head h1{font-size:18px;line-height:1.45;overflow-wrap:anywhere}.leave{flex:none;font-size:12px;padding:10px;max-width:95px;min-height:44px}.connection-card{margin-top:10px;padding:10px;display:flex;flex-wrap:wrap;gap:8px;font-size:12px}.connection-title{margin:0}.connection-title i{box-shadow:none}.now-card,.control-card{padding:14px;border-radius:16px;margin-top:12px}.now-card h2{font-size:19px;margin:8px 0}.resource-line{margin-top:10px;padding:8px;flex-wrap:wrap}.quick-tools{max-width:780px;margin:12px auto 0}.cols-4{grid-template-columns:repeat(4,minmax(0,1fr))}.quick-tools button,.remote-dock button,.qa-reminder button{min-height:48px;font-size:13px;border:1px solid #ecd9cb;border-radius:12px;background:#fffefa;color:#68554b;padding:8px 4px}.button-grid button{min-width:0;white-space:normal;overflow-wrap:anywhere}.remote-dock{position:fixed;z-index:20;bottom:0;left:0;right:0;padding:8px 12px calc(8px + env(safe-area-inset-bottom));background:#fffefa;border-top:1px solid #eadccf;box-shadow:0 -4px 20px #76543810}.remote-dock .button-grid{max-width:780px;margin:0 auto;gap:6px}.remote-dock .accent{background:#eaf7f1}.qa-reminder{max-width:780px;margin:10px auto 0}.qa-reminder button{width:100%;color:#96671f;background:#fff2cd}summary{cursor:pointer;min-height:32px;line-height:32px;font-weight:700}.now-card details p{margin:8px 0}.control-card :deep(.child-qa-panel){margin-top:10px;padding:10px}.control-card :deep(.child-qa-panel button){min-height:44px;border:1px solid #ecd9cb;border-radius:10px;background:#fffefa;color:#68554b;font:inherit}.control-card :deep(.child-qa-panel small){font-size:12px}.status-grid{grid-template-columns:1fr 1fr}.network-error{overflow-wrap:anywhere}.mobile-remote :deep(input){font-size:16px;min-width:0}button:focus-visible,summary:focus-visible{outline:2px solid #d87959;outline-offset:2px}.attendance-buttons{grid-template-columns:repeat(2,1fr)}
</style>
