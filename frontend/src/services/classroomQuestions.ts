import { http } from '@/api/http'

/**
 * Stage 7.5 儿童问题记录 —— 前端服务层
 *
 * 契约来源：《STAGE_7_5_CHILD_QUESTION_BACKEND_HANDOFF.md》
 *
 * 后端接口尚未部署，因此这些请求在真实环境会失败。前端页面必须显式展示
 * "后端未就绪（backend-not-ready）"状态，禁止用 localStorage 冒充正式业务数据，
 * 禁止在失败时伪装成功。
 *
 * 后端完成后再切换为真实可用即结束阻塞。
 */

/** 一条正式幼儿问题，对齐后端 student_question_record 响应结构。 */
export type ClassroomQuestion = {
  id: number
  studentId: number | null
  studentName: string | null
  classId: number
  classroomRunId: number
  lessonStepIndex: number | null
  questionText: string
  topic: string | null
  teacherId: number
  teacherName: string | null
  createdAt: string
}

/** 记录问题的请求体（POST /classroom-runs/:runId/questions）。 */
export type CreateQuestionPayload = {
  requestId: string
  studentId?: number | null
  lessonStepIndex?: number | null
  questionText: string
  topic?: string | null
}

/** 班级历史问题查询（GET /classes/:classId/questions）。 */
export type ClassQuestionQuery = {
  page: number
  pageSize: number
  studentId?: number
  keyword?: string
}

/** 班级历史问题分页响应。 */
export type ClassQuestionPage = {
  items: ClassroomQuestion[]
  total: number
  page: number
  pageSize: number
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