import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { useUserStore } from './user'

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

export type NewChatMessage = Pick<ChatMessage, 'role' | 'content'> &
  Partial<Pick<ChatMessage, 'id' | 'createdAt'>>

export type ConversationSession = {
  localId: string
  backendSessionId: number | null
  ownerKey: string
  title: string
  customTitle: boolean
  pinned: boolean
  unread: boolean
  messages: ChatMessage[]
  createdAt: string
  updatedAt: string
}

const STORAGE_KEY = 'kindergarten-ai-conversations-v1'
const LEGACY_HISTORY_KEY = 'kindergarten-ai-chat-history'
const LEGACY_IMPORTED_KEY = 'kindergarten-ai-history-imported-v1'

function createLocalId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function normalizeMessage(
  value: unknown,
  fallbackTime: string,
): ChatMessage | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<ChatMessage>
  if (
    (item.role !== 'user' && item.role !== 'assistant') ||
    typeof item.content !== 'string' ||
    !item.content.trim()
  ) {
    return null
  }
  return {
    id: typeof item.id === 'string' && item.id ? item.id : createLocalId(),
    role: item.role,
    content: item.content,
    createdAt:
      typeof item.createdAt === 'string' && item.createdAt
        ? item.createdAt
        : fallbackTime,
  }
}

function normalizeSession(value: unknown): ConversationSession | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<ConversationSession>
  const isValid =
    typeof item.localId === 'string' &&
    (item.backendSessionId === null ||
      (typeof item.backendSessionId === 'number' &&
        Number.isInteger(item.backendSessionId))) &&
    typeof item.ownerKey === 'string' &&
    typeof item.title === 'string' &&
    Array.isArray(item.messages) &&
    typeof item.createdAt === 'string' &&
    typeof item.updatedAt === 'string'
  if (!isValid) return null

  return {
    localId: item.localId as string,
    backendSessionId: item.backendSessionId as number | null,
    ownerKey: item.ownerKey as string,
    title: item.title as string,
    customTitle: item.customTitle === true,
    pinned: item.pinned === true,
    unread: item.unread === true,
    messages: (item.messages as unknown[])
      .map((message) =>
        normalizeMessage(message, item.updatedAt as string),
      )
      .filter((message): message is ChatMessage => !!message),
    createdAt: item.createdAt as string,
    updatedAt: item.updatedAt as string,
  }
}

function sessionTitle(messages: ChatMessage[]): string {
  const firstQuestion = messages.find((message) => message.role === 'user')
  if (!firstQuestion) return '新会话'
  const compact = firstQuestion.content.replace(/\s+/g, ' ').trim()
  return compact.slice(0, 15)
}

