import axios from 'axios'
import { http } from './http'

/** 后端 ResourceType 的真实可查询值。document 仅用于兼容旧资源。 */
export const RESOURCE_TYPES = [
  'image',
  'audio',
  'video',
  'pdf',
  'ppt',
  'picture_book',
  'nursery_rhyme',
  'animation',
  'question_bank',
  'experiment',
  'model_3d',
  'document',
] as const

export type KnownResourceType = (typeof RESOURCE_TYPES)[number]

/** 新上传允许选择的类型；document 只用于读取历史数据。 */
export const UPLOAD_RESOURCE_TYPES = RESOURCE_TYPES.filter(
  (type) => type !== 'document',
) as Exclude<KnownResourceType, 'document'>[]

/** 服务端出现尚未被当前前端识别的值时进入安全降级状态。 */
export type ResourceType = KnownResourceType | 'unknown'

/** 年龄段，对齐后端 ResourceAgeGroup */
export type ResourceAgeGroup = 'small' | 'middle' | 'large' | 'all'

/** 审核状态，对齐后端 ResourceReviewStatus */
export type ResourceReviewStatus =
  | 'draft'
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'archived'

export const AGE_GROUPS: ResourceAgeGroup[] = [
  'small',
  'middle',
  'large',
  'all',
]

