import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { http, apiErrorMessage } from '@/api/http'
import { useLessonPlanStore } from './lessonPlan'

export type Candidate = { candidateId: string; title: string; teacherInstructionSuggestion: string;
  studentContentCandidate: string; rationale: string; durationSecondsSuggestion: number; resourceId?: number }
export type CandidateDraft = { id: number; status: string; output: { schemaVersion: number;
  baseLessonPlanId: number | null; baseVersion: number | null; targetStepId: number | null;
  candidates: Candidate[]; warnings: string[] } }
export type ReviewField = 'teacherInstruction' | 'studentContent' | 'durationSeconds' | 'resourceId' | 'title'
const sourceFields = { teacherInstruction: 'teacherInstructionSuggestion', studentContent: 'studentContentCandidate',
  durationSeconds: 'durationSecondsSuggestion', resourceId: 'resourceId', title: 'title' } as const

export const useLessonAiReviewStore = defineStore('lessonAiReview', () => {
  const lesson = useLessonPlanStore()
  const suggestion = ref<CandidateDraft | null>(null)
  const busy = ref(false); const error = ref(''); const targetKey = ref('')
  const capturedRevision = ref(-1)
  let capturedFingerprint = ''; let sequence = 0
  const fingerprint = () => JSON.stringify(lesson.draft)
  const stale = computed(() => !!suggestion.value && (lesson.editRevision !== capturedRevision.value || fingerprint() !== capturedFingerprint))
  function clear() { sequence++; suggestion.value = null; error.value = ''; targetKey.value = ''; busy.value = false }
  async function loadDraft(id: number) {
    const request = ++sequence; busy.value = true; error.value = ''; suggestion.value = null
    const revision = lesson.editRevision; const before = fingerprint()
    try {
      const { data } = await http.get<CandidateDraft>(`/lesson-plans/ai-drafts/${id}`)
      if (request !== sequence) return
      const target = lesson.steps.find(s => s.id === data.output?.targetStepId)
      if (data.status !== 'generated' || data.output.schemaVersion !== 2 || !target ||
        data.output.baseLessonPlanId !== lesson.current?.id || data.output.baseVersion !== lesson.draft.version)
        throw new Error('该Draft不属于当前教案版本或目标步骤已失效')
      targetKey.value = target.localStepId!; capturedRevision.value = revision; capturedFingerprint = before
      suggestion.value = structuredClone(data)
    } catch (e) { if (request === sequence) error.value = apiErrorMessage(e, '建议读取失败') }
    finally { if (request === sequence) busy.value = false }
  }
  async function generate(key: string, taskType: 'step_optimization' | 'student_text', requirements: string) {
    const step = lesson.steps.find(s => s.localStepId === key)
    if (!step?.id || !lesson.current) throw new Error('请先保存教案，再为已保存的步骤生成建议')
    const request = ++sequence; busy.value = true; error.value = ''; suggestion.value = null
    targetKey.value = key; capturedRevision.value = lesson.editRevision; capturedFingerprint = fingerprint()
    const origin = { planId: lesson.current.id, version: lesson.draft.version }
    try {
      const { data } = await http.post<CandidateDraft>('/lesson-plans/ai-drafts', {
        schemaVersion: 2, taskType, baseLessonPlanId: origin.planId, baseVersion: origin.version, targetStepId: step.id,
        theme: lesson.draft.theme, ageGroup: lesson.draft.ageGroup, domain: lesson.draft.domain || '综合',
        durationMinutes: lesson.draft.estimatedMinutes, teachingObjectives: lesson.draft.objectives,
        teacherRequirements: requirements, resourceIds: [...new Set(lesson.steps.flatMap(s => s.resourceId ? [s.resourceId] : []))],
      }, { timeout: 110000 })
      if (request !== sequence) return
      if (data.status !== 'generated' || data.output.schemaVersion !== 2 || data.output.baseLessonPlanId !== origin.planId ||
        data.output.baseVersion !== origin.version || data.output.targetStepId !== step.id) throw new Error('AI建议来源与当前请求不匹配')
      suggestion.value = structuredClone(data)
    } catch (e) { if (request === sequence) error.value = apiErrorMessage(e, 'AI建议生成失败，仍可人工备课') }
    finally { if (request === sequence) busy.value = false }
  }
  function record(candidateId: string, field: ReviewField, decision: 'accepted' | 'modified' | 'rejected') {
    const draft = suggestion.value!
    const entry = { draftId: draft.id, candidateId, field, decision, targetLocalStepId: targetKey.value }
    const previous = lesson.aiProvenance.findIndex(r => r.draftId === draft.id && r.candidateId === candidateId && r.field === field)
    if (previous >= 0) lesson.aiProvenance.splice(previous, 1, entry); else lesson.aiProvenance.push(entry)
  }
  async function apply(candidateId: string, field: ReviewField, value?: string | number, clearStudent = false) {
    const draft = suggestion.value; const candidate = draft?.output.candidates.find(c => c.candidateId === candidateId)
    if (!draft || !candidate || stale.value || lesson.saving) throw new Error('建议已过期或正在保存，请重新核对后生成')
    const revision = lesson.editRevision; const before = fingerprint()
    const { data: current } = await http.get<{ id: number; version: number }>(`/lesson-plans/${draft.output.baseLessonPlanId}`)
    if (suggestion.value !== draft || revision !== lesson.editRevision || before !== fingerprint()) throw new Error('核对期间内容已修改，未应用旧建议')
    const step = lesson.steps.find(s => s.localStepId === targetKey.value)
    if (!step || step.id !== draft.output.targetStepId || current.id !== lesson.current?.id ||
      current.version !== draft.output.baseVersion || lesson.draft.version !== draft.output.baseVersion) throw new Error('基础版本或目标步骤已失效')
    const original = candidate[sourceFields[field]]
    const accepted = value ?? original
    if (accepted === undefined) throw new Error('该建议没有提供此字段')
    if (field === 'studentContent' && accepted === '' && !clearStudent) throw new Error('空候选不会清空已有学生文字；请在编辑器中明确修改')
    if (field === 'durationSeconds' && (!Number.isInteger(accepted) || Number(accepted) < 10 || Number(accepted) > 7200)) throw new Error('时长应为10至7200秒')
    if (field === 'resourceId' && accepted !== original) throw new Error('替换其他资源请使用资源选择器')
    if (field === 'teacherInstruction') step.teacherInstruction = String(accepted)
    else if (field === 'studentContent') step.studentContent = String(accepted)
    else if (field === 'title') step.title = String(accepted)
    else if (field === 'durationSeconds') step.durationSeconds = Number(accepted)
    else step.resourceId = Number(accepted)
    record(candidateId, field, accepted === original ? 'accepted' : 'modified'); lesson.markDirty()
    capturedRevision.value = lesson.editRevision; capturedFingerprint = fingerprint()
  }
  function reject(candidateId: string, field: ReviewField) {
    if (!suggestion.value?.output.candidates.some(c => c.candidateId === candidateId)) return
    const applied = lesson.aiProvenance.find(r => r.draftId === suggestion.value!.id && r.candidateId === candidateId && r.field === field)
    // Rejection is not an implicit undo of an already applied edit.
    if (applied && applied.decision !== 'rejected') return
    record(candidateId, field, 'rejected')
  }
  return { suggestion, busy, error, targetKey, stale, clear, generate, loadDraft, apply, reject }
})
