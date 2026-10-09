<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ElAlert,
  ElButton,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElInput,
  ElMessage,
  ElMessageBox,
} from 'element-plus'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import { apiErrorMessage, http } from '@/api/http'
import ClassroomAssistantPanel from '@/components/ClassroomAssistantPanel.vue'
import CourseResourcesPanel from '@/components/CourseResourcesPanel.vue'
import FavoritesPanel from '@/components/FavoritesPanel.vue'
import {
  RECORDING_MIME_TYPE,
  webmToWav,
} from '@/services/recordingAudio'
import {
  type ChatMessage,
  type ConversationSession,
  useConversationStore,
} from '@/stores/conversation'
import { useClassroomCommandStore } from '@/stores/classroomCommand'
import {
  useClassroomAssistantStore,
  type AssistantTool,
} from '@/stores/classroomAssistant'
import {
  useLessonRunStore,
  type ClassroomRunPayload,
} from '@/stores/lessonRun'
import {
  useCourseResourceStore,
  type CourseResource,
} from '@/stores/courseResource'
import { useFavoriteStore } from '@/stores/favorite'
import {
  RESOURCE_PLAYER_CLAIM_EVENT,
  useResourcePlayerStore,
} from '@/stores/resourcePlayer'
import { useUserStore } from '@/stores/user'

type ResourceAction = {
  type: 'play'
  resource: {
    id: string
    title: string
    mediaType: string
    contentUrl: string
  }
}

type ChatResponse = {
  reply: string
  resourceAction?: ResourceAction
  sessionId?: number
}

// ===== 新增：语音接口响应类型 开始 =====
const input = ref('')
const sending = ref(false)
const errorText = ref('')
const bottomRef = ref<HTMLElement | null>(null)
const router = useRouter()
const userStore = useUserStore()
const conversationStore = useConversationStore()
const favoriteStore = useFavoriteStore()
const courseResourceStore = useCourseResourceStore()
const resourcePlayerStore = useResourcePlayerStore()
const classroomCommandStore = useClassroomCommandStore()
const classroomAssistantStore = useClassroomAssistantStore()
const lessonRunStore = useLessonRunStore()
const { isLogin, isAdmin, teacherInfo } = storeToRefs(userStore)
const {
  processing: commandProcessing,
  feedback: commandFeedback,
  candidates: commandCandidates,
  navigationRequest: commandNavigationRequest,
} = storeToRefs(classroomCommandStore)
const {
  active: assistantActive,
  loading: assistantLoading,
  playbackPolicy: assistantPlaybackPolicy,
  draftReply: assistantDraftReply,
  suggestedAction: assistantSuggestedAction,
} = storeToRefs(classroomAssistantStore)
const {
  isBreakActive,
  breakRemainingSeconds,
  busy: runBusy,
} = storeToRefs(lessonRunStore)
// 课间模式与启发式课堂助教是两条独立路径：课间走 lessonRunStore 的权威 break，
// 启发式助教走 classroomAssistantStore.active。两者互斥：课间 active 时常驻课间 UI。
const BREAK_DURATIONS = [
  { seconds: 180, label: '3 分钟' },
  { seconds: 300, label: '5 分钟' },
  { seconds: 600, label: '10 分钟' },
]
const breakConfigOpen = ref(false)
const runTitle = computed(() => lessonRunStore.run?.lessonTitle ?? '')
const breakTimeText = computed(() => {
  const total = breakRemainingSeconds.value
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
})
const messages = computed(() => conversationStore.activeMessages)
const sessions = computed(() => conversationStore.visibleSessions)
const activeSession = computed(() => conversationStore.activeSession)
const activeNavigation = ref<'chat' | 'resources' | 'favorites'>('chat')
const accountMenuOpen = ref(false)
const accountAreaRef = ref<HTMLElement | null>(null)
const sessionSearch = ref('')
const renamingSessionId = ref<string | null>(null)
const renameInput = ref('')
const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  sessionId: '' as string,
})
const filteredSessions = computed(() => {
  const keyword = sessionSearch.value.trim().toLocaleLowerCase()
  if (!keyword) return sessions.value
  return sessions.value.filter((session) =>
    session.title.toLocaleLowerCase().includes(keyword),
  )
})
const contextMenuSession = computed(() =>
  sessions.value.find(
    (session) => session.localId === contextMenu.value.sessionId,
  ),
)

// ===== 新增：语音对话状态 开始 =====
const requestingMicrophone = ref(false)
const recording = ref(false)
const recognizing = ref(false)
const voiceReplyLoading = ref(false)
const synthesizing = ref(false)
const playingAudio = ref(false)
const playingResourceTitle = ref('')
const assistantSpeechLoading = ref(false)

let mediaRecorder: MediaRecorder | null = null
let mediaStream: MediaStream | null = null
let audioChunks: Blob[] = []
let currentAudio: HTMLAudioElement | null = null
let currentObjectUrl: string | null = null
let componentUnmounted = false
let assistantSpeechSequence = 0

const voiceBusy = computed(
  () =>
    requestingMicrophone.value ||
    recognizing.value ||
    voiceReplyLoading.value ||
    synthesizing.value,
)

const voiceStatusText = computed(() => {
  if (requestingMicrophone.value) return '正在请求麦克风权限…'
  if (recording.value) return '录音中，再点一次结束录音'
  if (recognizing.value) return '正在识别你说的话…'
  if (voiceReplyLoading.value) return '小花老师正在想一想…'
  if (synthesizing.value) return '正在生成语音回复…'
  if (playingAudio.value) {
    return playingResourceTitle.value
      ? `正在播放《${playingResourceTitle.value}》…`
      : '正在播放语音回复…'
  }
  return ''
})
// ===== 新增：语音对话状态 结束 =====

function saveHistory() {
  try {
    conversationStore.persist()
  } catch {
    errorText.value = '浏览器未能保存聊天记录，请检查存储空间。'
  }
}

async function scrollToBottom() {
  await nextTick()
  bottomRef.value?.scrollIntoView({ block: 'end', behavior: 'smooth' })
}

watch(() => messages.value.length, scrollToBottom)
watch(
  () => conversationStore.currentOwnerKey,
  () => {
    conversationStore.selectAvailableSession()
    sessionSearch.value = ''
    cancelRename()
    errorText.value = ''
    void scrollToBottom()
  },
)
watch(commandNavigationRequest, (request) => {
  if (!request) return
  activeNavigation.value = request.page
})
onMounted(() => {
  conversationStore.initialize()
  conversationStore.selectAvailableSession()
  document.addEventListener('click', closeAccountMenuOnOutsideClick)
  document.addEventListener('contextmenu', closeContextMenuOnOutsideClick)
  document.addEventListener('keydown', closeFloatingMenusOnEscape)
  window.addEventListener(
    RESOURCE_PLAYER_CLAIM_EVENT,
    stopChatAudioForResourcePlayer,
  )
  void scrollToBottom()
})

function newSession() {
  if (sending.value || recording.value || voiceBusy.value) return
  activeNavigation.value = 'chat'
  sessionSearch.value = ''
  cancelRename()
  closeContextMenu()
  conversationStore.createSession()
  input.value = ''
  errorText.value = ''
}

function openChatNavigation() {
  activeNavigation.value = 'chat'
  closeContextMenu()
}

function toggleAssistantMode() {
  if (isBreakActive.value) {
    ElMessage.info('课间休息中，请先结束课间再使用启发式课堂助教')
    return
  }
  if (!isLogin.value) {
    ElMessage.warning('启发式课堂助教仅供登录教师开启')
    return
  }
  errorText.value = ''
  if (assistantActive.value) {
    stopAssistantResponse()
    classroomAssistantStore.deactivate()
  } else {
    classroomAssistantStore.activate()
  }
}

// ===== 课间模式（与启发式助教彻底分离）=====
async function syncActiveRun() {
  try {
    const { data } = await http.get<ClassroomRunPayload | ClassroomRunPayload[]>(
      '/classroom-runs/active',
    )
    const active = Array.isArray(data) ? (data[0] ?? null) : data
    if (active) {
      lessonRunStore.adoptRun(active)
      // 复用现有轮询：多端同步 break 状态与倒计时
      lessonRunStore.startPolling(2000)
    } else {
      lessonRunStore.stopPolling()
      lessonRunStore.clearRun()
    }
    return active
  } catch {
    return null
  }
}

