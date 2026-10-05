import { http } from '@/api/http'

/**
 * Stage 7.6 儿童作品 / 绘画评价 —— 前端服务层契约
 *
 * 后端尚未提供作品实体与上传/评价接口（详见《STAGE_7_6_ARTWORK_BACKEND_HANDOFF.md》
 * 与《STAGE_7_6_ARTWORK_AI_HANDOFF.md》）。
 *
 * 契约按《Stage 7.6 调查报告》的推荐第一版模型冻结（student_artwork_record）。
 * 前端页面在接口未就绪时显式展示 backend-not-ready，禁止 localStorage/硬编码 AI 冒充成功。
 * 后端完成上传/评价接口后，把这里的请求路径与 response 对齐即可运行。
 */

export type ArtworkMediaType = 'image/jpeg' | 'image/png'

export type StudentArtwork = {
  id: number
  studentId: number | null
  classId: number
  classroomRunId: number
  lessonStepIndex: number | null
  teacherId: number
  teacherName: string | null
  fileUrl: string
  mimeType: string
  originalName: string
  aiDraft: string | null
  teacherComment: string | null
  confirmedAt: string | null
  createdAt: string
}

/** 上传作品请求（multipart FormData）。 */
export type UploadArtworkPayload = {
  studentId: number | null
  lessonStepIndex: number | null
  file: File
}

/** 上传后用返回的作品 ID 请求 AI 评价草稿。 */
export type GenerateAiDraftPayload = {
  artworkId: number
  /** 视觉模型接入后才能真实分析图片；未接入时该请求应返回能力未支持错误。 */
}

/** 教师确认评价（保存正式 comment，独立于 AI 草稿）。 */
export type ConfirmArtworkPayload = {
  artworkId: number
  teacherComment: string
}

/** 前端文件类型/大小预校验（正式上传前的边界校验）。 */
export const ARTWORK_MIME_TYPES: ArtworkMediaType[] = ['image/jpeg', 'image/png']
export const ARTWORK_MAX_BYTES = 10 * 1024 * 1024 // 10 MB

export type ArtworkValidationResult =
  | { ok: true }
  | { ok: false; reason: string }

export function validateArtworkFile(file: File): ArtworkValidationResult {
  if (!ARTWORK_MIME_TYPES.includes(file.type as ArtworkMediaType)) {
    return { ok: false, reason: '仅支持 JPG / PNG 图片。' }
  }
  if (file.size > ARTWORK_MAX_BYTES) {
    return { ok: false, reason: '图片不能超过 10MB。' }
  }
  return { ok: true }
}

/** 上传作品；后端未就绪时抛错（页面须显式阻塞）。 */
export async function uploadStudentArtwork(
  runId: number,
  payload: UploadArtworkPayload,
): Promise<StudentArtwork> {
  const form = new FormData()
  if (payload.studentId != null) form.append('studentId', String(payload.studentId))
  if (payload.lessonStepIndex != null)
    form.append('lessonStepIndex', String(payload.lessonStepIndex))
  form.append('file', payload.file)
  const { data } = await http.post<{ artwork: StudentArtwork }>(
    `/classroom-runs/${runId}/artworks`,
    form,
  )
  return data.artwork
}

/** AI 评价草稿：仅当后端视觉能力就绪才能真实生成；否则应显式失败而非伪造。 */
export async function generateArtworkAiDraft(
  _payload: GenerateAiDraftPayload,
): Promise<{ aiDraft: string }> {
  const { data } = await http.post<{ aiDraft: string }>(
    `/ai/artwork-review`,
    _payload,
  )
  return data
}

/** 教师确认评价（正式保存，独立于 AI 草稿）。 */
export async function confirmArtworkReview(
  _payload: ConfirmArtworkPayload,
): Promise<{ teacherComment: string; confirmedAt: string }> {
  const { data } = await http.post<{ teacherComment: string; confirmedAt: string }>(
    `/artworks/${_payload.artworkId}/confirm`,
    { teacherComment: _payload.teacherComment },
  )
  return data
}