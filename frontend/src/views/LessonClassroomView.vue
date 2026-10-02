<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { ElButton, ElMessage, ElMessageBox, ElTag } from 'element-plus'
import { apiErrorMessage, http } from '@/api/http'
import ResourcePlayer from '@/components/ResourcePlayer.vue'
import ClassroomHeader from '@/components/classroom/ClassroomHeader.vue'
import ClassroomStepSidebar from '@/components/classroom/ClassroomStepSidebar.vue'
import ClassroomControlBar from '@/components/classroom/ClassroomControlBar.vue'
import ClassroomAssistantPanel from '@/components/classroom/ClassroomAssistantPanel.vue'
import ClassroomVoiceControl from '@/components/classroom/ClassroomVoiceControl.vue'
import ClassroomPartnerPanel from '@/components/classroom/ClassroomPartnerPanel.vue'
import ClassRewardDrawer from '@/components/classroom/ClassRewardDrawer.vue'
import { useLessonRunStore } from '@/stores/lessonRun'
import { useClassroomAssistantStore, type AssistantTool } from '@/stores/classroomAssistant'
import { useCourseResourceStore } from '@/stores/courseResource'
import { useDigitalHumanStore } from '@/stores/digitalHuman'
import { isRecordingSupported, webmToWav, RECORDING_MIME_TYPE } from '@/services/recordingAudio'
import {
  AI_COMMAND_FAILURE_HINT,
  AI_COMMAND_PENDING_HINT,
} from '@/classroom/command/classroomAiFallback'
import {
  orchestrateCommand,
  type CommandRuntimeExecutors,
} from '@/classroom/command/commandRuntime'
import { DeviceCommandExecutor } from '@/classroom/command/DeviceCommandExecutor'
import {
  asrRecognizeWav,
  createClassroomVoiceRecorder,
  runAsrTextThroughCommand,
} from '@/services/voiceCommand'
import { ClassroomCommandExecutor } from '@/classroom/command/ClassroomCommandExecutor'
import { useClassroomCommandStore } from '@/stores/classroomCommand'
import { useResourcePlayerStore } from '@/stores/resourcePlayer'
import ResourceCandidatePanel from '@/components/classroom/ResourceCandidatePanel.vue'
import { resolveExecuteAction } from '@/classroom/command/ResourceCommandCoordinator'
import type { ResourceCommandResult } from '@/classroom/command/ResourceCommand'
import type { CourseResource } from '@/stores/courseResource'
import {
  listRunRewards,
  type RewardRecord,
} from '@/services/classroomCheckpoint'