async function openBreakConfig() {
  errorText.value = ''
  if (!isLogin.value) {
    ElMessage.warning('课间模式仅供登录教师开启')
    return
  }
  // 切换前先停止语音与助教语音，避免与课间 UI 互相干扰
  stopAssistantResponse()
  classroomAssistantStore.deactivate()
  await syncActiveRun()
  if (!lessonRunStore.run) {
    ElMessage.warning('当前没有进行中的课堂，无法开启课间模式')
    return
  }
  breakConfigOpen.value = true
}

async function startBreak(durationSeconds: number) {
  breakConfigOpen.value = false
  if (runBusy.value || isBreakActive.value) return
  try {
    await lessonRunStore.startBreak(durationSeconds)
    ElMessage.success('课间休息已开始')
  } catch (e) {
    ElMessage.error(apiErrorMessage(e, '课间休息未开启，请重试。'))
  }
}

async function endBreak() {
  if (runBusy.value || !isBreakActive.value) return
  try {
    await lessonRunStore.endBreak()
    ElMessage.success('已提前结束课间')
  } catch (e) {
    ElMessage.error(apiErrorMessage(e, '结束课间失败，请重试。'))
  }
}

async function handleAssistantResult(
  result: Awaited<ReturnType<typeof classroomAssistantStore.ask>>,
) {
  if (
    !result ||
    assistantPlaybackPolicy.value !== 'direct' ||
    result.requiresTeacherConfirmation
  ) return
  await playAssistantDraft()
}

async function sendAssistantMessage(text: string) {
  input.value = ''
  errorText.value = ''
  try {
    const result = await classroomAssistantStore.ask(text, 'child')
    await handleAssistantResult(result)
  } catch (error) {
    input.value = text
    errorText.value =
      error instanceof Error ? error.message : '课堂助教暂时无法回应。'
  }
}

const assistantToolPrompts: Record<AssistantTool | 'simplify', string> = {
  guided_question: '请围绕当前目标生成一个新的启发式观察问题。',
  give_hint: '请在不直接公布答案的前提下，再给孩子一个小提示。',
  simplify: '请把刚才准备说的话换成更简单、更短的幼儿口语。',
  follow_up: '请根据孩子刚才的回答继续追问一个主要问题。',
  encourage: '请鼓励孩子继续观察和表达，不使用能力标签。',
  summarize: '请用简短的话总结孩子目前已经发现的内容。',
  recommend_resource: '请从当前可用资源中推荐一个相关课堂素材。',
  classroom_command: '请根据当前课堂需要提出一个安全的资源控制建议。',
  safety_redirect: '请给出找老师帮助的安全引导。',
  unknown: '请判断下一步如何引导。',
}

async function runAssistantTool(tool: AssistantTool | 'simplify') {
  errorText.value = ''
  try {
    const modelTool: AssistantTool = tool === 'simplify' ? 'guided_question' : tool
    const result = await classroomAssistantStore.ask(
      assistantToolPrompts[tool],
      'teacher',
      modelTool,
    )
    await handleAssistantResult(result)
  } catch (error) {
    errorText.value =
      error instanceof Error ? error.message : '课堂助教工具执行失败。'
  }
}

async function runAssistantPrompt(text: string) {
  errorText.value = ''
  try {
    const result = await classroomAssistantStore.ask(text, 'teacher')
    await handleAssistantResult(result)
  } catch (error) {
    errorText.value =
      error instanceof Error ? error.message : '课堂助教工具执行失败。'
  }
}

async function playAssistantDraft() {
  const text = assistantDraftReply.value.trim()
  if (!text || assistantSuggestedAction.value) return
  const requestSequence = ++assistantSpeechSequence
  assistantSpeechLoading.value = true
  errorText.value = ''
  try {
    const { data } = await http.post<{ audioUrl: string }>('/ai/tts', { text })
    if (typeof data.audioUrl !== 'string' || !data.audioUrl.trim()) {
      throw new Error('语音服务没有返回可播放内容。')
    }
    if (requestSequence !== assistantSpeechSequence) return
    await playAudioSource(data.audioUrl.trim())
  } catch (error) {
    errorText.value = apiErrorMessage(error, '助教语音播放失败，请稍后重试。')
  } finally {
    if (requestSequence === assistantSpeechSequence) {
      assistantSpeechLoading.value = false
    }
  }
}

function stopAssistantResponse() {
  assistantSpeechSequence += 1
  classroomAssistantStore.cancel()
  assistantSpeechLoading.value = false
  releaseCurrentAudio()
}

function confirmAssistantAction() {
  const action = assistantSuggestedAction.value
  if (!action) return
  const resource = action.resourceId
    ? courseResourceStore.sortedResources.find(
        (item) => item.id === action.resourceId,
      )
    : undefined
  if (action.resourceId && !resource) {
    ElMessage.warning('推荐资源当前不可用，请手动选择其他素材')
    classroomAssistantStore.discardSuggestion()
    return
  }
  const intent =
    action.type === 'recommend_resource'
      ? 'open_resource'
      : action.commandIntent
  if (!intent || intent === 'unknown') {
    ElMessage.warning('该课堂操作无法执行')
    classroomAssistantStore.discardSuggestion()
    return
  }
  classroomCommandStore.executeConfirmedAction(intent, resource)
  classroomAssistantStore.discardSuggestion()
  ElMessage.success('已按教师确认执行')
}

function endAssistantInteraction() {
  stopAssistantResponse()
  classroomAssistantStore.deactivate()
}

function commandResourceTypeLabel(resource: CourseResource): string {
  return {
    image: '图片',
    audio: '音频',
    video: '视频',
    pdf: 'PDF',
    ppt: 'PPT课件',
    picture_book: '绘本',
    animation: '动画',
    question_bank: '题库',
    experiment: '实验素材',
    model_3d: '3D模型',
    document: '文档/课件',
  }[resource.mediaType]
}

const RESOURCE_CHAT_REQUEST_PATTERN =
  /(?:(?:帮我|请|麻烦).{0,8}(?:打开|播放|放一下|找|搜索|看看))|(?:(?:打开|播放|放一下|找|搜索|看看).{0,24}(?:课程资源|资源库|资源|歌曲|音乐|儿歌|故事|绘本|视频|动画|课件|图片|素材))/

function isResourceChatRequest(text: string): boolean {
  return RESOURCE_CHAT_REQUEST_PATTERN.test(text.trim())
}

async function runResourceChatCommand(text: string, speakReply = false) {
  const trimmed = text.trim()
  if (!trimmed) return
  conversationStore.appendMessage({ role: 'user', content: trimmed })
  input.value = ''
  errorText.value = ''
  let reply = ''
  let assistantMessageAdded = false
  let resourceOpened = false
  const currentResourceId = resourcePlayerStore.currentResource?.id
  try {
    if (!isLogin.value) {
      reply = '请先让老师登录，登录后我才能查找课程资源。'
    } else {
      const result = await classroomCommandStore.submit(trimmed, {
        currentPage: activeNavigation.value,
        currentResourceId:
          typeof currentResourceId === 'number' ? currentResourceId : undefined,
        playerStatus: resourcePlayerStore.playerStatus,
        ageGroup: resourcePlayerStore.currentResource?.ageGroup,
      })
      reply = commandFeedback.value.trim() || '这条资源指令暂时无法执行。'
      resourceOpened = Boolean(
        result?.matchStatus === 'matched' &&
        !result.requiresConfirmation &&
        result.resource,
      )
    }
    conversationStore.appendMessage({ role: 'assistant', content: reply })
    assistantMessageAdded = true
    saveHistory()

    if (speakReply && !resourceOpened) {
      try {
        const { data } = await http.post<{ audioUrl: string }>('/ai/tts', { text: reply })
        if (typeof data.audioUrl === 'string' && data.audioUrl.trim()) {
          await playAudioSource(data.audioUrl.trim())
        }
      } catch (error) {
        errorText.value =
          error instanceof Error ? error.message : '文字提示已生成，但语音播放失败。'
      }
    }
  } catch (error) {
    if (!assistantMessageAdded) conversationStore.removeLastMessage()
    input.value = speakReply ? '' : trimmed
    errorText.value =
      error instanceof Error ? error.message : '课堂指令执行失败，请稍后重试。'
  }
}

