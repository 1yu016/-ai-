import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { http } from '@/api/http'
import { useLessonPlanStore } from '@/stores/lessonPlan'

const plan = { id: 2, teacherId: 1, title: '认识1', theme: '数字', ageGroup: '4-5', objectives: '认识数字', estimatedMinutes: 20, status: 'draft', version: 1, steps: [{ id: 4, title: '介绍', stepType: 'teacher_talk', sortOrder: 1, instruction: '仅教师', content: '旧内容', durationSeconds: 60, actions: [{ actionType: 'avatar_action', actionName: 'wave' }], recoveryPoint: { name: '重来', trigger: 'manual', recoveryStepOrder: 1 } }] }
describe('manual authoring', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.restoreAllMocks() })
  it('loads legacy student content blank without mutating server data', async () => {
    vi.spyOn(http, 'get').mockResolvedValue({ data: plan })
    const store = useLessonPlanStore(); await store.load(2)
    expect(store.steps[0]?.teacherInstruction).toBe('仅教师')
    expect(store.steps[0]?.studentContent).toBe('')
    expect(store.steps[0]?.contentReviewRequired).toBe(true)
    expect(plan.steps[0]?.content).toBe('旧内容')
  })
  it('uses a single authoring request and preserves actions/recovery', async () => {
    vi.spyOn(http, 'get').mockResolvedValue({ data: plan })
    const put = vi.spyOn(http, 'put').mockResolvedValue({ data: { ...plan, version: 2, steps: [{ ...plan.steps[0], teacherInstruction: '仅教师', studentContent: '给学生', contentReviewRequired: false }] } })
    const patch = vi.spyOn(http, 'patch')
    const store = useLessonPlanStore(); await store.load(2); store.steps[0]!.studentContent = '给学生'; store.changeSummary = '区分内容'
    await store.save()
    expect(put).toHaveBeenCalledTimes(1); expect(patch).not.toHaveBeenCalled()
    expect(put).toHaveBeenCalledWith('/lesson-plans/2/authoring', expect.objectContaining({ steps: [expect.objectContaining({ sourceStepId: 4, localStepId: expect.any(String) })] }))
    expect(put).toHaveBeenCalledWith('/lesson-plans/2/authoring', expect.objectContaining({ version: 1, changeSummary: '区分内容', steps: [expect.objectContaining({ teacherInstruction: '仅教师', studentContent: '给学生', actions: plan.steps[0]!.actions, recoveryPoint: plan.steps[0]!.recoveryPoint })] }))
    expect(store.draft.version).toBe(2)
  })
  it('retries a failed create using the same request ID and retains input', async () => {
    const post = vi.spyOn(http, 'post').mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: plan })
    const store = useLessonPlanStore(); store.newDraft(); store.draft.title = '认识1'; store.addStep(); store.steps[0]!.teacherInstruction = '内部'
    await expect(store.save()).rejects.toThrow(); expect(store.steps[0]!.teacherInstruction).toBe('内部')
    await store.save()
    expect(post.mock.calls[0]![0]).toBe('/lesson-plans/authoring')
    expect((post.mock.calls[0]![1] as { requestId: string }).requestId).toBe((post.mock.calls[1]![1] as { requestId: string }).requestId)
  })
  it('loads version history read-only and deep-copies step configuration', async () => {
    vi.spyOn(http, 'get').mockResolvedValueOnce({ data: plan }).mockResolvedValueOnce({ data: [{ id: 1, versionNo: 1, changeSummary: '创建', snapshotJson: '{}' }] })
    const store = useLessonPlanStore(); await store.load(2); store.copyStep(0)
    store.steps[1]!.actions![0]!.actionName = 'nod'
    expect(store.steps[0]!.actions![0]!.actionName).toBe('wave')
    await store.fetchVersions(); expect(store.versions[0]?.versionNo).toBe(1); expect(store.draft.version).toBe(1)
  })
})
