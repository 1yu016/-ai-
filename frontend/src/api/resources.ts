import { http } from './http'

/** 资源类型，对齐后端 ResourceType 枚举 */
export type ResourceType =
  | 'image'
  | 'audio'
  | 'video'
  | 'pdf'
  | 'ppt'
  | 'picture_book'
  | 'animation'
  | 'question_bank'
  | 'experiment'
  | 'model_3d'
  | 'document'

/** 年龄段，对齐后端 ResourceAgeGroup */
export type ResourceAgeGroup = 'small' | 'middle' | 'large' | 'all'

/** 审核状态，对齐后端 ResourceReviewStatus */
export type ResourceReviewStatus =
  | 'draft'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'disabled'

export const RESOURCE_TYPES: ResourceType[] = [
  'image',
  'audio',
  'video',
  'pdf',
  'ppt',
  'picture_book',
  'animation',
  'question_bank',
  'experiment',
  'model_3d',
]

export const AGE_GROUPS: ResourceAgeGroup[] = [
  'small',
  'middle',
  'large',
  'all',
]

export const REVIEW_STATUSES: ResourceReviewStatus[] = [
  'draft',
  'pending',
  'approved',
  'rejected',
  'disabled',
]

/** 资源分类节点，对齐后端 ResourceCategory */
export type ResourceCategory = {
  id: number
  name: string
  parentId: number | null
  sort: number
  enabled: boolean
}

/** 单个资源响应，对齐后端 ResourceResponse */
export type ResourceResponse = {
  id: number
  title: string
  aliases: string[]
  description: string | null
  resourceType: ResourceType
  category: string
  categoryId: number | null
  ageGroup: ResourceAgeGroup
  domain: string | null
  tags: string[]
  fileUrl: string
  coverUrl: string | null
  fileName: string
  mimeType: string
  fileSize: number
  duration: number | null
  sha256: string | null
  reviewStatus: ResourceReviewStatus
  ownerId: string | null
  ownerType: string | null
  schoolId: string | null
  currentVersionId: number | null
  referenceCount: number
  isFavorite: boolean
  createdAt: string
  updatedAt: string
}

export type PaginatedResources = {
  items: ResourceResponse[]
  total: number
  page: number
  pageSize: number
}

export type ResourceSearchResult = ResourceResponse & { score: number }

/** GET /resources 查询参数 */
export type ListResourcesParams = {
  category?: string
  categoryId?: number
  resourceType?: ResourceType
  reviewStatus?: ResourceReviewStatus
  ageGroup?: ResourceAgeGroup
  domain?: string
  tag?: string
  keyword?: string
  page?: number
  pageSize?: number
}

/** 上传资源元数据（普通上传与分片会话通用；对齐 UploadResourceDto） */
export type ResourceMeta = {
  title: string
  category: string
  categoryId?: number
  ageGroup: ResourceAgeGroup
  resourceType: ResourceType
  aliases?: string[]
  description?: string
  domain?: string
  tags?: string[]
  duration?: number
}

/** 创建分片上传会话参数（对齐 CreateUploadSessionDto） */
export type CreateChunkSessionParams = ResourceMeta & {
  originalName: string
  declaredMime: string
  totalSize: number
  chunkSize: number
  expectedSha256?: string
}

export type UploadedChunk = {
  chunkNo: number
  fileSize: number
  sha256: string
}

export type UploadedChunksResponse = {
  sessionId: string
  status: string
  totalChunks: number
  uploadedChunks: UploadedChunk[]
}

export type ResourceReferencePayload = {
  referenceType: string
  referenceId: string
}

export type ReviewPayload = {
  status: ResourceReviewStatus
  comment?: string
}

export type AiSuggestion = {
  tags: string[]
  ageGroup: ResourceAgeGroup
  teachingGoals: string
  activitySuggestions: string
}

