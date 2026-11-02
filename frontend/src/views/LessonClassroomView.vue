<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { CLASSROOM_EXIT_MESSAGE, requiresClassroomExitConfirmation } from '@/router/classroomExitPolicy'
import { storeToRefs } from 'pinia'
import { ElButton, ElDrawer, ElMessage, ElMessageBox, ElTag } from 'element-plus'
import LivePresentationPreview from '@/components/classroom/LivePresentationPreview.vue'
import PresentationQueuePanel from '@/components/classroom/PresentationQueuePanel.vue'
import { apiErrorMessage, http } from '@/api/http'
import { useTeachingSpeech } from '@/composables/useTeachingSpeech'
import { platformApi, type Student, type RewardLeaderboardItem } from '@/api/platform'
import ResourcePlayer from '@/components/ResourcePlayer.vue'
import DigitalHumanStage from '@/components/DigitalHumanStage.vue'
import InteractionFullscreenView from '@/components/classroom/operations/InteractionFullscreenView.vue'
import OpeningSequenceOverlay from '@/components/classroom/OpeningSequenceOverlay.vue'
import { lessonAvatarCue } from '@/classroom/lessonAvatarCue'
import { screenOpeningApi } from '@/api/screenOpening'
import type { ScreenLifecycle, ClassroomRunPayload } from '@/stores/lessonRun'
import FullscreenLeaderboard from '@/components/classroom/FullscreenLeaderboard.vue'
import ClassroomHeader from '@/components/classroom/ClassroomHeader.vue'
import ClassroomMobileDrawer from '@/components/classroom/ClassroomMobileDrawer.vue'
import ClassroomStepSidebar from '@/components/classroom/ClassroomStepSidebar.vue'
import ClassroomQuickActions from '@/components/classroom/ClassroomQuickActions.vue'
import ClassroomAssistantPanel from '@/components/classroom/ClassroomAssistantPanel.vue'
import ClassroomDirectorPanel from '@/components/classroom/ClassroomDirectorPanel.vue'
import ClassroomVoiceControl from '@/components/classroom/ClassroomVoiceControl.vue'
import ClassroomWakeControl from '@/components/classroom/ClassroomWakeControl.vue'
import ChildQaPanel from '@/components/classroom/ChildQaPanel.vue'
import ClassRewardDrawer from '@/components/classroom/ClassRewardDrawer.vue'
import { useLessonRunStore } from '@/stores/lessonRun'
import { useClassroomAssistantStore, type AssistantTool } from '@/stores/classroomAssistant'
import { useCourseResourceStore } from '@/stores/courseResource'
import { useUserStore } from '@/stores/user'
import { useDigitalHumanStore } from '@/stores/digitalHuman'
import { useClassroomAvatar } from '@/composables/useClassroomAvatar'
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
import {
  LocalWakeSpeech,
  isStopListeningPhrase,
  stripWakePhrase,
  type WakeUiState,
} from '@/services/localWakeSpeech'
import { canonicalizeSpokenCommand, routeTeacherVoiceCommand } from '@/classroom/command/TeacherVoiceCommandRouter'
import { ClassroomCommandExecutor } from '@/classroom/command/ClassroomCommandExecutor'
import { useClassroomCommandStore } from '@/stores/classroomCommand'
import { useResourcePlayerStore } from '@/stores/resourcePlayer'
import ResourceCandidatePanel from '@/components/classroom/ResourceCandidatePanel.vue'
import { resolveExecuteAction } from '@/classroom/command/ResourceCommandCoordinator'
import type { ResourceCommandResult } from '@/classroom/command/ResourceCommand'
import type { CourseResource } from '@/stores/courseResource'
import { useVoiceCommandPreferenceStore } from '@/stores/voiceCommandPreference'
import type { TeacherVoiceCommandMatch } from '@/classroom/command/TeacherVoiceCommandRouter'
import { TeacherInstructionSession, type InstructionFeedback } from '@/classroom/command/TeacherInstructionSession'
import { TeachingCompanion } from '@/classroom/command/TeachingCompanion'
import { understandTeaching } from '@/classroom/command/TeachingLanguage'
import { commandCapability } from '@/services/classroomCapabilities'
import {
  listRunRewards,
  type RewardRecord,
} from '@/services/classroomCheckpoint'

