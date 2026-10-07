import { http } from '@/api/http'

export type ClassroomTimelineItem = {
  key: string
  type: string
  title: string
  description: string
  occurredAt: string
  source: string
  requestId?: string | null
  details?: Record<string, unknown>
}

export type ClassroomSummaryContent = {
  classroomSummary: string
  participation: string
  interestPoints: string[]
  commonQuestions: string[]
  teachingStrategies: string[]
}

export type ClassroomSummaryDraft = ClassroomSummaryContent & {
  id: number
  classroomRunId: number
  source: 'ai' | 'safe_rules'
  status: 'pending' | 'confirmed' | 'discarded'
  createdAt: string
  updatedAt: string
}

export type FormalClassroomSummary = ClassroomSummaryContent & {
  id: number
  classroomRunId: number
  draftId: number
  confirmedAt: string
  updatedAt: string
}

export async function getClassroomTimeline(runId: number) {
  const { data } = await http.get<{
    run: { id: number; title: string; status: string; startedAt: string | null; endedAt: string | null }
    items: ClassroomTimelineItem[]
  }>(`/classroom-runs/${runId}/timeline`)
  return data
}

export async function ensureClassroomSummaryDraft(runId: number) {
  const { data } = await http.post<ClassroomSummaryDraft>(`/classroom-runs/${runId}/summary/draft`)
  return data
}

export async function getClassroomSummary(runId: number) {
  const { data } = await http.get<{
    draft: ClassroomSummaryDraft | null
    formalSummary: FormalClassroomSummary | null
  }>(`/classroom-runs/${runId}/summary`)
  return data
}

export async function confirmClassroomSummary(runId: number, content: ClassroomSummaryContent) {
  const { data } = await http.post<{ formalSummary: FormalClassroomSummary }>(
    `/classroom-runs/${runId}/summary/confirm`,
    content,
  )
  return data.formalSummary
}

export async function discardClassroomSummary(runId: number, reason?: string) {
  await http.post(`/classroom-runs/${runId}/summary/discard`, { reason })
}

export async function getClassroomReport(runId: number) {
  const { data } = await http.get<{
    fileName: string
    content: string
    generatedAt: string
    formalSummary: FormalClassroomSummary
    timeline: ClassroomTimelineItem[]
  }>(`/classroom-runs/${runId}/report`)
  return data
}
