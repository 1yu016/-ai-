import { http } from './http'

export type Page<T> = { items: T[]; total: number; page: number; pageSize: number }
export type ClassTeacherSummary = { teacherId: number; name: string; role: string }
export type SchoolClass = {
  id: number
  name: string
  grade: string | null
  ageRange: string | null
  schoolYear: string
  status: string
  teachers: ClassTeacherSummary[]
  studentCount: number
}
export type ClassListQuery = { page?: number; pageSize?: number; keyword?: string; status?: string }
export type ClassroomRunSummary = {
  id: number
  title: string
  status: string
  startedAt: string | null
  endedAt: string | null
  createdAt: string
}
export type StudentAuthorizationStatus = 'authorized' | 'partial' | 'unauthorized' | 'pending'
export type StudentPermissions = { photo: boolean; voice: boolean; artwork: boolean }
export type Student = {
  id: number
  classId: number
  className?: string
  studentNo: string
  name: string
  nickname: string | null
  status: string
  authorizationStatus?: StudentAuthorizationStatus
  permissions?: StudentPermissions
  createdAt: string
  updatedAt: string
}
export type StudentDetail = Student & {
  className: string
  authorizationStatus: StudentAuthorizationStatus
  permissions: StudentPermissions
  gender: string | null
  birthday: string | null
  consents: Consent[]
}
export type StudentListQuery = {
  classId: number
  page?: number
  pageSize?: number
  keyword?: string
  status?: 'active' | 'disabled'
}

export type StudentImportRow = {
  rowNumber: number
  studentNo: string
  name: string
  nickname: string | null
  gender: string | null
  birthday: string | null
  status: 'active' | 'disabled'
  valid: boolean
  errors: string[]
}

export type StudentImportPreview = {
  sessionId: string
  classId: number
  className: string
  expiresAt: string
  summary: { total: number; valid: number; invalid: number }
  validRows: StudentImportRow[]
  invalidRows: StudentImportRow[]
}

export type StudentImportResult = {
  sessionId: string
  requestId: string
  classId: number
  created: number
  skipped: number
  replayed: boolean
}
export type ClassroomBindingSummary = {
  id: number
  classId: number
  className: string | null
  deviceId: number
  device: Pick<Device, 'id' | 'deviceCode' | 'name' | 'type' | 'status' | 'online' | 'lastOnlineAt'> | null
  boundAt: string
}
export type Classroom = {
  id: number
  name: string
  location: string | null
  status: string
  bindingCount?: number
  onlineDeviceCount?: number
  bindings?: ClassroomBindingSummary[]
}
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
export type Consent = {
  id: number
  studentId: number
  consentType: 'photo' | 'voice' | 'artwork'
  status: 'granted' | 'revoked' | 'pending'
  note?: string | null
  consentedAt?: string | null
  revokedAt?: string | null
}

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
  classes: (query: ClassListQuery | number = {}) => http.get<Page<SchoolClass>>('/classes', {
    params: typeof query === 'number' ? { page: query, pageSize: 50 } : query,
  }),
  listClasses: (query: ClassListQuery | number = {}) => http.get<Page<SchoolClass>>('/classes', {
    params: typeof query === 'number' ? { page: query, pageSize: 50 } : query,
  }),
  classDetail: (id: number) => http.get<SchoolClass>(`/classes/${id}`),
  createClass: (data: { name: string; grade?: string; ageRange?: string; schoolYear: string }) => http.post<SchoolClass>('/classes', data),
  updateClass: (id: number, data: Partial<Pick<SchoolClass, 'name' | 'grade' | 'ageRange' | 'schoolYear' | 'status'>>) => http.patch<SchoolClass>(`/classes/${id}`, data),
  students: (classIdOrQuery: number | StudentListQuery, page = 1) => http.get<Page<Student>>('/students', {
    params: typeof classIdOrQuery === 'number'
      ? { classId: classIdOrQuery, page, pageSize: 100 }
      : classIdOrQuery,
  }),
  studentDetail: (id: number) => http.get<StudentDetail>(`/students/${id}`),
  createStudent: (data: { classId: number; studentNo: string; name: string; nickname?: string; gender?: string; birthday?: string }) => http.post<Student>('/students', data),
  syncStudents: (data: { classId: number; students: Array<{ studentNo: string; name: string; nickname?: string }> }) => http.post('/students/sync', data),
  updateStudent: (id: number, data: Partial<Pick<StudentDetail, 'name' | 'nickname' | 'gender' | 'birthday' | 'status'>>) => http.patch<Student>(`/students/${id}`, data),
  studentImportTemplate: (classId: number) => http.get<Blob>(`/classes/${classId}/students/import/template`, { responseType: 'blob' }),
  previewStudentImport: (classId: number, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return http.post<StudentImportPreview>(`/classes/${classId}/students/import/preview`, form)
  },
  confirmStudentImport: (classId: number, sessionId: string, requestId: string) => http.post<StudentImportResult>(`/classes/${classId}/students/import/${sessionId}/confirm`, { requestId }),
  studentImportErrors: (classId: number, sessionId: string) => http.get<Blob>(`/classes/${classId}/students/import/${sessionId}/errors`, { responseType: 'blob' }),
  consents: (studentId: number) => http.get<Consent[]>('/guardian-consents', { params: { studentId } }),
  classrooms: () => http.get<Classroom[]>('/classrooms'),
  listClassrooms: () => http.get<Classroom[]>('/classrooms'),
  classroomDetail: (id: number) => http.get<Classroom>(`/classrooms/${id}`),
  createClassroom: (data: { name: string; location?: string }) => http.post<Classroom>('/classrooms', data),
  updateClassroom: (id: number, data: Partial<Pick<Classroom, 'name' | 'location' | 'status'>>) => http.patch<Classroom>(`/classrooms/${id}`, data),
  devices: () => http.get<Device[]>('/devices'),
  listDevices: () => http.get<Device[]>('/devices'),
  deviceDetail: (id: number) => http.get<Device>(`/devices/${id}`),
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
  classRuns: (classId: number, params: { page?: number; pageSize?: number } = {}) =>
    http.get<Page<ClassroomRunSummary>>(`/classes/${classId}/classroom-runs`, { params }),
  classDeviceBindings: (classId: number) => http.get<ClassDeviceBinding[]>(`/classes/${classId}/device-bindings`),
  bindTeacher: (classId: number, data: { teacherId: number; role: string }) => http.post(`/classes/${classId}/teachers`, data),
  unbindTeacher: (classId: number, teacherId: number) => http.delete(`/classes/${classId}/teachers/${teacherId}`),
  classRewards: (classId: number, params: { page?: number; pageSize?: number; studentId?: number } = {}) => http.get<ClassRewardPage>(`/classes/${classId}/rewards`, { params }),
  rewardLeaderboard: (classId: number, limit = 5) =>
    http.get<RewardLeaderboardResponse>(`/classes/${classId}/rewards/leaderboard`, { params: { limit } }),
}
