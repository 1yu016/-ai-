<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue'
import { ElButton, ElMessage, ElSlider } from 'element-plus'
import { storeToRefs } from 'pinia'
import {
  fetchAuthedBlob,
  fetchAuthedPreviewAsset,
  getResourcePreviewManifest,
  type ResourcePreviewManifest,
} from '@/api/resources'
import ModelPreviewStage from '@/components/resources/ModelPreviewStage.vue'
import type { CourseResource } from '@/stores/courseResource'
import { useResourcePlayerStore } from '@/stores/resourcePlayer'
import { stopBrowserSpeech } from '@/services/browserSpeech'

const props = defineProps<{
  resources: CourseResource[]
  showClose?: boolean
}>()

const playerStore = useResourcePlayerStore()
const {
  currentResource,
  playbackSession,
  playerStatus,
  currentTime,
  duration,
  volume,
  muted,
  pageIndex,
  pageCount,
  zoom,
  isClassroomMode,
  errorMessage,
  hasPlayableMedia,
  autoPlayOnOpen,
  controlRequest,
} = storeToRefs(playerStore)

const playerRootRef = ref<HTMLElement | null>(null)
const audioRef = ref<HTMLAudioElement | null>(null)
const videoRef = ref<HTMLVideoElement | null>(null)

const sourceUrl = computed(
  () => currentResource.value?.contentUrl || currentResource.value?.dataUrl || '',
)
const effectiveMediaType = computed(
  () => currentResource.value?.playerMediaType ?? currentResource.value?.mediaType,
)
// 资源库文件统一通过带 Authorization 的请求转成 blob URL。这样图片、PDF、
// 音频和视频都不会把 Token 写进 URL，也不会绕过服务端资源权限检查。
const mediaSource = ref('')
const previewManifest = ref<ResourcePreviewManifest | null>(null)
const previewNotice = ref('')
let activeBlobRevoke: (() => void) | null = null
// 每次进场加载都自增的世代号，用于丢弃「迟到」的过期响应：仅当本次 fetch 仍是
// 最新一次加载时才允许写入 mediaSource，避免旧资源的晚到结果覆盖当前资源。
let mediaLoadSeq = 0
let disposed = false
let ownedSession = playbackSession.value
function currentEvent(event: Event) {
  const element = event.currentTarget as HTMLElement
  return !disposed && element?.dataset.playbackSession === String(playbackSession.value) &&
    element.dataset.playbackSource === mediaSource.value
}
function handlePlay(event: Event) { if (currentEvent(event)) playerStore.setStatus('playing') }
function handlePause(event: Event) { if (currentEvent(event) && playerStatus.value !== 'ended') playerStore.setStatus('paused') }
// 使所有在途的媒体加载失效（此后返回即视为 stale，只回收自身 blob）。用于
// close / unmount 等「当前 pending load 已不再有效」的场景，语义与
// releaseActiveBlob（回收已生效 blob）分离。
function invalidateMediaLoad() {
  mediaLoadSeq += 1
}
function releaseActiveBlob() {
  if (mediaSource.value) mediaSource.value = ''
  const revoke = activeBlobRevoke
  activeBlobRevoke = null
  if (revoke) {
    // 先让 Vue 在下一次 DOM 更新中清掉 <audio>/<video> 对 blob 的 src 引用，
    // 再回收 object URL；若在元素仍引用 blob 时 revoke，Chromium 会中止加载并
    // 在 console 记录 net::ERR_ABORTED。
    void nextTick(revoke)
  }
}
async function loadMediaSource(resource: CourseResource) {
  const loadId = ++mediaLoadSeq
  playerStore.setStatus('loading')
  previewManifest.value = null
  previewNotice.value = ''
  try {
    if (resource.source !== 'library') {
      if (isPresentationResource(resource)) {
        releaseActiveBlob()
        previewNotice.value = '本地 PowerPoint 源文件不能直接预览，请上传并由服务端转换。'
        playerStore.setStatus('paused')
        return null
      }
      releaseActiveBlob()
      mediaSource.value = resource.contentUrl || resource.dataUrl || ''
      return mediaSource.value
    }
    const resourceId = Number(resource.id)
    if (!Number.isInteger(resourceId) || resourceId <= 0) {
      throw new Error('资源编号无效')
    }
    let loader = () => fetchAuthedBlob(resourceId)
    if (isPresentationResource(resource) || resource.mediaType === 'picture_book') {
      const manifest = await getResourcePreviewManifest(resourceId)
      if (loadId !== mediaLoadSeq) return null
      previewManifest.value = manifest
      previewNotice.value = manifest.message ?? ''
      if (manifest.status !== 'ready' || manifest.mode === 'unsupported') {
        releaseActiveBlob()
        playerStore.setStatus('paused')
        return null
      }
      if (manifest.mode === 'images') {
        playerStore.setPage(1, manifest.assets.length)
        const first = manifest.assets[0]
        if (!first) throw new Error('预览页为空')
        loader = () => fetchAuthedPreviewAsset(resourceId, first.name)
      } else if (manifest.mode === 'pdf') {
        const asset = manifest.assets[0]
        if (!asset) throw new Error('PDF 预览文件不存在')
        loader = () => fetchAuthedPreviewAsset(resourceId, asset.name)
      }
    }
    const { url, revoke } = await loader()
    if (loadId !== mediaLoadSeq) {
      // 已被更新的资源取代：仅回收本次自己的 object URL，绝不触碰正在使用的当前 blob。
      revoke()
      return null
    }
    // 仅在成功取得新 blob URL 后才释放上一条，避免网络往返期间 mediaSource 被置空，
    // 使 <audio>/<video> 失去有效源导致 play() 抛 NotSupportedError。
    releaseActiveBlob()
    activeBlobRevoke = revoke
    mediaSource.value = url
    return url
  } catch {
    // 迟到请求的失败也不该误伤当前资源的 blob / 状态。
    if (loadId === mediaLoadSeq) {
      releaseActiveBlob()
      playerStore.setStatus('error', '资源暂时无法加载，请检查网络后重试。')
    }
    return null
  }
}