export const REVIEW_STATUSES: ResourceReviewStatus[] = [
  'draft',
  'pending_review',
  'approved',
  'rejected',
  'archived',
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

export type ResourcePreviewAsset = {
  name: string
  mimeType: string
  pageNumber: number | null
}

export type ResourcePreviewManifest = {
  status: 'ready' | 'unavailable'
  mode: 'source' | 'pdf' | 'images' | 'unsupported'
  assets: ResourcePreviewAsset[]
  message: string | null
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
  resourceType?: KnownResourceType
  reviewStatus?: ResourceReviewStatus
  ageGroup?: ResourceAgeGroup
  domain?: string
  tag?: string
  isFavorite?: boolean
  ownerId?: string
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
  resourceType: KnownResourceType
  aliases?: string[]
  description?: string
  domain?: string
  tags?: string[]
  duration?: number
}

/** PATCH /resources/:id，严格对应后端 UpdateResourceDto，不包含文件或审核字段。 */
export type UpdateResourceMetadata = Partial<
  Pick<
    ResourceMeta,
    | 'title'
    | 'aliases'
    | 'description'
    | 'category'
    | 'categoryId'
    | 'ageGroup'
    | 'domain'
    | 'tags'
  >
>

export type ResourceFavoriteState = {
  resourceId: number
  isFavorite: boolean
}

/** 创建分片上传会话参数（对齐 CreateUploadSessionDto） */
export type CreateChunkSessionParams = ResourceMeta & {
  originalName: string
  declaredMime: string
  totalSize: number
  chunkSize: number
  expectedSha256?: string
}

const MB = 1024 * 1024

/** 与后端 RESOURCE_SIZE_LIMITS 保持一致，用于选择文件后的快速提示。 */
export const RESOURCE_UPLOAD_SIZE_LIMITS: Readonly<Record<KnownResourceType, number>> = {
  image: 15 * MB,
  audio: 100 * MB,
  video: 500 * MB,
  pdf: 80 * MB,
  ppt: 150 * MB,
  picture_book: 80 * MB,
  nursery_rhyme: 100 * MB,
  animation: 300 * MB,
  question_bank: 20 * MB,
  experiment: 80 * MB,
  model_3d: 300 * MB,
  document: 80 * MB,
}

type UploadExtensionRule = {
  mime: string
  defaultType: KnownResourceType
  allowedTypes: readonly KnownResourceType[]
}

const UPLOAD_EXTENSION_RULES: Readonly<Record<string, UploadExtensionRule>> = {
  jpg: { mime: 'image/jpeg', defaultType: 'image', allowedTypes: ['image'] },
  jpeg: { mime: 'image/jpeg', defaultType: 'image', allowedTypes: ['image'] },
  png: { mime: 'image/png', defaultType: 'image', allowedTypes: ['image'] },
  gif: { mime: 'image/gif', defaultType: 'animation', allowedTypes: ['animation', 'image'] },
  mp3: { mime: 'audio/mpeg', defaultType: 'audio', allowedTypes: ['audio', 'nursery_rhyme'] },
  wav: { mime: 'audio/wav', defaultType: 'audio', allowedTypes: ['audio', 'nursery_rhyme'] },
  mp4: { mime: 'video/mp4', defaultType: 'video', allowedTypes: ['video', 'animation'] },
  pdf: {
    mime: 'application/pdf',
    defaultType: 'pdf',
    allowedTypes: ['pdf', 'picture_book', 'experiment', 'document'],
  },
  ppt: {
    mime: 'application/vnd.ms-powerpoint',
    defaultType: 'ppt',
    allowedTypes: ['ppt', 'document'],
  },
  pptx: {
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    defaultType: 'ppt',
    allowedTypes: ['ppt', 'document'],
  },
  json: {
    mime: 'application/json',
    defaultType: 'question_bank',
    allowedTypes: ['question_bank', 'model_3d'],
  },
  gltf: { mime: 'model/gltf+json', defaultType: 'model_3d', allowedTypes: ['model_3d'] },
  glb: { mime: 'model/gltf-binary', defaultType: 'model_3d', allowedTypes: ['model_3d'] },
  vrm: { mime: 'model/gltf-binary', defaultType: 'model_3d', allowedTypes: ['model_3d'] },
}

export const RESOURCE_UPLOAD_ACCEPT = Object.keys(UPLOAD_EXTENSION_RULES)
  .map((extension) => `.${extension}`)
  .join(',')

export type ResourceFileValidation =
  | { valid: true; declaredMime: string; maxSize: number }
  | { valid: false; message: string; maxSize?: number }

function fileExtension(fileName: string): { extension: string; safe: boolean } {
  const name = fileName.trim()
  const index = name.lastIndexOf('.')
  if (index <= 0 || index === name.length - 1) return { extension: '', safe: false }
  const stem = name.slice(0, index)
  return { extension: name.slice(index + 1).toLowerCase(), safe: !stem.includes('.') }
}

/** 前端只做快速校验，服务端仍会检查真实 MIME、文件魔数和结构。 */
export function validateResourceFile(
  file: Pick<File, 'name' | 'size'>,
  resourceType: KnownResourceType,
): ResourceFileValidation {
  const { extension, safe } = fileExtension(file.name)
  const rule = UPLOAD_EXTENSION_RULES[extension]
  if (!safe || !rule) return { valid: false, message: '文件扩展名不允许或包含双扩展名' }
  if (!rule.allowedTypes.includes(resourceType)) {
    return { valid: false, message: '资源类型与文件格式不匹配' }
  }
  const maxSize = RESOURCE_UPLOAD_SIZE_LIMITS[resourceType]
  if (file.size <= 0) return { valid: false, message: '文件内容为空', maxSize }
  if (file.size > maxSize) {
    return {
      valid: false,
      message: `文件超过该类型允许的 ${Math.round(maxSize / MB)}MB 上限`,
      maxSize,
    }
  }
  return { valid: true, declaredMime: rule.mime, maxSize }
}

type PaginatedResourcesWire = Omit<PaginatedResources, 'items'> & {
  items: unknown[]
}

function isKnownResourceType(value: unknown): value is KnownResourceType {
  return typeof value === 'string' && (RESOURCE_TYPES as readonly string[]).includes(value)
}

/** 只在 API 边界做运行时归一化，页面和 store 不再信任未知的服务端枚举。 */
export function normalizeResourceResponse(value: unknown): ResourceResponse {
  const resource = value as Omit<ResourceResponse, 'resourceType' | 'reviewStatus'> & {
    resourceType?: unknown
    reviewStatus?: unknown
  }
  const reviewStatus = resource.reviewStatus === 'pending'
    ? 'pending_review'
    : resource.reviewStatus === 'disabled'
      ? 'archived'
      : resource.reviewStatus
  return {
    ...resource,
    resourceType: isKnownResourceType(resource.resourceType)
      ? resource.resourceType
      : 'unknown',
    reviewStatus: REVIEW_STATUSES.includes(reviewStatus as ResourceReviewStatus)
      ? reviewStatus as ResourceReviewStatus
      : 'draft',
  }
}

/** 删除空筛选并规范分页，所有资源列表请求共用这一套参数规则。 */
export function normalizeListResourcesParams(
  params: ListResourcesParams = {},
): ListResourcesParams {
  const normalized: ListResourcesParams = {}
  const textKeys = ['category', 'domain', 'tag', 'keyword', 'ownerId'] as const
  for (const key of textKeys) {
    const value = params[key]?.trim()
    if (value) normalized[key] = value
  }
  if (params.categoryId && params.categoryId > 0) normalized.categoryId = params.categoryId
  if (params.resourceType) normalized.resourceType = params.resourceType
  if (params.reviewStatus) normalized.reviewStatus = params.reviewStatus
  if (params.ageGroup) normalized.ageGroup = params.ageGroup
  if (params.isFavorite !== undefined) normalized.isFavorite = params.isFavorite
  if (params.page) normalized.page = Math.max(1, Math.trunc(params.page))
  if (params.pageSize) normalized.pageSize = Math.min(100, Math.max(1, Math.trunc(params.pageSize)))
  return normalized
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

export type ResourceReferenceUsage = {
  referenceType: string
  referenceId: string
  lessonPlanId: number | null
  lessonPlanTitle: string | null
  steps: Array<{ id: number; sortOrder: number; title: string }>
  createdAt: string
}

export type ReviewPayload = {
  status: Extract<ResourceReviewStatus, 'approved' | 'rejected' | 'archived'>
  comment?: string
}

export type AiSuggestion = {
  tags: string[]
  ageGroup: ResourceAgeGroup
  teachingGoals: string
  activitySuggestions: string
}

/** 从名称推导 resourceType，用于上传面板根据扩展名预设类型 */
export function guessResourceType(fileName: string): KnownResourceType | null {
  const { extension, safe } = fileExtension(fileName)
  return safe ? (UPLOAD_EXTENSION_RULES[extension]?.defaultType ?? null) : null
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
async function fetchProtectedBlob(
  path: string,
): Promise<{ url: string; revoke: () => void }> {
  const response = await http.get<Blob>(path, {
    responseType: 'blob',
  })
  const url = URL.createObjectURL(response.data)
  const revoke = () => URL.revokeObjectURL(url)
  return { url, revoke }
}

export function fetchAuthedBlob(
  id: number,
): Promise<{ url: string; revoke: () => void }> {
  return fetchProtectedBlob(`/resources/${id}/download`)
}

export async function getResourcePreviewManifest(
  id: number,
): Promise<ResourcePreviewManifest> {
  const { data } = await http.get<ResourcePreviewManifest>(
    `/resources/${id}/preview-manifest`,
  )
  return data
}

export function fetchAuthedPreviewAsset(
  id: number,
  assetName: string,
): Promise<{ url: string; revoke: () => void }> {
  return fetchProtectedBlob(
    `/resources/${id}/preview-assets/${encodeURIComponent(assetName)}`,
  )
}

/** 将单资源获取失败映射为可展示提示：404 资源失效 / 403 无权 / 其余网络或加载失败（课堂不白屏、可重试）。 */
export function resourceAccessMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    if (status === 404) return '该教学资源已不可用或已被删除'
    if (status === 403) return '无权访问该教学资源，请联系管理员'
    if (!error.response) return '网络连接失败，请检查网络后重试'
    const body = error.response.data
    if (body && typeof body === 'object' && 'message' in body) {
      const message = (body as { message?: unknown }).message
      if (typeof message === 'string' && message.trim()) return message
      if (Array.isArray(message) && message.length) return message.map(String).join('；')
    }
  }
  if (error instanceof Error && error.message) return error.message
  return '资源加载失败，请检查网络后重试'
}

export type ResourceAccessErrorKind = 'forbidden' | 'not_found' | 'network' | 'error'

export function resourceAccessErrorKind(error: unknown): ResourceAccessErrorKind {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 403) return 'forbidden'
    if (error.response?.status === 404) return 'not_found'
    if (!error.response) return 'network'
  }
  return 'error'
}

