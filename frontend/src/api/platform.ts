import { http } from './http'

export type Page<T> = { items: T[]; total: number; page: number; pageSize: number }
export type SchoolClass = { id: number; name: string; grade: string | null; ageRange: string | null; schoolYear: string; status: string }
export type Student = { id: number; classId: number; studentNo: string; name: string; nickname: string | null; status: string; createdAt: string; updatedAt: string }
export type Classroom = { id: number; name: string; location: string | null; status: string }
export type Device = { id: number; deviceCode: string; name: string; type: string; status: string; lastOnlineAt: string | null }
export type DeviceBinding = { id: number; deviceId: number; classroomId: number; classId: number; status: string; boundAt: string }
export type Consent = { id: number; studentId: number; consentType: string; status: string; note?: string | null }

export const platformApi = {
  classes: (page = 1) => http.get<Page<SchoolClass>>('/classes', { params: { page, pageSize: 50 } }),
  students: (classId: number, page = 1) => http.get<Page<Student>>('/students', { params: { classId, page, pageSize: 100 } }),
  updateStudent: (id: number, data: Partial<Pick<Student, 'name' | 'nickname'>>) => http.patch<Student>(`/students/${id}`, data),
  consents: (studentId: number) => http.get<Consent[]>('/guardian-consents', { params: { studentId } }),
  classrooms: () => http.get<Classroom[]>('/classrooms'),
  devices: () => http.get<Device[]>('/devices'),
  bindDevice: (data: { deviceId: number; classroomId: number; classId: number }) => http.post<DeviceBinding>('/device-bindings', data),
  unbindDevice: (id: number) => http.delete(`/device-bindings/${id}`),
  createTicket: (data: { deviceId: number; classId: number; classroomId: number; expiresInSeconds?: number }) => http.post<{ ticket: string; expiresAt: string }>('/classroom-tickets', data),
}
