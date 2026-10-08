import { http } from './http'

export type Page<T> = { items: T[]; total: number; page: number; pageSize: number }
export type SchoolClass = { id: number; name: string; grade: string | null; ageRange: string | null; schoolYear: string; status: string }
export type Student = { id: number; classId: number; studentNo: string; name: string; nickname: string | null; status: string; createdAt: string; updatedAt: string }
export type Classroom = { id: number; name: string; location: string | null; status: string }
export type DeviceBindingSummary = {
  id: number
  classroomId: number
  classroomName: string | null
  classId: number
  className: string | null
  boundAt: string
}
export type Device = {
  id: number
  deviceCode: string
  name: string
  type: string
  status: string
  online: boolean
  lastOnlineAt: string | null
  binding?: DeviceBindingSummary | null
}
export type DeviceBinding = { id: number; deviceId: number; classroomId: number; classId: number; status: string; boundAt: string }
export type ClassDeviceBinding = {
  id: number
  classId: number
  classroomId: number
  classroom: { id: number; name: string } | null
  deviceId: number
  device: { id: number; deviceCode: string; name: string; type: string; status: string; online: boolean; lastOnlineAt: string | null } | null
}
export type Consent = { id: number; studentId: number; consentType: string; status: string; note?: string | null }

export type AdminDashboard = {
  generatedAt: string
  teachers: number
  classes: number
  students: number
  devices: { total: number; online: number; offline: number }
  classrooms: { today: number; active: number; abnormal: number }
  resources: { pending: number; disabled: number }
  ai: {
    total: number
    success: number
    errors: number
    successRate: number
    errorRate: number
    averageLatencyMs: number
  }
  storage: { indexedResourceBytes: number; physicalBytes: number }
}

export type AuditLogItem = {
  id: number
  actorType: 'teacher' | 'administrator'
  actorId: number
  action: string
  targetType: string | null
  targetId: string | null
  result: 'success' | 'failure'
  ipAddress: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
}

export type AiCallLogItem = {
  id: number
  actorType: 'teacher' | 'administrator' | null
  actorId: number | null
  feature: string
  provider: string | null
  model: string | null
  requestId: string | null
  status: string
  latencyMs: number | null
  errorCode: string | null
  createdAt: string
}

export type TeacherItem = {
  id: number
  account: string
  name: string
  role: string
  status: string
  schoolId: string | null
  classes: { classId: number; className: string; role: string }[]
}

export type RewardRecord = {
  id: number
  studentId: number
  studentName: string | null
  classId: number
  classroomRunId: number
  lessonTitle?: string | null
  runAt?: string | null
  teacherId: number
  teacherName: string | null
  rewardType: string
  rewardCategory?: 'answer' | 'cooperation' | 'focus' | 'labor' | 'exploration' | 'progress'
  rewardForms?: Array<'points' | 'badge' | 'flower' | 'voice_praise' | 'animation'>
  points?: number
  badgeCode?: string | null
  praiseText?: string | null
  animationKey?: string | null
  stars: number
  reason: string | null
  revokedAt?: string | null
  revokedByTeacherId?: number | null
  revokeReason?: string | null
  createdAt: string
}

export type ClassRewardPage = {
  items: RewardRecord[]
  total: number
  page: number
  pageSize: number
  summary: { classId: number; className: string; totalStars: number; totalPoints: number }
}

// 班级小红花 Top5 排行榜：后端按 class_id 过滤、GROUP BY student、SUM(stars)
// 排序 totalStars DESC + studentId ASC，必须经 requireClassAccess。
// 契约对应 GET /classes/:classId/rewards/leaderboard。
export type RewardLeaderboardItem = {
  rank: number
  studentId: number
  studentName: string | null
  totalStars: number
}
export type RewardLeaderboardResponse = {
  classId: number
  className: string
  items: RewardLeaderboardItem[]
}

