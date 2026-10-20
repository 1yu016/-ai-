import { computed, ref } from 'vue'
import { useLessonRunStore } from '@/stores/lessonRun'
import { apiErrorMessage } from '@/api/http'

export type PresentationItem = { id: string; kind: 'resource' | 'avatar'; title: string; resourceId?: number; enabled: boolean }

/** Queue editing affects only this Run snapshot; presentation requires an explicit command. */
export function usePresentationQueue() {
  const store = useLessonRunStore()
  const saving = ref(false)
  const error = ref('')
  const activeItemId = computed(() => store.run?.playerRecoverySuggestion?.presentationItemId)
  const items = computed<PresentationItem[]>(() => {
    const queues = store.run?.interactionState?.presentationQueues as Record<string, PresentationItem[]> | undefined
    const saved = queues?.[String(store.run?.currentStepIndex)]
    if (Array.isArray(saved)) return saved
    const resourceId = store.currentStep?.resourceId
    return resourceId ? [{ id: `lesson-${resourceId}`, kind: 'resource', resourceId, title: store.currentResource?.title ?? '步骤资源', enabled: true }] : []
  })
  async function save(next: PresentationItem[]) {
    if (!store.run || saving.value) return
    saving.value = true; error.value = ''
    try { await store.teacherCommand('update_presentation_queue', { stepIndex: store.run.currentStepIndex, items: next }, 'teacher_panel') }
    catch (cause) { error.value = apiErrorMessage(cause, '课堂队列保存失败，请重试。') }
    finally { saving.value = false }
  }
  async function show(item: PresentationItem, play = false) {
    if (!store.run || saving.value || !item.enabled) return
    saving.value = true; error.value = ''
    try { await store.teacherCommand(item.kind === 'avatar' ? 'set_presentation' : play ? 'play_resource' : 'open_resource', item.kind === 'avatar' ? { mode: 'avatar', presentationItemId: item.id } : { resourceId: item.resourceId, presentationItemId: item.id }, 'teacher_panel', store.run.deviceId) }
    catch (cause) { error.value = apiErrorMessage(cause, '展示指令发送失败，请重试。') }
    finally { saving.value = false }
  }
  function move(index: number, offset: number) {
    const next = [...items.value]; const destination = index + offset
    if (destination < 0 || destination >= next.length) return
    const [item] = next.splice(index, 1); if (!item) return
    next.splice(destination, 0, item); return save(next)
  }
  const activeIndex = computed(() => items.value.findIndex(item => item.id === activeItemId.value))
  const previousItem = computed(() => items.value.slice(0, Math.max(0, activeIndex.value)).reverse().find(item => item.enabled))
  const nextItem = computed(() => items.value.slice(activeIndex.value + 1).find(item => item.enabled))
  function replace(index: number, replacement: PresentationItem) {
    return save(items.value.map((item, itemIndex) => itemIndex === index ? { ...replacement, id: item.id } : item))
  }
  async function media(operation: 'pause_media' | 'resume_media') {
    if (!store.run || saving.value) return
    saving.value = true; error.value = ''
    try { await store.teacherCommand(operation, undefined, 'teacher_panel', store.run.deviceId) }
    catch (cause) { error.value = apiErrorMessage(cause, '媒体控制失败，请重试。') }
    finally { saving.value = false }
  }
  return { canShow: computed(() => store.can('resource_start')), canEdit: computed(() => store.can('queue_edit')), canPause: computed(() => store.can('safe_stop')), canResume: computed(() => store.can('resource_start')), items, saving, error, save, show, move, replace, activeItemId, previousItem, nextItem, media }
}
