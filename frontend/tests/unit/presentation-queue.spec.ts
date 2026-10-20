import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
const state = vi.hoisted(() => ({ command: vi.fn() }))
let store: {
  run: {
    id: number
    deviceId: number
    currentStepIndex: number
    interactionState: { presentationQueues?: Record<string, import('@/composables/usePresentationQueue').PresentationItem[]> }
    playerRecoverySuggestion?: { presentationItemId: string }
  }
  currentStep: { resourceId: number }
  currentResource: { title: string }
  teacherCommand: typeof state.command
  can: (action: string) => boolean
  command: typeof state.command
}
vi.mock('@/stores/lessonRun', () => ({ useLessonRunStore: () => store }))
import { usePresentationQueue } from '@/composables/usePresentationQueue'

describe('current Run presentation queue', () => {
  beforeEach(() => {
    state.command.mockReset().mockResolvedValue({})
    store = reactive({ run: { id: 9, deviceId: 3, currentStepIndex: 1, interactionState: {} }, currentStep: { resourceId: 12 }, currentResource: { title: '卡片' }, command: state.command, teacherCommand: state.command, can: () => true })
  })
  it('reads the lesson fallback without any command or lesson mutation', () => {
    const queue = usePresentationQueue()
    expect(queue.items.value[0]?.resourceId).toBe(12)
    expect(state.command).not.toHaveBeenCalled()
  })
  it('uses an explicitly empty saved queue rather than restoring removed lesson resources', () => {
    store.run.interactionState.presentationQueues = { '1': [] }
    expect(usePresentationQueue().items.value).toEqual([])
  })
  it('editing sends only update_presentation_queue, never open/play', async () => {
    const queue = usePresentationQueue()
    await queue.save([])
    expect(state.command).toHaveBeenCalledExactlyOnceWith('update_presentation_queue', { stepIndex: 1, items: [] }, 'teacher_panel')
  })
  it('explicit show targets the bound screen; hidden items cannot show', async () => {
    const queue = usePresentationQueue()
    await queue.show({ id: 'r1', kind: 'resource', resourceId: 12, title: '卡片', enabled: false })
    expect(state.command).not.toHaveBeenCalled()
    await queue.show({ id: 'r1', kind: 'resource', resourceId: 12, title: '卡片', enabled: true })
    expect(state.command).toHaveBeenCalledWith('open_resource', { resourceId: 12, presentationItemId: 'r1' }, 'teacher_panel', 3)
  })
  it('a failed edit is visible and does not replace the saved queue', async () => {
    state.command.mockRejectedValue(new Error('offline'))
    const queue = usePresentationQueue()
    await queue.save([])
    expect(queue.error.value).not.toBe('')
    expect(queue.items.value).toHaveLength(1)
    expect(queue.saving.value).toBe(false)
  })
  it('next and previous skip hidden items, using the explicit displayed item id', () => {
    store.run.interactionState.presentationQueues = { '1': [
      { id: 'one', kind: 'avatar', title: 'one', enabled: true },
      { id: 'hidden', kind: 'avatar', title: 'hidden', enabled: false },
      { id: 'three', kind: 'avatar', title: 'three', enabled: true },
    ] }
    store.run.playerRecoverySuggestion = { presentationItemId: 'one' }
    const queue = usePresentationQueue()
    expect(queue.nextItem.value?.id).toBe('three')
    expect(queue.previousItem.value).toBeUndefined()
    store.run.playerRecoverySuggestion.presentationItemId = 'three'
    expect(queue.previousItem.value?.id).toBe('one')
    expect(queue.nextItem.value).toBeUndefined()
    expect(state.command).not.toHaveBeenCalled()
  })
  it('replacement edits the queue, preserving identity without switching presentation', async () => {
    const queue = usePresentationQueue()
    await queue.replace(0, { id: 'unused', kind: 'resource', resourceId: 20, title: '新卡片', enabled: true })
    expect(state.command).toHaveBeenCalledExactlyOnceWith('update_presentation_queue', { stepIndex: 1, items: [{ id: 'lesson-12', kind: 'resource', resourceId: 20, title: '新卡片', enabled: true }] }, 'teacher_panel')
  })
  it('media controls use the same formal command bus and target the current device', async () => {
    const queue = usePresentationQueue()
    await queue.media('pause_media')
    expect(state.command).toHaveBeenCalledExactlyOnceWith('pause_media', undefined, 'teacher_panel', 3)
  })
})
