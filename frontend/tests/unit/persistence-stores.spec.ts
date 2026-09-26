import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useConversationStore } from '@/stores/conversation'
import { useFavoriteStore } from '@/stores/favorite'
import { useUserStore } from '@/stores/user'

describe('favorites and conversations', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useUserStore().initialize()
  })

  it('persists favorite toggles', () => {
    const favorites = useFavoriteStore(); favorites.initialize()
    const session = { localId: 's1', backendSessionId: null, ownerKey: 'visitor:v1', title: '春天', customTitle: false, pinned: false, unread: false, messages: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' }
    const message = { id: 'm1', role: 'assistant' as const, content: '看看花是什么颜色', createdAt: '2026-01-01' }
    expect(favorites.toggleFavorite(message, session)).toBe(true)
    expect(favorites.isFavorite('m1')).toBe(true)
    expect(localStorage.getItem('chat_favorite_v1')).toContain('m1')
    expect(favorites.toggleFavorite(message, session)).toBe(false)
  })

  it('isolates visitor and teacher conversation owners', () => {
    const user = useUserStore(); const conversations = useConversationStore(); conversations.initialize()
    const visitor = conversations.createSession(); conversations.appendMessage({ role: 'user', content: '你好' })
    user.setLogin('token', { teacherId: 8, account: 'teacher', name: '老师' })
    expect(conversations.visibleSessions).toHaveLength(0)
    const teacher = conversations.createSession()
    expect(teacher.ownerKey).toBe('teacher:8')
    expect(visitor.ownerKey).toContain('visitor:')
  })
})
