import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { apiErrorMessage, http } from '@/api/http'
import {
  normalizeServerResource,
  type CourseResource,
  type ResourceAgeGroup,
  type ServerResource,
} from './courseResource'
import { useResourcePlayerStore, type ResourcePlayerStatus } from './resourcePlayer'
import { useUserStore } from './user'

export const CLASSROOM_COMMAND_INTENTS = [
  'search_resource',
  'open_resource',
  'play_resource',
  'pause_media',
  'resume_media',
  'stop_media',
  'close_resource',
  'volume_up',
  'volume_down',
  'open_chat',
  'open_resources',
  'start_activity',
  'next_step',
  'previous_step',
  'unknown',
] as const

export type ClassroomCommandIntent = (typeof CLASSROOM_COMMAND_INTENTS)[number]
export type ClassroomPage = 'chat' | 'resources' | 'favorites'

export type ClassroomCommandContext = {
  currentPage: ClassroomPage
  currentResourceId?: number
  playerStatus: ResourcePlayerStatus
  ageGroup?: ResourceAgeGroup
}

type CommandCandidate = ServerResource & { score: number }

export type ClassroomCommandResponse = {
  mode: 'command'
  intent: ClassroomCommandIntent
  resourceType?: CourseResource['mediaType']
  keyword?: string
  confidence: number
  reply: string
  requiresConfirmation: boolean
  matchStatus:
    | 'not_required'
    | 'matched'
    | 'multiple'
    | 'low_confidence'
    | 'not_found'
  resource?: ServerResource
  candidates?: CommandCandidate[]
}

type NavigationRequest = {
  id: number
  page: 'chat' | 'resources'
}

function isAllowedIntent(value: unknown): value is ClassroomCommandIntent {
  return CLASSROOM_COMMAND_INTENTS.some((intent) => intent === value)
}

export const useClassroomCommandStore = defineStore('classroomCommand', () => {
  const userStore = useUserStore()
  const resourcePlayerStore = useResourcePlayerStore()
  const isCommandMode = ref(false)
  const processing = ref(false)
  const feedback = ref('')
  const candidates = ref<CourseResource[]>([])
  const pendingIntent = ref<ClassroomCommandIntent | null>(null)
  const confirmationRequired = ref(false)
  const navigationRequest = ref<NavigationRequest | null>(null)
  const activityStep = ref(0)
  let navigationSequence = 0
  let initialized = false

  function initialize() {
    if (initialized) return
    initialized = true
    watch(
      () => userStore.isLogin,
      (isLogin) => {
        if (!isLogin) reset()
      },
    )
  }

  function setCommandMode(enabled: boolean) {
    isCommandMode.value = enabled
    feedback.value = ''
    candidates.value = []
    pendingIntent.value = null
    confirmationRequired.value = false
  }

  function requestNavigation(page: 'chat' | 'resources') {
    navigationRequest.value = { id: ++navigationSequence, page }
  }

  function executeIntent(
    intent: ClassroomCommandIntent,
    resource?: CourseResource,
  ) {
    switch (intent) {
      case 'search_resource':
      case 'open_resource':
        if (!resource) return
        requestNavigation('resources')
        resourcePlayerStore.openResource(resource, false)
        return
      case 'play_resource':
        if (!resource) return
        requestNavigation('resources')
        resourcePlayerStore.openResource(resource, true)
        return
      case 'pause_media':
        resourcePlayerStore.requestControl('pause')
        return
      case 'resume_media':
        resourcePlayerStore.requestControl('resume')
        return
      case 'stop_media':
        resourcePlayerStore.requestControl('stop')
        return
      case 'close_resource':
        resourcePlayerStore.requestControl('close')
        return
      case 'volume_up':
        resourcePlayerStore.setVolume(resourcePlayerStore.volume + 0.1)
        return
      case 'volume_down':
        resourcePlayerStore.setVolume(resourcePlayerStore.volume - 0.1)
        return
      case 'open_chat':
        requestNavigation('chat')
        return
      case 'open_resources':
        requestNavigation('resources')
        return
      case 'start_activity':
        activityStep.value = 1
        return
      case 'next_step':
        activityStep.value = Math.max(1, activityStep.value + 1)
        return
      case 'previous_step':
        activityStep.value = Math.max(1, activityStep.value - 1)
        return
      case 'unknown':
        return
    }
  }

  async function submit(text: string, context: ClassroomCommandContext) {
    if (processing.value) return null
    processing.value = true
    feedback.value = ''
    candidates.value = []
    pendingIntent.value = null
    confirmationRequired.value = false
    try {
      const { data } = await http.post<ClassroomCommandResponse>('/ai/command', {
        text,
        context,
      })
      if (
        data.mode !== 'command' ||
        !isAllowedIntent(data.intent) ||
        typeof data.reply !== 'string'
      ) {
        throw new Error('课堂指令服务返回了无效结果。')
      }

      feedback.value = data.reply.trim()
      pendingIntent.value = data.intent
      candidates.value = (data.candidates ?? [])
        .map((candidate) => normalizeServerResource(candidate))
        .filter((resource): resource is CourseResource => !!resource)

      if (data.requiresConfirmation) {
        confirmationRequired.value =
          data.matchStatus === 'not_required' && data.intent !== 'unknown'
        return data
      }

      const resource = data.resource
        ? normalizeServerResource(data.resource)
        : undefined
      executeIntent(data.intent, resource ?? undefined)
      pendingIntent.value = null
      return data
    } catch (error) {
      const message = apiErrorMessage(error, '课堂指令执行失败，请稍后重试。')
      feedback.value = message
      throw new Error(message, { cause: error })
    } finally {
      processing.value = false
    }
  }

  function confirmCandidate(resource: CourseResource) {
    if (!pendingIntent.value) return
    const intent = pendingIntent.value
    executeIntent(intent, resource)
    feedback.value = `已选择《${resource.title}》。`
    candidates.value = []
    pendingIntent.value = null
    confirmationRequired.value = false
  }

  function confirmPendingAction() {
    if (!confirmationRequired.value || !pendingIntent.value) return
    executeIntent(pendingIntent.value)
    feedback.value = '已按教师确认执行课堂指令。'
    pendingIntent.value = null
    confirmationRequired.value = false
  }

  function executeConfirmedAction(
    intent: ClassroomCommandIntent,
    resource?: CourseResource,
  ) {
    if (!isAllowedIntent(intent) || intent === 'unknown') return
    executeIntent(intent, resource)
  }

  function clearResult() {
    feedback.value = ''
    candidates.value = []
    pendingIntent.value = null
    confirmationRequired.value = false
  }

  function reset() {
    isCommandMode.value = false
    processing.value = false
    clearResult()
    activityStep.value = 0
    navigationRequest.value = null
  }

  return {
    isCommandMode,
    processing,
    feedback,
    candidates,
    confirmationRequired,
    navigationRequest,
    activityStep,
    initialize,
    setCommandMode,
    submit,
    confirmCandidate,
    confirmPendingAction,
    executeConfirmedAction,
    clearResult,
    reset,
  }
})
