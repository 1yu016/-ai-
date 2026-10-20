import { onScopeDispose, watch } from 'vue'
import { useDigitalHumanStore } from '@/stores/digitalHuman'

// Classroom pages supply authoritative context; render adapters know nothing about Run APIs.
export function useClassroomAvatar(read: () => { id: number; classId?: number; deviceId: number; lessonPlanId: number; status: string; currentStepIndex?: number; interactionState?: Record<string, unknown> | null } | null) {
  const avatar = useDigitalHumanStore()
  const phase = () => (read()?.interactionState?.screenLifecycle as { phase?: string } | undefined)?.phase
  let visualGeneration = 0
  const greeted = new Set<number>()
  onScopeDispose(() => { visualGeneration++ })
  watch(() => {
    const run = read()
    return run ? JSON.stringify([run.id, run.classId, run.deviceId, run.lessonPlanId]) : ''
  }, () => {
    const run = read()
    if (!run) { avatar.reset(); return }
    void avatar.loadRuntime({ classId: run.classId, classroomRunId: run.id, deviceId: run.deviceId, lessonPlanId: run.lessonPlanId })
  }, { immediate: true, flush: 'sync' })
  watch(() => read()?.status, status => avatar.setClassroomPaused(status !== 'running'), { immediate: true, flush: 'sync' })
  watch(() => {
    const run = read()
    return JSON.stringify([run?.id, run?.currentStepIndex, phase()])
  }, async () => {
    const generation = ++visualGeneration
    const run = read()
    if (!run) return
    avatar.transition({ type: 'step_change' })
    const owner = run.id
    await avatar.loadRuntime({ classId: run.classId, classroomRunId: run.id, deviceId: run.deviceId, lessonPlanId: run.lessonPlanId })
    if (generation !== visualGeneration || read()?.id !== owner || avatar.renderingPaused) return
  }, { immediate: true, flush: 'sync' })
  watch(() => [read()?.id, phase(), avatar.modelState], () => {
    const run = read()
    if (!run || phase() !== 'opening' || avatar.modelState !== 'loaded' || avatar.renderingPaused || greeted.has(run.id)) return
    greeted.add(run.id)
    avatar.transition({ type: 'lesson_opening' })
  }, { immediate: true, flush: 'post' })
}
