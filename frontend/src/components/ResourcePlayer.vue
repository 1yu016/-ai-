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
import { fetchAuthedBlob } from '@/api/resources'
import type { CourseResource } from '@/stores/courseResource'
import { useResourcePlayerStore } from '@/stores/resourcePlayer'

const props = defineProps<{
  resources: CourseResource[]
}>()

const playerStore = useResourcePlayerStore()
const {
  currentResource,
  playerStatus,
  currentTime,
  duration,
  volume,
  muted,
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
// 受保护媒体通过带 Authorization 的 blob 加载，供 <audio>/<video> 使用，
// 避免原生媒体元素无法携带 token 导致 401。
const mediaSource = ref('')
let activeBlobRevoke: (() => void) | null = null
// 每次进场加载都自增的世代号，用于丢弃「迟到」的过期响应：仅当本次 fetch 仍是
// 最新一次加载时才允许写入 mediaSource，避免旧资源的晚到结果覆盖当前资源。
let mediaLoadSeq = 0
// 使所有在途的媒体加载失效（此后返回即视为 stale，只回收自身 blob）。用于
// close / unmount 等「当前 pending load 已不再有效」的场景，语义与
// releaseActiveBlob（回收已生效 blob）分离。
function invalidateMediaLoad() {
  mediaLoadSeq += 1
}
function releaseActiveBlob() {
  if (activeBlobRevoke) {
    activeBlobRevoke()
    activeBlobRevoke = null
  }
  if (mediaSource.value) mediaSource.value = ''
}
async function loadMediaSource(resource: CourseResource) {
  const loadId = ++mediaLoadSeq
  if (resource.mediaType !== 'audio' && resource.mediaType !== 'video') {
    releaseActiveBlob()
    return null
  }
  try {
    const { url, revoke } = await fetchAuthedBlob(Number(resource.id))
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
const isPresentation = computed(() => {
  const resource = currentResource.value
  if (!resource) return false
  return (
    resource.mimeType === 'application/vnd.ms-powerpoint' ||
    resource.mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    /\.pptx?$/i.test(resource.fileName)
  )
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
  if (currentResource.value?.mediaType === 'audio') return audioRef.value
  if (currentResource.value?.mediaType === 'video') return videoRef.value
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
  const media = activeMedia()
  if (!media) return
  // 受保护媒体源尚未就绪（mediaSource 为空）时不播放，避免空源 NotSupportedError。
  if (
    (currentResource.value?.mediaType === 'audio' ||
      currentResource.value?.mediaType === 'video') &&
    !mediaSource.value
  ) {
    return
  }
  try {
    if (playerStatus.value === 'ended' || media.ended) {
      media.currentTime = 0
      playerStore.setProgress(0, media.duration)
    }
    await media.play()
    playerStore.setStatus('playing')
  } catch (error) {
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
  const media = event.currentTarget as HTMLMediaElement
  playerStore.setProgress(media.currentTime, media.duration)
}

function updateDuration(event: Event) {
  const media = event.currentTarget as HTMLMediaElement
  media.volume = volume.value
  media.muted = muted.value
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

function handleEnded() {
  playerStore.setProgress(duration.value, duration.value)
  playerStore.setStatus('ended')
}

function handleMediaError() {
  playerStore.setStatus('error', '资源暂时无法加载，请检查网络后重试。')
}

function handleVisualLoaded() {
  playerStore.setStatus('paused')
}

function handleVisualError() {
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
  invalidateMediaLoad()
  stopMediaElements()
  releaseActiveBlob()
  await exitClassroomMode()
  playerStore.close()
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
  () => [currentResource.value?.id, sourceUrl.value] as const,
  async ([resourceId, resourceSource], [previousResourceId, previousSource]) => {
    if (!resourceId) return
    const resource = currentResource.value
    if (!resource) return
    stopMediaElements()
    const loaded = await loadMediaSource(resource)
    if (
      (resource.mediaType === 'audio' || resource.mediaType === 'video') &&
      !loaded
    ) {
      return
    }
    await nextTick()
    const media = activeMedia()
    if (!media) return
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

watch(isPresentation, (presentation) => {
  if (presentation && currentResource.value) playerStore.setStatus('paused')
}, { immediate: true })

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
  invalidateMediaLoad()
  stopMediaElements()
  releaseActiveBlob()
  if (playerStatus.value === 'playing') playerStore.setStatus('paused')
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
            currentResource.mediaType === 'image'
              ? '🖼️'
              : currentResource.mediaType === 'audio'
                ? '🎵'
                : currentResource.mediaType === 'video'
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
        <ElButton aria-label="关闭播放器" @click="closePlayer">关闭</ElButton>
      </div>
    </header>

    <div class="player-stage">
      <img
        v-if="currentResource.mediaType === 'image'"
        class="stage-image"
        :src="sourceUrl"
        :alt="currentResource.title"
        @load="handleVisualLoaded"
        @error="handleVisualError"
      />

      <div v-else-if="currentResource.mediaType === 'audio'" class="audio-stage">
        <div class="album-art" aria-hidden="true">
          <img
            v-if="currentResource.coverUrl"
            :src="currentResource.coverUrl"
            alt=""
          />
          <span v-else>♫</span>
        </div>
        <strong>{{ currentResource.title }}</strong>
        <p>{{ currentResource.description || '幼儿园课程音频' }}</p>
        <audio
          ref="audioRef"
          :src="mediaSource"
          preload="metadata"
          @loadedmetadata="updateDuration"
          @timeupdate="updateProgress"
          @play="playerStore.setStatus('playing')"
          @pause="playerStatus !== 'ended' && playerStore.setStatus('paused')"
          @ended="handleEnded"
          @error="handleMediaError"
        ></audio>
      </div>

      <video
        v-else-if="currentResource.mediaType === 'video'"
        ref="videoRef"
        class="stage-video"
        :src="mediaSource"
        :poster="currentResource.coverUrl || undefined"
        playsinline
        preload="metadata"
        @loadedmetadata="updateDuration"
        @timeupdate="updateProgress"
        @play="playerStore.setStatus('playing')"
        @pause="playerStatus !== 'ended' && playerStore.setStatus('paused')"
        @ended="handleEnded"
        @error="handleMediaError"
      ></video>

      <iframe
        v-else-if="!isPresentation"
        class="stage-document"
        :src="sourceUrl"
        :title="`${currentResource.title} PDF预览`"
        @load="handleVisualLoaded"
      ></iframe>

      <div v-else class="presentation-stage">
        <div class="presentation-icon" aria-hidden="true">📊</div>
        <h3>{{ currentResource.title }}</h3>
        <p>PowerPoint 课件已保存到资源库。浏览器无法稳定预览 PPT，请打开或下载后使用 PowerPoint/WPS 放映。</p>
        <a
          class="presentation-open"
          :href="sourceUrl"
          target="_blank"
          rel="noopener noreferrer"
        >
          打开或下载课件
        </a>
      </div>

      <p v-if="errorMessage" class="player-error" role="alert">
        {{ errorMessage }}
      </p>
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

    <footer v-else class="non-media-controls">
      <ElButton :disabled="!canGoPrevious" @click="previous">上一项</ElButton>
      <span>按 ESC 可退出课堂模式</span>
      <ElButton :disabled="!canGoNext" @click="next">下一项</ElButton>
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
  bottom: 16px;
  margin: 0;
  padding: 9px 13px;
  border-radius: 10px;
  background: #fff0f0;
  color: #b64747;
  font-size: 13px;
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