function openResourceNavigation() {
  activeNavigation.value = 'resources'
  cancelRename()
  closeContextMenu()
  accountMenuOpen.value = false
}

function openFavoritesNavigation() {
  activeNavigation.value = 'favorites'
  cancelRename()
  closeContextMenu()
  accountMenuOpen.value = false
}

function copyResourceToChat(resource: CourseResource) {
  const reference = `【个人资源：${resource.title}（${resource.category}）】`
  input.value = input.value.trim()
    ? `${input.value.trim()}\n${reference}`
    : reference
  activeNavigation.value = 'chat'
  void nextTick(() => {
    document
      .querySelector<HTMLTextAreaElement>('.composer .el-textarea__inner')
      ?.focus()
  })
}

function sessionExportText(session: ConversationSession): string {
  const messages = session.messages.map((message) => {
    const speaker = message.role === 'user' ? '用户' : 'AI助教'
    return `${speaker}：${message.content}`
  })
  return [`会话：${session.title}`, '', ...messages].join('\r\n')
}

async function copySessionText(session: ConversationSession) {
  if (!session.messages.length) return
  const text = sessionExportText(session)
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
  }
  ElMessage.success('聊天记录已复制')
}

function safeFileName(value: string): string {
  const normalized = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim()
  return normalized || '聊天记录'
}

function downloadSessionText(session: ConversationSession) {
  if (!session.messages.length) return
  const blob = new Blob([`\uFEFF${sessionExportText(session)}`], {
    type: 'text/plain;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${safeFileName(session.title)}.txt`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
  ElMessage.success('聊天记录已下载')
}

function handleExportCommand(
  command: 'copy' | 'download',
  session: ConversationSession,
) {
  if (command === 'copy') void copySessionText(session)
  else downloadSessionText(session)
}

function toggleMessageFavorite(message: ChatMessage) {
  if (!activeSession.value) return
  const favorite = favoriteStore.toggleFavorite(message, activeSession.value)
  ElMessage.success(favorite ? '消息已收藏' : '已取消收藏')
}

function switchSession(localId: string) {
  if (sending.value || recording.value || voiceBusy.value) return
  if (!conversationStore.selectSession(localId)) return
  activeNavigation.value = 'chat'
  cancelRename()
  closeContextMenu()
  input.value = ''
  errorText.value = ''
  void scrollToBottom()
}

function formatSessionTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function startRename(localId: string) {
  const session = sessions.value.find((item) => item.localId === localId)
  if (!session) return
  renamingSessionId.value = localId
  renameInput.value = session.title
  closeContextMenu()
  void nextTick(() => {
    const inputElement = document.querySelector<HTMLInputElement>(
      '.session-rename-input',
    )
    inputElement?.focus()
    inputElement?.select()
  })
}

function confirmRename() {
  if (!renamingSessionId.value) return
  if (!renameInput.value.trim()) {
    ElMessage.warning('会话标题不能为空')
    document.querySelector<HTMLInputElement>('.session-rename-input')?.focus()
    return
  }
  conversationStore.renameSession(
    renamingSessionId.value,
    renameInput.value,
  )
  renamingSessionId.value = null
  renameInput.value = ''
}

function cancelRename() {
  renamingSessionId.value = null
  renameInput.value = ''
}

async function requestDeleteSession(localId: string) {
  closeContextMenu()
  cancelRename()
  try {
    await ElMessageBox.confirm(
      '确定删除该会话吗？删除后不可恢复',
      '删除会话',
      {
        confirmButtonText: '确认删除',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )
  } catch {
    return
  }

  conversationStore.deleteSession(localId)
  ElMessage.success('会话已删除')
  void scrollToBottom()
}

function toggleSessionPinned(localId: string) {
  conversationStore.togglePinned(localId)
  closeContextMenu()
}

function openContextMenu(event: MouseEvent, localId: string) {
  const menuWidth = 164
  const menuHeight = 132
  contextMenu.value = {
    visible: true,
    x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
    y: Math.max(
      8,
      Math.min(event.clientY, window.innerHeight - menuHeight - 8),
    ),
    sessionId: localId,
  }
}

function closeContextMenu() {
  contextMenu.value.visible = false
}

function closeContextMenuOnOutsideClick() {
  closeContextMenu()
}

function closeFloatingMenusOnEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  accountMenuOpen.value = false
  closeContextMenu()
  cancelRename()
}

async function sendMessage() {
  const text = input.value.trim()
  if (
    !text ||
    sending.value ||
    commandProcessing.value ||
    assistantLoading.value
  ) return

  if (assistantActive.value) {
    await sendAssistantMessage(text)
    return
  }

  if (isResourceChatRequest(text)) {
    sending.value = true
    await runResourceChatCommand(text)
    sending.value = false
    return
  }

  classroomCommandStore.clearResult()

  // 快照只包含之前的对话；当前这一句由 text 单独发送。
  const history = messages.value.map(({ role, content }) => ({
    role,
    content,
  }))
  conversationStore.appendMessage({ role: 'user', content: text })
  input.value = ''
  errorText.value = ''
  sending.value = true

  try {
    const { data } = await http.post<ChatResponse>('/ai/chat', {
      text,
      history,
      sessionId: activeSession.value?.backendSessionId ?? undefined,
    })
    if (typeof data.reply !== 'string' || !data.reply.trim()) {
      throw new Error('AI 助教没有返回文字回复，请稍后重试。')
    }

    conversationStore.setBackendSessionId(data.sessionId)
    conversationStore.appendMessage({
      role: 'assistant',
      content: data.reply.trim(),
    })
    saveHistory()
    if (data.resourceAction) {
      try {
        await playResourceAction(data.resourceAction)
      } catch (error) {
        errorText.value =
          error instanceof Error ? error.message : '资源播放失败，请重试。'
      }
    }
  } catch (error) {
    // 发送失败时恢复输入，避免把失败消息加入下一轮上下文。
    conversationStore.removeLastMessage()
    input.value = text
    errorText.value = apiErrorMessage(error, '发送失败，请稍后重试。')
  } finally {
    sending.value = false
  }
}

// ===== 新增：录音、ASR、聊天、TTS 串联逻辑 开始 =====
function stopMediaTracks() {
  mediaStream?.getTracks().forEach((track) => track.stop())
  mediaStream = null
}

function releaseCurrentAudio() {
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.src = ''
    currentAudio = null
  }
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl)
    currentObjectUrl = null
  }
  playingAudio.value = false
  playingResourceTitle.value = ''
}

function stopChatAudioForResourcePlayer() {
  releaseCurrentAudio()
}

async function recognizeVoiceInput(audioBlob: Blob): Promise<string> {
  const formData = new FormData()
  formData.append('file', audioBlob, `recording-${Date.now()}.wav`)
  try {
    const { data } = await http.post<{ text: string }>('/ai/asr', formData)
    const text = typeof data.text === 'string' ? data.text.trim() : ''
    if (!text) throw new Error('没有识别到你说的话，请重新试一次。')
    return text
  } catch (error) {
    throw new Error(apiErrorMessage(error, '语音识别失败，请稍后重试。'), {
      cause: error,
    })
  }
}

async function playAudioSource(
  source: string,
  objectUrl: string | null = null,
  resourceTitle = '',
) {
  resourcePlayerStore.close()
  releaseCurrentAudio()
  currentObjectUrl = objectUrl
  playingResourceTitle.value = resourceTitle

  const audio = new Audio(source)
  currentAudio = audio
  audio.addEventListener(
    'ended',
    () => {
      if (currentAudio === audio) releaseCurrentAudio()
    },
    { once: true },
  )
  audio.addEventListener(
    'error',
    () => {
      if (currentAudio === audio) releaseCurrentAudio()
    },
    { once: true },
  )

  try {
    await audio.play()
    playingAudio.value = true
  } catch (error) {
    releaseCurrentAudio()
    throw new Error(
      '浏览器阻止了自动播放，请允许页面播放声音后重试。',
      {
        cause: error,
      },
    )
  }
}

