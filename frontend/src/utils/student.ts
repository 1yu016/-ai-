import type {
  Consent,
  Student,
  StudentAuthorizationStatus,
} from '@/api/platform'

export const STUDENT_AUTHORIZATION_LABELS: Record<StudentAuthorizationStatus, string> = {
  authorized: '已授权',
  partial: '部分授权',
  unauthorized: '未授权',
  pending: '待确认',
}

export const CONSENT_TYPE_LABELS: Record<Consent['consentType'], string> = {
  photo: '照片',
  voice: '声音',
  artwork: '作品',
}

export const CONSENT_STATUS_LABELS: Record<Consent['status'], string> = {
  granted: '已授权',
  revoked: '未授权',
  pending: '待确认',
}

export function studentAuthorizationStatus(
  student: Partial<Student>,
): StudentAuthorizationStatus {
  return student.authorizationStatus ?? 'pending'
}

export function studentDisplayName(
  student: Pick<Student, 'id'> & Partial<Pick<Student, 'name' | 'nickname'>>,
): string {
  const name = typeof student.name === 'string' ? student.name.trim() : ''
  const nickname = typeof student.nickname === 'string' ? student.nickname.trim() : ''
  return name || nickname || `幼儿 ${student.id}`
}

export function studentStatusLabel(status: string): string {
  return status === 'disabled' ? '已停用' : '在读'
}
