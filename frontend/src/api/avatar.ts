import { http } from '@/api/http'

// 角色列表项：完整保留后端返回的已公开字段，前端不丢弃。
export interface AvatarCharacterListItem {
  id: number
  name: string
  category?: string | null
  description?: string | null
  status?: string | null
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

export async function resolveAvatar(context: ResolveAvatarContext): Promise<ResolveAvatarResponse> {
  const { data } = await http.get<ResolveAvatarResponse>('/avatars/resolve', { params: context })
  return data
}

export async function listAvatarCharacters(): Promise<AvatarCharacterListResponse> {
  const { data } = await http.get<AvatarCharacterListResponse>('/avatars/characters', {
    params: { page: 1, pageSize: 50, status: 'approved' },
  })
  return data
}