function resourceContentUrl(contentUrl: string): string {
  if (!contentUrl.startsWith('/')) return contentUrl
  const baseUrl = String(import.meta.env.VITE_API_BASE_URL || '').replace(
    /\/$/,
    '',
  )
  return `${baseUrl}${contentUrl}`
}

async function playResourceAction(action: ResourceAction) {
  await playAudioSource(
    resourceContentUrl(action.resource.contentUrl),
    null,
    action.resource.title,
  )
}

async function handleRecordedAudio(audioBlob: Blob) {
  let pendingUserMessage = false
  try {
    if (!audioBlob.size) throw new Error('没有录到声音，请重新录制。')

    recognizing.value = true
    const wavBlob = await webmToWav(audioBlob)
    const userText = await recognizeVoiceInput(wavBlob)
    recognizing.value = false

    voiceReplyLoading.value = true
    if (isResourceChatRequest(userText)) {
      await runResourceChatCommand(userText, true)
      voiceReplyLoading.value = false
      return
    }

    classroomCommandStore.clearResult()

    const history = messages.value.map(({ role, content }) => ({ role, content }))
    conversationStore.appendMessage({
      role: 'user',
      content: userText,
    })
    pendingUserMessage = true
    const { data } = await http.post<ChatResponse>('/ai/chat', {
      text: userText,
      history,
      sessionId: activeSession.value?.backendSessionId ?? undefined,
    })
    if (typeof data.reply !== 'string' || !data.reply.trim()) {
      throw new Error('AI 助教没有返回文字回复，请稍后重试。')
    }
    conversationStore.setBackendSessionId(data.sessionId)
    conversationStore.appendMessage({
      role: 'assistant',
      content: data.reply.trim(),
    })
    pendingUserMessage = false
    saveHistory()
    voiceReplyLoading.value = false

    if (data.resourceAction) {
      await playResourceAction(data.resourceAction)
    } else {
      synthesizing.value = true
      const { data: speech } = await http.post<{ audioUrl: string }>('/ai/tts', {
        text: data.reply.trim(),
      })
      if (typeof speech.audioUrl !== 'string' || !speech.audioUrl.trim()) {
        throw new Error('语音服务没有返回可播放内容。')
      }
      await playAudioSource(speech.audioUrl.trim())
      synthesizing.value = false
    }
  } catch (error) {
    if (pendingUserMessage) conversationStore.removeLastMessage()
    console.error('语音对话失败：', error)
    errorText.value =
      error instanceof TypeError
        ? '网络连接失败，请确认后端服务已启动后重试。'
        : error instanceof Error
          ? error.message
          : '语音对话失败，请稍后重试。'
  } finally {
    recognizing.value = false
    voiceReplyLoading.value = false
    synthesizing.value = false
  }
}

async function startRecording() {
  if (
    !navigator.mediaDevices?.getUserMedia ||
    typeof MediaRecorder === 'undefined'
  ) {
    throw new Error('当前浏览器不支持麦克风录音，请使用最新版 Chrome 或 Edge。')
  }
  if (!MediaRecorder.isTypeSupported(RECORDING_MIME_TYPE)) {
    throw new Error(
      '当前浏览器不支持 WebM 录音格式，请使用最新版 Chrome 或 Edge。',
    )
  }

  requestingMicrophone.value = true
  errorText.value = ''
  releaseCurrentAudio()

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    })
    const recorder = new MediaRecorder(stream, {
      mimeType: RECORDING_MIME_TYPE,
    })

    mediaStream = stream
    mediaRecorder = recorder
    audioChunks = []

    recorder.addEventListener('dataavailable', (event: BlobEvent) => {
      if (event.data.size > 0) audioChunks.push(event.data)
    })
    recorder.addEventListener(
      'stop',
      () => {
        const audioBlob = new Blob(audioChunks, { type: RECORDING_MIME_TYPE })
        audioChunks = []
        mediaRecorder = null
        stopMediaTracks()
        if (!componentUnmounted) void handleRecordedAudio(audioBlob)
      },
      { once: true },
    )
    recorder.addEventListener(
      'error',
      (event) => {
        console.error('MediaRecorder 录音错误：', event)
        errorText.value = '录音发生错误，请重新尝试。'
        recording.value = false
        mediaRecorder = null
        stopMediaTracks()
      },
      { once: true },
    )

    recorder.start()
    recording.value = true
  } catch (error) {
    stopMediaTracks()
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      throw new Error('麦克风权限被拒绝，请在浏览器设置中允许使用麦克风。', {
        cause: error,
      })
    }
    throw error
  } finally {
    requestingMicrophone.value = false
  }
}

function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return
  recording.value = false
  recognizing.value = true
  mediaRecorder.stop()
}

async function toggleRecording() {
  if (recording.value) {
    stopRecording()
    return
  }
  if (sending.value || voiceBusy.value) return

  try {
    await startRecording()
  } catch (error) {
    console.error('无法开始录音：', error)
    errorText.value =
      error instanceof Error ? error.message : '无法使用麦克风，请稍后重试。'
  }
}

function openLogin() {
  void router.push('/login')
}

function toggleAccountMenu() {
  if (!isLogin.value) {
    openLogin()
    return
  }
  accountMenuOpen.value = !accountMenuOpen.value
}

function closeAccountMenuOnOutsideClick(event: MouseEvent) {
  closeContextMenu()
  const target = event.target
  if (
    target instanceof Node &&
    accountAreaRef.value &&
    !accountAreaRef.value.contains(target)
  ) {
    accountMenuOpen.value = false
  }
}

function logout() {
  accountMenuOpen.value = false
  userStore.logout()
  errorText.value = ''
  void router.push('/login')
  ElMessage.success('已退出登录')
}

onBeforeUnmount(() => {
  document.removeEventListener('click', closeAccountMenuOnOutsideClick)
  document.removeEventListener('contextmenu', closeContextMenuOnOutsideClick)
  document.removeEventListener('keydown', closeFloatingMenusOnEscape)
  window.removeEventListener(
    RESOURCE_PLAYER_CLAIM_EVENT,
    stopChatAudioForResourcePlayer,
  )
  componentUnmounted = true
  classroomAssistantStore.cancel()
  lessonRunStore.stopPolling()
  if (mediaRecorder?.state === 'recording') mediaRecorder.stop()
  stopMediaTracks()
  releaseCurrentAudio()
})
// ===== 新增：录音、ASR、聊天、TTS 串联逻辑 结束 =====
</script>