async function loadPictureBookPage(page: number) {
  const resource = currentResource.value
  const manifest = previewManifest.value
  if (
    !resource ||
    resource.source !== 'library' ||
    manifest?.mode !== 'images'
  ) return
  const asset = manifest.assets[page - 1]
  const resourceId = Number(resource.id)
  if (!asset || !Number.isInteger(resourceId) || resourceId <= 0) return
  const loadId = ++mediaLoadSeq
  playerStore.setStatus('loading')
  try {
    const { url, revoke } = await fetchAuthedPreviewAsset(resourceId, asset.name)
    if (loadId !== mediaLoadSeq) {
      revoke()
      return
    }
    releaseActiveBlob()
    activeBlobRevoke = revoke
    mediaSource.value = url
    playerStore.setStatus('paused')
  } catch {
    if (loadId === mediaLoadSeq)
      playerStore.setStatus('error', '绘本页面暂时无法加载，请稍后重试。')
  }
}
function isPresentationResource(resource: CourseResource): boolean {
  return (
    resource.mediaType === 'ppt' ||
    resource.mimeType === 'application/vnd.ms-powerpoint' ||
    resource.mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    /\.pptx?$/i.test(resource.fileName)
  )
}
const isPresentation = computed(() => {
  const resource = currentResource.value
  return resource ? isPresentationResource(resource) : false
})
const previewMode = computed(() => {
  const resource = currentResource.value
  if (!resource) return 'unsupported'
  if (isPresentation.value || resource.mediaType === 'picture_book') {
    const mode = previewManifest.value?.mode
    if (mode === 'images') return 'images'
    if (mode === 'pdf') return 'pdf'
    if (mode === 'source') {
      if (resource.mimeType?.startsWith('image/')) return 'image'
      if (resource.mimeType === 'application/pdf') return 'pdf'
    }
    return 'presentation'
  }
  if (resource.mediaType === 'model_3d') return 'model_3d'
  if (effectiveMediaType.value === 'image') return 'image'
  if (effectiveMediaType.value === 'audio') return 'audio'
  if (effectiveMediaType.value === 'video') return 'video'
  if (resource.mediaType === 'pdf' || resource.mimeType === 'application/pdf') return 'pdf'
  return 'unsupported'
})
const hasPageZoomControls = computed(() =>
  ['image', 'images', 'pdf'].includes(previewMode.value),
)
const documentSource = computed(() => {
  if (!mediaSource.value) return ''
  const separator = mediaSource.value.includes('#') ? '&' : '#'
  return `${mediaSource.value}${separator}page=${pageIndex.value}&zoom=${Math.round(zoom.value * 100)}`
})
const currentIndex = computed(() =>
  props.resources.findIndex(
    (resource) => resource.id === currentResource.value?.id,
  ),
)
const canGoPrevious = computed(() => currentIndex.value > 0)
const canGoNext = computed(
  () => currentIndex.value >= 0 && currentIndex.value < props.resources.length - 1,
)
const progressMaximum = computed(() => Math.max(duration.value, 1))
const isPlaying = computed(() => playerStatus.value === 'playing')