export const resourceApi = {
  list: async (params?: ListResourcesParams) => {
    const response = await http.get<PaginatedResourcesWire>('/resources', {
      params: normalizeListResourcesParams(params),
    })
    return {
      ...response,
      data: {
        ...response.data,
        items: response.data.items.map(normalizeResourceResponse),
      },
    }
  },

  search: async (params: { keyword: string; resourceType?: KnownResourceType }) => {
    const response = await http.get<unknown[]>('/resources/search', { params })
    return {
      ...response,
      data: response.data.map((item) => normalizeResourceResponse(item) as ResourceSearchResult),
    }
  },

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

  uploadChunk: (
    id: string,
    chunkNo: number,
    chunk: Blob,
    sha256: string,
    options: { onProgress?: (loaded: number, total: number) => void; signal?: AbortSignal } = {},
  ) => {
    const form = new FormData()
    form.append('file', chunk)
    form.append('sha256', sha256)
    return http.post(`/resources/upload-sessions/${id}/chunks/${chunkNo}`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      signal: options.signal,
      onUploadProgress: (event) => {
        if (event.total) options.onProgress?.(event.loaded, event.total)
      },
    })
  },

  completeUpload: async (id: string, metadata?: Partial<Omit<ResourceMeta, 'resourceType'>>) => {
    const response = await http.post<unknown>(
      `/resources/upload-sessions/${id}/complete`,
      metadata,
    )
    return { ...response, data: normalizeResourceResponse(response.data) }
  },

  abortUpload: (id: string) =>
    http.delete(`/resources/upload-sessions/${id}`),

  get: async (id: number) => {
    const response = await http.get<unknown>(`/resources/${id}`)
    return { ...response, data: normalizeResourceResponse(response.data) }
  },

  update: async (id: number, data: UpdateResourceMetadata) => {
    const response = await http.patch<unknown>(`/resources/${id}`, data)
    return { ...response, data: normalizeResourceResponse(response.data) }
  },

  remove: (id: number) => http.delete(`/resources/${id}`),

  favorite: (id: number) =>
    http.post<ResourceFavoriteState>(`/resources/${id}/favorite`),

  unfavorite: (id: number) =>
    http.delete<ResourceFavoriteState>(`/resources/${id}/favorite`),

  addReference: (id: number, data: ResourceReferencePayload) =>
    http.post(`/resources/${id}/references`, data),

  listReferences: (id: number) =>
    http.get<ResourceReferenceUsage[]>(`/resources/${id}/references`),

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