<template>
  <main class="chat-page">
    <div class="chat-shell">
      <!-- ===== 阶段5新增：会话侧边栏 开始 ===== -->
      <aside class="session-sidebar" aria-label="历史会话">
        <ElInput
          v-model="sessionSearch"
          class="session-search"
          clearable
          aria-label="搜索会话"
          placeholder="搜索会话"
        >
          <template #prefix>
            <span aria-hidden="true">⌕</span>
          </template>
        </ElInput>

        <ElButton
          class="new-session-button"
          type="primary"
          :disabled="sending || recording || voiceBusy"
          @click="newSession"
        >
          <span aria-hidden="true">＋</span>
          新建会话
        </ElButton>

        <section class="session-history" aria-labelledby="history-title">
          <div class="session-history-heading">
            <div>
              <p class="sidebar-eyebrow">
                {{ isLogin ? '教师空间' : '游客空间' }}
              </p>
              <h2 id="history-title">历史会话</h2>
            </div>
            <span class="session-count">{{ filteredSessions.length }}</span>
          </div>

          <nav class="session-list" aria-label="会话列表">
            <div
              v-for="session in filteredSessions"
              :key="session.localId"
              class="session-item"
              :class="{
                active: session.localId === activeSession?.localId,
                disabled: sending || recording || voiceBusy,
              }"
              role="button"
              :tabindex="renamingSessionId === session.localId ? -1 : 0"
              @click="switchSession(session.localId)"
              @keydown.enter.prevent="switchSession(session.localId)"
              @contextmenu.prevent.stop="openContextMenu($event, session.localId)"
            >
              <span v-if="session.pinned" class="pinned-mark" aria-label="已置顶">
                📌
              </span>
              <input
                v-if="renamingSessionId === session.localId"
                v-model="renameInput"
                class="session-rename-input"
                maxlength="40"
                aria-label="编辑会话标题"
                @click.stop
                @keydown.enter.prevent.stop="confirmRename"
                @keydown.esc.prevent.stop="cancelRename"
              />
              <span v-else class="session-title">{{ session.title }}</span>
              <span class="session-time">
                {{ formatSessionTime(session.updatedAt) }}
              </span>
              <span
                v-if="session.unread"
                class="unread-dot"
                aria-label="有未读回复"
              ></span>
              <span
                v-if="renamingSessionId !== session.localId"
                class="session-actions"
                @click.stop
              >
                <ElDropdown
                  trigger="click"
                  :disabled="session.messages.length === 0"
                  @command="handleExportCommand($event, session)"
                >
                  <button
                    type="button"
                    title="导出"
                    aria-label="导出聊天记录"
                    :disabled="session.messages.length === 0"
                    @click.stop
                  >
                    ↥
                  </button>
                  <template #dropdown>
                    <ElDropdownMenu>
                      <ElDropdownItem command="copy">
                        一键复制全部聊天文本
                      </ElDropdownItem>
                      <ElDropdownItem command="download">
                        下载 TXT 文件
                      </ElDropdownItem>
                    </ElDropdownMenu>
                  </template>
                </ElDropdown>
                <button
                  type="button"
                  title="重命名"
                  aria-label="重命名会话"
                  @click.stop="startRename(session.localId)"
                >
                  ✎
                </button>
                <button
                  type="button"
                  title="删除"
                  aria-label="删除会话"
                  @click.stop="requestDeleteSession(session.localId)"
                >
                  ×
                </button>
              </span>
            </div>

            <p v-if="filteredSessions.length === 0" class="session-empty">
              {{ sessionSearch.trim() ? '没有匹配的会话' : '还没有会话' }}
            </p>
          </nav>
        </section>

        <nav class="feature-navigation" aria-label="功能导航">
          <button
            type="button"
          class="feature-nav-item"
          :class="{ active: activeNavigation === 'chat' }"
            @click="openChatNavigation"
          >
            <span class="feature-nav-icon" aria-hidden="true">💬</span>
            <span>聊天</span>
          </button>
          <button
            type="button"
          class="feature-nav-item"
          :class="{ active: activeNavigation === 'resources' }"
            @click="openResourceNavigation"
          >
            <span class="feature-nav-icon" aria-hidden="true">📚</span>
            <span>课程资源</span>
          </button>
          <button
            type="button"
            class="feature-nav-item"
            :class="{ active: activeNavigation === 'favorites' }"
            @click="openFavoritesNavigation"
          >
            <span class="feature-nav-icon" aria-hidden="true">⭐</span>
            <span>我的收藏</span>
          </button>
          <button
            v-if="isLogin"
            type="button"
            class="feature-nav-item"
            @click="router.push('/my-classes')"
          >
            <span class="feature-nav-icon" aria-hidden="true">🏫</span>
            <span>我的班级</span>
          </button>
          <button
            v-if="isLogin"
            type="button"
            class="feature-nav-item"
            @click="router.push('/lesson-plans')"
          >
            <span class="feature-nav-icon" aria-hidden="true">📝</span>
            <span>备课中心</span>
          </button>
          <button
            v-if="isLogin && isAdmin"
            type="button"
            class="feature-nav-item"
            @click="router.push('/students')"
          >
            <span class="feature-nav-icon" aria-hidden="true">🧒</span>
            <span>学生管理</span>
          </button>
        </nav>

        <div
          ref="accountAreaRef"
          class="sidebar-account"
          @click.stop
        >
          <button
            type="button"
            class="account-row"
            :aria-expanded="isLogin ? accountMenuOpen : undefined"
            :aria-haspopup="isLogin ? 'menu' : undefined"
            @click.stop="toggleAccountMenu"
          >
            <span class="account-avatar" aria-hidden="true">👩‍🏫</span>
            <span class="account-copy">
              <strong>{{ teacherInfo?.name || '教师登录' }}</strong>
              <small>{{ teacherInfo?.account || '登录后管理会话' }}</small>
            </span>
            <span v-if="isLogin" class="account-chevron" aria-hidden="true">
              {{ accountMenuOpen ? '⌃' : '⌄' }}
            </span>
          </button>

          <Transition name="account-menu">
            <div
              v-if="isLogin && accountMenuOpen"
              class="account-dropdown"
              role="menu"
              @click.stop
            >
              <button type="button" role="menuitem" @click.stop="logout">
                <span aria-hidden="true">↪</span>
                退出登录
              </button>
            </div>
          </Transition>
        </div>
      </aside>

      <Teleport to="body">
        <div
          v-if="contextMenu.visible && contextMenuSession"
          class="session-context-menu"
          :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
          role="menu"
          @click.stop
          @contextmenu.prevent
        >
          <button
            type="button"
            role="menuitem"
            @click="toggleSessionPinned(contextMenu.sessionId)"
          >
            <span aria-hidden="true">📌</span>
            {{ contextMenuSession.pinned ? '取消置顶' : '置顶' }}
          </button>
          <button
            type="button"
            role="menuitem"
            @click="startRename(contextMenu.sessionId)"
          >
            <span aria-hidden="true">✎</span>
            重命名
          </button>
          <button
            type="button"
            class="danger"
            role="menuitem"
            @click="requestDeleteSession(contextMenu.sessionId)"
          >
            <span aria-hidden="true">×</span>
            删除
          </button>
        </div>
      </Teleport>
      <!-- ===== 阶段5新增：会话侧边栏 结束 ===== -->

      <section
        v-show="activeNavigation === 'chat'"
        class="chat-card"
        aria-label="幼儿园 AI 助教聊天"
      >
      <header class="chat-header">
        <div class="assistant-icon" aria-hidden="true">🌼</div>
        <div class="header-copy">
          <p class="eyebrow">幼儿园小助手</p>
          <h1>{{ isBreakActive ? '课间休息' : (assistantActive ? '启发式课堂助教' : '和小花老师聊聊天') }}</h1>
          <p class="subtitle">
            {{ isBreakActive ? '让小朋友休息一下吧' : (assistantActive ? '教师控制 · 先预览再播放' : '你说的话，我会认真听呀') }}
          </p>
        </div>
        <div class="header-actions">
          <ElButton
            v-if="isLogin"
            class="break-mode-button"
            :type="isBreakActive ? 'success' : 'default'"
            :disabled="recording || voiceBusy || runBusy"
            @click="isBreakActive ? endBreak() : openBreakConfig()"
          >
            {{ isBreakActive ? '退出课间模式' : '课间模式' }}
          </ElButton>
          <ElButton
            v-if="isLogin"
            class="assistant-mode-button"
            :type="assistantActive ? 'primary' : 'default'"
            :disabled="recording || voiceBusy"
            @click="toggleAssistantMode"
          >
            {{ assistantActive ? '返回聊天' : '启发引导' }}
          </ElButton>
          <span class="text-badge">
            {{ assistantActive ? '教师控制 · 先预览再播放' : '文字 · 语音' }}
          </span>
        </div>
      </header>

      <!-- 课间模式：isBreakActive 时接管主内容，隐藏聊天框与启发式助教表单 -->
      <div v-if="isBreakActive" class="chat-break" data-test="chat-break" aria-live="polite">
        <div class="chat-break-card">
          <span class="chat-break-emoji" aria-hidden="true">☕</span>
          <h2>课间休息</h2>
          <p class="chat-break-sub">让小朋友休息一下吧</p>
          <div class="chat-break-time" data-test="chat-break-countdown">{{ breakTimeText }}</div>
          <p v-if="runTitle" class="chat-break-lesson">本节课程：{{ runTitle }}</p>
          <ElButton size="large" :disabled="runBusy" @click="endBreak">
            {{ runBusy ? '处理中…' : '提前结束课间' }}
          </ElButton>
        </div>
      </div>

      <!-- 课间时长选择：仅在选择开启课间时显示 -->
      <div v-if="breakConfigOpen" class="break-config" data-test="break-config">
        <span class="break-config-label">选择课间时长：</span>
        <ElButton
          v-for="d in BREAK_DURATIONS"
          :key="d.seconds"
          :disabled="runBusy"
          @click="startBreak(d.seconds)"
        >
          {{ d.label }}
        </ElButton>
        <ElButton text @click="breakConfigOpen = false">取消</ElButton>
      </div>

      <ClassroomAssistantPanel
        v-if="assistantActive && !isBreakActive"
        :playing="playingAudio || assistantSpeechLoading"
        @tool="runAssistantTool"
        @prompt="runAssistantPrompt"
        @play="playAssistantDraft"
        @stop="stopAssistantResponse"
        @confirm-action="confirmAssistantAction"
        @end="endAssistantInteraction"
      />

      <div v-if="!isBreakActive" class="message-area" aria-live="polite">
        <div v-if="messages.length === 0" class="welcome">
          <div class="welcome-icon" aria-hidden="true">✨</div>
          <h2>你好呀，小朋友！</h2>
          <p>
            今天想聊些什么？可以告诉我你喜欢的故事、小动物，或者问我一个问题。
          </p>
        </div>

        <div
          v-for="message in messages"
          :key="message.id"
          class="message-row"
          :class="message.role === 'user' ? 'from-user' : 'from-assistant'"
        >
          <div class="message-avatar" aria-hidden="true">
            {{ message.role === 'assistant' ? '🌼' : '我' }}
          </div>
          <div class="message-bubble">
            <div class="message-content">{{ message.content }}</div>
            <button
              type="button"
              class="favorite-message-button"
              :class="{ active: favoriteStore.isFavorite(message.id) }"
              :aria-label="
                favoriteStore.isFavorite(message.id) ? '取消收藏' : '收藏消息'
              "
              :title="
                favoriteStore.isFavorite(message.id) ? '取消收藏' : '收藏'
              "
              @click="toggleMessageFavorite(message)"
            >
              {{ favoriteStore.isFavorite(message.id) ? '★ 已收藏' : '☆ 收藏' }}
            </button>
          </div>
        </div>

        <div v-if="sending" class="message-row from-assistant">
          <div class="message-avatar" aria-hidden="true">🌼</div>
          <div class="message-bubble typing" aria-label="小花老师正在思考">
            正在想一想…
          </div>
        </div>
        <!-- ===== 新增：语音提问的 AI 回复加载提示 开始 ===== -->
        <div v-if="voiceReplyLoading" class="message-row from-assistant">
          <div class="message-avatar" aria-hidden="true">🌼</div>
          <div class="message-bubble typing" aria-label="小花老师正在思考">
            正在想一想…
          </div>
        </div>
        <!-- ===== 新增：语音提问的 AI 回复加载提示 结束 ===== -->
        <div ref="bottomRef"></div>
      </div>

      <div v-if="!isBreakActive" class="composer">
        <section
          v-if="commandCandidates.length"
          class="command-panel"
          aria-label="课程资源选择"
        >
          <div class="command-mode-title">
            <strong>📚 找到多个课程资源</strong>
            <span>请选择要打开的一项</span>
          </div>
          <p v-if="commandFeedback" class="command-feedback" role="status">
            {{ commandFeedback }}
          </p>
          <div v-if="commandCandidates.length" class="command-candidates">
            <button
              v-for="resource in commandCandidates"
              :key="resource.id"
              type="button"
              class="command-candidate"
              @click="classroomCommandStore.confirmCandidate(resource)"
            >
              <span aria-hidden="true">
                {{
                  resource.mediaType === 'audio'
                    ? '🎵'
                    : resource.mediaType === 'video'
                      ? '🎬'
                      : resource.mediaType === 'image'
                        ? '🖼️'
                        : '📄'
                }}
              </span>
              <span>
                <strong>{{ resource.title }}</strong>
                <small>{{ commandResourceTypeLabel(resource) }} · {{ resource.category }}</small>
              </span>
            </button>
          </div>
        </section>
        <ElAlert
          v-if="errorText"
          class="error-alert"
          :title="errorText"
          type="error"
          show-icon
          :closable="false"
        />
        <div class="composer-row">
          <ElInput
            v-model="input"
            type="textarea"
            :autosize="{ minRows: 2, maxRows: 4 }"
            :maxlength="2000"
            :placeholder="assistantActive ? '输入孩子刚才的问题或回答…' : '写下你想说的话，或说“打开课程资源里的小星星”…'"
            :disabled="
              sending ||
              commandProcessing ||
              assistantLoading ||
              recording ||
              voiceBusy
            "
            :aria-label="assistantActive ? '输入儿童问题或回答' : '输入聊天消息'"
            @keydown.enter.exact.prevent="sendMessage"
          />
          <!-- ===== 新增：麦克风录音按钮 开始 ===== -->
          <ElButton
            class="voice-button"
            :class="{ 'is-recording': recording }"
            :loading="
              requestingMicrophone ||
              recognizing ||
              voiceReplyLoading ||
              synthesizing
            "
            :disabled="
              assistantActive ||
              sending ||
              (voiceBusy && !recording)
            "
            :aria-label="recording ? '结束录音' : '开始录音'"
            @click="toggleRecording"
          >
            <span v-if="!voiceBusy" aria-hidden="true">{{
              recording ? '■' : '🎤'
            }}</span>
            {{ recording ? '结束' : '语音' }}
          </ElButton>
          <!-- ===== 新增：麦克风录音按钮 结束 ===== -->
          <ElButton
            class="send-button"
            type="primary"
            :loading="sending || commandProcessing || assistantLoading"
            :disabled="
              !input.trim() ||
              recording ||
              voiceBusy ||
              commandProcessing ||
              assistantLoading
            "
            @click="sendMessage"
          >
            {{ assistantActive ? '交给助教' : '发送' }}
          </ElButton>
        </div>
        <!-- ===== 新增：语音流程状态提示 开始 ===== -->
        <p
          v-if="voiceStatusText"
          class="voice-status"
          :class="{ recording }"
          role="status"
          aria-live="polite"
        >
          <span class="status-dot" aria-hidden="true"></span>
          {{ voiceStatusText }}
        </p>
        <!-- ===== 新增：语音流程状态提示 结束 ===== -->
        <p class="composer-hint">
          {{ assistantActive ? 'AI 只生成草稿，由教师决定是否播放' : '可直接说话或输入文字，也可要求打开课程资源' }}
        </p>
      </div>
      </section>

      <CourseResourcesPanel
        v-show="activeNavigation === 'resources'"
        @copy-to-chat="copyResourceToChat"
      />

      <FavoritesPanel v-show="activeNavigation === 'favorites'" />

    </div>
  </main>
