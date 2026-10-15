import { http } from './http'

export type ScreenPreparation = {
  preparationId: string; revision: number; deviceId: number; classId: number;
  classroomId: number; lessonPlanId: number; lessonPlanVersion: number;
  courseTitle: string; welcomeText: string; createdAt: string; expiresAt: string;
  serverNow?: string;
}
export type PreparationInput = {
  classId: number; classroomId: number; lessonPlanId: number;
  lessonPlanVersion: number; requestId: string;
}
export const screenPreparationApi = {
  create: (deviceId: number, data: PreparationInput) => http.post<ScreenPreparation>(`/devices/${deviceId}/screen-preparations`, data),
  get: (deviceId: number) => http.get<{ preparation: ScreenPreparation | null; serverNow: string }>(`/devices/${deviceId}/screen-preparations`),
  cancel: (deviceId: number, preparation: ScreenPreparation) => http.delete(`/devices/${deviceId}/screen-preparations/${preparation.preparationId}`, { params: { revision: preparation.revision } }),
}