function activeMedia(): HTMLMediaElement | null {
  if (effectiveMediaType.value === 'audio') return audioRef.value
  if (effectiveMediaType.value === 'video') return videoRef.value
  return null
}

function stopMediaElements() {
  for (const media of [audioRef.value, videoRef.value]) {
    if (!media) continue
    media.pause()
    media.currentTime = 0
  }
}

async function openResource(resource: CourseResource) {
  stopMediaElements()
  playerStore.openResource(resource)
  await nextTick()
}

async function play() {
  stopBrowserSpeech()
  const media = activeMedia()
  if (!media) return
  // 受保护媒体源尚未就绪（mediaSource 为空）时不播放，避免空源 NotSupportedError。
  if (
    (effectiveMediaType.value === 'audio' ||
      effectiveMediaType.value === 'video') &&
    !mediaSource.value
  ) {
    return
  }
  const session = playbackSession.value
  try {
    if (playerStatus.value === 'ended' || media.ended) {
      media.currentTime = 0
      playerStore.setProgress(0, media.duration)
    }
    await media.play()
    if (disposed || session !== playbackSession.value || media !== activeMedia()) return
    playerStore.setStatus('playing')
  } catch (error) {
    if (disposed || session !== playbackSession.value || media !== activeMedia()) return
    console.error('课程资源播放失败：', error)
    playerStore.setStatus('paused')
    ElMessage.warning('浏览器阻止了自动播放，请点击播放按钮。')
  }
}

function pause() {
  const media = activeMedia()
  media?.pause()
  if (media) playerStore.setStatus('paused')
}

function pauseAllMedia() {
  let paused = false
  for (const media of [audioRef.value, videoRef.value]) {
    if (!media) continue
    media.pause()
    paused = true
  }
  if (paused) playerStore.setStatus('paused')
}

function togglePlayback() {
  if (isPlaying.value) pause()
  else void play()
}

function stop() {
  const media = activeMedia()
  if (media) {
    media.pause()
    media.currentTime = 0
  }
  playerStore.setProgress(0)
  if (hasPlayableMedia.value) playerStore.setStatus('paused')
}

function updateProgress(event: Event) {
  if (!currentEvent(event)) return
  const media = event.currentTarget as HTMLMediaElement
  playerStore.setProgress(media.currentTime, media.duration)
}

function updateDuration(event: Event) {
  if (!currentEvent(event)) return
  const media = event.currentTarget as HTMLMediaElement
  media.volume = volume.value
  media.muted = muted.value
  if (currentTime.value > 0 && Number.isFinite(media.duration)) {
    media.currentTime = Math.min(currentTime.value, media.duration)
  }
  playerStore.setProgress(media.currentTime, media.duration)
  if (playerStatus.value === 'loading') playerStore.setStatus('paused')
}

function seek(value: number | number[]) {
  const seconds = Array.isArray(value) ? value[0] ?? 0 : value
  const media = activeMedia()
  if (!media) return
  media.currentTime = seconds
  playerStore.setProgress(seconds, media.duration)
}

