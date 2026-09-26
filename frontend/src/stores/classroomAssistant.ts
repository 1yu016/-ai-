import axios from 'axios'
import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { apiErrorMessage, http } from '@/api/http'
import {
  CLASSROOM_COMMAND_INTENTS,
  type ClassroomCommandIntent,
} from './classroomCommand'
import {
  useCourseResourceStore,
  type CourseResourceMediaType,
  type ResourceAgeGroup,
} from './courseResource'
import { useUserStore } from './user'

export const ASSISTANT_TOOLS = [
  'guided_question',
  'give_hint',
  'follow_up',
  'encourage',
  'summarize',
  'recommend_resource',
  'classroom_command',
  'safety_redirect',
  'unknown',
] as const

export type AssistantTool = (typeof ASSISTANT_TOOLS)[number]
export type AssistantResponseLength = 'short' | 'medium' | 'long'
export type AssistantPlaybackPolicy = 'confirm' | 'direct'
export type AssistantHistoryRole = 'child' | 'teacher' | 'assistant'

export type AssistantSuggestedAction = {
  type: 'recommend_resource' | 'classroom_command'
  resourceId?: number
  commandIntent?: ClassroomCommandIntent
  description: string
}

type AssistantHistoryItem = {
  role: AssistantHistoryRole
  content: string
}

type AssistantResponse = {
  mode: 'guided_dialogue'
  ability?: AssistantTool
  reply: string
  teacherTip: string
  suggestedAction: AssistantSuggestedAction | null
  requiresTeacherConfirmation: boolean
}

const PRIVACY_PATTERN =
  /(?:我叫|我的名字|我住在|家庭住址|电话号码|手机号|发照片|家庭情况)/
const NO_ANSWER_PATTERN = /(?:不知道|不会|不清楚|想不出来|没有发现|不明白)/

function isAssistantTool(value: unknown): value is AssistantTool {
  return ASSISTANT_TOOLS.some((tool) => tool === value)
}

function isCommandIntent(value: unknown): value is ClassroomCommandIntent {
  return CLASSROOM_COMMAND_INTENTS.some((intent) => intent === value)
}

function safeHistoryContent(value: string): string {
  return PRIVACY_PATTERN.test(value) ? '[儿童隐私内容已省略]' : value
}

