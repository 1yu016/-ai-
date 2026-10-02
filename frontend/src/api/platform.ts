import { http } from './http'

export type Page<T> = { items: T[]; total: number; page: number; pageSize: number }
export type SchoolClass = { id: number; name: string; grade: string | null; ageRange: string | null; schoolYear: string; status: string }
export type Student = { id: number; classId: number; studentNo: string; name: string; nickname: string | null; status: string; createdAt: string; updatedAt: string }
export type Classroom = { id: number; name: string; location: string | null; status: string }
export type Device = { id: number; deviceCode: string; name: string; type: string; status: string; lastOnlineAt: string | null }
export type DeviceBinding = { id: number; deviceId: number; classroomId: number; classId: number; status: string; boundAt: string }
export type ClassDeviceBinding = {
  id: number
  classId: number
  classroomId: number
  classroom: { id: number; name: string } | null
  deviceId: number
  device: { id: number; name: string; type: string; status: string } | null
}
export type Consent = { id: number; studentId: number; consentType: string; status: string; note?: string | null }

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
  stars: number
  reason: string | null
  createdAt: string
}

export type ClassRewardPage = {
  items: RewardRecord[]
  total: number
  page: number
  pageSize: number
  summary: { classId: number; className: string; totalStars: number }
}

export const platformApi = {
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
  bindDevice: (data: { deviceId: number; classroomId: number; classId: number }) => http.post<DeviceBinding>('/device-bindings', data),
  unbindDevice: (id: number) => http.delete(`/device-bindings/${id}`),
  createTicket: (data: { deviceId: number; classId: number; classroomId: number; expiresInSeconds?: number }) => http.post<{ ticket: string; expiresAt: string }>('/classroom-tickets', data),
  teachers: (params: { page?: number; pageSize?: number; keyword?: string; status?: string } = {}) => http.get<Page<TeacherItem>>('/teachers', { params }),
  createTeacher: (data: { account: string; password: string; name: string; role?: string; schoolId?: string }) => http.post<{ id: number; account: string; name: string; role: string; status: string }>('/teachers', data),
  updateTeacher: (id: number, data: Partial<Pick<TeacherItem, 'name' | 'role' | 'status'>>) => http.patch<{ id: number; account: string; name: string; role: string; status: string }>(`/teachers/${id}`, data),
  classTeachers: (classId: number) => http.get<{ relationId: number; role: string; teacherId: number; name: string; account: string }[]>(`/classes/${classId}/teachers`),
  classDeviceBindings: (classId: number) => http.get<ClassDeviceBinding[]>(`/classes/${classId}/device-bindings`),
  bindTeacher: (classId: number, data: { teacherId: number; role: string }) => http.post(`/classes/${classId}/teachers`, data),
  unbindTeacher: (classId: number, teacherId: number) => http.delete(`/classes/${classId}/teachers/${teacherId}`),
  classRewards: (classId: number, params: { page?: number; pageSize?: number; studentId?: number } = {}) => http.get<ClassRewardPage>(`/classes/${classId}/rewards`, { params }),
}