function changeVolume(value: number | number[]) {
  const percentage = Array.isArray(value) ? value[0] ?? 0 : value
  playerStore.setVolume(percentage / 100)
}

function setVolume(value: number) {
  playerStore.setVolume(value)
}

function previousPage() {
  playerStore.setPage(Math.max(1, pageIndex.value - 1))
}

function nextPage() {
  const maximum = pageCount.value ?? 999
  playerStore.setPage(Math.min(maximum, pageIndex.value + 1))
}

function zoomIn() {
  playerStore.setZoom(Math.min(3, zoom.value + 0.25))
}

function zoomOut() {
  playerStore.setZoom(Math.max(0.5, zoom.value - 0.25))
}

function fitToWindow() {
  playerStore.setZoom(1)
}

async function downloadCurrent() {
  const resource = currentResource.value
  if (!resource || resource.source !== 'library') return
  const resourceId = Number(resource.id)
  if (!Number.isInteger(resourceId) || resourceId <= 0) return
  try {
    const { url, revoke } = await fetchAuthedBlob(resourceId)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = resource.fileName || resource.title
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(revoke, 0)
  } catch {
    ElMessage.error('下载失败，请稍后重试。')
  }
}

async function retryCurrentResource() {
  const resource = currentResource.value
  if (!resource) return
  playerStore.setStatus('loading')
  await loadMediaSource(resource)
}

function handleEnded(event: Event) {
  if (!currentEvent(event)) return
  playerStore.setProgress(duration.value, duration.value)
  playerStore.setStatus('ended')
}

function handleMediaError(event: Event) {
  if (!currentEvent(event)) return
  playerStore.setStatus('error', '资源暂时无法加载，请检查网络后重试。')
}

function handleVisualLoaded(event: Event) {
  if (!currentEvent(event)) return
  playerStore.setStatus('paused')
}

function handleVisualError(event: Event) {
  if (!currentEvent(event)) return
  playerStore.setStatus('error', '资源暂时无法显示，请检查网络后重试。')
}

function openAt(index: number) {
  const resource = props.resources[index]
  if (!resource) return
  stopMediaElements()
  playerStore.openResource(resource)
}

function previous() {
  if (canGoPrevious.value) openAt(currentIndex.value - 1)
}

function next() {
  if (canGoNext.value) openAt(currentIndex.value + 1)
}

async function enterClassroomMode() {
  if (!currentResource.value) return
  playerStore.enterClassroomMode()
  await nextTick()
  try {
    if (!document.fullscreenElement) {
      await playerRootRef.value?.requestFullscreen()
    }
  } catch (error) {
    console.warn('浏览器未进入原生全屏，使用页面课堂模式：', error)
    ElMessage.info('已进入课堂模式，可按 ESC 退出。')
  }
}

async function exitClassroomMode() {
  playerStore.exitClassroomMode()
  if (document.fullscreenElement === playerRootRef.value) {
    await document.exitFullscreen().catch(() => undefined)
  }
}

async function closePlayer() {
  const session = playbackSession.value
  invalidateMediaLoad()
  stopMediaElements()
  await exitClassroomMode()
  if (disposed || session !== playbackSession.value) return
  playerStore.close()
  // 等 currentResource 置空后 <audio>/<video> 已从 DOM 卸载，再回收 blob。
  // 若在元素仍引用 blob 时 revoke，Chromium 会中止加载并在 console 记录
  // net::ERR_ABORTED。
  await nextTick()
  if (playbackSession.value === session + 1) releaseActiveBlob()
}

function handleFullscreenChange() {
  if (!document.fullscreenElement && isClassroomMode.value) {
    playerStore.exitClassroomMode()
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && isClassroomMode.value) {
    void exitClassroomMode()
  }
}

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0:00'
  const totalSeconds = Math.floor(value)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