export const platformApi = {
  adminDashboard: () => http.get<AdminDashboard>('/admin/dashboard'),
  auditLogs: (params: { page?: number; pageSize?: number; action?: string; actorType?: string; result?: string; from?: string; to?: string } = {}) => http.get<Page<AuditLogItem>>('/audit-logs', { params }),
  aiCallLogs: (params: { page?: number; pageSize?: number } = {}) => http.get<Page<AiCallLogItem>>('/ai-call-logs', { params }),
  classes: (page = 1) => http.get<Page<SchoolClass>>('/classes', { params: { page, pageSize: 50 } }),
  listClasses: (page = 1) => http.get<Page<SchoolClass>>('/classes', { params: { page, pageSize: 50 } }),
  createClass: (data: { name: string; grade?: string; ageRange?: string; schoolYear: string }) => http.post<SchoolClass>('/classes', data),
  updateClass: (id: number, data: Partial<Pick<SchoolClass, 'name' | 'grade' | 'ageRange' | 'schoolYear' | 'status'>>) => http.patch<SchoolClass>(`/classes/${id}`, data),
  students: (classId: number, page = 1) => http.get<Page<Student>>('/students', { params: { classId, page, pageSize: 100 } }),
  createStudent: (data: { classId: number; studentNo: string; name: string; nickname?: string }) => http.post<Student>('/students', data),
  syncStudents: (data: { classId: number; students: Array<{ studentNo: string; name: string; nickname?: string }> }) => http.post('/students/sync', data),
  updateStudent: (id: number, data: Partial<Pick<Student, 'name' | 'nickname' | 'status'>>) => http.patch<Student>(`/students/${id}`, data),
  consents: (studentId: number) => http.get<Consent[]>('/guardian-consents', { params: { studentId } }),
  classrooms: () => http.get<Classroom[]>('/classrooms'),
  listClassrooms: () => http.get<Classroom[]>('/classrooms'),
  createClassroom: (data: { name: string; location?: string }) => http.post<Classroom>('/classrooms', data),
  updateClassroom: (id: number, data: Partial<Pick<Classroom, 'name' | 'location' | 'status'>>) => http.patch<Classroom>(`/classrooms/${id}`, data),
  devices: () => http.get<Device[]>('/devices'),
  listDevices: () => http.get<Device[]>('/devices'),
  createDevice: (data: { deviceCode: string; name: string; type: string }) => http.post<Device>('/devices', data),
  updateDevice: (id: number, data: Partial<Pick<Device, 'name' | 'type' | 'status'>>) => http.patch<Device>(`/devices/${id}`, data),
  heartbeat: (id: number, deviceCode: string) => http.post<Device>(`/devices/${id}/heartbeat`, { deviceCode }),
  bindDevice: (data: { deviceId: number; classroomId: number; classId: number }) => http.post<DeviceBinding>('/device-bindings', data),
  unbindDevice: (id: number) => http.delete(`/device-bindings/${id}`),
  createTicket: (data: { deviceId: number; classId: number; classroomId: number; lessonRunId?: number; expiresInSeconds?: number }) => http.post<{ ticket: string; expiresAt: string; deviceCode: string }>('/classroom-tickets', data),
  consumeTicket: (data: { ticket: string; deviceCode: string }) => http.post<{ classId: number; classroomId: number; deviceId: number; lessonRunId: number | null; deviceCode: string }>('/classroom-tickets/consume', data),
  teachers: (params: { page?: number; pageSize?: number; keyword?: string; status?: string } = {}) => http.get<Page<TeacherItem>>('/teachers', { params }),
  createTeacher: (data: { account: string; password: string; name: string; role?: string; schoolId?: string }) => http.post<{ id: number; account: string; name: string; role: string; status: string }>('/teachers', data),
  updateTeacher: (id: number, data: Partial<Pick<TeacherItem, 'name' | 'role' | 'status'>>) => http.patch<{ id: number; account: string; name: string; role: string; status: string }>(`/teachers/${id}`, data),
  classTeachers: (classId: number) => http.get<{ relationId: number; role: string; teacherId: number; name: string; account: string }[]>(`/classes/${classId}/teachers`),
  classDeviceBindings: (classId: number) => http.get<ClassDeviceBinding[]>(`/classes/${classId}/device-bindings`),
  bindTeacher: (classId: number, data: { teacherId: number; role: string }) => http.post(`/classes/${classId}/teachers`, data),
  unbindTeacher: (classId: number, teacherId: number) => http.delete(`/classes/${classId}/teachers/${teacherId}`),
  classRewards: (classId: number, params: { page?: number; pageSize?: number; studentId?: number } = {}) => http.get<ClassRewardPage>(`/classes/${classId}/rewards`, { params }),
  rewardLeaderboard: (classId: number, limit = 5) =>
    http.get<RewardLeaderboardResponse>(`/classes/${classId}/rewards/leaderboard`, { params: { limit } }),
}
