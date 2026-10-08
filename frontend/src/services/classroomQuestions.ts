import { http } from '@/api/http'

/**
 * Stage 7.5 儿童问题记录 —— 前端服务层
 *
 * 契约来源：《STAGE_7_5_CHILD_QUESTION_BACKEND_HANDOFF.md》
 *
 * 所有正式数据均来自后端；不使用 localStorage 保存问题或聚类结果。
 */

/** 一条正式幼儿问题，对齐后端 student_question_record 响应结构。 */
export type ClassroomQuestion = {
  id: number
  studentId: number | null
  studentName: string | null
  classId: number
  classroomRunId: number
  lessonStepIndex: number | null
  asrRawText: string
  teacherCorrectedText: string | null
  questionText: string
  topic: string | null
  domain: string | null
  isAnonymous: boolean
  teacherId: number
  teacherName: string | null
  lessonTitle: string | null
  createdAt: string
  updatedAt: string
}

/** 记录问题的请求体（POST /classroom-runs/:runId/questions）。 */
export type CreateQuestionPayload = {
  requestId: string
  studentId?: number | null
  lessonStepIndex?: number | null
  asrRawText?: string
  questionText: string
  teacherCorrectedText?: string | null
  topic?: string | null
  domain?: string | null
  isAnonymous?: boolean
}

/** 班级历史问题查询（GET /classes/:classId/questions）。 */
export type ClassQuestionQuery = {
  page: number
  pageSize: number
  studentId?: number
  keyword?: string
  topic?: string
  domain?: string
}

/** 班级历史问题分页响应。 */
export type ClassQuestionPage = {
  items: ClassroomQuestion[]
  total: number
  page: number
  pageSize: number
}

export type QuestionMap = {
  classId: number
  filters: { topic: string | null; domain: string | null; studentId: number | null }
  summary: { total: number; anonymousCount: number; identifiedStudentCount: number }
  topics: Array<{ name: string; count: number }>
  domains: Array<{ name: string; count: number }>
  frequentQuestions: Array<{ question: string; count: number }>
  interestHotspots: string[]
  suggestionSource: 'ai' | 'safe_rules'
  studentClusters: Array<{
    studentId: number
    studentName: string
    questionCount: number
    topics: Array<{ name: string; count: number }>
    domains: Array<{ name: string; count: number }>
  }>
  teachingSuggestions: string[]
  activitySuggestions: string[]
  recommendedResources: Array<{
    id: number
    title: string
    resourceType: string
    domain: string | null
  }>
  safety: {
    individualRankingGenerated: false
    negativeLabelsGenerated: false
    note: string
  }
}

function makeRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `question-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** 记录一条课堂问题；成功才返回正式记录。后端未就绪时抛错。 */
export async function createClassroomQuestion(
  runId: number,
  payload: Omit<CreateQuestionPayload, 'requestId'>,
): Promise<ClassroomQuestion> {
  const { data } = await http.post<{ question: ClassroomQuestion }>(
    `/classroom-runs/${runId}/questions`,
    { ...payload, requestId: makeRequestId() },
  )
  return data.question
}

export async function updateClassroomQuestion(
  runId: number,
  questionId: number,
  payload: {
    teacherCorrectedText?: string
    topic?: string | null
    domain?: string | null
    isAnonymous?: boolean
  },
): Promise<ClassroomQuestion> {
  const { data } = await http.patch<{ question: ClassroomQuestion }>(
    `/classroom-runs/${runId}/questions/${questionId}`,
    { ...payload, requestId: makeRequestId() },
  )
  return data.question
}

/** 拉取本节课堂的正式问题（按 createdAt 正序）。 */
export async function listRunQuestions(
  runId: number,
): Promise<ClassroomQuestion[]> {
  const { data } = await http.get<ClassroomQuestion[]>(
    `/classroom-runs/${runId}/questions`,
  )
  return data
}

/** 班级历史问题分页查询。 */
export async function listClassQuestions(
  classId: number,
  query: ClassQuestionQuery,
): Promise<ClassQuestionPage> {
  const { data } = await http.get<ClassQuestionPage>(
    `/classes/${classId}/questions`,
    { params: query },
  )
  return data
}

export async function getQuestionMap(
  classId: number,
  query: { topic?: string; domain?: string; studentId?: number } = {},
): Promise<QuestionMap> {
  const { data } = await http.get<QuestionMap>(
    `/classes/${classId}/question-map`,
    { params: query },
  )
  return data
}