watch(
  () => [currentResource.value?.id, sourceUrl.value, playbackSession.value] as const,
  async ([resourceId, resourceSource], [previousResourceId, previousSource]) => {
    if (!resourceId) return
    const resource = currentResource.value
    if (!resource) return
    const session = playbackSession.value
    ownedSession = session
    stopMediaElements()
    const loaded = await loadMediaSource(resource)
    if (disposed || session !== playbackSession.value) return
    if (!loaded && !isPresentationResource(resource)) {
      return
    }
    await nextTick()
    if (disposed || session !== playbackSession.value) return
    const media = activeMedia()
    if (!media) {
      if (loaded) playerStore.setStatus('paused')
      return
    }
    media.volume = volume.value
    media.muted = muted.value
    if (!autoPlayOnOpen.value) {
      media.pause()
      playerStore.setStatus('paused')
      return
    }
    if (
      resourceId !== previousResourceId ||
      resourceSource !== previousSource ||
      playerStatus.value !== 'playing'
    ) {
      void play()
    }
  },
)

watch(playbackSession, () => {
  invalidateMediaLoad()
  stopMediaElements()
  releaseActiveBlob()
}, { flush: 'sync' })

watch(controlRequest, (request) => {
  if (!request) return
  switch (request.action) {
    case 'play':
    case 'resume':
      void play()
      break
    case 'pause':
      pause()
      break
    case 'stop':
      stop()
      break
    case 'close':
      void closePlayer()
      break
    case 'next':
      next()
      break
    case 'previous':
      previous()
      break
  }
})

watch(pageIndex, (page, previousPage) => {
  if (page !== previousPage && previewManifest.value?.mode === 'images')
    void loadPictureBookPage(page)
})

watch([volume, muted], ([nextVolume, nextMuted]) => {
  const media = activeMedia()
  if (!media) return
  media.volume = nextVolume
  media.muted = nextMuted
})

onMounted(() => {
  document.addEventListener('fullscreenchange', handleFullscreenChange)
  document.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  disposed = true
  invalidateMediaLoad()
  stopMediaElements()
  releaseActiveBlob()
  if (ownedSession === playbackSession.value && playerStatus.value === 'playing') playerStore.setStatus('paused')
  document.removeEventListener('fullscreenchange', handleFullscreenChange)
  document.removeEventListener('keydown', handleKeydown)
})

defineExpose({
  openResource,
  enterClassroomMode,
  play,
  pause,
  resume: play,
  stop,
  close: closePlayer,
  setVolume,
  seek,
  previous,
  next,
  previousPage,
  nextPage,
  zoomIn,
  zoomOut,
})
</script>

