import { http } from './http'
import type { ScreenLifecycle } from '@/stores/lessonRun'

export const screenOpeningApi = {
  finish: (runId: number, lifecycle: ScreenLifecycle, operation: 'complete' | 'skip') =>
    http.post<ScreenLifecycle>(`/classroom-runs/${runId}/opening/${operation}`, {
      deviceId: lifecycle.deviceId, bindingId: lifecycle.bindingId, expectedRevision: lifecycle.revision,
    }),
}