</template>

<style scoped>
:global(html),
:global(body),
:global(#app) {
  min-height: 100%;
  margin: 0;
}

:global(body) {
  font-family: 'Nunito', 'Microsoft YaHei', 'PingFang SC', sans-serif;
}

.chat-page {
  min-height: 100dvh;
  padding: 28px 16px;
  box-sizing: border-box;
  display: flex;
  justify-content: center;
  align-items: center;
  background:
    radial-gradient(circle at 15% 18%, #fff7c9 0, transparent 33%),
    radial-gradient(circle at 90% 80%, #ffe5dc 0, transparent 33%), #fffaf2;
  color: #473d36;
}

.chat-shell {
  width: min(100%, 1180px);
  height: min(800px, calc(100dvh - 56px));
  min-height: 500px;
  display: flex;
  overflow: hidden;
  border: 1px solid #f5e5d5;
  border-radius: 28px;
  background: #fffdfa;
  box-shadow: 0 20px 60px rgb(130 83 42 / 12%);
}

.session-sidebar {
  width: 276px;
  flex: none;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  padding: 22px 18px 16px;
  border-right: 1px solid #f1e3d5;
  background: #fff8ed;
}

.sidebar-eyebrow {
  margin: 0;
  color: #be8065;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.session-search {
  flex: none;
  margin-bottom: 10px;
}

.session-search :deep(.el-input__wrapper) {
  border-radius: 12px;
  background: #fffdfa;
  box-shadow: 0 0 0 1px #ead9ca inset;
}

.session-search :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px #e2a17e inset;
}

.new-session-button {
  width: 100%;
  height: 42px;
  flex: none;
  gap: 5px;
  padding: 0 16px;
  border: 0;
  border-radius: 13px;
  background: #e9956e;
  font-weight: 700;
}

.new-session-button:not(.is-disabled):hover,
.new-session-button:not(.is-disabled):focus {
  background: #dc855f;
}

.session-history {
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  margin-top: 20px;
}

.session-history-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 4px 10px;
}

