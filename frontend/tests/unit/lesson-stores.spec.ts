import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '@/api/http'
import { useLessonPlanStore, type LessonPlan } from '@/stores/lessonPlan'
import { useLessonRunStore, type LessonRun } from '@/stores/lessonRun'
import { useResourcePlayerStore } from '@/stores/resourcePlayer'

const plan: LessonPlan = { id: 3, teacherId: 1, title: '春天', theme: '春天', ageGroup: '4-5', objectives: '观察颜色', estimatedMinutes: 20, status: 'draft', version: 1, steps: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' }
const running: LessonRun = { id: 9, runId: 9, lessonPlanId: 3, status: 'running', currentStepOrder: 1, lessonTitle: '春天', lessonObjectives: '观察颜色', ageGroup: '4-5', steps: [{ sortOrder: 1, title: '导入', stepType: 'introduction', instruction: '看一看', durationSeconds: 60 }, { sortOrder: 2, title: '提问', stepType: 'question', instruction: '什么颜色？', durationSeconds: 60 }], elapsedSeconds: 5, startedAt: '2026-01-01', updatedAt: '2026-01-01' }

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

  it('surfaces the backend reason when a lesson cannot start', async () => {
    vi.spyOn(http, 'post').mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { message: '教案还没有课堂步骤，无法开始上课' } },
    })
    const store = useLessonPlanStore()
    await expect(store.start(3)).rejects.toThrow('教案还没有课堂步骤，无法开始上课')
  })
})

describe('lesson run state flow', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('loads, advances, pauses, resumes, and completes from backend truth', async () => {
    vi.spyOn(http, 'get').mockResolvedValue({ data: running })
    vi.spyOn(http, 'patch').mockResolvedValue({ data: { ...running, currentStepOrder: 2 } })
    vi.spyOn(http, 'post')
      .mockResolvedValueOnce({ data: { ...running, currentStepOrder: 2, status: 'paused' } })
      .mockResolvedValueOnce({ data: { ...running, currentStepOrder: 2, status: 'running' } })
      .mockResolvedValueOnce({ data: { ...running, currentStepOrder: 2, status: 'completed' } })
    const store = useLessonRunStore()
    await store.load(9)
    await store.next()
    expect(store.run?.currentStepOrder).toBe(2)
    expect(useResourcePlayerStore().controlRequest?.action).toBe('stop')
    await store.pause(); expect(store.run?.status).toBe('paused')
    await store.resume(); expect(store.run?.status).toBe('running')
    await store.complete(); expect(store.run?.status).toBe('completed')
  })

  it('does not move past the final step', async () => {
    vi.spyOn(http, 'get').mockResolvedValue({ data: { ...running, currentStepOrder: 2 } })
    const patch = vi.spyOn(http, 'patch')
    const store = useLessonRunStore()
    await store.load(9)
    await store.next()
    expect(patch).not.toHaveBeenCalled()
  })
})
