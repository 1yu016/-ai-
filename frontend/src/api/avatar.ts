import { http } from '@/api/http'

// 角色列表项：完整保留后端返回的已公开字段，前端不丢弃。
export interface AvatarCharacterListItem {
  id: number
  name: string
  category?: string | null
  description?: string | null
  status?: string | null
  ownerType?: string
  ownerId?: number
  schoolId?: string | null
  currentVersionId?: number | null
}

// GET /avatars/characters 响应
export interface AvatarCharacterListResponse {
  items: AvatarCharacterListItem[]
  total: number
  page: number
  pageSize: number
}

// GET /avatars/resolve 响应（后端 Avatar runtime 配置，供课堂运行时使用）
export interface ResolveAvatarResponse {
  sourceScope: string | null
  character: { id: number; name: string; category: string | null } | null
  version: { id: number; version: number; engineVersion: string; modelFormat: 'glb' | 'gltf' | 'vrm' } | null
  renderAsset: { id: number; assetType: string; contentUrl: string | null; mimeType: string | null } | null
  action: { requested: string; effective: string | null; contentUrl: string | null }
  voice: { provider: string; voiceId: string; language: string; speed: number; volume: number; pitch: number } | null
  personality: { style: string; catchphrases: string[]; greeting: string; encouragementStyle: string; goodbyeText: string } | null
  fallbackLevel: string | null
  reason: string | null
}

// resolve 查询上下文：按课堂运行去解析角色绑定（classId/lessonPlanId/classroomRunId 三维作用域）
export interface ResolveAvatarContext {
  classId?: number
  lessonPlanId?: number
  classroomRunId?: number
  deviceId?: number
}

export type AvatarAsset = {
  id: number
  versionId: number
  assetType: string
  actionName: string | null
  originalName: string
  mimeType: string
  fileSize: number
  contentUrl: string
}

export type AvatarVersion = {
  id: number
  characterId: number
  version: number
  engineVersion: string
  modelFormat: 'glb' | 'gltf' | 'vrm'
  status: 'draft' | 'ready' | 'disabled'
  assets: AvatarAsset[]
}

export type AvatarVoiceProfile = {
  provider: string
  voiceId: string
  language: string
  speed: number
  volume: number
  pitch: number
  status: 'active' | 'disabled' | 'unavailable'
}

export type AvatarPersonality = {
  style: string
  catchphrases: string[]
  greeting: string
  encouragementStyle: string
  goodbyeText: string
}

export interface AvatarCharacterDetail extends AvatarCharacterListItem {
  versions: AvatarVersion[]
  voiceProfile: AvatarVoiceProfile | null
  personality: AvatarPersonality | null
}

export type AvatarBindingInput = {
  characterId: number
  versionId: number
  reason: string
}

export async function resolveAvatar(context: ResolveAvatarContext): Promise<ResolveAvatarResponse> {
  const { data } = await http.get<ResolveAvatarResponse>('/avatars/resolve', { params: context })
  return data
}

export async function listAvatarCharacters(params: Record<string, unknown> = {}): Promise<AvatarCharacterListResponse> {
  const { data } = await http.get<AvatarCharacterListResponse>('/avatars/characters', {
    params: { page: 1, pageSize: 100, ...params },
  })
  return data
}

export async function getAvatarCharacter(id: number) {
  const { data } = await http.get<AvatarCharacterDetail>(`/avatars/characters/${id}`)
  return data
}

export async function createAvatarCharacter(input: { name: string; category: string; description?: string }) {
  const { data } = await http.post<AvatarCharacterDetail>('/avatars/characters', input)
  return data
}

export async function updateAvatarCharacter(id: number, input: { name?: string; category?: string; description?: string }) {
  const { data } = await http.patch<AvatarCharacterDetail>(`/avatars/characters/${id}`, input)
  return data
}

export async function createAvatarVersion(characterId: number, input: { file: File; modelFormat: string; engineVersion: string }) {
  const form = new FormData()
  form.append('file', input.file)
  form.append('modelFormat', input.modelFormat)
  form.append('engineVersion', input.engineVersion)
  const { data } = await http.post<AvatarVersion>(`/avatars/characters/${characterId}/versions`, form)
  return data
}

export async function uploadAvatarAsset(versionId: number, input: { file: File; assetType: string; actionName?: string }) {
  const form = new FormData()
  form.append('file', input.file)
  form.append('assetType', input.assetType)
  if (input.actionName) form.append('actionName', input.actionName)
  const { data } = await http.post<AvatarAsset>(`/avatars/versions/${versionId}/assets`, form)
  return data
}

export async function publishAvatarVersion(versionId: number) {
  const { data } = await http.post<AvatarVersion>(`/avatars/versions/${versionId}/publish`)
  return data
}

export async function submitAvatarReview(characterId: number) {
  const { data } = await http.post<AvatarCharacterDetail>(`/avatars/characters/${characterId}/submit-review`)
  return data
}

export async function reviewAvatar(characterId: number, status: 'approved' | 'rejected' | 'disabled', comment: string) {
  const { data } = await http.post<AvatarCharacterDetail>(`/avatars/characters/${characterId}/review`, { status, comment })
  return data
}

export async function disableAvatarVersion(versionId: number, reason: string) {
  const { data } = await http.patch<AvatarVersion>(`/avatars/versions/${versionId}/status`, { status: 'disabled', reason })
  return data
}

export async function saveAvatarVoice(characterId: number, input: AvatarVoiceProfile & { reason: string }) {
  const { data } = await http.patch(`/avatars/characters/${characterId}/voice-profile`, input)
  return data
}

export async function saveAvatarPersonality(characterId: number, input: AvatarPersonality & { reason: string }) {
  const { data } = await http.patch(`/avatars/characters/${characterId}/personality`, input)
  return data
}

export async function setClassAvatar(classId: number, input: AvatarBindingInput) {
  const { data } = await http.post(`/avatars/bindings/classes/${classId}`, input)
  return data
}

export async function setLessonAvatar(lessonPlanId: number, input: AvatarBindingInput) {
  const { data } = await http.post(`/avatars/bindings/lesson-plans/${lessonPlanId}`, input)
  return data
}

export async function setClassroomAvatar(runId: number, input: AvatarBindingInput & { deviceId: number; version: number; requestId: string }) {
  const { data } = await http.post(`/classroom-runs/${runId}/avatar-binding`, input)
  return data
}

export async function fetchAvatarAsset(assetId: number) {
  const { data } = await http.get<Blob>(`/avatars/assets/${assetId}/content`, { responseType: 'blob' })
  return data
}