const route = useRoute(); const router = useRouter(); const store = useLessonRunStore(); const assistant = useClassroomAssistantStore(); const resources = useCourseResourceStore()
const digitalHuman = useDigitalHumanStore()
const classroomCommand = useClassroomCommandStore()
const resourcePlayer = useResourcePlayerStore()
const commandExecutor = new ClassroomCommandExecutor(store, resourcePlayer)
const deviceExecutor = new DeviceCommandExecutor(resourcePlayer)
const commandExecutors: CommandRuntimeExecutors = {
  classroom: commandExecutor,
  device: deviceExecutor,
}
const { run, currentStep, currentResource, progress, elapsedSeconds, loading, busy, error, isBreakActive, breakRemainingSeconds } = storeToRefs(store)
const { draftReply, teacherTip, loading: assistantLoading, attemptCount, requiresTeacherConfirmation } = storeToRefs(assistant)
const { roleName: dhRoleName } = storeToRefs(digitalHuman)
const teacherPrompt = ref(''); const childReply = ref(''); const assistantEnabled = ref(false)
const commandInput = ref(''); const commandFeedback = ref(''); const commandRunId = ref(0); const commandBusy = ref(false)
// Stage 6.5：资源命令（search/open/play）的待确认结果；教师确认/取消前绝不产生播放器副作用。
const resourceCommandResult = ref<ResourceCommandResult | null>(null)
const voiceRecState = ref<'idle' | 'recording' | 'recognizing'>('idle'); const voiceFeedback = ref('')
const assistantSpeechLoading = ref(false); const assistantSpeaking = ref(false); const draftAccepted = ref(false)
let assistantAudio: HTMLAudioElement | null = null
const childRecording = ref(false); const childRequestingMicrophone = ref(false); const childRecognizing = ref(false)
let childMediaRecorder: MediaRecorder | null = null; let childMediaStream: MediaStream | null = null; let childAudioChunks: Blob[] = []; let childRecordingGeneration = 0; let componentUnmounted = false
// 左侧环节导航折叠：纯前端状态，禁止调用 backend / 修改 ClassroomRun / snapshot。较窄屏幕默认收起。
const stepSidebarCollapsed = ref(window.innerWidth < 1280)
// Stage 7.3：本节课奖励入口（drawer 展示独立 RewardRecord，X 为累计星星数）。
const rewards = ref<RewardRecord[]>([])
const runRewardTotal = ref(0)
const rewardDrawerOpen = ref(false)
const rewardsLoading = ref(false)
async function loadRewards() {
  const current = run.value
  if (!current) return
  rewardsLoading.value = true
  try {
    const payload = await listRunRewards(current.id)
    rewards.value = payload.items
    runRewardTotal.value = payload.items.reduce((sum, r) => sum + r.stars, 0)
  } catch {
    rewards.value = []
    runRewardTotal.value = 0
  } finally {
    rewardsLoading.value = false
  }
}
async function openRewardDrawer() {
  await loadRewards()
  rewardDrawerOpen.value = true
}
const isActive = computed(() => run.value?.status === 'running' || run.value?.status === 'paused')
const paused = computed(() => run.value?.status === 'paused')
const breakTimeText = computed(() => { const total = breakRemainingSeconds.value; return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}` })
const childVoiceStatus = computed(() => childRequestingMicrophone.value ? '正在请求麦克风权限…' : childRecording.value ? '录音中，请让孩子说话，说完再点一次' : childRecognizing.value ? '正在识别孩子的回答…' : '')
const typeText: Record<string,string> = { introduction:'导入', teacher_talk:'教师讲述', question:'提问互动', resource:'课程资源', activity:'集体活动', transition:'环节过渡', summary:'课堂总结' }
const ageGroupMap = { '3-4':'small', '4-5':'middle', '5-6':'large' } as const
const dhActionLabel: Record<string, string> = { idle:'待机', listen:'倾听', thinking:'思考', talk:'说话', happy:'高兴', question:'提问', encourage:'鼓励', praise:'表扬', wave:'挥手', goodbye:'再见' }
const dhActionText = computed(() => dhActionLabel[digitalHuman.action] ?? '待机')
const micReady = computed(() => isRecordingSupported())
const assistantOnline = computed(() => assistant.active)
async function safe(task: () => Promise<void>) { try { await task() } catch (e) { ElMessage.error(e instanceof Error ? e.message : '操作失败，请检查网络后重试') } }
async function goToStep(index: number) { if (!run.value || index === run.value.currentStepIndex) return; await safe(() => store.move(index)) }
async function finish(kind: 'complete' | 'cancel') { const text = kind === 'complete' ? '确认结束并完成本次课堂吗？' : '确认中止本次课堂吗？教案不会被删除。'; try { await ElMessageBox.confirm(text, kind === 'complete' ? '结束课堂' : '中止课堂', { type:'warning', confirmButtonText:'确认', cancelButtonText:'继续上课' }) } catch { return } digitalHuman.transition({ type: 'lesson_end' }); await safe(async () => { await (kind === 'complete' ? store.complete() : store.cancel()); store.clear(); await router.push('/lesson-plans') }) }
async function runCommand() {
  const text = commandInput.value.trim()
  if (!text) return
  const runId = ++commandRunId.value
  commandFeedback.value = ''
  commandBusy.value = true
  resourceCommandResult.value = null
  commandFeedback.value = AI_COMMAND_PENDING_HINT
  try {
    const outcome = await orchestrateCommand({
      text,
      runId,
      body: {
        text,
        context: {
          currentPage: 'resources',
          currentResourceId: currentResource.value?.id ?? undefined,
          playerStatus: resourcePlayer.playerStatus,
          ageGroup: run.value?.ageGroup || undefined,
        },
      },
      executors: commandExecutors,
      deps: {
        // 与语音路径一致：http.post 返回 axios response，统一解包到 payload，保证文本/语音同一条管线。
        post: async (url, body, config) => (await http.post(url, body, config)).data,
        // 迟到响应防护：请求已失效（超时在此期间 / 用户又发起新指令）时不执行。
        isCurrent: (id) => id === commandRunId.value,
      },
    })
    if (runId !== commandRunId.value) return
    if (outcome.kind === 'device_executed') {
      // 媒体命令：反馈真实结果（executed=false 时为“未执行”原因，不显式假成功）。
      commandFeedback.value = outcome.message
      return
    }
    if (outcome.kind === 'executed') {
      commandFeedback.value = `${outcome.intent} → ${outcome.message}`
      return
    }
    if (outcome.kind === 'resource_pending') {
      // 资源命令：进入教师确认流程（候选区域展示）。未确认前不打开/不播放。
      commandFeedback.value = outcome.result.reply
      resourceCommandResult.value =
        outcome.result.candidates.length > 0 ? outcome.result : null
      return
    }
    if (outcome.kind === 'unsupported') {
      // 白名单外的 intent（open_chat/open_resources/start_activity 等）属后续阶段，
      // 明确 unsupported/deferred，绝不自动执行。
      commandFeedback.value = `AI 判读为 ${outcome.intent}，该指令不属于本阶段已批准范围，未执行（交由后续指令系统接入）。`
      classroomCommand.feedback = outcome.reply ?? ''
      return
    }
    // failed：超时 / 网络错误 / 5xx / 格式非法 / 疑问否定安全句 —— 统一安全失败，不执行。
    commandFeedback.value = outcome.hint
  } catch {
    if (runId === commandRunId.value) commandFeedback.value = AI_COMMAND_FAILURE_HINT
  } finally {
    if (runId === commandRunId.value) commandBusy.value = false
  }
}
// ─── 语音控制课堂（Stage 6.3）：明确入口，复用现有录音编排 + ASR + Command Runtime ───
// 录音 session 使用共享 createClassroomVoiceRecorder，与 ChatView 现有 push-to-talk 编排一致，
// 不复制第三份 MediaRecorder 逻辑；识别文本送入已有 runAsrTextThroughCommand（同一套 Router/Executor/fallback）。
async function runVoiceCommand(audioBlob: Blob) {
  const runId = ++commandRunId.value
  voiceRecState.value = 'recognizing'
  resourceCommandResult.value = null
  try {
    const text = await asrRecognizeWav(audioBlob, async (url, body, config) => (await http.post(url, body, config)).data)
    if (runId !== commandRunId.value || componentUnmounted) return
    if (!text) {
      voiceFeedback.value = '没有听清，请再说一次。'
      return
    }
    voiceFeedback.value = `识别到：“${text}”`
    const outcome = await runAsrTextThroughCommand(
      text,
      runId,
      {
        currentPage: 'resources',
        currentResourceId: typeof currentResource.value?.id === 'string' ? currentResource.value.id : undefined,
        playerStatus: resourcePlayer.playerStatus,
        ageGroup: run.value?.ageGroup || undefined,
      },
      commandExecutors,
      {
        // 迟到响应防护：runId 已失效（超时/用户又发起新指令/组件卸载）时不执行。
        post: async (url, body, config) => (await http.post(url, body, config)).data,
        isCurrent: (id) => id === commandRunId.value && !componentUnmounted,
      },
    )
    if (runId !== commandRunId.value || componentUnmounted) return
    if (outcome.kind === 'device_executed') {
      // 语音媒体命令：反馈真实结果（executed=false 时为“未执行”原因）。
      voiceFeedback.value = outcome.message
      return
    }
    if (outcome.kind === 'executed') {
      voiceFeedback.value = `${outcome.intent} → ${outcome.message}`
      return
    }
    if (outcome.kind === 'resource_pending') {
      // 资源命令（语音与文本共用 commandRuntime）：进入教师确认流程，未确认前不打开/不播放。
      voiceFeedback.value = outcome.result.reply
      resourceCommandResult.value =
        outcome.result.candidates.length > 0 ? outcome.result : null
      return
    }
    if (outcome.kind === 'unsupported') {
      voiceFeedback.value = `AI 判读为 ${outcome.intent}，该指令不属于本阶段已批准范围，未执行。`
      return
    }
    // failed：ASR 空文本 / AI fallback 超时 / 网络 / 5xx —— 统一安全失败，不执行。
    voiceFeedback.value = outcome.hint
  } catch (e) {
    if (runId === commandRunId.value && !componentUnmounted) voiceFeedback.value = apiErrorMessage(e, '语音识别失败，请稍后重试。')
  } finally {
    if (runId === commandRunId.value && !componentUnmounted) voiceRecState.value = 'idle'
  }
}
// ─── 资源命令教师确认（Stage 6.5）──────────────
// 硬约束：search/open/play 资源命令在教师确认前不产生任何播放器副作用。
// 确认 → 统一走 resourcePlayer.openResource（protected download 链路）；
// 取消 → 清空候选，无副作用。
function confirmResourceCommand(resource: CourseResource) {
  const result = resourceCommandResult.value
  if (!result) return
  const action = resolveExecuteAction(result.intent, resource)
  resourcePlayer.openResource(resource, action.autoPlay)
  const actionWord = action.autoPlay ? '播放' : '打开'
  commandFeedback.value = `已${actionWord}《${resource.title}》。${action.note ?? ''}`
  resourceCommandResult.value = null
}
function cancelResourceCommand() {
  if (!resourceCommandResult.value) return
  resourceCommandResult.value = null
  commandFeedback.value = '已取消，未执行任何资源操作。'
}
const voiceRecorder = createClassroomVoiceRecorder({
  onBlob: (blob) => void runVoiceCommand(blob),
  onError: (error) => {
    voiceRecState.value = 'idle'
    voiceFeedback.value = error.message
  },
})
async function toggleVoiceRecording() {
  if (voiceRecState.value === 'recording') {
    voiceRecorder.stop()
    return
  }
  // 防重复点击：录音中/识别中/课堂忙时不允许开新 session。
  // 注意：课堂暂停时仍允许发起“继续上课/下一步”等语音命令，故不拦截 paused。
  if (voiceRecState.value !== 'idle' || busy.value) return
  voiceFeedback.value = ''
  voiceRecState.value = 'recording'
  try {
    await voiceRecorder.start()
  } catch (e) {
    voiceRecState.value = 'idle'
    voiceFeedback.value = e instanceof Error ? e.message : '无法使用麦克风，请稍后重试。'
  }
}
async function askAssistant(tool?: AssistantTool, useTeacherPrompt = false) { const teacherText = teacherPrompt.value.trim(); const childText = childReply.value.trim(); const text = useTeacherPrompt ? teacherText : childText || currentStep.value?.content || ''; if (!text) return ElMessage.warning(useTeacherPrompt ? '请先输入老师的问题或要求' : '当前没有可用于引导的课堂内容'); try { await assistant.ask(text, useTeacherPrompt || !childText ? 'teacher' : 'child', tool); if (useTeacherPrompt) teacherPrompt.value = ''; else childReply.value = '' } catch (e) { ElMessage.error(e instanceof Error ? e.message : '课堂助教暂时不可用') } }
function stopChildMediaTracks() { childMediaStream?.getTracks().forEach((track) => track.stop()); childMediaStream = null }
function cancelChildRecording() { childRecordingGeneration += 1; if (childMediaRecorder?.state === 'recording') childMediaRecorder.stop(); childMediaRecorder = null; childAudioChunks = []; childRecording.value = false; childRequestingMicrophone.value = false; childRecognizing.value = false; stopChildMediaTracks() }
async function recognizeChildReply(audioBlob: Blob, generation: number) { try { if (!audioBlob.size) throw new Error('没有录到声音，请重新录制。'); childRecognizing.value = true; const wavBlob = await webmToWav(audioBlob); if (generation !== childRecordingGeneration || componentUnmounted) return; const formData = new FormData(); formData.append('file', wavBlob, `child-reply-${Date.now()}.wav`); const { data } = await http.post<{ text: string }>('/ai/asr', formData); if (generation !== childRecordingGeneration || componentUnmounted) return; const text = typeof data.text === 'string' ? data.text.trim() : ''; if (!text) throw new Error('没有识别到孩子的话，请靠近麦克风再试一次。'); childReply.value = text; ElMessage.success('已识别孩子的回答，请选择下方引导方式') } catch (e) { if (generation === childRecordingGeneration && !componentUnmounted) ElMessage.error(apiErrorMessage(e, '语音识别失败，请稍后重试。')) } finally { if (generation === childRecordingGeneration) childRecognizing.value = false } }
async function startChildRecording() { if (!isRecordingSupported()) throw new Error('当前浏览器不支持麦克风录音，请使用最新版 Chrome 或 Edge。'); childRequestingMicrophone.value = true; const generation = ++childRecordingGeneration; try { const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); if (generation !== childRecordingGeneration || componentUnmounted) { stream.getTracks().forEach((track) => track.stop()); return } const recorder = new MediaRecorder(stream, { mimeType: RECORDING_MIME_TYPE }); childMediaStream = stream; childMediaRecorder = recorder; childAudioChunks = []; recorder.addEventListener('dataavailable', (event: BlobEvent) => { if (event.data.size > 0) childAudioChunks.push(event.data) }); recorder.addEventListener('stop', () => { const audioBlob = new Blob(childAudioChunks, { type: RECORDING_MIME_TYPE }); childAudioChunks = []; childMediaRecorder = null; stopChildMediaTracks(); if (generation === childRecordingGeneration && !componentUnmounted) void recognizeChildReply(audioBlob, generation) }, { once: true }); recorder.addEventListener('error', () => { childRecording.value = false; childMediaRecorder = null; stopChildMediaTracks(); ElMessage.error('录音发生错误，请重新尝试。') }, { once: true }); recorder.start(); childRecording.value = true } catch (e) { stopChildMediaTracks(); if (e instanceof DOMException && e.name === 'NotAllowedError') throw new Error('麦克风权限被拒绝，请在浏览器设置中允许使用麦克风。', { cause: e }); throw e } finally { childRequestingMicrophone.value = false } }
function stopChildRecording() { if (!childMediaRecorder || childMediaRecorder.state === 'inactive') return; childRecording.value = false; childRecognizing.value = true; childMediaRecorder.stop() }
async function toggleChildRecording() { if (childRecording.value) return stopChildRecording(); if (childRequestingMicrophone.value || childRecognizing.value || assistantLoading.value) return; try { await startChildRecording() } catch (e) { ElMessage.error(e instanceof Error ? e.message : '无法使用麦克风，请稍后重试。') } }
function stopAssistantSpeech() { if (assistantAudio) { assistantAudio.pause(); assistantAudio.src = ''; assistantAudio = null } assistantSpeechLoading.value = false; assistantSpeaking.value = false }
async function playAssistantDraft() { const text = draftReply.value.trim(); if (!text || requiresTeacherConfirmation.value) return; stopAssistantSpeech(); assistantSpeechLoading.value = true; digitalHuman.transition({ type: 'tts_start' }); try { const { data } = await http.post<{ audioUrl: string }>('/ai/tts', { text }); if (typeof data.audioUrl !== 'string' || !data.audioUrl.trim()) throw new Error('语音服务没有返回可播放内容'); const audio = new Audio(data.audioUrl.trim()); assistantAudio = audio; const release = () => { if (assistantAudio === audio) { stopAssistantSpeech(); digitalHuman.transition({ type: 'tts_end' }) } }; audio.addEventListener('ended', release, { once: true }); audio.addEventListener('error', release, { once: true }); await audio.play(); assistantSpeaking.value = true; draftAccepted.value = true } catch (e) { stopAssistantSpeech(); digitalHuman.transition({ type: 'tts_end' }); digitalHuman.setFallback('语音暂时不可用'); ElMessage.error(apiErrorMessage(e, '助教语音播放失败，请稍后重试。')) } finally { assistantSpeechLoading.value = false } }
function acceptDraftAsText() { draftAccepted.value = true; digitalHuman.transition({ type: 'ai_response', emotion: 'encourage' }); ElMessage.success('已由教师确认，可自行讲述给孩子听') }
function discardAssistantDraft() { stopAssistantSpeech(); digitalHuman.transition({ type: 'settle' }); draftAccepted.value = false; assistant.endInteraction() }
function beforeUnload(event: BeforeUnloadEvent) { if (!isActive.value) return; event.preventDefault(); event.returnValue = '' }
onBeforeRouteLeave(() => !isActive.value || window.confirm('课堂仍在进行中，确定离开吗？进度已由后端保存。'))
watch(currentStep, (step, previous) => {
  if (!run.value || !step) return
  if (previous && previous.stepIndex !== step.stepIndex) { assistant.endInteraction(); cancelChildRecording(); childReply.value = ''; digitalHuman.transition({ type: 'step_change' }) }
  assistant.activate()
  assistant.ageGroup = ageGroupMap[run.value.ageGroup as keyof typeof ageGroupMap] ?? 'middle'
  assistant.theme = run.value.lessonTitle
  if (run.value.lessonObjectives) assistant.objective = run.value.lessonObjectives
  assistant.currentStep = `${step.title}：${step.content}`
})
watch(currentResource, (resource) => {
  // 资源环节打开时数字人缩小到角落，避免遮挡课件；其他环节恢复主展示状态。
  digitalHuman.setCompact(Boolean(resource))
}, { immediate: true })
watch(draftReply, () => { draftAccepted.value = false; stopAssistantSpeech() })
// Stage 7.3：run 就绪后自动加载本节课奖励汇总（X 计数）。
watch(run, (current) => {
  if (current?.id) void loadRewards()
})
onMounted(async () => { window.addEventListener('beforeunload', beforeUnload); await store.load(Number(route.params.runId)).catch(() => undefined); store.startPolling() })
onBeforeUnmount(() => { store.stopPolling(); componentUnmounted = true; window.removeEventListener('beforeunload', beforeUnload); cancelChildRecording(); voiceRecorder.cancel(); stopAssistantSpeech(); digitalHuman.reset(); assistant.endInteraction() })
</script>

<template>
  <main class="classroom">
    <div v-if="loading" class="center">正在恢复课堂…</div>
    <div v-else-if="error" class="center error">{{ error }}<ElButton @click="router.push('/lesson-plans')">返回教案列表</ElButton></div>
    <!-- Stage 7.4：课间休息。isBreakActive 为 true 时隐藏推进教学的 workspace/ControlBar，仅展示倒计时与提前结束 -->
    <div v-else-if="run && isBreakActive" class="break-mode" data-test="break-mode">
      <div class="break-card">
        <span class="break-emoji">☕</span>
        <h1>课间休息</h1>
        <div class="break-time" data-test="break-countdown">{{ breakTimeText }}</div>
        <p class="break-muted">让幼儿喝水、如厕，放松休息</p>
        <ElButton size="large" :disabled="busy" @click="safe(store.endBreak)">
          {{ busy ? '处理中…' : '提前结束课间' }}
        </ElButton>
      </div>
    </div>
    <template v-else-if="run && currentStep && isActive">
      <ClassroomHeader
        :lesson-title="run.lessonTitle"
        :step-title="currentStep.title"
        :paused="paused"
        :current-step-index="run.currentStepIndex"
        :total-steps="run.steps.length"
        :elapsed-seconds="elapsedSeconds"
        :step-minutes="Math.ceil(currentStep.durationSeconds / 60)"
        :progress="progress"
      />
      <div class="workspace">
        <ClassroomStepSidebar
          :steps="run.steps"
          :current-step-index="run.currentStepIndex"
          :paused="paused"
          :busy="busy"
          :collapsed="stepSidebarCollapsed"
          @go-step="goToStep"
          @toggle-collapse="stepSidebarCollapsed = !stepSidebarCollapsed"
        />
        <section class="center-panel">
          <div class="center-scroll">
            <section class="step-card">
              <ElTag effect="light" class="step-type-tag">{{ typeText[currentStep.type] ?? currentStep.type }}</ElTag>
              <h2 class="step-heading">{{ currentStep.title }}</h2>
              <p class="instruction">{{ currentStep.content }}</p>
              <div v-if="currentStep.expectedResponse" class="assist-block">
                <small>预期回答</small>
                <p>{{ currentStep.expectedResponse }}</p>
              </div>
              <div v-if="currentStep.teacherTip" class="assist-block tip">
                <small>教师提示</small>
                <p>{{ currentStep.teacherTip }}</p>
              </div>
              <div v-if="currentStep.type === 'resource'" class="resource-card">
                <div>
                  <strong>{{ currentResource?.title ?? '资源已失效' }}</strong>
                  <p>{{ currentResource ? '点击后打开现有统一播放器，不会自动播放。' : '该资源已删除或无权访问，可继续切换其他环节。' }}</p>
                </div>
                <ElButton type="primary" size="large" :disabled="!currentResource" @click="store.openResource">打开资源</ElButton>
              </div>
            </section>
            <ClassroomAssistantPanel
              v-model:teacher-prompt="teacherPrompt"
              v-model:child-reply="childReply"
              v-model:draft-reply="draftReply"
              :enabled="assistantEnabled"
              :child-voice-status="childVoiceStatus"
              :assistant-loading="assistantLoading"
              :child-recording="childRecording"
              :child-requesting-microphone="childRequestingMicrophone"
              :child-recognizing="childRecognizing"
              :teacher-tip="teacherTip"
              :requires-teacher-confirmation="requiresTeacherConfirmation"
              :assistant-speech-loading="assistantSpeechLoading"
              :assistant-speaking="assistantSpeaking"
              :draft-accepted="draftAccepted"
              :attempt-count="attemptCount"
              @toggle-assistant="assistantEnabled = !assistantEnabled"
              @ask-assistant="askAssistant"
              @toggle-child-recording="toggleChildRecording"
              @play-draft="playAssistantDraft"
              @stop-speech="stopAssistantSpeech"
              @accept-draft="acceptDraftAsText"
              @discard-draft="discardAssistantDraft"
            />
            <ClassroomVoiceControl
              v-model:command-input="commandInput"
              :command-feedback="commandFeedback"
              :voice-feedback="voiceFeedback"
              :command-busy="commandBusy"
              :voice-rec-state="voiceRecState"
              :busy="busy"
              :is-active="isActive"
              @run-command="runCommand"
              @toggle-voice-recording="toggleVoiceRecording"
            />
            <ResourceCandidatePanel
              v-if="resourceCommandResult"
              :result="resourceCommandResult"
              @confirm="confirmResourceCommand"
              @cancel="cancelResourceCommand"
            />
          </div>
        </section>
        <ClassroomPartnerPanel
          :role-name="dhRoleName"
          :action-text="dhActionText"
          :mic-ready="micReady"
          :assistant-online="assistantOnline"
          :classroom-status-text="paused ? '已暂停' : '正在进行'"
        />
      </div>
      <ClassroomControlBar
        :paused="paused"
        :busy="busy"
        :current-step-index="run.currentStepIndex"
        :total-steps="run.steps.length"
        @previous="safe(store.previous)"
        @next="safe(store.next)"
        @repeat="store.repeat"
        @pause="safe(store.pause)"
        @resume="safe(store.resume)"
        @finish-complete="finish('complete')"
        @finish-cancel="finish('cancel')"
      >
        <template #extra>
          <div class="control-group reward">
            <span class="group-label">奖励</span>
            <ElButton size="large" :disabled="rewardsLoading" @click="openRewardDrawer">
              🌟 本节课奖励（{{ runRewardTotal }}）
            </ElButton>
          </div>
        </template>
      </ClassroomControlBar>
      <ClassRewardDrawer
        v-model="rewardDrawerOpen"
        :rewards="rewards"
        :total-stars="runRewardTotal"
        :loading="rewardsLoading"
      />
      <ResourcePlayer :resources="currentResource ? [currentResource] : resources.sortedResources" />
    </template>
    <div v-else-if="run" class="center ended">
      <h1>{{ run.status === 'completed' ? '本节课堂已完成' : run.status === 'failed' ? '课堂运行异常' : '本节课堂已中止' }}</h1>
      <p>课堂记录已保存，当前页面为只读状态。</p>
      <ElButton type="primary" @click="router.push('/lesson-plans')">返回教案列表</ElButton>
    </div>
  </main>
</template>

<style scoped>
.classroom {
  position: relative;
  height: 100vh;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  padding: 18px 24px 0;
  overflow: hidden;
  background: #F6F2EA;
  color: #4F3D31;
}
.workspace {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) 280px;
  align-items: stretch;
  gap: 16px;
  margin-top: 16px;
}
.center-panel { min-width: 0; display: flex; flex-direction: column; overflow: hidden; }
.center-scroll {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
  padding-right: 4px;
}
.step-card {
  padding: 26px 30px 28px;
  border: 1px solid #E8DED1;
  border-radius: 16px;
  background: #FFFDF9;
  box-shadow: 0 6px 20px rgba(79, 61, 49, 0.08);
}
.step-type-tag { --el-tag-bg-color: #FBEFE3; --el-tag-border-color: #EACFB4; --el-tag-text-color: #C07A3E; border-radius: 999px; font-weight: 800; padding: 2px 12px; }
.step-heading { margin: 10px 0 0; color: #4F3D31; font-size: 30px; font-weight: 800; line-height: 1.3; }
.instruction { margin: 14px 0 0; max-width: 900px; color: #6B584C; font-size: 20px; line-height: 1.75; }
.assist-block { margin-top: 16px; padding: 14px 18px; border: 1px solid #F0E4D5; border-radius: 12px; background: #FFF8EE; }
.assist-block small { color: #9B8779; font-size: 12px; font-weight: 800; letter-spacing: 1px; }
.assist-block p { margin: 5px 0 0; color: #6B584C; font-size: 16px; line-height: 1.65; }
.resource-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 16px;
  padding: 16px 18px;
  border: 1px solid #DCE9D5;
  border-radius: 12px;
  background: #F4FAF0;
}
.resource-card strong { color: #4F3D31; font-size: 16px; }
.resource-card p { margin: 4px 0 0; color: #718064; font-size: 14px; line-height: 1.6; }
.resource-card :deep(.el-button) { border-radius: 12px; }
.control-group.reward { border-left: 1px solid #E8DED1; }
.center { min-height: 70vh; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 16px; }
.error { color: #E76F6F; }
.ended h1 { margin: 0; font-size: 28px; }
.ended p { color: #9B8779; margin: 0; }
.break-mode { flex: 1; min-height: 0; display: flex; justify-content: center; align-items: center; }
.break-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 48px 64px;
  border: 1px solid #F0DDCE;
  border-radius: 22px;
  background: #FFFDF9;
  box-shadow: 0 10px 28px #B9795114;
}
.break-card h1 { margin: 0; color: #4F3D31; font-size: 34px; font-weight: 800; }
.break-emoji { font-size: 56px; }
.break-time { font-size: 64px; font-weight: 800; color: #D67B59; font-variant-numeric: tabular-nums; }
.break-muted { margin: 0; color: #9B8779; }
@media (max-width: 1440px) {
  .workspace { grid-template-columns: auto minmax(0, 1fr) 260px; }
}
@media (max-width: 1280px) {
  /* <1280：左侧步骤栏默认已收起(68px)，右侧教学伙伴保留并压缩到 200px，绝不隐藏 */
  .workspace { grid-template-columns: auto minmax(0, 1fr) 200px; }
  .classroom { padding: 16px 18px 0; }
  .step-card { padding: 22px 24px 24px; }
  .instruction { font-size: 18px; }
}
</style>