<template>
  <section
    v-if="currentResource"
    ref="playerRootRef"
    class="resource-player"
    :class="{ 'classroom-mode': isClassroomMode }"
    aria-label="课程资源播放器"
  >
    <header class="player-header">
      <div class="resource-heading">
        <span class="resource-type-icon" aria-hidden="true">
          {{
            effectiveMediaType === 'image'
              ? '🖼️'
              : effectiveMediaType === 'audio'
                ? '🎵'
                : effectiveMediaType === 'video'
                  ? '🎬'
                  : isPresentation
                    ? '📊'
                    : '📄'
          }}
        </span>
        <div>
          <small>{{ isClassroomMode ? '课堂演示中' : '资源预览' }}</small>
          <h2>{{ currentResource.title }}</h2>
        </div>
      </div>
      <div class="top-actions">
        <ElButton
          v-if="isClassroomMode && hasPlayableMedia"
          type="warning"
          @click="pauseAllMedia"
        >
          暂停全部媒体
        </ElButton>
        <ElButton v-if="!isClassroomMode" @click="enterClassroomMode">
          全屏课堂模式
        </ElButton>
        <ElButton v-else @click="exitClassroomMode">返回</ElButton>
        <ElButton v-if="showClose !== false" aria-label="关闭播放器" @click="closePlayer">关闭</ElButton>
      </div>
    </header>

    <div class="player-stage">
      <img
        :key="`${playbackSession}:${mediaSource}`"
        :data-playback-session="playbackSession"
        :data-playback-source="mediaSource"
        v-if="previewMode === 'image' || previewMode === 'images'"
        class="stage-image"
        :src="mediaSource"
        :alt="currentResource.title"
        :style="{ transform: `scale(${zoom})` }"
        @load="handleVisualLoaded"
        @error="handleVisualError"
      />

      <div v-else-if="previewMode === 'audio'" class="audio-stage">
        <div class="album-art" aria-hidden="true">
          <img
            v-if="currentResource.source === 'browser' && currentResource.coverUrl"
            :src="currentResource.coverUrl"
            alt=""
          />
          <span v-else>♫</span>
        </div>
        <strong>{{ currentResource.title }}</strong>
        <p>{{ currentResource.description || '幼儿园课程音频' }}</p>
        <audio
          :key="`${playbackSession}:${mediaSource}`"
          :data-playback-session="playbackSession"
          :data-playback-source="mediaSource"
          ref="audioRef"
          :src="mediaSource"
          preload="metadata"
          @loadedmetadata="updateDuration"
          @timeupdate="updateProgress"
          @play="handlePlay"
          @pause="handlePause"
          @ended="handleEnded"
          @error="handleMediaError"
        ></audio>
      </div>

      <video
        :key="`${playbackSession}:${mediaSource}`"
        :data-playback-session="playbackSession"
        :data-playback-source="mediaSource"
        v-else-if="previewMode === 'video'"
        ref="videoRef"
        class="stage-video"
        :src="mediaSource"
        :poster="currentResource.source === 'browser' ? currentResource.coverUrl || undefined : undefined"
        playsinline
        preload="metadata"
        @loadedmetadata="updateDuration"
        @timeupdate="updateProgress"
        @play="handlePlay"
        @pause="handlePause"
        @ended="handleEnded"
        @error="handleMediaError"
      ></video>

      <iframe
        :key="`${playbackSession}:${mediaSource}`"
        :data-playback-session="playbackSession"
        :data-playback-source="mediaSource"
        v-else-if="previewMode === 'pdf'"
        class="stage-document"
        :src="documentSource"
        :title="`${currentResource.title} PDF预览`"
        @load="handleVisualLoaded"
      ></iframe>

      <ModelPreviewStage
        v-else-if="previewMode === 'model_3d' && mediaSource"
        :src="mediaSource"
        :title="currentResource.title"
      />

      <div v-else-if="previewMode === 'presentation'" class="presentation-stage">
        <div class="presentation-icon" aria-hidden="true">📊</div>
        <h3>{{ currentResource.title }}</h3>
        <p>{{ previewNotice || '该 PowerPoint 课件需要由服务端转换为 PDF 或逐页图片后播放。' }}</p>
        <ElButton type="primary" @click="downloadCurrent">安全下载源文件</ElButton>
      </div>

      <div v-else class="presentation-stage unsupported-stage">
        <div class="presentation-icon" aria-hidden="true">📦</div>
        <h3>当前类型无法在线预览</h3>
        <p>文件已受到权限保护，可以下载后使用受信任的本地应用打开。</p>
        <ElButton type="primary" @click="downloadCurrent">安全下载</ElButton>
      </div>

      <div v-if="errorMessage" class="player-error" role="alert">
        <strong>资源加载失败</strong>
        <span>{{ errorMessage }}</span>
        <ElButton type="primary" @click="retryCurrentResource">重新加载</ElButton>
      </div>
      <div
        v-else-if="playerStatus === 'loading'"
        class="player-loading"
        role="status"
      >
        资源加载中…
      </div>
    </div>

    <div v-if="hasPlayableMedia" class="media-controls">
      <div class="progress-row">
        <span>{{ formatTime(currentTime) }}</span>
        <ElSlider
          :model-value="currentTime"
          :max="progressMaximum"
          :step="0.1"
          :show-tooltip="false"
          aria-label="播放进度"
          @change="seek"
        />
        <span>{{ formatTime(duration) }}</span>
      </div>

      <div class="control-row">
        <ElButton :disabled="!canGoPrevious" @click="previous">上一项</ElButton>
        <ElButton class="primary-control" type="primary" @click="togglePlayback">
          {{ isPlaying ? '暂停' : playerStatus === 'ended' ? '重新播放' : '播放' }}
        </ElButton>
        <ElButton @click="stop">停止</ElButton>
        <ElButton :disabled="!canGoNext" @click="next">下一项</ElButton>
        <div class="volume-control">
          <button type="button" @click="playerStore.toggleMuted()">
            {{ muted || volume === 0 ? '🔇' : '🔊' }}
          </button>
          <ElSlider
            :model-value="volume * 100"
            :max="100"
            :show-tooltip="false"
            aria-label="音量"
            @input="changeVolume"
          />
        </div>
      </div>
    </div>

    <footer v-else-if="hasPageZoomControls" class="non-media-controls">
      <ElButton :disabled="pageIndex <= 1" @click="previousPage">上一页</ElButton>
      <ElButton @click="zoomOut">缩小</ElButton>
      <span>第 {{ pageIndex }} 页 · {{ Math.round(zoom * 100) }}%</span>
      <ElButton v-if="previewMode === 'image' || previewMode === 'images'" @click="fitToWindow">适应窗口</ElButton>
      <ElButton @click="zoomIn">放大</ElButton>
      <ElButton :disabled="pageCount !== null && pageIndex >= pageCount" @click="nextPage">下一页</ElButton>
    </footer>
  </section>