export const useConversationStore = defineStore('conversation', () => {
  const userStore = useUserStore()
  const sessions = ref<ConversationSession[]>([])
  const activeLocalId = ref<string | null>(null)
  let initialized = false

  const currentOwnerKey = computed(() =>
    userStore.isLogin && userStore.teacherInfo
      ? `teacher:${userStore.teacherInfo.teacherId}`
      : `visitor:${userStore.visitorId}`,
  )

  const visibleSessions = computed(() =>
    sessions.value
      .filter((session) => session.ownerKey === currentOwnerKey.value)
      .sort((left, right) => {
        if (left.pinned !== right.pinned) return left.pinned ? -1 : 1
        return right.updatedAt.localeCompare(left.updatedAt)
      }),
  )

  const activeSession = computed(
    () =>
      sessions.value.find(
        (session) =>
          session.localId === activeLocalId.value &&
          session.ownerKey === currentOwnerKey.value,
      ) ?? null,
  )

  const activeMessages = computed(() => activeSession.value?.messages ?? [])

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.value))
  }

  function importLegacyHistory() {
    if (localStorage.getItem(LEGACY_IMPORTED_KEY)) return
    localStorage.setItem(LEGACY_IMPORTED_KEY, '1')

    try {
      const saved = localStorage.getItem(LEGACY_HISTORY_KEY)
      if (!saved) return
      const parsed: unknown = JSON.parse(saved)
      if (!Array.isArray(parsed)) return
      const timestamp = new Date().toISOString()
      const messages = parsed
        .map((message) => normalizeMessage(message, timestamp))
        .filter((message): message is ChatMessage => !!message)
      if (!messages.length) return

      sessions.value.push({
        localId: createLocalId(),
        backendSessionId: null,
        ownerKey: `visitor:${userStore.visitorId}`,
        title: sessionTitle(messages),
        customTitle: false,
        pinned: false,
        unread: false,
        messages,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      localStorage.removeItem(LEGACY_HISTORY_KEY)
    } catch {
      // 旧版历史损坏时忽略，不影响聊天页面使用。
    }
  }

  function initialize() {
    if (initialized) return
    initialized = true
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      const parsed: unknown = saved ? JSON.parse(saved) : []
      sessions.value = Array.isArray(parsed)
        ? parsed
            .map(normalizeSession)
            .filter((session): session is ConversationSession => !!session)
        : []
    } catch {
      sessions.value = []
    }
    importLegacyHistory()
    persist()
    selectAvailableSession()
  }

  function createSession(): ConversationSession {
    const timestamp = new Date().toISOString()
    const session: ConversationSession = {
      localId: createLocalId(),
      backendSessionId: null,
      ownerKey: currentOwnerKey.value,
      title: '新会话',
      customTitle: false,
      pinned: false,
      unread: false,
      messages: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    sessions.value.push(session)
    activeLocalId.value = session.localId
    persist()
    return session
  }

  function ensureActiveSession(): ConversationSession {
    const current = activeSession.value
    if (current) return current
    const latest = visibleSessions.value[0]
    if (latest) {
      activeLocalId.value = latest.localId
      return latest
    }
    return createSession()
  }

  function selectAvailableSession(): ConversationSession | null {
    const current = activeSession.value
    if (current) return current
    const latest = visibleSessions.value[0] ?? null
    activeLocalId.value = latest?.localId ?? null
    if (latest?.unread) latest.unread = false
    persist()
    return latest
  }

  function selectSession(localId: string): boolean {
    const session = sessions.value.find(
      (item) =>
        item.localId === localId && item.ownerKey === currentOwnerKey.value,
    )
    if (!session) return false
    activeLocalId.value = session.localId
    session.unread = false
    persist()
    return true
  }

  function appendMessage(message: NewChatMessage) {
    const session = ensureActiveSession()
    session.messages.push({
      ...message,
      id: message.id || createLocalId(),
      createdAt: message.createdAt || new Date().toISOString(),
    })
    if (!session.customTitle) session.title = sessionTitle(session.messages)
    if (message.role === 'assistant') session.unread = true
    session.updatedAt = new Date().toISOString()
    persist()
  }

  function removeLastMessage() {
    const session = activeSession.value
    if (!session) return
    session.messages.pop()
    if (!session.customTitle) session.title = sessionTitle(session.messages)
    session.updatedAt = new Date().toISOString()
    persist()
  }

  function renameSession(localId: string, title: string): boolean {
    const normalizedTitle = title.trim()
    if (!normalizedTitle) return false
    const session = sessions.value.find(
      (item) =>
        item.localId === localId && item.ownerKey === currentOwnerKey.value,
    )
    if (!session) return false
    session.title = normalizedTitle
    session.customTitle = true
    persist()
    return true
  }

  function togglePinned(localId: string): boolean {
    const session = sessions.value.find(
      (item) =>
        item.localId === localId && item.ownerKey === currentOwnerKey.value,
    )
    if (!session) return false
    session.pinned = !session.pinned
    persist()
    return session.pinned
  }

  function deleteSession(localId: string): boolean {
    const index = sessions.value.findIndex(
      (item) =>
        item.localId === localId && item.ownerKey === currentOwnerKey.value,
    )
    if (index < 0) return false
    const deletingActiveSession = activeLocalId.value === localId
    sessions.value.splice(index, 1)
    if (deletingActiveSession) {
      activeLocalId.value = visibleSessions.value[0]?.localId ?? null
      if (activeSession.value) activeSession.value.unread = false
    }
    persist()
    return true
  }

  function setBackendSessionId(sessionId?: number) {
    if (!sessionId || !activeSession.value) return
    activeSession.value.backendSessionId = sessionId
    activeSession.value.updatedAt = new Date().toISOString()
    persist()
  }

  function migrateVisitorToTeacher(visitorId: string, teacherId: number) {
    const visitorOwner = `visitor:${visitorId}`
    const teacherOwner = `teacher:${teacherId}`
    const teacherBackendIds = new Set(
      sessions.value
        .filter(
          (session) =>
            session.ownerKey === teacherOwner && session.backendSessionId,
        )
        .map((session) => session.backendSessionId),
    )

    sessions.value = sessions.value.filter((session) => {
      if (session.ownerKey !== visitorOwner) return true
      if (
        session.backendSessionId &&
        teacherBackendIds.has(session.backendSessionId)
      ) {
        return false
      }
      session.ownerKey = teacherOwner
      if (session.backendSessionId) teacherBackendIds.add(session.backendSessionId)
      return true
    })
    activeLocalId.value = null
    persist()
    selectAvailableSession()
  }

  return {
    sessions,
    activeLocalId,
    currentOwnerKey,
    visibleSessions,
    activeSession,
    activeMessages,
    initialize,
    persist,
    createSession,
    ensureActiveSession,
    selectAvailableSession,
    selectSession,
    appendMessage,
    removeLastMessage,
    renameSession,
    togglePinned,
    deleteSession,
    setBackendSessionId,
    migrateVisitorToTeacher,
  }
})