const route = useRoute(); const router = useRouter(); const store = useLessonRunStore(); const assistant = useClassroomAssistantStore(); const resources = useCourseResourceStore()
const user = useUserStore()
const consoleTab = ref<'interaction' | 'assistant'>('interaction')
const presentationDrawerOpen = ref(false)
const lessonDetailsOpen = ref(false)
const assistantDrawerOpen = ref(false)
const voiceDrawerOpen = ref(false)
const moreDrawerOpen = ref(false)
const mobileDrawerOpen = ref(false)
function openClassroomTool(name: string) {
  if (!run.value || Number(route.params.runId) !== run.value.id) return
  void router.push({ name, query: { runId: String(run.value.id), from: route.fullPath } })
}
const allowDebugPanel = computed(() => import.meta.env.DEV && route.query.debug === '1')
const digitalHuman = useDigitalHumanStore()
useClassroomAvatar(() => store.run?.id === Number(route.params.runId) ? store.run : null)
const classroomCommand = useClassroomCommandStore()
const resourcePlayer = useResourcePlayerStore()
const voicePreferences = useVoiceCommandPreferenceStore()
const commandExecutor = new ClassroomCommandExecutor(store, resourcePlayer)
const deviceExecutor = new DeviceCommandExecutor(resourcePlayer)
const commandExecutors: CommandRuntimeExecutors = {
  classroom: commandExecutor,
  device: deviceExecutor,
}
const { run, currentStep, currentResource, resourceResolveState, progress, elapsedSeconds, loading, busy, error, isBreakActive, breakRemainingSeconds } = storeToRefs(store)
const { draftReply, teacherTip, loading: assistantLoading, attemptCount, requiresTeacherConfirmation } = storeToRefs(assistant)
const childQaActive = ref(false)
function onChildQaActive(active:boolean){childQaActive.value=active;if(active){commandRunId.value++;pendingVoiceCommand.value=null;void wakeSpeech?.stop();voiceRecorder.cancel();cancelChildRecording();teacherInstructions.invalidate();assistant.endInteraction();stopAssistantSpeech()}}
const teacherPrompt = ref(''); const childReply = ref(''); const assistantEnabled = ref(false)
const commandInput = ref(''); const commandFeedback = ref(''); const commandRunId = ref(0); const commandBusy = ref(false)
// Stage 6.5：资源命令（search/open/play）的待确认结果；教师确认/取消前绝不产生播放器副作用。
const resourceCommandResult = ref<ResourceCommandResult | null>(null)
const voiceRecState = ref<'idle' | 'recording' | 'recognizing'>('idle'); const voiceFeedback = ref('')
// 语音唤醒：本地唤醒词检测（不上云）；唤醒后的指令仍走既有 ASR + D-10 指令链路。
const wakeState = ref<WakeUiState>('off')
const wakeStatus = ref('语音唤醒未开启，课堂语音只在你点击「语音控制」时采集。')
const wakeDetail = ref('')
const wakeBusy = ref(false)
let wakeSpeech: LocalWakeSpeech | null = null
let lastWakeCommand = { text: '', at: 0 }
const wakeFooterLabel = computed(() => {
  if (wakeState.value === 'loading') return '正在开启唤醒…'
  if (wakeState.value === 'waiting') return '🎧 等待唤醒词'
  if (wakeState.value === 'awake') return '🎤 已唤醒·说指令'
  if (wakeState.value === 'error') return '唤醒不可用'
  return '开启语音唤醒'
})
const pendingVoiceCommand = ref<TeacherVoiceCommandMatch | null>(null)
const unresolvedInstruction = ref<string | null>(null)
const companion = new TeachingCompanion()
const intelligentTeachingEnabled=import.meta.env.VITE_CLASSROOM_INTELLIGENCE!=='false'
const teachingSuggestion = ref('')
const suggestionEnabled = ref(true)
const instructionJournalKey = () => `classroom-instruction:${user.teacherInfo?.account ?? 'anonymous'}:${store.run?.id ?? route.params.runId}`
const teacherInstructions = new TeacherInstructionSession({
  context: () => {
    const r = store.run
    return r ? { id: r.id, classId: Number(r.classId), deviceId: r.deviceId, version: r.version, currentStepIndex: r.currentStepIndex, status: r.status, breakActive: store.isBreakActive } : null
  },
  currentResource: () => store.currentResource,
  rollCallState: () => ({...store.run?.rollCallState, counts: (store.run?.rollCallState?.counts ?? {}) as Record<string,number>}),
  referentAmbiguous: () => {
    const r=store.run, reward=r?.interactionState?.rewardPresentation, roll=r?.rollCallState
    return !!reward && reward.studentId !== roll?.lastStudentId && Date.parse(reward.createdAt) >= Date.parse(roll?.updatedAt ?? '')
  },
  journal: {
    read: () => sessionStorage.getItem(instructionJournalKey()),
    write: value => { if(value)sessionStorage.setItem(instructionJournalKey(),value);else sessionStorage.removeItem(instructionJournalKey()) },
  },
  students: async classId => {
    const all: Student[] = []
    for (let page = 1; page <= 100; page++) {
      const { data } = await platformApi.students({ classId, page, pageSize: 100 })
      all.push(...data.items)
      if (all.length >= data.total) return all
    }
    throw new Error('学生列表不完整，请使用正式面板选择。')
  },
  check: match => {
    const action = commandCapability(match.operation)
    if (!action) throw new Error('该操作没有已确认的能力映射。')
    store.requireAction(action)
  },
  execute: (match, requestId) => {
    const parameters = { ...match.parameters }
    if (match.operation === 'set_volume' && typeof parameters.volumeDelta === 'number') {
      parameters.volume = Math.max(0, Math.min(1, resourcePlayer.volume + parameters.volumeDelta))
      delete parameters.volumeDelta
    }
    return store.teacherCommand(match.operation, parameters, 'teacher_panel', store.run?.deviceId, requestId)
  },
  query: async requestId => (await http.get(`/classroom-commands/${encodeURIComponent(requestId)}`)).data,
  adopt: (result, origin) => store.applyCommandResult(result, origin),
})
async function submitTeacherInput(text:string, confirmation=false): Promise<InstructionFeedback> {
  if (understandTeaching(text)?.kind === 'stop') {
    teacherInstructions.invalidate();companion.invalidate();pendingVoiceCommand.value=null
    wakeSpeech?.stopCommandWindow()
    return {handled:true,message:'已取消待处理指令并结束连续收听，课堂继续。'}
  }
  if (teacherInstructions.unresolvedRequestId) return teacherInstructions.query()
  if(!intelligentTeachingEnabled) {
    const routed=routeTeacherVoiceCommand(text)
    if(!routed)return {handled:true,message:'基础控制模式：请使用固定口令或课堂按钮。'}
    await store.refreshTeacherState()
    return teacherInstructions.submit(text,confirmation)
  }
  const origin=store.run, generation=commandRunId.value, actor=user.teacherInfo?.account
  if (!origin || Number(route.params.runId)!==origin.id) return {handled:true,message:'当前课堂尚未就绪。'}
  try {
    const {data}=await http.get<ClassroomRunPayload>(`/classroom-runs/${origin.id}`)
    if (componentUnmounted || generation!==commandRunId.value || actor!==user.teacherInfo?.account || store.run?.id!==origin.id || data.id!==origin.id || data.deviceId!==origin.deviceId || data.version<(store.run?.version ?? 0)) return {handled:true,message:'课堂上下文已变化，旧输入未执行。'}
    store.adoptRun(data)
    await store.refreshCapabilities()
    if (generation!==commandRunId.value || store.run?.id!==origin.id) return {handled:true,message:'课堂状态已变化，请重新输入。'}
    let classroom=store.run!
    // Actual class age is read through the existing authorized platform API.
    // Frozen lesson age is not exposed by Run; never claim this is frozen plan metadata.
    if(['lesson','suggest','accept'].includes(understandTeaching(text)?.kind ?? '') && classroom.classId) {
      const {data:cls}=await platformApi.classDetail(classroom.classId)
      if(generation!==commandRunId.value || store.run?.id!==origin.id || actor!==user.teacherInfo?.account)return {handled:true,message:'课堂已变化，旧问题已取消。'}
      classroom={...classroom,ageGroup:cls.ageRange ?? ''}
    }
    const reply=companion.respond(text,classroom)
    if (reply) {
      const request=understandTeaching(text)
      const seenKey=`classroom-suggestions-seen:${actor}:${origin.id}:${classroom.currentStepIndex}`
      if(request?.kind==='suggest' || request?.kind==='ignore')sessionStorage.setItem(seenKey,'1')
      if(request?.kind==='later') {
        sessionStorage.removeItem(seenKey)
        sessionStorage.setItem(`classroom-suggestions-defer:${actor}:${origin.id}`,String(Date.now()+60000))
      }
      suggestionEnabled.value=companion.enabled
      sessionStorage.setItem(`classroom-suggestions:${actor}:${origin.id}`,companion.enabled?'on':'off')
      teachingSuggestion.value=companion.proposal?.message ?? ''
      if (reply.command) return teacherInstructions.submit(reply.command,confirmation)
      return {handled:true,message:reply.message}
    }
    return teacherInstructions.submit(text,confirmation)
  } catch { return {handled:true,message:'当前课堂状态无法确认，请恢复连接后重试；未发送新操作。'} }
}
async function suggestionAction(text:string) {
  if(commandBusy.value || busy.value)return
  commandInput.value=text;await runCommand()
}
async function queryTeacherInstruction() {
  const result = await teacherInstructions.query()
  commandFeedback.value = result.message
  unresolvedInstruction.value = teacherInstructions.unresolvedRequestId
}
watch(()=>run.value?.id,()=>{
  unresolvedInstruction.value=teacherInstructions.unresolvedRequestId
  companion.enabled=sessionStorage.getItem(`classroom-suggestions:${user.teacherInfo?.account}:${run.value?.id}`)!=='off'
  suggestionEnabled.value=companion.enabled
})
const draftAccepted = ref(false)
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
// ─── 课堂互动（点名 + 快速奖励）──────────────
// 数据来源 = 当前 run.classId 的真实学生列表；只在本班内点名/奖励。
const interactionStudents = ref<Student[]>([])
const selectedStudentId = ref<number | null>(null)
// 禁交互条件：非 running（paused/completed/cancelled/failed）或课间中或操作忙时。
// 后端 rewards 权限仍作为最终保障，这里仅做前端体验层禁用。
const interactionDisabled = computed(() => busy.value || (!store.can('roll_call') && !store.can('reward')))
watch(() => run.value, () => { if (!store.capabilities || store.capabilities.version !== run.value?.version || Date.now() - store.capabilities.at > 4000) void store.refreshCapabilities() })
async function loadInteractionStudents(classId: number) {
  try {
    const result = await platformApi.students(classId)
    interactionStudents.value = result.data.items.filter((s) => s.status !== 'disabled')
    // 若选中幼儿已不在当前班（理论上不会跨班），清空选择。
    if (selectedStudentId.value != null &&
        !interactionStudents.value.some((s) => s.id === selectedStudentId.value)) {
      selectedStudentId.value = null
    }
  } catch {
    // 学生拉取失败仅清空交互范围，不伪造列表；不影响课堂其他能力。
    interactionStudents.value = []
  }
}
// 快速奖励成功：接收独立 RewardRecord，同步刷新本节累计与 drawer 明细，
// 然后重新从后端拉取班级 Top5 排行榜（后端为准，不靠本地累加；刷新失败不回滚奖励）。
function onInteractionRewarded(record: RewardRecord) {
  runRewardTotal.value += record.stars ?? 1
  rewards.value = [record, ...rewards.value]
  void refreshLeaderboard()
}