.session-history-heading h2 {
  margin: 2px 0 0;
  font-size: 17px;
}

.session-count {
  display: grid;
  min-width: 24px;
  height: 24px;
  place-items: center;
  border-radius: 999px;
  background: #f3e3d5;
  color: #886d5c;
  font-size: 11px;
  font-weight: 700;
}

.session-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 6px;
  scrollbar-color: #e9d7c8 transparent;
  scrollbar-width: thin;
}

.session-list::-webkit-scrollbar {
  width: 5px;
}

.session-list::-webkit-scrollbar-track {
  border-radius: 999px;
  background: #f7eee5;
}

.session-list::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: #dbc3b2;
}

.session-list::-webkit-scrollbar-thumb:hover {
  background: #cdaa94;
}

.session-item {
  position: relative;
  width: 100%;
  display: grid;
  gap: 5px;
  box-sizing: border-box;
  margin-bottom: 7px;
  padding: 12px;
  border: 1px solid transparent;
  border-radius: 13px;
  background: transparent;
  color: #675348;
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.session-item:hover,
.session-item:focus-visible {
  border-color: #efd9c8;
  background: #fffdf9;
  outline: none;
}

.session-item.active {
  border-color: #edc8b2;
  background: #ffeade;
}

.session-item.disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.session-title {
  overflow: hidden;
  font-size: 14px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-time {
  color: #a28a7a;
  font-size: 11px;
}

.session-rename-input {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 4px 7px;
  border: 1px solid #e7ad8d;
  border-radius: 8px;
  outline: none;
  background: #fffdfa;
  color: #604d42;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
}

.pinned-mark,
.unread-dot {
  position: absolute;
  z-index: 1;
  pointer-events: none;
}

.pinned-mark {
  right: 9px;
  bottom: 8px;
  font-size: 11px;
}

.unread-dot {
  top: 9px;
  right: 10px;
  width: 8px;
  height: 8px;
  border: 2px solid #fff8ed;
  border-radius: 50%;
  background: #e85b5b;
  box-shadow: 0 1px 4px rgb(185 56 56 / 25%);
}

.session-actions {
  position: absolute;
  z-index: 2;
  top: 50%;
  right: 6px;
  display: flex;
  gap: 3px;
  padding: 4px 3px 4px 15px;
  opacity: 0;
  background: linear-gradient(90deg, transparent, #fffdf9 32%);
  pointer-events: none;
  transform: translateY(-50%);
  transition: opacity 0.16s ease;
}

.session-item.active .session-actions {
  background: linear-gradient(90deg, transparent, #ffeade 32%);
}

.session-item:hover .session-actions,
.session-item:focus-within .session-actions {
  opacity: 1;
  pointer-events: auto;
}

.session-actions button {
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: #f7e8dc;
  color: #8e6d59;
  cursor: pointer;
  font: inherit;
  font-size: 15px;
}

.session-actions button:hover,
.session-actions button:focus-visible {
  background: #edcdbb;
  color: #814f3d;
  outline: none;
}

.session-actions :deep(.el-dropdown) {
  display: inline-flex;
}

.session-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

.session-empty {
  margin: 22px 8px;
  color: #a38a79;
  font-size: 12px;
  text-align: center;
}

.session-context-menu {
  position: fixed;
  z-index: 3000;
  width: 156px;
  box-sizing: border-box;
  padding: 6px;
  border: 1px solid #ead6c6;
  border-radius: 12px;
  background: #fffdfa;
  box-shadow: 0 14px 36px rgb(92 57 35 / 20%);
}

.session-context-menu button {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #685347;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  text-align: left;
}

.session-context-menu button:hover,
.session-context-menu button:focus-visible {
  background: #fff0e7;
  outline: none;
}

.session-context-menu button.danger {
  color: #b24f4f;
}

.feature-navigation {
  flex: none;
  display: grid;
  gap: 5px;
  padding: 12px 0;
  border-top: 1px solid #f0e1d2;
}

.feature-nav-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  box-sizing: border-box;
  padding: 11px 12px;
  border: 1px solid transparent;
  border-radius: 12px;
  background: transparent;
  color: #806858;
  cursor: pointer;
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  text-align: left;
}

.feature-nav-item:hover,
.feature-nav-item:focus-visible {
  border-color: #efd9c8;
  background: #fffdf9;
  color: #654d40;
  outline: none;
}

.feature-nav-item.active {
  border-color: #edc8b2;
  background: #ffeade;
  color: #8f4f3d;
}

.feature-nav-icon {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border-radius: 8px;
  background: rgb(255 255 255 / 60%);
  font-size: 15px;
}

.sidebar-account {
  position: relative;
  flex: none;
  padding-top: 10px;
  border-top: 1px solid #f0e1d2;
}

.account-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  box-sizing: border-box;
  padding: 9px 10px;
  border: 1px solid transparent;
  border-radius: 13px;
  background: transparent;
  color: #604d42;
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.account-row:hover,
.account-row:focus-visible,
.account-row[aria-expanded='true'] {
  border-color: #efd9c8;
  background: #fffdf9;
  outline: none;
}

.account-avatar {
  display: grid;
  width: 38px;
  height: 38px;
  flex: none;
  place-items: center;
  border-radius: 12px;
  background: #ffedb8;
  font-size: 20px;
}

.account-copy {
  min-width: 0;
  flex: 1;
  display: grid;
}

.account-copy strong,
.account-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-copy strong {
  font-size: 14px;
}

.account-copy small {
  margin-top: 2px;
  color: #9b8373;
  font-size: 11px;
}

.account-chevron {
  color: #9f806d;
  font-size: 15px;
}

.account-dropdown {
  margin-top: 7px;
  padding: 5px;
  border: 1px solid #ecd8c8;
  border-radius: 12px;
  background: #fffdfa;
  box-shadow: 0 10px 24px rgb(117 75 42 / 14%);
}

.account-dropdown button {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 10px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: #a34f3f;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  text-align: left;
}

.account-dropdown button:hover,
.account-dropdown button:focus-visible {
  background: #fff0e9;
  outline: none;
}

.account-menu-enter-active,
.account-menu-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}

.account-menu-enter-from,
.account-menu-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.chat-card {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #fffdfa;
}

.chat-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 22px 28px;
  border-bottom: 1px solid #f4e9dc;
  background: #fff9ee;
}

.assistant-icon,
.welcome-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 58px;
  height: 58px;
  border-radius: 20px;
  background: #ffedb8;
  font-size: 30px;
}

.header-copy {
  min-width: 0;
  flex: 1;
}

.eyebrow,
.subtitle,
.composer-hint {
  margin: 0;
  color: #957d6c;
  font-size: 12px;
}

.eyebrow {
  color: #be8065;
  font-weight: 700;
  letter-spacing: 0.08em;
}

h1 {
  margin: 2px 0;
  font-size: 22px;
  line-height: 1.3;
}

.text-badge {
  padding: 7px 12px;
  border-radius: 999px;
  background: #eaf6e9;
  color: #548351;
  font-size: 12px;
  font-weight: 700;
}

.header-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.assistant-mode-button,
.break-mode-button,
.command-mode-button {
  height: 36px;
  border-radius: 11px;
  font-weight: 700;
}

