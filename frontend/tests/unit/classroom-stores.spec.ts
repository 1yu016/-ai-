import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '@/api/http'
import { useClassroomCommandStore } from '@/stores/classroomCommand'
import { useClassroomAssistantStore } from '@/stores/classroomAssistant'
import { useResourcePlayerStore } from '@/stores/resourcePlayer'
import { useUserStore } from '@/stores/user'

describe('classroom command whitelist', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useUserStore().setLogin('token', { teacherId: 1, account: 'teacher', name: '老师' })
  })

  it('rejects an intent outside the explicit whitelist', async () => {
    vi.spyOn(http, 'post').mockResolvedValue({ data: { mode: 'command', intent: 'delete_everything', reply: 'bad', confidence: 1, requiresConfirmation: false, matchStatus: 'not_required' } })
    const store = useClassroomCommandStore()
    await expect(store.submit('执行危险操作', { currentPage: 'chat', playerStatus: 'idle' })).rejects.toThrow('课堂指令服务返回了无效结果')
    expect(useResourcePlayerStore().controlRequest).toBeNull()
  })

  it('executes a whitelisted media command only after valid response', async () => {
    vi.spyOn(http, 'post').mockResolvedValue({ data: { mode: 'command', intent: 'pause_media', reply: '暂停', confidence: 1, requiresConfirmation: false, matchStatus: 'not_required' } })
    await useClassroomCommandStore().submit('暂停', { currentPage: 'resources', playerStatus: 'playing' })
    expect(useResourcePlayerStore().controlRequest?.action).toBe('pause')
  })
})

describe('classroom assistant state', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useUserStore().setLogin('token', { teacherId: 1, account: 'teacher', name: '老师' })
  })

  it('keeps child dialogue in memory and clears it at interaction end', async () => {
    vi.spyOn(http, 'post').mockResolvedValue({ data: { mode: 'guided_dialogue', ability: 'give_hint', reply: '再看看叶子的颜色，好吗？', teacherTip: '等待观察', suggestedAction: null, requiresTeacherConfirmation: false } })
    const store = useClassroomAssistantStore()
    await store.ask('不知道', 'child', 'give_hint')
    expect(store.attemptCount).toBe(1)
    expect(store.history).toHaveLength(2)
    expect(Object.values(localStorage)).not.toContain(expect.stringContaining('不知道'))
    store.endInteraction()
    expect(store.history).toEqual([])
    expect(store.draftReply).toBe('')
  })

  it('redacts child privacy before retaining page-memory history', async () => {
    vi.spyOn(http, 'post').mockResolvedValue({ data: { mode: 'guided_dialogue', reply: '请马上告诉老师。', teacherTip: '教师处理', suggestedAction: null, requiresTeacherConfirmation: false } })
    const store = useClassroomAssistantStore()
    await store.ask('我叫小明', 'child')
    expect(store.history[0]?.content).toBe('[儿童隐私内容已省略]')
  })
})
