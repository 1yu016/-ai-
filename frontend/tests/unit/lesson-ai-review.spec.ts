import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '@/api/http'
import { useLessonPlanStore } from '@/stores/lessonPlan'
import { useLessonAiReviewStore } from '@/stores/lessonAiReview'
const plan = { id: 3, version: 1, title: '数字', theme: '数字', ageGroup: '4-5', objectives: '认识1', estimatedMinutes: 20,
  status: 'draft', steps: [{ id: 7, sortOrder: 1, title: '观察', stepType: 'question', instruction: '内部', teacherInstruction: '内部',
    studentContent: '原学生文字', contentReviewRequired: false, durationSeconds: 60 },
  { id: 8, sortOrder: 2, title: '总结', stepType: 'summary', instruction: '总结', durationSeconds: 60 }] }
const candidate = { id: 11, status: 'generated', output: { schemaVersion: 2, baseLessonPlanId: 3, baseVersion: 1, targetStepId: 7,
  candidates: [{ candidateId: 'c-1', title: '观察建议', teacherInstructionSuggestion: '新的教师建议', studentContentCandidate: '新的学生候选', rationale: '简单观察', durationSecondsSuggestion: 90 }], warnings: [] } }
async function setup() {
  vi.spyOn(http, 'get').mockResolvedValue({ data: structuredClone(plan) })
  const post = vi.spyOn(http, 'post').mockResolvedValue({ data: structuredClone(candidate) })
  const put = vi.spyOn(http, 'put')
  const lesson = useLessonPlanStore(); await lesson.load(3)
  const review = useLessonAiReviewStore(); const key = lesson.steps[0]!.localStepId!
  return { lesson, review, key, post, put }
}
describe('field-level AI review', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.restoreAllMocks() })
  it('generates read-only suggestions and only changes one local field on acceptance', async () => {
    const { lesson, review, key, post, put } = await setup()
    await review.generate(key, 'step_optimization', '')
    expect(lesson.steps[0]!.studentContent).toBe('原学生文字'); expect(lesson.dirty).toBe(false)
    await review.apply('c-1', 'teacherInstruction')
    expect(lesson.steps[0]!.teacherInstruction).toBe('新的教师建议'); expect(lesson.steps[0]!.studentContent).toBe('原学生文字')
    expect(put).not.toHaveBeenCalled(); expect(post).toHaveBeenCalledTimes(1); expect(lesson.draft.version).toBe(1)
    expect(review.suggestion!.output.candidates[0]!.teacherInstructionSuggestion).toBe('新的教师建议')
  })
  it('modifies a local candidate copy and records rejection without modifying the Draft', async () => {
    const { lesson, review, key } = await setup(); await review.generate(key, 'student_text', '')
    await review.apply('c-1', 'studentContent', '教师修改后的提问')
    review.reject('c-1', 'teacherInstruction')
    expect(lesson.steps[0]!.studentContent).toBe('教师修改后的提问'); expect(lesson.steps[0]!.teacherInstruction).toBe('内部')
    expect(lesson.aiProvenance.map(r=>r.decision)).toEqual(['modified','rejected'])
    expect(review.suggestion!.output.candidates[0]!.studentContentCandidate).toBe('新的学生候选')
  })
  it('does not overwrite teacher edits made while AI is generating', async () => {
    const { lesson, review, key, post } = await setup()
    let resolve!: (value: {data: typeof candidate}) => void
    post.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const generating = review.generate(key, 'student_text', '')
    lesson.steps[0]!.studentContent = '生成期间教师新编辑'; lesson.markDirty()
    resolve({ data: structuredClone(candidate) }); await generating
    expect(review.stale).toBe(true)
    await expect(review.apply('c-1','studentContent')).rejects.toThrow()
    expect(lesson.steps[0]!.studentContent).toBe('生成期间教师新编辑')
  })
  it('uses stable IDs after sorting and rejects a deleted target', async () => {
    const { lesson, review, key } = await setup()
    lesson.moveStep(0,1); await review.generate(key,'step_optimization','')
    await review.apply('c-1','teacherInstruction')
    expect(lesson.steps.find(s=>s.id===7)!.teacherInstruction).toBe('新的教师建议')
    expect(lesson.steps.find(s=>s.id===8)!.instruction).toBe('总结')
    lesson.removeStep(1); await expect(review.apply('c-1','studentContent')).rejects.toThrow()
  })
  it('rejects remote version conflicts and edits made while checking the version', async () => {
    const { lesson, review, key } = await setup(); await review.generate(key,'student_text','')
    vi.mocked(http.get).mockResolvedValueOnce({ data: { id:3, version:2 } })
    await expect(review.apply('c-1','studentContent')).rejects.toThrow('基础版本')
    let resolve!: (v: { data: { id:number;version:number } }) => void
    vi.mocked(http.get).mockImplementationOnce(() => new Promise(r=>{resolve=r}))
    const checking = review.apply('c-1','studentContent'); lesson.steps[0]!.studentContent='更新'; lesson.markDirty(); resolve({data:{id:3,version:1}})
    await expect(checking).rejects.toThrow('核对期间'); expect(lesson.steps[0]!.studentContent).toBe('更新')
  })
  it('reads existing Draft without changing it and refuses drafts from other versions', async () => {
    const { lesson, review } = await setup()
    vi.mocked(http.get).mockResolvedValueOnce({data:structuredClone(candidate)})
    await review.loadDraft(11)
    expect(review.targetKey).toBe(lesson.steps[0]!.localStepId)
    expect(lesson.dirty).toBe(false)
    vi.mocked(http.get).mockResolvedValueOnce({data:{...candidate,output:{...candidate.output,baseVersion:99}}})
    await review.loadDraft(11); expect(review.suggestion).toBeNull(); expect(review.error).toContain('不属于')
  })
  it('does not silently clear student content for an empty candidate', async () => {
    const { lesson, review, key, post } = await setup()
    post.mockResolvedValueOnce({data:{...candidate,output:{...candidate.output,candidates:[{...candidate.output.candidates[0]!,studentContentCandidate:''}]}}})
    await review.generate(key,'student_text','')
    await expect(review.apply('c-1','studentContent')).rejects.toThrow('空候选')
    expect(lesson.steps[0]!.studentContent).toBe('原学生文字')
  })
})
