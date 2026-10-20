import { http } from '@/api/http'

/**
 * Stage 7.6 儿童作品 / 绘画评价 —— 前端服务层契约
 *
 * 正式作品上传、视觉草稿、教师确认和大屏投递契约。
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

export async function deliverArtworkReview(payload: {
  artworkId: number
  requestId: string
  deviceId: number
  targetDeviceId: number
  expectedVersion: number
}): Promise<{ display?: unknown; speech?: unknown }> {
  const { data } = await http.post<{ display?: unknown; speech?: unknown }>(`/artworks/${payload.artworkId}/deliver`, {
    requestId: payload.requestId,
    deviceId: payload.deviceId,
    targetDeviceId: payload.targetDeviceId,
    expectedVersion: payload.expectedVersion,
    source: 'teacher_panel',
  })
  return data
}

export type ArtworkDeliveryContext = { requestId: string; runId: number; deviceId: number }
export type ArtworkCommandSubmission = 'submitted' | 'reported_failure' | 'unknown'
export type ArtworkDeliveryStatus = { display: ArtworkCommandSubmission; speech: ArtworkCommandSubmission }

/** Command receipts describe server processing, never device receipt/playback. */
export function artworkCommandSubmission(value: unknown, context: ArtworkDeliveryContext, channel: 'display' | 'speech'): ArtworkCommandSubmission {
  if (!value || typeof value !== 'object') return 'unknown'
  const item = value as Record<string, unknown>
  if (item.requestId !== `${context.requestId}:${channel === 'display' ? 'display' : 'tts'}` ||
      (item.runId ?? item.classroomRunId) !== context.runId || item.targetDeviceId !== context.deviceId ||
      item.operation !== (channel === 'display' ? 'display_artwork' : 'speak_text')) return 'unknown'
  if (item.status === 'success') return 'submitted'
  if (item.status === 'failure' || item.status === 'conflict') return 'reported_failure'
  return 'unknown'
}

export function artworkDeliveryStatus(value: { display?: unknown; speech?: unknown }, context: ArtworkDeliveryContext): ArtworkDeliveryStatus {
  return { display: artworkCommandSubmission(value.display, context, 'display'), speech: artworkCommandSubmission(value.speech, context, 'speech') }
}

/** Bounded read-only reconciliation. A missing/Processing receipt does not prove failure. */
export async function queryArtworkDelivery(context: ArtworkDeliveryContext): Promise<ArtworkDeliveryStatus> {
  const read = async (channel: 'display' | 'speech') => {
    const id = `${context.requestId}:${channel === 'display' ? 'display' : 'tts'}`
    try {
      const { data } = await http.get(`/classroom-commands/${encodeURIComponent(id)}`)
      return artworkCommandSubmission(data, context, channel)
    } catch { return 'unknown' as const }
  }
  const [display, speech] = await Promise.all([read('display'), read('speech')])
  return { display, speech }
}

export function artworkDeliveryMessage(status: ArtworkDeliveryStatus): string {
  const labels = { submitted: '命令已提交', reported_failure: '服务端返回失败', unknown: '提交结果未知' }
  return `作品展示：${labels[status.display]}；评价朗读：${labels[status.speech]}。实际展示和朗读未确认（无设备 ACK 或关联播放反馈）。请核对课堂状态，勿重复提交。`
}