// Stage：班级小红花 Top5 排行榜（后端聚合）。接口未就绪/失败一律进入 error 态，
// 禁止用分页 reward items 自行 SUM 伪造总榜，避免「没有奖励 ≠ 加载失败」被混淆。
const leaderboard = ref<RewardLeaderboardItem[]>([])
const leaderboardLoading = ref(false)
const leaderboardError = ref('')
const leaderboardClassName = ref('班级成长榜')
async function loadLeaderboard(classId: number) {
  leaderboardError.value = ''
  leaderboardLoading.value = true
  try {
    const result = await platformApi.rewardLeaderboard(classId, 5)
    // 只信任 backend 返回的排序与累计；防御性截断到前 5 名。
    leaderboard.value = result.data.items.slice(0, 5)
    if (result.data.className) leaderboardClassName.value = `${result.data.className}成长榜`
  } catch {
    // 不伪造榜单：保持旧榜或清空，进入 error 态提示重试。
    leaderboard.value = []
    leaderboardError.value = '排行榜加载失败'
  } finally {
    leaderboardLoading.value = false
  }
}
function refreshLeaderboard() {
  const classId = run.value?.classId
  if (classId != null) return loadLeaderboard(classId)
  return Promise.resolve()
}
const breakTimeText = computed(() => { const total = breakRemainingSeconds.value; return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}` })
const childVoiceStatus = computed(() => childRequestingMicrophone.value ? '正在请求麦克风权限…' : childRecording.value ? '录音中，请让孩子说话，说完再点一次' : childRecognizing.value ? '正在识别孩子的回答…' : '')
const typeText: Record<string,string> = { introduction:'导入', teacher_talk:'教师讲述', question:'提问互动', resource:'课程资源', activity:'集体活动', transition:'环节过渡', summary:'课堂总结' }
const ageGroupMap = { '3-4':'small', '4-5':'middle', '5-6':'large' } as const
const dhActionLabel: Record<string, string> = { idle:'待机', listen:'倾听', thinking:'思考', talk:'讲述', happy:'高兴', question:'提问', encourage:'鼓励', praise:'表扬', wave:'挥手', goodbye:'再见' }
const dhActionText = computed(() => dhActionLabel[digitalHuman.action] ?? '待机')
const micReady = computed(() => isRecordingSupported())
const assistantOnline = computed(() => assistant.active)
const copilotStatus = computed(() => assistantSpeaking.value ? '正在讲解' : assistantLoading.value ? '正在思考' : voiceRecState.value === 'recording' ? '正在听' : '待命')
const compactVoiceStatus = computed(() => voiceRecState.value === 'recording' ? '正在听…' : voiceRecState.value === 'recognizing' ? '正在识别…' : commandBusy.value ? '正在执行课堂口令…' : commandFeedback.value || voiceFeedback.value || (micReady.value ? '麦克风已就绪' : '麦克风不可用'))
const nextTeachingStep = computed(() => run.value?.steps.find(step => step.stepIndex > (run.value?.currentStepIndex ?? -1)))
watch(resourceCommandResult, result => { if (result) voiceDrawerOpen.value = true })
async function safe(task: () => Promise<unknown> | void, action?: string) { try { if (action) store.requireAction(action); await task() } catch (e) { await store.handleTeacherRejection(e); ElMessage.error(e instanceof Error ? e.message : '操作失败，请检查网络后重试') } }
async function goToStep(index: number) { if (!run.value || index === run.value.currentStepIndex) return; await safe(() => store.move(index), 'change_step') }
async function closeTeacherResourcePlayer() {
  if (!run.value || !resourcePlayer.currentResource || busy.value) { resourcePlayer.close(); return }
  try {
    await store.teacherCommand('stop_media', undefined, 'teacher_panel', run.value.deviceId)
    resourcePlayer.close()
  } catch (error) {
    ElMessage.error(apiErrorMessage(error, '媒体关闭未确认，请检查大屏连接后重试。'))
  }
}
// ─── 全屏板块 + 开场/教学阶段（frontend only，不改 ClassroomRun）──────────────
// 统一全屏状态：同一时刻只允许一个全屏板块，关闭置 null。
// 仅用 Vue Teleport + Transition 做 overlay，不走路由跳转，避免重载 ClassroomRun。
const activeFullscreenPanel = ref<'interaction' | 'leaderboard' | 'avatar' | null>(null)
// 前端 UI 阶段：opening=开场、teaching=正式教学。纯粹 UI 状态，不影响 backend。
const openingLifecycle = computed(() => run.value?.interactionState?.screenLifecycle as ScreenLifecycle | undefined)
const classroomPhase = computed<'opening' | 'teaching'>(() => openingLifecycle.value?.phase === 'opening' ? 'opening' : 'teaching')
const openingBusy = ref(false)
const openingError = ref('')
const currentAvatarCue=computed(()=>lessonAvatarCue(currentStep.value,digitalHuman.runtime?.character?.name ?? ''))
const openingAvatarCue=computed(()=>lessonAvatarCue(run.value?.steps.find(step=>step.stepIndex===0),digitalHuman.runtime?.character?.name ?? ''))

// 数字人职责划分（2D / 3D 各司其职，不强行合并）：
//   Opening → DigitalHumanStage(3D)；Teaching → ClassroomAvatar(2D)；Fullscreen → DigitalHumanStage(3D far)。
// 三态各自 mount / unmount，不同时常驻两个大型 3D renderer。
function openFullscreen(panel: 'interaction' | 'leaderboard' | 'avatar') {
  if (panel === 'interaction' || panel === 'leaderboard') void loadRewards()
  // 榜单全屏打开时刷新班级累计榜（backend 为准；失败显示不可用态，不伪造）。
  if (panel === 'leaderboard' && run.value?.classId != null) void refreshLeaderboard()
  activeFullscreenPanel.value = panel
}
function closeFullscreen() { activeFullscreenPanel.value = null }
// 全屏板块统一脚手架：顶部栏标题 / 次级元信息 / 右侧奖励计数（仅互动板块显示）。
const fullscreenTitle = computed(() => {
  if (activeFullscreenPanel.value === 'interaction') return '课堂互动'
  if (activeFullscreenPanel.value === 'leaderboard') return '本节奖励榜'
  if (activeFullscreenPanel.value === 'avatar') return 'AI 教学伙伴'
  return ''
})
const teacherDisplayName = computed(() => user.teacherInfo?.name ?? '')
// 次级小信息：课程标题 + 教师（纯展示，来源不依赖 backend 追加请求）。
const fullscreenMeta = computed(() => {
  if (activeFullscreenPanel.value !== 'interaction') return ''
  const parts: string[] = []
  if (run.value?.lessonTitle) parts.push(run.value.lessonTitle)
  if (teacherDisplayName.value) parts.push(teacherDisplayName.value)
  return parts.join(' · ')
})
// 开场「进入课堂 / 跳过开场」：两按钮同一出口，TTS 失败也不会把教师卡在开场。
async function enterClassroomFromOpening(operation: 'complete' | 'skip' = 'complete') {
  if (!run.value || !openingLifecycle.value || openingBusy.value) return
  const originId = run.value.id
  openingBusy.value = true
  openingError.value = ''
  try {
    await store.refreshTeacherState()
    if (run.value?.id !== originId || openingLifecycle.value?.phase !== 'opening') return
    store.requireAction(operation === 'skip' ? 'skip_opening' : 'complete_opening')
    await screenOpeningApi.finish(run.value.id, openingLifecycle.value, operation)
    await store.load(run.value.id)
    closeFullscreen()
  } catch (error) { openingError.value = apiErrorMessage(error, '开场结束失败，请重试。'); await store.handleTeacherRejection(error); ElMessage.error(openingError.value) }
  finally { openingBusy.value = false }
}
async function finish(kind: 'complete' | 'cancel') { try { store.requireAction(kind) } catch (e) { ElMessage.error(apiErrorMessage(e, '当前不能结束课堂')); return } const text = kind === 'complete' ? '确定本节课已经完成吗？结束后将进入课堂总结，本节课堂将不能继续教学操作。' : '确认中止本次课堂吗？教案不会被删除。'; try { await ElMessageBox.confirm(text, kind === 'complete' ? '结束课堂' : '中止课堂', { type:'warning', confirmButtonText: kind === 'complete' ? '确认结束' : '确认', cancelButtonText:'继续上课' }) } catch { return } try { store.requireAction(kind) } catch (e) { ElMessage.error(apiErrorMessage(e, '操作能力已变化，请刷新')); return } digitalHuman.transition({ type: 'lesson_end' }); const runId = run.value?.id; if (kind === 'complete') { if (runId == null) return; try { await store.complete(); store.clear(); await router.push({ name: 'lesson-classroom-summary', params: { runId } }) } catch (e) { await store.handleTeacherRejection(e); ElMessage.error(e instanceof Error ? e.message : '结束课堂失败，请重试。') } } else { await safe(async () => { await store.cancel(); store.clear(); await router.push('/lesson-plans') }) } }
async function runCommand() {
  if (commandBusy.value || busy.value) return
  const text = commandInput.value.trim()
  if (!text) return
  const runId = ++commandRunId.value
  const originRunId = run.value?.id
  commandFeedback.value = ''
  commandBusy.value = true
  resourceCommandResult.value = null
  commandFeedback.value = AI_COMMAND_PENDING_HINT
  try {
    const direct = await submitTeacherInput(text)
    unresolvedInstruction.value = teacherInstructions.unresolvedRequestId
    if (runId !== commandRunId.value || originRunId !== run.value?.id || componentUnmounted) return
    if (direct.handled) {
      commandFeedback.value = direct.message
      pendingVoiceCommand.value = direct.confirmation ?? null
      if (direct.result && direct.committedRunId === run.value?.id && store.lastCommandResult?.operation === 'reward_student') digitalHuman.transition({ type: 'ai_response', emotion: 'encourage' })
      return
    }
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
      customSynonyms: voicePreferences.items,
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
    if (outcome.kind === 'confirmation_required') {
      pendingVoiceCommand.value = teacherInstructions.registerConfirmation(outcome.match)
      commandFeedback.value = outcome.message
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
  if(childQaActive.value){ElMessage.warning('儿童问答中公共音频不执行教师命令，请先结束问答或使用教师按钮接管。');return}
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
    await dispatchVoiceText(text, runId, true)
  } catch (e) {
    if (runId === commandRunId.value && !componentUnmounted) voiceFeedback.value = apiErrorMessage(e, '语音识别失败，请稍后重试。')
  } finally {
    if (runId === commandRunId.value && !componentUnmounted) voiceRecState.value = 'idle'
  }
}
/**
 * 已识别文本 → 既有 D-10 指令链路（TeacherInstructionSession / CommandRuntime）。
 * 手动语音与唤醒语音共用这一条链路，不新建第二套意图解析或业务执行。
 * requireConfirmation=false 时仍遵守指令自身的 requiresConfirmation（结束课堂等高风险操作照常确认）。
 */
async function dispatchVoiceText(text: string, runId: number, requireConfirmation: boolean) {
  if(childQaActive.value)return
  const direct = await submitTeacherInput(text, requireConfirmation)
  unresolvedInstruction.value = teacherInstructions.unresolvedRequestId
  if (runId !== commandRunId.value || componentUnmounted) return
  if (direct.handled) {
    voiceFeedback.value = direct.message
    pendingVoiceCommand.value = direct.confirmation ?? null
    return
  }
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
    5000,
    voicePreferences.items,
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
  if (outcome.kind === 'confirmation_required') {
    pendingVoiceCommand.value = teacherInstructions.registerConfirmation(outcome.match)
    voiceFeedback.value = outcome.message
    return
  }
  if (outcome.kind === 'unsupported') {
    voiceFeedback.value = `AI 判读为 ${outcome.intent}，该指令不属于本阶段已批准范围，未执行。`
    return
  }
  // failed：ASR 空文本 / AI fallback 超时 / 网络 / 5xx —— 统一安全失败，不执行。
  voiceFeedback.value = outcome.hint
}
async function confirmPendingVoiceCommand() {
  const match = pendingVoiceCommand.value
  if (!match || commandBusy.value) return
  const originRunId = run.value?.id
  commandBusy.value = true
  try {
    if (match.operation !== 'group_roll_call') {
      const result = await teacherInstructions.execute(match)
      if (componentUnmounted || run.value?.id !== originRunId) return
      unresolvedInstruction.value = teacherInstructions.unresolvedRequestId
      voiceFeedback.value = result.message
      commandFeedback.value = result.message
      return
    }
    // Legacy name-list grouping is not a canonical group identity.
    voiceFeedback.value = '请到正式分组点名面板选择已有分组。'
    commandFeedback.value = voiceFeedback.value
  } catch (error) {
    const message = apiErrorMessage(error, '指令执行失败，请检查幼儿姓名或课堂状态。')
    voiceFeedback.value = message
    commandFeedback.value = message
  } finally {
    commandBusy.value = false
    pendingVoiceCommand.value = null
  }
}
function cancelPendingVoiceCommand() {
  pendingVoiceCommand.value = null
  voiceFeedback.value = '已取消，未执行课堂操作。'
}
// ─── 资源命令教师确认（Stage 6.5）──────────────
// 硬约束：search/open/play 资源命令在教师确认前不产生任何播放器副作用。
// 确认 → 统一走 resourcePlayer.openResource（protected download 链路）；
// 取消 → 清空候选，无副作用。
async function confirmResourceCommand(resource: CourseResource) {
  const result = resourceCommandResult.value
  if (!result || !run.value || commandBusy.value) return
  const origin = { id: run.value.id, step: run.value.currentStepIndex, deviceId: run.value.deviceId }
  const action = resolveExecuteAction(result.intent, resource)
  commandBusy.value = true
  try {
    const feedback = await teacherInstructions.execute({
      operation: action.autoPlay ? 'play_resource' : 'open_resource',
      parameters: { resourceId: Number(resource.id) },
      normalized: '', label: resource.title, requiresConfirmation: false, source: 'builtin',
    })
    unresolvedInstruction.value = teacherInstructions.unresolvedRequestId
    if (componentUnmounted || run.value?.id !== origin.id || run.value?.deviceId !== origin.deviceId || run.value.currentStepIndex !== origin.step) return
    commandFeedback.value = feedback.message
    if (feedback.result) {
      resourcePlayer.openResource(resource, action.autoPlay)
      resourceCommandResult.value = null
    }
  } finally { commandBusy.value = false }
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
  if(childQaActive.value){ElMessage.warning('儿童问答中公共音频不执行教师命令，请先结束问答或使用教师按钮接管。');return}
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
// ─── 语音唤醒（本地唤醒词；唤醒后的指令仍走既有 ASR + D-10 指令链路）───
function ensureWakeSpeech(): LocalWakeSpeech {
  if (wakeSpeech) return wakeSpeech
  wakeSpeech = new LocalWakeSpeech({
    onState: (state, message) => {
      wakeState.value = state
      wakeStatus.value = message
      if (state === 'off') {
        wakeDetail.value = ''
        wakeStatus.value = '语音唤醒已关闭，麦克风已释放。'
      }
    },
    onWake: () => {
      wakeState.value = 'awake'
      wakeStatus.value = '我在。请说指令。'
      wakeDetail.value = ''
      if (!digitalHuman.renderingPaused) digitalHuman.transition({ type: 'teacher_command', command: 'listen' })
    },
    onPartial: (text) => {
      wakeDetail.value = `正在识别：“${text}”`
    },
    onUtterance: (blob, localText) => void runWakeCommand(blob, localText),
    onCommandWindowEnd: (reason) => {
      wakeState.value = 'waiting'
      wakeDetail.value = ''
      wakeStatus.value = reason
    },
  })
  return wakeSpeech
}
async function toggleWakeListening() {
  if(childQaActive.value){ElMessage.warning('儿童问答中公共音频不执行教师命令，请先结束问答或使用教师按钮接管。');return}
  if (wakeBusy.value) return
  if (!isActive.value && wakeState.value === 'off') {
    ElMessage.warning('课堂开始后才能开启语音唤醒。')
    return
  }
  wakeBusy.value = true
  try {
    if (wakeState.value === 'off' || wakeState.value === 'error') {
      await ensureWakeSpeech().start()
    } else {
      await wakeSpeech?.stop()
    }
  } finally {
    wakeBusy.value = false
  }
}
let wakeCommandInFlight=false
async function runWakeCommand(audioBlob:Blob,localText:string) {
  if(wakeCommandInFlight) {wakeStatus.value='正在处理上一条指令，请稍候。';return}
  wakeCommandInFlight=true
  try {await processWakeCommand(audioBlob,localText)} finally {wakeCommandInFlight=false}
}
async function processWakeCommand(audioBlob: Blob, localText: string) {
  if(childQaActive.value){ElMessage.warning('儿童问答中公共音频不执行教师命令，请先结束问答或使用教师按钮接管。');return}
  if (componentUnmounted) return
  // 防御：只有处于「已唤醒」窗口内的语音才允许进入课堂业务链路。
  if (wakeState.value !== 'awake') return
  const runId = ++commandRunId.value
  const originRunId = run.value?.id
  wakeStatus.value = '正在识别教师指令…'
  wakeDetail.value = localText ? `本地听到：“${localText}”` : ''
  let text = ''
  // 本地识别已经能归一成明确口令时，不必再依赖云端 ASR（也不在唤醒后上传教室音频）。
  const localCanonical = canonicalizeSpokenCommand(stripWakePhrase(localText))
  const localRouted = localCanonical ? routeTeacherVoiceCommand(localCanonical) : null
  if (localRouted) {
    text = ''
  } else if (!localCanonical && audioBlob.size > 0 && import.meta.env.VITE_CLASSROOM_REAL_ASR === 'true') {
    try {
      text = await asrRecognizeWav(audioBlob, async (url, body, config) => (await http.post(url, body, config)).data)
    } catch (error) {
      console.warn('[wake-command] asr failed', audioBlob.size, error instanceof Error ? error.message : String(error))
      text = ''
    }
  }
  if (runId !== commandRunId.value || componentUnmounted || run.value?.id !== originRunId) return
  const spoken = stripWakePhrase(text) || localCanonical || stripWakePhrase(localText)
  const recognized = canonicalizeSpokenCommand(spoken)
  if (!recognized) {
    wakeStatus.value = '没有听清，请再说一次。'
    return
  }
  if (isStopListeningPhrase(recognized)) {
    wakeSpeech?.stopCommandWindow()
    return
  }
  // 同一句话被重复识别时不重复提交业务命令。
  const now = Date.now()
  if (lastWakeCommand.text === recognized && now - lastWakeCommand.at < 2000) {
    wakeStatus.value = '刚刚已执行相同指令，本次没有重复提交。'
    return
  }
  lastWakeCommand = { text: recognized, at: now }
  wakeDetail.value = `识别到：“${recognized}”`
  const wakeRoute = routeTeacherVoiceCommand(recognized)
  wakeStatus.value = wakeRoute?.kind === 'command' ? `正在执行：${wakeRoute.match.label}` : '正在执行语音指令…'
  // 唤醒指令往往在页面静置一段时间后才发出；能力快照过期时先刷新，避免误判为「阶段不允许」。
  const capability = wakeRoute?.kind === 'command' ? commandCapability(wakeRoute.match.operation) : null
  if (capability && !store.can(capability)) {
    await store.refreshTeacherState().catch(() => undefined)
    if (runId !== commandRunId.value || componentUnmounted || run.value?.id !== originRunId) return
  }
  await dispatchVoiceText(recognized, runId, false)
  if (runId !== commandRunId.value || componentUnmounted || run.value?.id !== originRunId) return
  wakeStatus.value = voiceFeedback.value || '语音指令已处理。'
  if (pendingVoiceCommand.value) wakeStatus.value = `请教师确认：${pendingVoiceCommand.value.label}`
}
async function askAssistant(tool?: AssistantTool, useTeacherPrompt = false) { const teacherText = teacherPrompt.value.trim(); const childText = childReply.value.trim(); const text = useTeacherPrompt ? teacherText : childText || currentStep.value?.content || ''; if (!text) return ElMessage.warning(useTeacherPrompt ? '请先输入老师的问题或要求' : '当前没有可用于引导的课堂内容'); try { await assistant.ask(text, useTeacherPrompt || !childText ? 'teacher' : 'child', tool); if (useTeacherPrompt) teacherPrompt.value = ''; else childReply.value = '' } catch (e) { ElMessage.error(e instanceof Error ? e.message : '课堂助教暂时不可用') } }
function stopChildMediaTracks() { childMediaStream?.getTracks().forEach((track) => track.stop()); childMediaStream = null }
function cancelChildRecording() { childRecordingGeneration += 1; if (childMediaRecorder?.state === 'recording') childMediaRecorder.stop(); childMediaRecorder = null; childAudioChunks = []; childRecording.value = false; childRequestingMicrophone.value = false; childRecognizing.value = false; stopChildMediaTracks() }
async function recognizeChildReply(audioBlob: Blob, generation: number) { try { if (!audioBlob.size) throw new Error('没有录到声音，请重新录制。'); childRecognizing.value = true; const wavBlob = await webmToWav(audioBlob); if (generation !== childRecordingGeneration || componentUnmounted) return; const formData = new FormData(); formData.append('file', wavBlob, `child-reply-${Date.now()}.wav`); const { data } = await http.post<{ text: string }>('/ai/asr', formData); if (generation !== childRecordingGeneration || componentUnmounted) return; const text = typeof data.text === 'string' ? data.text.trim() : ''; if (!text) throw new Error('没有识别到孩子的话，请靠近麦克风再试一次。'); childReply.value = text; ElMessage.success('已识别孩子的回答，请选择下方引导方式') } catch (e) { if (generation === childRecordingGeneration && !componentUnmounted) ElMessage.error(apiErrorMessage(e, '语音识别失败，请稍后重试。')) } finally { if (generation === childRecordingGeneration) childRecognizing.value = false } }
async function startChildRecording() { if (!isRecordingSupported()) throw new Error('当前浏览器不支持麦克风录音，请使用最新版 Chrome 或 Edge。'); childRequestingMicrophone.value = true; const generation = ++childRecordingGeneration; try { const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); if (generation !== childRecordingGeneration || componentUnmounted) { stream.getTracks().forEach((track) => track.stop()); return } const recorder = new MediaRecorder(stream, { mimeType: RECORDING_MIME_TYPE }); childMediaStream = stream; childMediaRecorder = recorder; childAudioChunks = []; recorder.addEventListener('dataavailable', (event: BlobEvent) => { if (event.data.size > 0) childAudioChunks.push(event.data) }); recorder.addEventListener('stop', () => { const audioBlob = new Blob(childAudioChunks, { type: RECORDING_MIME_TYPE }); childAudioChunks = []; childMediaRecorder = null; stopChildMediaTracks(); if (generation === childRecordingGeneration && !componentUnmounted) void recognizeChildReply(audioBlob, generation) }, { once: true }); recorder.addEventListener('error', () => { childRecording.value = false; childMediaRecorder = null; stopChildMediaTracks(); ElMessage.error('录音发生错误，请重新尝试。') }, { once: true }); recorder.start(); childRecording.value = true } catch (e) { stopChildMediaTracks(); if (e instanceof DOMException && e.name === 'NotAllowedError') throw new Error('麦克风权限被拒绝，请在浏览器设置中允许使用麦克风。', { cause: e }); throw e } finally { childRequestingMicrophone.value = false } }
function stopChildRecording() { if (!childMediaRecorder || childMediaRecorder.state === 'inactive') return; childRecording.value = false; childRecognizing.value = true; childMediaRecorder.stop() }
async function toggleChildRecording() { if (childRecording.value) return stopChildRecording(); if (childRequestingMicrophone.value || childRecognizing.value || assistantLoading.value) return; try { await startChildRecording() } catch (e) { ElMessage.error(e instanceof Error ? e.message : '无法使用麦克风，请稍后重试。') } }
const canSpeakTeaching = computed(() => !!run.value && run.value.status === 'running' && Number(route.params.runId) === run.value.id && !isBreakActive.value && !run.value.manualInterventionRequired && store.can('tts'))
watch(voiceRecState, state => {
  if (state === 'recording' && !digitalHuman.renderingPaused) digitalHuman.transition({ type: 'teacher_command', command: 'listen' })
  else if (digitalHuman.currentState === 'listen') digitalHuman.transition({ type: 'settle' })
})
const teachingSpeech = useTeachingSpeech({
  identity: () => JSON.stringify([route.params.runId, run.value?.id, run.value?.deviceId, run.value?.currentStepIndex,
    run.value?.status, openingLifecycle.value?.phase, isBreakActive.value, run.value?.manualInterventionRequired, digitalHuman.identityKey]),
  allowed: () => canSpeakTeaching.value,
  authorize: async text => {
    await store.teacherCommand('speak_text', { text }, 'teacher_panel', run.value?.deviceId)
    await store.refreshCapabilities()
  },
  requestAudio: async text => (await http.post<{ audioUrl: string }>('/ai/tts', { text })).data.audioUrl,
  onSpeaking: active => digitalHuman.transition({ type: active ? 'tts_start' : 'tts_end' }),
  onError: cause => { digitalHuman.setFallback('语音暂时不可用'); ElMessage.error(apiErrorMessage(cause, '助教语音播放失败，请稍后重试。')) },
})
const { loading: assistantSpeechLoading, speaking: assistantSpeaking, paused: assistantSpeechPaused } = teachingSpeech
// 数字人或助教播报期间暂停本地唤醒送音：避免 TTS 自唤醒与重复指令。
watch([assistantSpeaking, () => digitalHuman.isSpeaking, pendingVoiceCommand], ([speaking, avatarSpeaking, confirming]) => {
  wakeSpeech?.setPlaybackActive(Boolean(speaking || avatarSpeaking || confirming))
})
function stopListeningOnFocusLoss() {void wakeSpeech?.stop();voiceRecorder.cancel()}
function stopListeningOnHidden() {if(document.hidden)stopListeningOnFocusLoss()}
onMounted(()=>{window.addEventListener('blur',stopListeningOnFocusLoss);document.addEventListener('visibilitychange',stopListeningOnHidden)})
onBeforeUnmount(()=>{window.removeEventListener('blur',stopListeningOnFocusLoss);document.removeEventListener('visibilitychange',stopListeningOnHidden);companion.clear()})
watch(()=>user.teacherInfo?.account,()=>{teacherInstructions.clearIdentity();commandRunId.value++;commandBusy.value=false;commandFeedback.value='';voiceFeedback.value='';companion.clear();teachingSuggestion.value='';pendingVoiceCommand.value=null;void wakeSpeech?.stop()})
watch([elapsedSeconds,commandBusy,assistantSpeaking,()=>run.value?.version],()=>{
  if(!run.value || !intelligentTeachingEnabled)return
  const seenKey=`classroom-suggestions-seen:${user.teacherInfo?.account}:${run.value.id}:${run.value.currentStepIndex}`
  if(sessionStorage.getItem(seenKey))return
  if(Number(sessionStorage.getItem(`classroom-suggestions-defer:${user.teacherInfo?.account}:${run.value.id}`) ?? 0)>Date.now())return
  const quiet=!commandBusy.value && !busy.value && !assistantSpeaking.value && !digitalHuman.isSpeaking && !pendingVoiceCommand.value && voiceRecState.value==='idle' && wakeState.value!=='awake' && resourcePlayer.playerStatus!=='playing' && openingLifecycle.value?.phase!=='opening'
  const message=companion.proactive(run.value,quiet)
  if(message){teachingSuggestion.value=message;sessionStorage.setItem(seenKey,'1')}
})
function stopAssistantSpeech() { teachingSpeech.stop() }
function pauseAssistantSpeech() { teachingSpeech.pause() }
async function resumeAssistantSpeech() { await teachingSpeech.resume() }
async function playAssistantDraft() {
  if (requiresTeacherConfirmation.value) return
  if (await teachingSpeech.play(draftReply.value.trim())) draftAccepted.value = true
}
function acceptDraftAsText() { draftAccepted.value = true; digitalHuman.transition({ type: 'ai_response', emotion: 'encourage' }); ElMessage.success('已由教师确认，可自行讲述给孩子听') }
function discardAssistantDraft() { stopAssistantSpeech(); digitalHuman.transition({ type: 'settle' }); draftAccepted.value = false; assistant.endInteraction() }
function beforeUnload(event: BeforeUnloadEvent) { if (!isActive.value) return; event.preventDefault(); event.returnValue = '' }
onBeforeRouteLeave(() => { const leave = !requiresClassroomExitConfirmation(run.value?.status) || window.confirm(CLASSROOM_EXIT_MESSAGE); if (leave) stopAssistantSpeech(); return leave })
watch(currentStep, (step, previous) => {
  if (!run.value || !step) return
  if (previous && previous.stepIndex !== step.stepIndex) { assistant.endInteraction(); cancelChildRecording(); childReply.value = ''; digitalHuman.transition({ type: 'step_change' }) }
  assistant.activate()
  assistant.ageGroup = ageGroupMap[run.value.ageGroup as keyof typeof ageGroupMap] ?? 'middle'
  assistant.theme = run.value.lessonTitle
  if (run.value.lessonObjectives) assistant.objective = run.value.lessonObjectives
  assistant.currentStep = `${step.title}：${step.content}`
})
watch(() => [run.value?.id, run.value?.deviceId, run.value?.classId, run.value?.currentStepIndex, run.value?.status, store.isBreakActive].join('|'), () => {
  teacherInstructions.invalidate()
  companion.invalidate();teachingSuggestion.value=''
  pendingVoiceCommand.value = null
  resourceCommandResult.value = null
  commandRunId.value++
  commandBusy.value = false
  voiceRecorder.cancel()
  voiceRecState.value = 'idle'
})
// 切换 Run / 课堂结束：立即停止唤醒采集，旧课堂的语音回调不得继续执行。
// 注意只对「Run 身份/终态」变化反应，轮询刷新同一 Run 不触发关闭。
watch(
  () => [run.value?.id ?? null, run.value?.status ?? ''] as const,
  ([nextId, nextStatus], previous) => {
    const [previousId, previousStatus] = previous ?? [null, '']
    const runChanged = nextId != null && previousId != null && nextId !== previousId
    const finished = (nextStatus === 'completed' || nextStatus === 'cancelled') && previousStatus !== nextStatus
    if (!runChanged && !finished) return
    lastWakeCommand = { text: '', at: 0 }
    void wakeSpeech?.stop()
  },
  { deep: true },
)
// 数字人常驻右侧主卡（右栏独立于中央课件，不再需要资源环节缩到角落）。
// compact 逻辑已废弃：右侧栏在中间媒体区之外，数字人常驻不遮挡 PPT/ResourcePlayer。
watch(draftReply, () => { draftAccepted.value = false; stopAssistantSpeech() })
// Stage 7.3：run 就绪后自动加载本节课奖励汇总（X 计数）。
watch(run, (current) => {
  if (current?.id) void loadRewards()
  if (current?.classId) {
    void loadInteractionStudents(current.classId)
    void loadLeaderboard(current.classId)
  }
})
// Esc：仅关闭「普通 fullscreen panel」，绝不绕过 OpeningSequenceOverlay 开场。
function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && activeFullscreenPanel.value) closeFullscreen()
}
async function mountClassroom() {
  window.addEventListener('beforeunload', beforeUnload)
  // The voice panel is now lazy-mounted in a drawer; keep its existing preferences ready for the status-bar entry.
  void voicePreferences.load().catch(() => undefined)
  await store.load(Number(route.params.runId)).catch(() => undefined)
  // 仅在「刚创建并通过 start 进入」的一次性标记下播放开场；
  // 刷新后 store 重建、标记归零，不会重复开场。
  if (store.newlyStarted && isActive.value) {
    store.newlyStarted = false
  }
  store.startPolling()
  window.addEventListener('keydown', handleKeydown)
}
onMounted(mountClassroom)
watch(() => route.params.runId, (next, previous) => {
  if (!previous || next === previous) return
  closeFullscreen(); stopAssistantSpeech(); store.clearRun()
  void store.load(Number(next)).then(() => {
    if (!componentUnmounted && route.params.runId === next) store.startPolling()
  }).catch(() => undefined)
})
onBeforeUnmount(() => { teacherInstructions.invalidate(); commandRunId.value++; window.removeEventListener('keydown', handleKeydown); store.stopPolling(); componentUnmounted = true; window.removeEventListener('beforeunload', beforeUnload); cancelChildRecording(); voiceRecorder.cancel(); void wakeSpeech?.stop(); stopAssistantSpeech(); digitalHuman.reset(); assistant.endInteraction() })
</script>

<template>
  <main class="classroom" :class="{ 'classroom-debug': allowDebugPanel }">
    <!-- Keep the same teacher control surface alive across teaching and break. -->
    <ClassroomMobileDrawer v-if="run && Number(route.params.runId) === run.id" v-model="mobileDrawerOpen" :run="run" />
    <ElDrawer v-if="run" v-model="voiceDrawerOpen" title="课堂语音与口令" size="min(640px, 95vw)">
      <ClassroomVoiceControl
        v-model:command-input="commandInput"
        :command-feedback="commandFeedback"
        :voice-feedback="voiceFeedback"
        :command-busy="commandBusy"
        :voice-rec-state="voiceRecState"
        :busy="busy"
        :is-active="isActive"
        :pending-confirmation="pendingVoiceCommand?.label"
        :unresolved-request-id="unresolvedInstruction"
        @query-command="queryTeacherInstruction"
        @run-command="runCommand"
        @toggle-voice-recording="toggleVoiceRecording"
        @confirm-command="confirmPendingVoiceCommand"
        @cancel-command="cancelPendingVoiceCommand"
      />
      <ClassroomWakeControl
        :state="wakeState"
        :status-text="wakeStatus"
        :detail="wakeDetail"
        :busy="wakeBusy"
        :disabled="!isActive"
        @toggle="toggleWakeListening"
      />
      <ResourceCandidatePanel v-if="resourceCommandResult" :result="resourceCommandResult" @confirm="confirmResourceCommand" @cancel="cancelResourceCommand" />
    </ElDrawer>
    <section v-if="run" role="status" data-test="classroom-capabilities">
      <p>{{ store.capabilityMessage }}</p>
      <ElButton :loading="store.capabilityLoading" @click="store.refreshTeacherState()">刷新课堂状态</ElButton>
    </section>
    <section v-if="store.commandStateRefresh.status !== 'idle'" role="status" data-test="command-state-refresh">
      <p>{{ store.commandStateRefresh.message }}</p>
      <ElButton :loading="store.commandStateRefresh.status === 'refreshing'" :disabled="store.commandStateRefresh.status === 'refreshing'" @click="store.retryCommandStateRefresh()">重新查询状态</ElButton>
    </section>
    <div v-if="loading" class="center">正在恢复课堂…</div>
    <div v-else-if="error" class="center error">{{ error }}<ElButton @click="router.push('/lesson-plans')">返回教案列表</ElButton></div>
    <!-- Stage 7.4：课间休息。isBreakActive 为 true 时隐藏推进教学的 workspace/ControlBar，仅展示倒计时与提前结束 -->
    <div v-else-if="run && isBreakActive" class="break-mode" data-test="break-mode">
      <div class="break-card">
        <span class="break-emoji">{{ run.breakContent?.icon || '☕' }}</span>
        <h1>{{ run.breakContent?.title || '课间休息' }}</h1>
        <div class="break-time" data-test="break-countdown">{{ breakTimeText }}</div>
        <p class="break-muted">{{ run.breakContent?.message || '让幼儿喝水、如厕，放松休息' }}</p>
        <ElButton size="large" :disabled="busy || !store.can('end_break')" @click="safe(store.endBreak, 'end_break')">
          {{ busy ? '处理中…' : '提前结束课间' }}
        </ElButton>
        <ElButton @click="voiceDrawerOpen = true">课堂口令</ElButton>
        <ElButton @click="mobileDrawerOpen = true">连接手机</ElButton>
      </div>
    </div>
    <template v-else-if="run && currentStep && isActive">
      <ClassroomHeader
        :lesson-title="`${leaderboardClassName !== '班级成长榜' ? leaderboardClassName.replace(/成长榜$/, '') + ' · ' : ''}${run.lessonTitle}`"
        :step-title="currentStep.title"
        :paused="paused"
        :current-step-index="run.currentStepIndex"
        :total-steps="run.steps.length"
        :elapsed-seconds="elapsedSeconds"
        :step-minutes="Math.ceil(currentStep.durationSeconds / 60)"
        :progress="progress"
      >
        <template #navigation><ElButton text @click="router.push({ name: 'my-classes' })">← 工作台</ElButton></template>
        <template #actions>
          <span class="console-status">AI 助教：{{ copilotStatus }} · 手机连接以手机端为准</span>
          <ElButton :disabled="busy || !store.can(paused ? 'resume' : 'pause')" @click="safe(paused ? store.resume : store.pause, paused ? 'resume' : 'pause')">{{ paused ? '恢复课堂' : '暂停课堂' }}</ElButton>
          <ElButton :disabled="busy || !store.can('complete')" @click="finish('complete')">结束课堂</ElButton>
          <ElButton text @click="moreDrawerOpen = true">更多</ElButton>
        </template>
      </ClassroomHeader>
      <div class="workspace" :class="{ 'flow-collapsed': stepSidebarCollapsed }">
        <ClassroomStepSidebar
          :steps="run.steps"
          :can-change="store.can('change_step')"
          :current-step-index="run.currentStepIndex"
          :paused="paused"
          :busy="busy"
          :collapsed="stepSidebarCollapsed"
          @go-step="goToStep"
          @toggle-collapse="stepSidebarCollapsed = !stepSidebarCollapsed"
        >
          <div class="next-teaching-step"><small>下一环节</small><strong>{{ nextTeachingStep?.title || '课堂总结' }}</strong></div>
        </ClassroomStepSidebar>
        <section class="center-panel">
          <div class="center-scroll">
            <LivePresentationPreview />
            <section class="console-card console-controls" aria-label="课堂展示与环节控制">
              <h2>课堂控制</h2>
              <ElButton tag="a" :href="'/classroom/screen/' + run.deviceId" target="_blank" rel="noopener">打开独立大屏</ElButton>
              <ElButton @click="mobileDrawerOpen = true">连接手机</ElButton>
              <ElButton type="primary" @click="presentationDrawerOpen = true">调整课堂内容</ElButton>
              <ElButton v-if="currentResource" data-test="show-step-resource" :disabled="busy || !store.can('resource_start')" @click="safe(() => store.openResource(), 'resource_start')">展示本环节课件</ElButton>
              <ElButton :disabled="busy || !store.can('safe_stop')" @click="safe(() => store.teacherCommand('stop_media', undefined, 'teacher_panel', run?.deviceId), 'safe_stop')">停止媒体</ElButton>
              <template v-if="run.playerRecoverySuggestion?.resourceId">
                <ElButton :disabled="busy || !store.can('media_control')" @click="safe(() => store.command('previous_page', undefined, 'teacher_panel', run?.deviceId), 'media_control')">大屏上一页</ElButton>
                <ElButton :disabled="busy || !store.can('media_control')" @click="safe(() => store.command('next_page', undefined, 'teacher_panel', run?.deviceId), 'media_control')">大屏下一页</ElButton>
              </template>
              <div class="step-controls">
                <ElButton :disabled="busy || !store.can('change_step') || run.currentStepIndex === 0" @click="safe(store.previous, 'change_step')">上一环节</ElButton>
                <ElButton :disabled="busy || !store.can('change_step') || !nextTeachingStep" @click="safe(store.next, 'change_step')">下一环节</ElButton>
                <ElButton text @click="lessonDetailsOpen = true">查看完整教案</ElButton>
              </div>
            </section>
            <section class="console-card"><h2>当前教学提示</h2>
      <p v-if="currentAvatarCue" class="lesson-avatar-cue" data-test="lesson-avatar-cue">{{ digitalHuman.runtime?.character?.name || '课堂伙伴' }}：{{ currentAvatarCue }}</p>
<p>{{ currentStep.teacherTip || teacherTip || '给小朋友一点观察和表达的时间。' }}</p></section>
            <ElDrawer v-model="lessonDetailsOpen" title="课堂教案 · 仅教师可见" size="min(640px, 95vw)">
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
                  <template v-if="resourceResolveState.status === 'loading'">
                    <strong>正在加载资源…</strong>
                    <p>正在获取步骤绑定的教学资源，请稍候。</p>
                  </template>
                  <template v-else-if="resourceResolveState.status === 'missing'">
                    <strong>资源不可用</strong>
                    <p>{{ resourceResolveState.message }}（可切换到其他环节继续上课）</p>
                  </template>
                  <template v-else>
                    <strong>{{ currentResource?.title ?? '资源已失效' }}</strong>
                    <p>{{ currentResource ? '点击后打开现有统一播放器，不会自动播放。' : '该资源已删除或无权访问，可继续切换其他环节。' }}</p>
                  </template>
                </div>
                <ElButton type="primary" size="large" :disabled="!store.can('resource_start') || !currentResource || resourceResolveState.status === 'loading'" @click="safe(() => store.openResource(), 'resource_start')">打开资源</ElButton>
              </div>
            </section>
            <details v-for="step in run.steps.filter(item => item.stepIndex !== currentStep?.stepIndex)" :key="step.stepIndex" class="lesson-detail-step"><summary>第 {{ step.stepIndex + 1 }} 环节 · {{ step.title }}</summary><p>{{ step.content }}</p><p v-if="step.teacherTip">教师提示：{{ step.teacherTip }}</p><p v-if="step.expectedResponse">预期回答：{{ step.expectedResponse }}</p></details>
            </ElDrawer>
            <ElDrawer v-model="presentationDrawerOpen" title="本节课堂展示内容" size="min(760px, 95vw)">
              <PresentationQueuePanel />
            </ElDrawer>
            <ElDrawer v-model="assistantDrawerOpen" title="AI教学伙伴" size="min(660px, 95vw)">
            <ClassroomAssistantPanel
              v-model:teacher-prompt="teacherPrompt"
              v-model:child-reply="childReply"
              v-model:draft-reply="draftReply"
              :can-speak="canSpeakTeaching"
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
              :assistant-speech-paused="assistantSpeechPaused"
              :draft-accepted="draftAccepted"
              :attempt-count="attemptCount"
              @toggle-assistant="assistantEnabled = !assistantEnabled"
              @ask-assistant="askAssistant"
              @toggle-child-recording="toggleChildRecording"
              @play-draft="playAssistantDraft"
              @pause-speech="pauseAssistantSpeech"
              @resume-speech="resumeAssistantSpeech"
              @stop-speech="stopAssistantSpeech"
              @accept-draft="acceptDraftAsText"
              @discard-draft="discardAssistantDraft"
            />
            <ClassroomDirectorPanel />
            </ElDrawer>
          </div>
        </section>
        <div class="assist-col">
          <section class="console-card console-notice" role="status">
            <strong>课堂互动与 AI 助教</strong>
            <span>当前展示待审核：{{ run.playerRecoverySuggestion?.childQaAnswerStatus === 'pending' ? 1 : 0 }}</span>
            <p v-if="commandFeedback">{{ commandFeedback }}</p>
          </section>
          <ChildQaPanel @active="onChildQaActive"
            :run-id="run.id"
            :step-index="run.currentStepIndex"
            :identity="JSON.stringify([route.params.runId, run?.id, run?.deviceId, run?.currentStepIndex, digitalHuman.identityKey])"
            :allowed="!!run && Number(route.params.runId) === run.id && run.status === 'running' && classroomPhase === 'teaching' && !isBreakActive && !run.manualInterventionRequired && voiceRecState === 'idle' && !childRecording && !childRequestingMicrophone"
            :speaking="assistantSpeaking || digitalHuman.isSpeaking"
          />
          <div class="console-tabs" role="tablist" aria-label="课堂工具">
            <button role="tab" :aria-selected="consoleTab === 'interaction'" @click="consoleTab = 'interaction'">课堂互动</button>
            <button role="tab" :aria-selected="consoleTab === 'assistant'" @click="consoleTab = 'assistant'">AI 助教</button>
          </div>
          <section v-show="consoleTab === 'interaction'" class="console-card" role="tabpanel" aria-label="课堂互动">
          <ClassroomQuickActions console-mode :can-roll="store.can('roll_call')" :can-reward="store.can('reward')" :disabled="interactionDisabled" :total-stars="runRewardTotal" @interaction="openFullscreen('interaction')" @reward="openFullscreen('interaction')" @resources="presentationDrawerOpen = true" @assistant="assistantDrawerOpen = true" @leaderboard="openFullscreen('leaderboard')" />
          <ElButton @click="openClassroomTool('classroom-engagement')">考勤与课间设置</ElButton>
          <ElButton @click="openClassroomTool('classroom-insights')">儿童问题与作品</ElButton>
          <ElButton :disabled="rewardsLoading" @click="openRewardDrawer">本节奖励记录（{{ runRewardTotal }}）</ElButton>
          </section>
          <section v-show="consoleTab === 'assistant'" class="console-card" role="tabpanel" aria-label="AI 助教">
          <ElButton @click="assistantDrawerOpen = true">AI教学伙伴</ElButton>
      <section v-if="intelligentTeachingEnabled" class="teaching-suggestion" aria-label="课堂教学建议">
        <p v-if="teachingSuggestion">{{ teachingSuggestion }}</p>
        <ElButton @click="suggestionAction('有什么适合现在的小活动？')" :disabled="commandBusy">教学建议</ElButton>
        <template v-if="teachingSuggestion"><ElButton @click="suggestionAction('采用建议')" :disabled="commandBusy">采用建议</ElButton><ElButton @click="suggestionAction('忽略建议')">忽略建议</ElButton><ElButton @click="suggestionAction('稍后提醒')">稍后提醒</ElButton></template>
        <ElButton @click="suggestionAction(suggestionEnabled ? '关闭主动建议' : '开启主动建议')">{{ suggestionEnabled ? '关闭主动建议' : '开启主动建议' }}</ElButton>
        <p v-if="commandFeedback" role="status">{{ commandFeedback }}</p>
      </section>

          <ElButton data-test="enter-avatar" @click="openFullscreen('avatar')">进入数字人大屏</ElButton>
          </section>
        </div>
      </div>
      <footer class="teacher-hint-bar">
        <div class="teacher-hint"><strong>教师提示</strong><span>{{ currentStep.teacherTip || teacherTip || '给小朋友一点观察和表达的时间。' }}</span></div>
        <button class="voice-status" type="button" :disabled="commandBusy || voiceRecState === 'recognizing' || busy" @click="toggleVoiceRecording">{{ voiceRecState === 'recording' ? '结束录音' : '语音控制' }}</button>
        <button
          class="voice-status wake-status-button"
          :class="{ 'wake-waiting': wakeState === 'waiting', 'wake-awake': wakeState === 'awake' }"
          type="button"
          :disabled="wakeBusy"
          @click="toggleWakeListening"
        >{{ wakeFooterLabel }}</button>
        <span v-if="wakeState !== 'off'" class="wake-inline" role="status" data-test="wake-inline">{{ wakeStatus }}</span>
        <button class="voice-detail" type="button" @click="voiceDrawerOpen = true">{{ compactVoiceStatus }}</button>
      </footer>
      <ElDrawer v-model="moreDrawerOpen" title="更多课堂操作" size="min(480px, 95vw)">
        <div class="more-actions">
          <ElButton :disabled="busy || !store.can('change_step')" @click="store.can('change_step') && store.repeat()">重复本环节</ElButton>
          <hr /><p>中止后无法继续当前课堂，请确认后操作。</p>
          <ElButton type="danger" plain :disabled="busy || !store.can('cancel')" @click="finish('cancel')">中止课堂</ElButton>
        </div>
      </ElDrawer>
      <ClassRewardDrawer
        v-model="rewardDrawerOpen"
        :rewards="rewards"
        :total-stars="runRewardTotal"
        :loading="rewardsLoading"
      />
      <ResourcePlayer :resources="currentResource ? [currentResource] : resources.sortedResources" :show-close="true" @close-request="closeTeacherResourcePlayer" />
      <OpeningSequenceOverlay
        v-if="classroomPhase === 'opening' && isActive"
        :lesson-title="run.lessonTitle"
        :subtitle="openingAvatarCue || '小朋友们好，我们一起探索今天的新知识吧！'"
        :busy="openingBusy"
        :error="openingError"
        :teacher-name="user.teacherInfo?.name ?? ''"
        @enter="enterClassroomFromOpening"
        @skip="enterClassroomFromOpening('skip')"
      >
        <template #controls>
          <div class="opening-teacher-controls">
            <ElButton @click="mobileDrawerOpen = true">连接手机</ElButton>
            <ElButton :disabled="busy || openingBusy || !store.can(paused ? 'resume' : 'pause')" @click="safe(paused ? store.resume : store.pause, paused ? 'resume' : 'pause')">{{ paused ? '恢复课堂' : '暂停课堂' }}</ElButton>
            <ElButton :disabled="busy || openingBusy || !store.can('complete')" @click="finish('complete')">结束课堂</ElButton>
          </div>
        </template>
      </OpeningSequenceOverlay>
    </template>
    <div v-else-if="run" class="center ended">
      <h1>{{ run.status === 'completed' ? '本节课堂已完成' : run.status === 'failed' ? '课堂运行异常' : '本节课堂已中止' }}</h1>
      <p>课堂记录已保存，当前页面为只读状态。</p>
      <ElButton type="primary" @click="router.push('/lesson-plans')">返回教案列表</ElButton>
    </div>
    <!-- 全屏板块 overlay：统一 activeFullscreenPanel 状态，Vue Teleport 到 body，避免路由跳转重载 ClassroomRun -->
    <Teleport to="body">
      <Transition name="classroom-panel">
        <div v-if="activeFullscreenPanel" class="classroom-fullscreen-overlay" data-test="fullscreen-overlay">
          <header class="fs-topbar" data-test="fs-topbar">
            <button class="fs-back" type="button" data-test="fs-close" @click="closeFullscreen">
              ← 返回课堂
            </button>
            <div class="fs-top-head">
              <h1 class="fs-top-title" data-test="fs-title">{{ fullscreenTitle }}</h1>
              <p v-if="fullscreenMeta" class="fs-top-meta" data-test="fs-meta">{{ fullscreenMeta }}</p>
            </div>
            <div v-if="activeFullscreenPanel === 'interaction'" class="fs-top-right">
              <span class="fs-star" data-test="fs-star">本节 🌟 {{ runRewardTotal }}</span>
            </div>
          </header>

          <div v-if="activeFullscreenPanel === 'interaction'" class="fs-body fs-body-interaction" data-test="fs-interaction">
            <InteractionFullscreenView
              :run="run"
              :students="interactionStudents"
              :selected-student-id="selectedStudentId"
              :busy="busy"
              :disabled="interactionDisabled"
              :reward-total="runRewardTotal"
              @update:selected-student-id="selectedStudentId = $event"
              @rewarded="onInteractionRewarded"
              @goto-leaderboard="openFullscreen('leaderboard')"
            />
          </div>
          <div v-else-if="activeFullscreenPanel === 'leaderboard'" class="fs-body" data-test="fs-leaderboard">
            <FullscreenLeaderboard
              :rewards="rewards"
              :class-leaderboard="leaderboard"
              :class-loading="leaderboardLoading"
              :class-error="leaderboardError"
            />
          </div>
          <div v-else-if="activeFullscreenPanel === 'avatar'" class="fs-body fs-avatar" data-test="fs-avatar">
            <div class="fs-avatar-inner">
              <h2 class="fs-title">AI 教学伙伴</h2>
              <!-- 3D 数字人大屏：DigitalHumanStage far 机位宽松取景，字幕/输入区固定在下方 -->
              <DigitalHumanStage :controls="false" far />
              <div class="fs-avatar-chat" data-test="fs-avatar-chat">
                <template v-if="draftReply">
                  <div class="fs-chat-draft">
                    <small>AI 教学伙伴的回答</small>
                    <p>{{ draftReply }}</p>
                    <div class="fs-chat-actions">
                      <ElButton size="small" :loading="assistantSpeechLoading" :disabled="requiresTeacherConfirmation || !store.can('tts')" @click="playAssistantDraft">
                        🔊 {{ assistantSpeaking ? '播放中…' : '播放' }}
                      </ElButton>
                      <ElButton v-if="assistantSpeaking" size="small" @click="stopAssistantSpeech">⏹ 停止</ElButton>
                      <ElButton size="small" @click="discardAssistantDraft">清除</ElButton>
                    </div>
                  </div>
                </template>
                <template v-else>
                  <div class="fs-chat-ask">
                    <input
                      v-model="teacherPrompt"
                      class="fs-chat-input"
                      placeholder="问问 AI 教学伙伴…（回车发送）"
                      @keyup.enter="askAssistant(undefined, true)"
                    />
                    <ElButton type="primary" size="small" :loading="assistantLoading" @click="askAssistant(undefined, true)">
                      问助教
                    </ElButton>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </main>
</template>

<style scoped>
.classroom-exit{display:flex;align-items:center;gap:14px;color:#8d7568;font-size:13px;margin-bottom:12px;flex-wrap:wrap}
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
.assist-col {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
}
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
/* ─── 右侧紧凑入口：课堂互动 / 本节榜单 ─── */
.launcher-row {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.launcher {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 12px 14px;
  border: 1px solid #EFD9C8;
  border-radius: 14px;
  background: #FFFDF9;
  box-shadow: 0 6px 18px rgba(79, 61, 49, 0.07);
  cursor: pointer;
  text-align: left;
}
.launcher:hover { border-color: #E4C395; background: #FFFBF4; }
.l-emoji { font-size: 20px; line-height: 1; }
.l-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.l-title { color: #4F3D31; font-size: 16px; font-weight: 800; line-height: 1.2; }
.l-sub { color: #C07A3E; font-size: 13px; font-weight: 700; line-height: 1.2; }
.l-side { display: flex; align-items: center; gap: 8px; }
.l-stars {
  font-style: normal;
  padding: 3px 10px;
  border-radius: 999px;
  background: #FFF6E8;
  color: #C07A3E;
  font-size: 13px;
  font-weight: 800;
  white-space: nowrap;
}
.l-arrow { color: #D8A468; font-size: 20px; font-weight: 800; line-height: 1; }
@media (max-width: 1280px) {
  /* 窄屏：互动/榜单并排两个按钮；隐藏副文案与星星胶囊，保留主标题+箭头 */
  .launcher-row { flex-direction: row; }
  .launcher { flex: 1; min-width: 0; padding: 10px; gap: 6px; }
  .l-emoji { font-size: 16px; }
  .l-sub { display: none; }
  .l-stars { display: none; }
  .l-title { font-size: 14px; }
  .l-arrow { font-size: 16px; }
}
/* ─── 全屏 overlay + 过渡动画 ───
   固定覆盖整个视口，真正盖住原课堂全部 UI；暖色底 + 极轻渐变，无重 blur。
   统一脚手架（顶部栏 + body），各板块内容由组件自行控制 max-width / 布局。 */
.classroom-fullscreen-overlay {
  position: fixed;
  inset: 0;
  z-index: 300;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background:
    radial-gradient(circle at 50% 8%, #fffaf4 0%, #fff7ee 45%, rgba(255, 244, 232, 0.96) 100%);
}
.fs-topbar {
  flex: 0 0 auto;
  min-height: 72px;
  padding: 16px 48px;
  box-sizing: border-box;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 16px;
  border-bottom: 1px solid #F2E6D5;
  background: rgba(255, 253, 249, 0.55);
}
.fs-back { justify-self: start; border: 1px solid #EADFCB; border-radius: 14px; padding: 10px 18px; background: #FFFDF8; color: #6B584C; font-size: 15px; font-weight: 800; cursor: pointer; box-shadow: 0 4px 12px rgba(121, 89, 66, 0.06); }
.fs-back:hover { border-color: #E4C395; color: #B3682F; }
.fs-top-head { text-align: center; }
.fs-top-title { margin: 0; color: #4F3D31; font-size: 20px; font-weight: 800; line-height: 1.2; }
.fs-top-meta { margin: 2px 0 0; color: #A48E7E; font-size: 13px; font-weight: 600; }
.fs-top-right { justify-self: end; }
.fs-star {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: 1px solid #F2DDBE;
  border-radius: 999px;
  background: #FFF6E8;
  color: #C07A3E;
  font-size: 15px;
  font-weight: 800;
  white-space: nowrap;
}
/* 过渡：进入 260ms，退出 200ms；easing cubic-bezier(0.22,1,0.36,1) */
.classroom-panel-enter-active {
  transition: opacity 0.26s cubic-bezier(0.22, 1, 0.36, 1), transform 0.26s cubic-bezier(0.22, 1, 0.36, 1);
}
.classroom-panel-leave-active {
  transition: opacity 0.2s cubic-bezier(0.22, 1, 0.36, 1), transform 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}
.classroom-panel-enter-from,
.classroom-panel-leave-to {
  opacity: 0;
  transform: scale(0.985) translateY(8px);
}
.fs-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
}
/* 互动操作台：内容自行控制 max-width 布局，纵向可滚动（窄屏），不做上下居中挤压 */
.fs-body-interaction { align-items: stretch; overflow: auto; }
/* 数字人大屏：3D 数字人占满剩余纵向空间并居中，字幕/输入区固定在下方 */
.fs-avatar-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: 100%;
  height: 100%;
  padding: 24px 32px 28px;
  box-sizing: border-box;
}
.fs-avatar-inner :deep(.digital-human) {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  max-width: none;
  display: flex;
  align-items: center;
  justify-content: center;
}
.fs-title { margin: 0; color: #4F3D31; font-size: 22px; font-weight: 800; }
.fs-avatar-chat { width: 100%; max-width: 460px; }
.fs-chat-draft {
  padding: 14px 16px;
  border: 1px solid #E8DED1;
  border-radius: 14px;
  background: #FFFDF9;
  box-shadow: 0 6px 18px rgba(79, 61, 49, 0.07);
}
.fs-chat-draft small { color: #9B8779; font-size: 12px; font-weight: 800; letter-spacing: 1px; }
.fs-chat-draft p { margin: 6px 0 10px; color: #4F3D31; font-size: 16px; line-height: 1.65; }
.fs-chat-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.fs-chat-ask { display: flex; gap: 10px; width: 100%; }
.fs-chat-input {
  flex: 1;
  min-width: 0;
  padding: 10px 14px;
  border: 1px solid #E8DED1;
  border-radius: 12px;
  background: #FFFDF9;
  color: #4F3D31;
  font-size: 14px;
  outline: none;
}
.fs-chat-input::placeholder { color: #B5A294; }
.fs-chat-input:focus { border-color: #E4C395; }
@media (max-width: 999px) {
  .fs-topbar { grid-template-columns: 1fr; gap: 8px; padding: 12px 20px; justify-items: center; text-align: center; }
  .fs-back { justify-self: center; }
  .fs-top-right { justify-self: end; }
}
</style>
<style scoped>
.classroom{height:auto;min-height:100dvh;overflow:visible;padding:16px;gap:14px;background:var(--app-bg);color:var(--app-text)}
.workspace{display:grid;grid-template-columns:minmax(210px,1fr) minmax(0,2fr) minmax(0,2fr);gap:16px;margin:0;min-height:0;flex:none;align-items:start}
.workspace.flow-collapsed{grid-template-columns:68px minmax(0,1fr) minmax(0,1fr)}
.center-panel,.center-scroll,.assist-col{height:auto;min-width:0;overflow:visible}
.center-scroll,.assist-col{display:flex;flex-direction:column;gap:14px}
.workspace :deep(.step-sidebar){height:auto;max-height:none;overflow:visible}
.console-card{padding:16px;border:1px solid var(--app-border);border-radius:16px;background:var(--app-surface);min-width:0}
.console-card h2{font-size:16px;margin:0 0 12px}.console-card p{line-height:1.7;margin:8px 0;color:var(--app-muted)}
.console-controls{display:flex;flex-wrap:wrap;gap:8px}.console-controls h2{flex-basis:100%;margin:0}.console-card :deep(.el-button){margin:0;white-space:nowrap}
.step-controls{display:flex;flex-wrap:wrap;gap:8px;flex-basis:100%;border-top:1px solid var(--app-border);padding-top:12px;margin-top:4px}
.console-notice{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.console-notice span{margin-left:auto;color:var(--app-primary-dark);font-size:13px}.console-notice p{flex-basis:100%}
.console-tabs{display:flex;gap:8px}.console-tabs button{flex:1;padding:12px;border-radius:12px;border:1px solid var(--app-border);background:var(--app-surface);color:var(--app-text);font:inherit;cursor:pointer}.console-tabs button[aria-selected=true]{background:var(--app-primary-soft);border-color:var(--app-primary);font-weight:700}
.console-status{font-size:12px;color:var(--app-muted);align-self:center}
.next-teaching-step{display:grid;gap:8px;padding-top:12px;border-top:1px solid var(--app-border);line-height:1.7}.next-teaching-step small{color:var(--app-muted)}
.teacher-hint-bar{display:flex;flex-wrap:wrap;gap:10px;border-radius:16px;padding:14px;background:var(--app-surface);border:1px solid var(--app-border);margin:0}.teacher-hint{flex:1 1 260px;display:flex;gap:10px;line-height:1.6}.voice-status,.voice-detail{white-space:nowrap}
.teaching-suggestion{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.teaching-suggestion p{flex-basis:100%}
@media(max-width:1100px){.workspace{grid-template-columns:190px minmax(0,1fr) minmax(0,1fr);gap:12px}.classroom{padding:12px}}
@media(max-width:800px){.workspace,.workspace.flow-collapsed{grid-template-columns:1fr}.workspace :deep(.step-sidebar.collapsed){width:100%}.console-status{flex-basis:100%}}
</style>
