import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { ChatMessage, ConversationSession } from './conversation'

const FAVORITE_STORAGE_KEY = 'chat_favorite_v1'

export type FavoriteMessage = {
  id: string
  messageId: string
  sessionId: string
  sessionTitle: string
  role: ChatMessage['role']
  content: string
  messageCreatedAt: string
  favoritedAt: string
}

function createId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function normalizeFavorite(value: unknown): FavoriteMessage | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<FavoriteMessage>
  if (
    typeof item.id !== 'string' ||
    typeof item.messageId !== 'string' ||
    typeof item.sessionId !== 'string' ||
    typeof item.sessionTitle !== 'string' ||
    (item.role !== 'user' && item.role !== 'assistant') ||
    typeof item.content !== 'string' ||
    typeof item.messageCreatedAt !== 'string' ||
    typeof item.favoritedAt !== 'string'
  ) {
    return null
  }
  return item as FavoriteMessage
}

export const useFavoriteStore = defineStore('favorite', () => {
  const favorites = ref<FavoriteMessage[]>([])
  let initialized = false

  const sortedFavorites = computed(() =>
    [...favorites.value].sort((left, right) =>
      right.favoritedAt.localeCompare(left.favoritedAt),
    ),
  )

  function persist() {
    localStorage.setItem(FAVORITE_STORAGE_KEY, JSON.stringify(favorites.value))
  }

  function initialize() {
    if (initialized) return
    initialized = true
    try {
      const saved = localStorage.getItem(FAVORITE_STORAGE_KEY)
      const parsed: unknown = saved ? JSON.parse(saved) : []
      favorites.value = Array.isArray(parsed)
        ? parsed
            .map(normalizeFavorite)
            .filter((item): item is FavoriteMessage => !!item)
        : []
    } catch {
      favorites.value = []
    }
  }

  function isFavorite(messageId: string): boolean {
    return favorites.value.some((item) => item.messageId === messageId)
  }

  function toggleFavorite(
    message: ChatMessage,
    session: ConversationSession,
  ): boolean {
    const existingIndex = favorites.value.findIndex(
      (item) => item.messageId === message.id,
    )
    if (existingIndex >= 0) {
      favorites.value.splice(existingIndex, 1)
      persist()
      return false
    }

    favorites.value.push({
      id: createId(),
      messageId: message.id,
      sessionId: session.localId,
      sessionTitle: session.title,
      role: message.role,
      content: message.content,
      messageCreatedAt: message.createdAt,
      favoritedAt: new Date().toISOString(),
    })
    persist()
    return true
  }

  function removeFavorite(id: string): boolean {
    const index = favorites.value.findIndex((item) => item.id === id)
    if (index < 0) return false
    favorites.value.splice(index, 1)
    persist()
    return true
  }

  return {
    favorites,
    sortedFavorites,
    initialize,
    isFavorite,
    toggleFavorite,
    removeFavorite,
  }
})
