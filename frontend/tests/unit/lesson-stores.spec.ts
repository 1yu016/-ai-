import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '@/api/http'
import { useLessonPlanStore, type LessonPlan } from '@/stores/lessonPlan'
import { useLessonRunStore } from '@/stores/lessonRun'
import { useClassroomAssistantStore } from '@/stores/classroomAssistant'
import { useResourcePlayerStore } from '@/stores/resourcePlayer'

const plan: LessonPlan = { id: 3, teacherId: 1, title: '春天', theme: '春天', ageGroup: '4-5', objectives: '观察颜色', estimatedMinutes: 20, status: 'draft', version: 1, steps: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' }
const running = { id: 9, lessonPlanId: 3, deviceId: 1, version: 1, status: 'running', currentStepIndex: 0, title: '春天', steps: [{ stepIndex: 0, title: '导入', type: 'introduction', content: '看一看', resourceId: null, durationSeconds: 60 }, { stepIndex: 1, title: '提问', type: 'question', content: '什么颜色？', resourceId: null, durationSeconds: 60 }], elapsedSeconds: 5, startedAt: '2026-01-01', updatedAt: '2026-01-01' }

describe('lesson plan store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('adds, copies, moves, and removes steps with continuous order', () => {
    const store = useLessonPlanStore()
    store.addStep({ title: '第一步' })
    store.addStep({ title: '第二步' })
    store.copyStep(0)
    store.moveStep(2, -1)
    store.removeStep(0)
    expect(store.steps.map((step) => step.sortOrder)).toEqual([1, 2])
    expect(store.dirty).toBe(true)
  })

  it('keeps AI output as an unsaved editable draft', async () => {
    vi.spyOn(http, 'post').mockResolvedValue({ data: { id: 7, output: { title: 'AI春天', theme: '春天', ageGroup: '4-5', domain: '科学', estimatedMinutes: 20, teachingObjectives: ['观察'], teachingProcess: [{ title: '观察', stepType: 'question', content: '你看到了什么？', durationSeconds: 120 }] } } })
    const store = useLessonPlanStore()
    store.draft.estimatedMinutes = 20
    await store.generateDraft([], { theme: '春天' })
    expect(store.current).toBeNull()
    expect(store.draft.title).toBe('AI春天')
    expect(store.dirty).toBe(true)
    expect(http.post).toHaveBeenCalledWith('/lesson-plans/ai-drafts', expect.objectContaining({ theme: '春天', domain: '综合', teachingObjectives: '春天' }))
  })

  it('prevents duplicate save submissions', async () => {
    let resolveRequest!: (value: unknown) => void
    vi.spyOn(http, 'post').mockImplementation(() => new Promise((resolve) => { resolveRequest = resolve }))
    const store = useLessonPlanStore()
    Object.assign(store.draft, { title: '教案', theme: '主题', objectives: '目标' })
    const first = store.save()
    await expect(store.save()).rejects.toThrow('正在保存')
    resolveRequest({ data: plan })
    vi.spyOn(http, 'put').mockResolvedValue({ data: { version: 2, steps: [] } })
    await first
  })

})

describe('lesson run state flow', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('loads, advances, pauses, resumes, and completes from backend truth', async () => {
    vi.spyOn(http, 'get').mockResolvedValue({ data: running })
    const post = vi.spyOn(http, 'post').mockResolvedValueOnce({ data: { ...running, currentStepIndex: 1, version: 2 } }).mockResolvedValueOnce({ data: { ...running, currentStepIndex: 1, status: 'paused', version: 3 } }).mockResolvedValueOnce({ data: { ...running, currentStepIndex: 1, status: 'running', version: 4 } }).mockResolvedValueOnce({ data: { ...running, currentStepIndex: 1, status: 'completed', version: 5 } })
    const store = useLessonRunStore()
    await store.load(9)
    await store.next()
    expect(store.run?.currentStepIndex).toBe(1)
    expect(post).toHaveBeenNthCalledWith(1, '/classroom-runs/9/steps/1', expect.objectContaining({ version: 1, requestId: expect.any(String) }))
    expect(useResourcePlayerStore().controlRequest?.action).toBe('stop')
    await store.pause(); expect(store.run?.status).toBe('paused')
    await store.resume(); expect(store.run?.status).toBe('running')
    await store.complete(); expect(store.run?.status).toBe('completed')
  })

  it('does not move past the final step', async () => {
    vi.spyOn(http, 'get').mockResolvedValue({ data: { ...running, currentStepIndex: 1 } })
    const patch = vi.spyOn(http, 'post')
    const store = useLessonRunStore()
    await store.load(9)
    await store.next()
    expect(patch).not.toHaveBeenCalled()
  })

  it('blocks prepared and failed runs from classroom actions', async () => {
    vi.spyOn(http, 'get').mockResolvedValue({ data: { ...running, status: 'prepared' } })
    const post = vi.spyOn(http, 'post')
    const store = useLessonRunStore()
    await store.load(9)
    await store.next(); await store.pause(); await store.complete()
    expect(post).not.toHaveBeenCalled()
    vi.spyOn(http, 'get').mockResolvedValue({ data: { ...running, status: 'failed' } })
    await store.load(9)
    await store.next(); await store.resume(); await store.cancel()
    expect(post).not.toHaveBeenCalled()
  })

  it('blocks step navigation and every action after the run has ended', async () => {
    vi.spyOn(http, 'get').mockResolvedValue({ data: { ...running, status: 'cancelled' } })
    const patch = vi.spyOn(http, 'post')
    const post = vi.spyOn(http, 'post')
    const store = useLessonRunStore()
    await store.load(9)
    await store.next()
    await store.previous()
    await store.move(2)
    await store.pause()
    await store.resume()
    await store.complete()
    await store.cancel()
    expect(patch).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
  })

  it('adapts the real lesson objectives from the classroom-run payload and trims whitespace', async () => {
    vi.spyOn(http, 'get').mockResolvedValue({ data: { ...running, objectives: '能识别数字“1”  的外形特征  ' } })
    const store = useLessonRunStore()
    await store.load(9)
    expect(store.run?.lessonObjectives).toBe('能识别数字“1”  的外形特征')
  })

  it('syncs a real objective to the assistant so no empty objective is ever sent', async () => {
    vi.spyOn(http, 'get').mockResolvedValue({ data: { ...running, objectives: '能识别数字1' } })
    const store = useLessonRunStore()
    const assistant = useClassroomAssistantStore()
    await store.load(9)
    expect(assistant.objective).toBe('能识别数字1')
  })

  it('keeps the assistant default objective (never empty) when the backend returns none', async () => {
    vi.spyOn(http, 'get').mockResolvedValue({ data: { ...running } })
    const store = useLessonRunStore()
    const assistant = useClassroomAssistantStore()
    await store.load(9)
    expect(store.run?.lessonObjectives).toBe('')
    expect(assistant.objective).toBe('鼓励幼儿认真观察并说出自己的发现')
  })
})