</template>

<style scoped>
.resource-player {
  position: absolute;
  z-index: 40;
  inset: 0;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  background: #fffdfa;
  color: #493d36;
}

.resource-player.classroom-mode {
  position: fixed;
  z-index: 5000;
  width: 100vw;
  height: 100dvh;
  background: #1f1b19;
  color: #fff;
}

.resource-player:fullscreen {
  width: 100vw;
  height: 100vh;
}

.player-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 17px 24px;
  border-bottom: 1px solid #efe1d4;
  background: #fff9ee;
}

.classroom-mode .player-header {
  padding: 20px 32px;
  border-color: rgb(255 255 255 / 12%);
  background: #2c2724;
}

.resource-heading,
.top-actions,
.control-row,
.volume-control,
.progress-row,
.non-media-controls {
  display: flex;
  align-items: center;
}

.resource-heading {
  min-width: 0;
  gap: 12px;
}

.resource-type-icon {
  display: grid;
  width: 46px;
  height: 46px;
  flex: none;
  place-items: center;
  border-radius: 14px;
  background: #ffedb8;
  font-size: 23px;
}

.resource-heading div {
  min-width: 0;
}

.resource-heading small {
  color: #b27b60;
  font-weight: 700;
}

.resource-heading h2 {
  max-width: 52vw;
  margin: 2px 0 0;
  overflow: hidden;
  font-size: 19px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.top-actions {
  flex: none;
  gap: 9px;
}

.top-actions :deep(.el-button) {
  border-radius: 10px;
}

.player-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  display: grid;
  place-items: center;
  overflow: hidden;
  padding: 20px;
  background: #f8f1e9;
}

.classroom-mode .player-stage {
  padding: 24px 36px;
  background: #171412;
}

.stage-image,
.stage-video {
  display: block;
  max-width: 100%;
  max-height: 100%;
  border-radius: 12px;
  object-fit: contain;
  box-shadow: 0 14px 40px rgb(52 35 25 / 18%);
}

.stage-image {
  transition: transform 180ms ease;
}

.stage-video {
  width: 100%;
  height: 100%;
  background: #000;
}

.stage-document {
  width: 100%;
  height: 100%;
  border: 0;
  border-radius: 12px;
  background: #fff;
}

.presentation-stage {
  display: grid;
  justify-items: center;
  width: min(100%, 620px);
  padding: 36px;
  border-radius: 20px;
  background: #fff;
  text-align: center;
  box-shadow: 0 14px 40px rgb(52 35 25 / 12%);
}