export const useClassroomAssistantStore = defineStore(
  'classroomAssistant',
  () => {
    const userStore = useUserStore()
    const resourceStore = useCourseResourceStore()
    const active = ref(false)
    const loading = ref(false)
    const ageGroup = ref<ResourceAgeGroup>('middle')
    const theme = ref('当前课堂活动')
    const objective = ref('鼓励幼儿认真观察并说出自己的发现')
    const currentStep = ref('自由观察与表达')
    const responseLength = ref<AssistantResponseLength>('short')
    const playbackPolicy = ref<AssistantPlaybackPolicy>('confirm')
    const history = ref<AssistantHistoryItem[]>([])
    const askedQuestions = ref<string[]>([])
    const attemptCount = ref(0)
    const draftReply = ref('')
    const teacherTip = ref('')
    const suggestedAction = ref<AssistantSuggestedAction | null>(null)
    const requiresTeacherConfirmation = ref(false)
    const lastAbility = ref<AssistantTool>('unknown')
    let abortController: AbortController | null = null
    let initialized = false

    const availableResources = computed(() =>
      resourceStore.sortedResources
        .filter(
          (resource): resource is typeof resource & { id: number } =>
            typeof resource.id === 'number' && resource.source === 'library',
        )
        .slice(0, 30)
        .map((resource) => ({
          id: resource.id,
          title: resource.title,
          type: resource.mediaType,
        })),
    )

    function initialize() {
      if (initialized) return
      initialized = true
      watch(
        () => userStore.isLogin,
        (isLogin) => {
          if (!isLogin) deactivate()
        },
      )
    }

    function activate() {
      active.value = true
    }

    function deactivate() {
      cancel()
      active.value = false
      endInteraction()
    }

    function updateAttemptCount(text: string, speaker: AssistantHistoryRole) {
      if (speaker !== 'child') return
      attemptCount.value = NO_ANSWER_PATTERN.test(text)
        ? Math.min(3, attemptCount.value + 1)
        : 0
    }

    function validSuggestedAction(
      value: unknown,
    ): AssistantSuggestedAction | null {
      if (!value || typeof value !== 'object') return null
      const action = value as Partial<AssistantSuggestedAction>
      if (
        action.type !== 'recommend_resource' &&
        action.type !== 'classroom_command'
      ) return null
      if (typeof action.description !== 'string' || !action.description.trim()) {
        return null
      }
      if (
        action.resourceId !== undefined &&
        (!Number.isInteger(action.resourceId) || action.resourceId <= 0)
      ) return null
      if (
        action.commandIntent !== undefined &&
        !isCommandIntent(action.commandIntent)
      ) return null
      return {
        type: action.type,
        resourceId: action.resourceId,
        commandIntent: action.commandIntent,
        description: action.description.trim(),
      }
    }

    async function ask(
      text: string,
      speaker: Exclude<AssistantHistoryRole, 'assistant'> = 'child',
      tool?: AssistantTool,
    ): Promise<AssistantResponse | null> {
      if (loading.value) return null
      const trimmed = text.trim()
      if (!trimmed) return null
      updateAttemptCount(trimmed, speaker)
      loading.value = true
      draftReply.value = ''
      teacherTip.value = ''
      suggestedAction.value = null
      requiresTeacherConfirmation.value = false
      abortController = new AbortController()
      try {
        const { data } = await http.post<AssistantResponse>(
          '/ai/classroom-assistant',
          {
            text: trimmed,
            speaker,
            ageGroup: ageGroup.value,
            activityContext: {
              theme: theme.value.trim(),
              objective: objective.value.trim(),
              currentStep: currentStep.value.trim(),
              responseLength: responseLength.value,
              askedQuestions: askedQuestions.value.slice(-20),
              attemptCount: attemptCount.value,
              availableResources: availableResources.value,
            },
            history: history.value.slice(-20),
            tool,
          },
          { signal: abortController.signal },
        )
        if (
          data.mode !== 'guided_dialogue' ||
          typeof data.reply !== 'string' ||
          typeof data.teacherTip !== 'string' ||
          (data.ability !== undefined && !isAssistantTool(data.ability))
        ) {
          throw new Error('课堂助教返回了无效结果。')
        }

        const normalized: AssistantResponse = {
          mode: 'guided_dialogue',
          ability: data.ability,
          reply: data.reply.trim(),
          teacherTip: data.teacherTip.trim(),
          suggestedAction: validSuggestedAction(data.suggestedAction),
          requiresTeacherConfirmation: Boolean(
            data.requiresTeacherConfirmation || data.suggestedAction,
          ),
        }
        draftReply.value = normalized.reply
        teacherTip.value = normalized.teacherTip
        suggestedAction.value = normalized.suggestedAction
        requiresTeacherConfirmation.value =
          normalized.requiresTeacherConfirmation
        lastAbility.value = normalized.ability ?? tool ?? 'unknown'
        history.value.push({
          role: speaker,
          content: safeHistoryContent(trimmed),
        })
        history.value.push({ role: 'assistant', content: normalized.reply })
        if (/[？?]/.test(normalized.reply)) {
          askedQuestions.value.push(normalized.reply)
        }
        history.value = history.value.slice(-20)
        askedQuestions.value = askedQuestions.value.slice(-20)
        return normalized
      } catch (error) {
        if (axios.isCancel(error)) return null
        throw new Error(
          apiErrorMessage(error, '课堂助教暂时无法回应，请稍后重试。'),
          { cause: error },
        )
      } finally {
        loading.value = false
        abortController = null
      }
    }

    function cancel() {
      abortController?.abort()
      abortController = null
      loading.value = false
    }

    function discardSuggestion() {
      suggestedAction.value = null
      requiresTeacherConfirmation.value = false
    }

    function endInteraction() {
      cancel()
      history.value = []
      askedQuestions.value = []
      attemptCount.value = 0
      draftReply.value = ''
      teacherTip.value = ''
      suggestedAction.value = null
      requiresTeacherConfirmation.value = false
      lastAbility.value = 'unknown'
    }

    return {
      active,
      loading,
      ageGroup,
      theme,
      objective,
      currentStep,
      responseLength,
      playbackPolicy,
      history,
      askedQuestions,
      attemptCount,
      draftReply,
      teacherTip,
      suggestedAction,
      requiresTeacherConfirmation,
      lastAbility,
      availableResources,
      initialize,
      activate,
      deactivate,
      ask,
      cancel,
      discardSuggestion,
      endInteraction,
    }
  },
)

export type AssistantAvailableResource = {
  id: number
  title: string
  type: CourseResourceMediaType
}