/** 从名称推导 resourceType，用于上传面板根据扩展名预设类型 */
export function guessResourceType(fileName: string): ResourceType | null {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  if (/^(jpg|jpeg|png|gif|webp|bmp|svg)$/.test(ext)) return 'image'
  if (/^(mp3|wav|ogg|m4a|aac|flac)$/.test(ext)) return 'audio'
  if (/^(mp4|webm|mov|avi|mkv)$/.test(ext)) return 'video'
  if (ext === 'pdf') return 'pdf'
  if (/^(ppt|pptx)$/.test(ext)) return 'ppt'
  if (ext === 'doc' || ext === 'docx' || ext === 'txt' || ext === 'xls' || ext === 'xlsx') return 'document'
  return null
}

/** 将资源元数据（逗号/JSON 数组，对应后端 Transform）序列化为可提交数组 */
export function toArrayField(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value
  if (value === undefined || value.trim() === '') return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (Array.isArray(parsed)) return parsed.map(String)
  } catch {
    // fallthrough to split
  }
  return value
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

/** 以携带 token 的 blob 拉取资源文件，返回 objectURL 与释放句柄；预览统一使用此方法规避 401 */
export async function fetchAuthedBlob(
  id: number,
): Promise<{ url: string; revoke: () => void }> {
  const response = await http.get<Blob>(`/resources/${id}/download`, {
    responseType: 'blob',
  })
  const url = URL.createObjectURL(response.data)
  const revoke = () => URL.revokeObjectURL(url)
  return { url, revoke }
}

export const resourceApi = {
  list: (params?: ListResourcesParams) =>
    http.get<PaginatedResources>('/resources', { params }),

  search: (params: { keyword: string; resourceType?: ResourceType }) =>
    http.get<ResourceSearchResult[]>('/resources/search', { params }),

  categories: () => http.get<ResourceCategory[]>('/resources/categories'),

  createCategory: (data: { name: string; parentId?: number; sort?: number }) =>
    http.post<ResourceCategory>('/resources/categories', data),

  upload: (
    field: string,
    form: FormData,
    onUploadProgress?: (loaded: number, total: number) => void,
  ) =>
    http.post<ResourceResponse>('/resources/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (event) => {
        if (onUploadProgress && event.total) {
          onUploadProgress(event.loaded, event.total)
        }
      },
    }),

  createUploadSession: (data: CreateChunkSessionParams) =>
    http.post<{ id: string; chunkSize: number; totalChunks: number }>(
      '/resources/upload-sessions',
      data,
    ),

  listUploadedChunks: (id: string) =>
    http.get<UploadedChunksResponse>(`/resources/upload-sessions/${id}/chunks`),

  uploadChunk: (id: string, chunkNo: number, chunk: Blob, sha256: string) => {
    const form = new FormData()
    form.append('file', chunk)
    form.append('sha256', sha256)
    return http.post(`/resources/upload-sessions/${id}/chunks/${chunkNo}`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },

  completeUpload: (id: string) =>
    http.post<ResourceResponse>(`/resources/upload-sessions/${id}/complete`),

  abortUpload: (id: string) =>
    http.delete(`/resources/upload-sessions/${id}`),

  get: (id: number) => http.get<ResourceResponse>(`/resources/${id}`),

  update: (id: number, data: Partial<ResourceMeta>) =>
    http.patch<ResourceResponse>(`/resources/${id}`, data),

  remove: (id: number) => http.delete(`/resources/${id}`),

  favorite: (id: number) => http.post(`/resources/${id}/favorite`),

  unfavorite: (id: number) => http.delete(`/resources/${id}/favorite`),

  addReference: (id: number, data: ResourceReferencePayload) =>
    http.post(`/resources/${id}/references`, data),

  removeReference: (id: number, data: ResourceReferencePayload) =>
    http.delete(`/resources/${id}/references`, { data }),

  submitReview: (id: number) =>
    http.post(`/resources/${id}/submit-review`),

  review: (id: number, data: ReviewPayload) =>
    http.post(`/resources/${id}/review`, data),

  aiSuggestion: (id: number) =>
    http.post<AiSuggestion | null>(`/resources/${id}/ai-suggestion`),

  confirmAiSuggestion: (id: number, data: AiSuggestion) =>
    http.post<ResourceResponse>(`/resources/${id}/ai-suggestion/confirm`, data),
}