.presentation-icon {
  display: grid;
  width: 110px;
  height: 110px;
  place-items: center;
  border-radius: 28px;
  background: linear-gradient(145deg, #ffcf87, #ed8362);
  font-size: 54px;
}

.presentation-stage h3 {
  margin: 20px 0 8px;
  font-size: 24px;
}

.presentation-stage p {
  max-width: 520px;
  margin: 0;
  color: #8a7466;
  line-height: 1.7;
}

.presentation-stage :deep(.el-button) {
  margin-top: 20px;
}

.player-loading {
  position: absolute;
  z-index: 5;
  padding: 12px 18px;
  border-radius: 999px;
  background: rgb(255 255 255 / 92%);
  color: #806c61;
  box-shadow: 0 8px 24px rgb(52 35 25 / 12%);
}

.presentation-open {
  margin-top: 20px;
  padding: 12px 20px;
  border-radius: 11px;
  background: #409eff;
  color: #fff;
  font-weight: 700;
  text-decoration: none;
}

.classroom-mode .presentation-stage {
  background: #2c2724;
}

.classroom-mode .presentation-stage p {
  color: #d5c9c1;
}

.audio-stage {
  display: grid;
  justify-items: center;
  width: min(100%, 620px);
  text-align: center;
}

.album-art {
  width: min(38vh, 280px);
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 30px;
  background: linear-gradient(145deg, #ffd998, #ef9168);
  color: #fff;
  box-shadow: 0 20px 50px rgb(108 65 41 / 24%);
  font-size: 100px;
}

.album-art img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.audio-stage strong {
  margin-top: 20px;
  font-size: 24px;
}

.audio-stage p {
  margin: 7px 0 0;
  color: #927b6d;
}

.classroom-mode .audio-stage p {
  color: #c5b7af;
}

.player-error {
  position: absolute;
  inset: 50% auto auto 50%;
  display: grid;
  width: min(90%, 460px);
  justify-items: center;
  gap: 12px;
  padding: 24px;
  transform: translate(-50%, -50%);
  border: 1px solid #f4c8c8;
  border-radius: 18px;
  background: rgb(255 240 240 / 96%);
  color: #b64747;
  text-align: center;
  box-shadow: 0 16px 46px rgb(90 45 45 / 16%);
}

.media-controls,
.non-media-controls {
  flex: none;
  padding: 14px 24px 18px;
  border-top: 1px solid #efe1d4;
  background: #fffdfa;
}

.classroom-mode .media-controls,
.classroom-mode .non-media-controls {
  padding: 18px 34px 24px;
  border-color: rgb(255 255 255 / 12%);
  background: #2c2724;
}

.progress-row {
  gap: 13px;
  color: #8e7768;
  font-size: 11px;
}

.progress-row :deep(.el-slider) {
  flex: 1;
}

.classroom-mode .progress-row {
  color: #d5c9c1;
}

.control-row {
  justify-content: center;
  gap: 10px;
  margin-top: 8px;
}

.control-row :deep(.el-button),
.non-media-controls :deep(.el-button) {
  min-width: 86px;
  border-radius: 11px;
}

.primary-control {
  border-color: #e9956e;
  background: #e9956e;
}

.volume-control {
  width: 138px;
  gap: 6px;
  margin-left: 10px;
}

.volume-control button {
  padding: 4px;
  border: 0;
  background: transparent;
  cursor: pointer;
  font-size: 17px;
}

.volume-control :deep(.el-slider) {
  flex: 1;
}

.non-media-controls {
  justify-content: space-between;
  gap: 18px;
  color: #9a8373;
  font-size: 12px;
}

.classroom-mode .control-row :deep(.el-button),
.classroom-mode .non-media-controls :deep(.el-button),
.classroom-mode .top-actions :deep(.el-button) {
  min-width: 124px;
  height: 48px;
  font-size: 16px;
}

.classroom-mode .primary-control {
  min-width: 150px !important;
}

.classroom-mode .non-media-controls {
  color: #d5c9c1;
}

@media (max-width: 760px) {
  .player-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .top-actions {
    width: 100%;
  }

  .control-row {
    flex-wrap: wrap;
  }

  .volume-control {
    width: min(100%, 240px);
    margin-left: 0;
  }

  .resource-heading h2 {
    max-width: 72vw;
  }
}
</style>