/* ─── 课间模式（接管主内容）────────── */
.chat-break {
  flex: 1;
  min-height: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 28px;
}
.chat-break-card {
  text-align: center;
  background: #fff6ec;
  border: 1px solid #f0ddce;
  border-radius: 22px;
  padding: 36px 48px;
  box-shadow: 0 12px 30px #b9795120;
  max-width: 420px;
}
.chat-break-emoji {
  font-size: 52px;
  line-height: 1;
}
.chat-break-card h2 {
  margin: 10px 0 4px;
  color: #4f3d31;
  font-size: 30px;
  font-weight: 800;
}
.chat-break-sub {
  margin: 0;
  color: #9a7e6e;
  font-size: 15px;
}
.chat-break-time {
  font-size: 62px;
  font-weight: 800;
  color: #d67b59;
  font-variant-numeric: tabular-nums;
  margin: 18px 0 6px;
}
.chat-break-lesson {
  margin: 0 0 20px;
  color: #907b6c;
}
.break-config {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 20px;
  background: #fffaf3;
  border-bottom: 1px solid #f0ddce;
  flex-wrap: wrap;
}
.break-config-label {
  color: #9a7e6e;
  font-weight: 700;
}

.message-area {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 28px;
  scrollbar-color: #e9d7c8 transparent;
}

.welcome {
  width: min(100%, 360px);
  margin: 12vh auto 0;
  text-align: center;
}

.welcome-icon {
  margin: 0 auto 18px;
  background: #fff3d8;
}

.welcome h2 {
  margin: 0 0 10px;
  font-size: 24px;
}

.welcome p {
  margin: 0;
  color: #907b6c;
  line-height: 1.8;
}

.message-row {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  margin-bottom: 18px;
}

.message-avatar {
  display: grid;
  place-items: center;
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 13px;
  background: #ffedb8;
  font-size: 18px;
  font-weight: 700;
}

.message-bubble {
  max-width: min(75%, 530px);
  padding: 12px 16px;
  border-radius: 18px 18px 18px 5px;
  background: #f8f2e9;
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.message-content {
  white-space: pre-wrap;
}

.favorite-message-button {
  display: block;
  margin: 7px 0 -4px auto;
  padding: 3px 6px;
  border: 0;
  border-radius: 7px;
  opacity: 0;
  background: transparent;
  color: #a08b7c;
  cursor: pointer;
  font: inherit;
  font-size: 10px;
  transition:
    opacity 0.15s ease,
    background 0.15s ease,
    color 0.15s ease;
}

.message-row:hover .favorite-message-button,
.message-row:focus-within .favorite-message-button,
.favorite-message-button.active {
  opacity: 1;
}

.favorite-message-button:hover,
.favorite-message-button:focus-visible,
.favorite-message-button.active {
  background: rgb(255 255 255 / 65%);
  color: #c58b28;
  outline: none;
}

.from-user {
  flex-direction: row-reverse;
}

.from-user .message-avatar {
  background: #fbd7c7;
  color: #a65b42;
  font-size: 14px;
}

.from-user .message-bubble {
  border-radius: 18px 18px 5px 18px;
  background: #ffe7d8;
}

.typing {
  color: #9a806d;
}

.composer {
  padding: 18px 28px 20px;
  border-top: 1px solid #f4e9dc;
  background: #fffdfa;
}

.command-panel {
  margin-bottom: 12px;
  padding: 12px;
  border: 1px solid #f0cf9d;
  border-radius: 14px;
  background: #fff8e8;
}

.command-mode-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: #805a32;
  font-size: 13px;
}

.command-mode-title span,
.activity-step {
  color: #9b7651;
  font-size: 11px;
}

.command-feedback {
  margin: 9px 0 0;
  color: #654d3a;
  font-size: 13px;
  line-height: 1.5;
}

.activity-step {
  margin: 7px 0 0;
  font-weight: 700;
}

.command-confirm-button {
  height: 36px;
  margin-top: 10px;
  border-radius: 10px;
  font-weight: 700;
}

.command-candidates {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(165px, 1fr));
  gap: 8px;
  margin-top: 10px;
}

.command-candidate {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px;
  border: 1px solid #edcfac;
  border-radius: 11px;
  background: #fffdfa;
  color: #654d3a;
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.command-candidate:hover,
.command-candidate:focus-visible {
  border-color: #df9c70;
  background: #fff2e8;
  outline: none;
}

.command-candidate > span:last-child {
  min-width: 0;
  display: grid;
}

.command-candidate strong,
.command-candidate small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.command-candidate strong {
  font-size: 13px;
}

.command-candidate small {
  margin-top: 2px;
  color: #9b7651;
  font-size: 10px;
}

.error-alert {
  margin-bottom: 12px;
}

.composer-row {
  display: flex;
  align-items: flex-end;
  gap: 12px;
}

.composer-row :deep(.el-textarea__inner) {
  border-radius: 14px;
  padding: 12px 14px;
  box-shadow: 0 0 0 1px #e9dacc inset;
  font-family: inherit;
  resize: none;
}

.composer-row :deep(.el-textarea__inner:focus) {
  box-shadow: 0 0 0 1px #e9a780 inset;
}

.send-button {
  flex: none;
  height: 50px;
  padding: 0 24px;
  border: 0;
  border-radius: 14px;
  background: #e9956e;
  font-weight: 700;
}

/* ===== 新增：语音按钮与状态样式 开始 ===== */
.voice-button {
  flex: none;
  height: 50px;
  padding: 0 18px;
  border-color: #e8c6b4;
  border-radius: 14px;
  color: #a65b42;
  font-weight: 700;
}

.voice-button:not(.is-disabled):hover,
.voice-button:not(.is-disabled):focus {
  border-color: #e9956e;
  background: #fff4ed;
  color: #934a35;
}

.voice-button.is-recording {
  border-color: #e46868;
  background: #fff0f0;
  color: #c84d4d;
}

.voice-status {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 10px 0 0;
  color: #8c7464;
  font-size: 13px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #e9a06f;
  animation: status-pulse 1.2s ease-in-out infinite;
}

.voice-status.recording {
  color: #c84d4d;
}

.voice-status.recording .status-dot {
  background: #e46868;
}

@keyframes status-pulse {
  50% {
    opacity: 0.35;
    transform: scale(0.75);
  }
}
/* ===== 新增：语音按钮与状态样式 结束 ===== */

.send-button:not(.is-disabled):hover,
.send-button:not(.is-disabled):focus {
  background: #dc855f;
}

.composer-hint {
  margin-top: 9px;
  text-align: right;
}

@media (max-width: 760px) {
  .chat-page {
    padding: 0;
  }

  .chat-shell {
    width: 100%;
    height: 100dvh;
    min-height: 0;
    flex-direction: column;
    border: 0;
    border-radius: 0;
  }

  .session-sidebar {
    width: 100%;
    height: 292px;
    padding: 12px 14px 9px;
    border-right: 0;
    border-bottom: 1px solid #f1e3d5;
  }

  .new-session-button {
    height: 38px;
  }

  .session-history {
    margin-top: 10px;
  }

  .session-history-heading {
    padding-bottom: 6px;
  }

  .session-history-heading h2 {
    font-size: 15px;
  }

  .session-list {
    display: flex;
    gap: 7px;
    padding: 0 0 5px;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .session-item {
    width: 155px;
    min-width: 155px;
    margin: 0;
    padding: 9px 10px;
  }

  .feature-navigation {
    display: flex;
    gap: 7px;
    padding: 7px 0;
  }

  .feature-nav-item {
    justify-content: center;
    padding: 7px 10px;
  }

  .sidebar-account {
    padding-top: 7px;
  }

  .account-row {
    padding: 5px 9px;
  }

  .account-avatar {
    width: 32px;
    height: 32px;
    font-size: 17px;
  }

  .chat-card {
    min-height: 0;
  }

  .chat-header,
  .message-area,
  .composer {
    padding-left: 16px;
    padding-right: 16px;
  }

  .text-badge,
  .subtitle {
    display: none;
  }

  h1 {
    font-size: 18px;
  }

  .message-bubble {
    max-width: 80%;
  }

  .composer-row {
    gap: 8px;
  }

  .voice-button,
  .send-button {
    padding: 0 14px;
  }
}
</style>
