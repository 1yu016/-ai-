import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { CourseResource } from './courseResource'
import { useUserStore } from './user'

export type ResourcePlayerStatus =
  | 'idle'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'error'

export const RESOURCE_PLAYER_CLAIM_EVENT = 'kindergarten-resource-player-claim'

export type ResourcePlayerControl =
  | 'play'
  | 'pause'
  | 'resume'
  | 'stop'
  | 'close'
  | 'next'
  | 'previous'

export type ResourcePlayerControlRequest = {
  id: number
  action: ResourcePlayerControl
}

export const useResourcePlayerStore = defineStore('resourcePlayer', () => {
  const userStore = useUserStore()
  const currentResource = ref<CourseResource | null>(null)
  const playerStatus = ref<ResourcePlayerStatus>('idle')
  const currentTime = ref(0)
  const duration = ref(0)
  const volume = ref(0.8)
  const muted = ref(false)
  const isClassroomMode = ref(false)
  const errorMessage = ref('')
  const autoPlayOnOpen = ref(true)
  const controlRequest = ref<ResourcePlayerControlRequest | null>(null)
  let initialized = false
  let controlSequence = 0

  const hasPlayableMedia = computed(
    () =>
      currentResource.value?.mediaType === 'audio' ||
      currentResource.value?.mediaType === 'video',
  )

  function resetProgress() {
    currentTime.value = 0
    duration.value = currentResource.value?.duration ?? 0
  }

  function openResource(resource: CourseResource, autoPlay = true) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(RESOURCE_PLAYER_CLAIM_EVENT))
    }
    currentResource.value = { ...resource }
    autoPlayOnOpen.value = autoPlay
    playerStatus.value =
      resource.mediaType === 'audio' || resource.mediaType === 'video'
        ? 'loading'
        : 'paused'
    errorMessage.value = ''
    resetProgress()
  }

  function syncResource(resource: CourseResource) {
    if (currentResource.value?.id !== resource.id) return
    currentResource.value = { ...resource }
  }

  function setStatus(status: ResourcePlayerStatus, message = '') {
    playerStatus.value = status
    errorMessage.value = message
  }

  function setProgress(time: number, mediaDuration?: number) {
    currentTime.value = Number.isFinite(time) ? Math.max(0, time) : 0
    if (mediaDuration !== undefined && Number.isFinite(mediaDuration)) {
      duration.value = Math.max(0, mediaDuration)
    }
  }

  function setVolume(value: number) {
    volume.value = Math.max(0, Math.min(1, value))
    if (volume.value > 0) muted.value = false
  }

  function toggleMuted() {
    muted.value = !muted.value
  }

  function enterClassroomMode() {
    isClassroomMode.value = true
  }

  function exitClassroomMode() {
    isClassroomMode.value = false
  }

  function close() {
    currentResource.value = null
    playerStatus.value = 'idle'
    currentTime.value = 0
    duration.value = 0
    errorMessage.value = ''
    isClassroomMode.value = false
    autoPlayOnOpen.value = true
  }

  function requestControl(action: ResourcePlayerControl) {
    controlRequest.value = { id: ++controlSequence, action }
  }

  function initialize() {
    if (initialized) return
    initialized = true
    watch(
      () => userStore.isLogin,
      (isLogin, wasLogin) => {
        if (wasLogin && !isLogin) close()
      },
    )
  }

  return {
    currentResource,
    playerStatus,
    currentTime,
    duration,
    volume,
    muted,
    isClassroomMode,
    errorMessage,
    autoPlayOnOpen,
    controlRequest,
    hasPlayableMedia,
    initialize,
    openResource,
    syncResource,
    setStatus,
    setProgress,
    setVolume,
    toggleMuted,
    enterClassroomMode,
    exitClassroomMode,
    requestControl,
    close,
  }
})
