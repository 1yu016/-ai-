<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElButton, ElMessage } from 'element-plus'
import type {
  ResourceAgeGroup,
  ResourceResponse,
  ResourceReviewStatus,
  ResourceType,
} from '@/api/resources'
import { fetchAuthedBlob } from '@/api/resources'

const props = defineProps<{ resource: ResourceResponse }>()
defineEmits<{ (event: 'close'): void }>()

/** blob objectURL，所有预览统一经 fetchAuthedBlob 生成，避免拿后端 fileUrl 直接引用导致 401 */
const blobUrl = ref('')
const loading = ref(false)
const loadFailed = ref(false)
const imageFullscreen = ref(false)
let loadGeneration = 0

async function loadBlob(): Promise<void> {
  const generation = ++loadGeneration
  loading.value = true
  loadFailed.value = false
  try {
    const { url, revoke } = await fetchAuthedBlob(props.resource.id)
    if (generation !== loadGeneration) {
      revoke()
      return
    }
    revokeHandles.push(revoke)
    blobUrl.value = url
  } catch {
    loadFailed.value = true
  } finally {
    if (generation === loadGeneration) loading.value = false
  }
}

// 记录所有 revoke 句柄，切换资源/卸载时统一释放，避免 objectURL 泄漏
const revokeHandles: Array<() => void> = []
function revokeAll(): void {
  loadGeneration += 1
  for (const revoke of revokeHandles) revoke()
  revokeHandles.length = 0
  blobUrl.value = ''
}

// 切换资源时先释放上一个 blob，再加载新资源
watch(
  () => props.resource.id,
  () => {
    revokeAll()
    imageFullscreen.value = false
    void loadBlob()
  },
  { immediate: true },
)

onBeforeUnmount(revokeAll)

/** 下载：走 blob 生成 objectURL 后 a[download] 触发，用完随即 revoke */
async function download(): Promise<void> {
  try {
    const { url, revoke } = await fetchAuthedBlob(props.resource.id)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = props.resource.fileName || props.resource.title
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    revoke()
  } catch {
    ElMessage.error('下载失败，请稍后重试。')
  }
}

const TYPE_LABELS: Record<ResourceType, string> = {
  image: '图片',
  audio: '音频',
  video: '视频',
  pdf: 'PDF',
  ppt: 'PPT 课件',
  picture_book: '绘本',
  animation: '动画',
  question_bank: '题库',
  experiment: '实验素材',
  model_3d: '3D 模型',
  document: '文档',
}

const STATUS_LABELS: Record<ResourceReviewStatus, string> = {
  draft: '草稿',
  pending: '待审核',
  approved: '已通过',
  rejected: '已驳回',
  disabled: '已停用',
}

const AGE_LABELS: Record<ResourceAgeGroup, string> = {
  small: '小班',
  middle: '中班',
  large: '大班',
  all: '通用',
}

const typeLabel = computed(() => TYPE_LABELS[props.resource.resourceType] ?? props.resource.resourceType)
const statusLabel = computed(() => STATUS_LABELS[props.resource.reviewStatus] ?? props.resource.reviewStatus)
const ageLabel = computed(() => AGE_LABELS[props.resource.ageGroup] ?? props.resource.ageGroup)

/** 实验素材：若本体为图片/视频则直接预览，否则信息+下载 */
const isImageMime = computed(
  () => props.resource.mimeType.startsWith('image/'),
)
const isVideoMime = computed(
  () => props.resource.mimeType.startsWith('video/'),
)

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = Number(bytes)
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const suffix = units[unit] ?? 'B'
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${suffix}`
}

function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '—'
  const total = Math.floor(seconds)
  const minutes = Math.floor(total / 60)
  const remain = String(total % 60).padStart(2, '0')
  return `${minutes}:${remain}`
}
</script>

<template>
  <section class="resource-preview">
    <header class="preview-header">
      <div class="heading">
        <span class="type-icon">{{ resource.resourceType === 'image' ? '🖼️' : resource.resourceType === 'audio' ? '🎵' : resource.resourceType === 'video' ? '🎬' : '📄' }}</span>
        <div class="heading-text">
          <small>{{ typeLabel }} · 审核：{{ statusLabel }}</small>
          <h2>{{ resource.title }}</h2>
        </div>
      </div>
      <div class="meta">
        <span v-if="resource.fileSize">大小 {{ formatSize(resource.fileSize) }}</span>
        <span v-if="resource.duration">时长 {{ formatDuration(resource.duration) }}</span>
        <span>{{ resource.mimeType }}</span>
        <span v-if="resource.ageGroup">年龄段 {{ ageLabel }}</span>
        <span v-if="resource.category">{{ resource.category }}</span>
      </div>
      <div class="actions">
        <ElButton @click="download">下载</ElButton>
        <ElButton type="primary" @click="$emit('close')">关闭</ElButton>
      </div>
    </header>

    <div class="stage">
      <p v-if="loading" class="hint">资源加载中…</p>

      <!-- 图片：点击放大 -->
      <template v-else-if="resource.resourceType === 'image' && blobUrl">
        <img
          class="plain preview"
          :src="blobUrl"
          :alt="resource.title"
          @click="imageFullscreen = true"
        />
        <span class="click-hint">点击图片可放大查看</span>
      </template>

      <!-- 音频 -->
      <div v-else-if="resource.resourceType === 'audio' && blobUrl" class="audio-stage">
        <div class="album-art"><span>♫</span></div>
        <strong>{{ resource.title }}</strong>
        <audio controls :src="blobUrl" preload="metadata"></audio>
      </div>

      <!-- 视频 -->
      <video
        v-else-if="resource.resourceType === 'video' && blobUrl"
        class="plain preview video"
        :src="blobUrl"
        controls
        playsinline
      ></video>

      <!-- PDF：内嵌 iframe -->
      <iframe
        v-else-if="resource.resourceType === 'pdf' && blobUrl"
        class="preview-doc"
        :src="blobUrl"
        :title="`${resource.title} PDF 预览`"
      ></iframe>

      <!-- PPT：不保证在线预览 -->
      <div v-else-if="resource.resourceType === 'ppt'" class="card-stage">
        <div class="big-icon">📊</div>
        <h3>{{ resource.title }}</h3>
        <p>暂不支持在线预览 PPT，请下载后使用 PowerPoint / WPS 打开。</p>
        <ElButton type="primary" @click="download">下载文件</ElButton>
      </div>

      <!-- 绘本：封面/基本信息 + 暂提供预览，不做逐页渲染 -->
      <div v-else-if="resource.resourceType === 'picture_book'" class="card-stage">
        <div class="big-icon">📚</div>
        <h3>{{ resource.title }}</h3>
        <p class="desc">{{ resource.description || '暂无简介' }}</p>
        <p class="hint">当前版本暂提供文件预览，可下载后阅读绘本内容。</p>
        <ElButton type="primary" @click="download">下载绘本</ElButton>
      </div>

      <!-- 题库：信息页 -->
      <div v-else-if="resource.resourceType === 'question_bank'" class="card-stage">
        <div class="big-icon">📝</div>
        <h3>{{ resource.title }}</h3>
        <p class="desc">{{ resource.description || '暂无说明' }}</p>
        <p class="hint">题库文件已保存，可下载后查看详细题目。</p>
        <ElButton type="primary" @click="download">下载题库</ElButton>
      </div>

      <!-- 实验素材：本体为图/视频则预览，否则说明+下载 -->
      <template v-else-if="resource.resourceType === 'experiment'">
        <img
          v-if="blobUrl && isImageMime"
          class="plain preview"
          :src="blobUrl"
          :alt="resource.title"
          @click="imageFullscreen = true"
        />
        <video
          v-else-if="blobUrl && isVideoMime"
          class="plain preview video"
          :src="blobUrl"
          controls
          playsinline
        ></video>
        <div v-else class="card-stage">
          <div class="big-icon">🧪</div>
          <h3>{{ resource.title }}</h3>
          <p class="desc">{{ resource.description || '暂无说明' }}</p>
          <ElButton type="primary" @click="download">下载素材</ElButton>
        </div>
      </template>

      <!-- 3D 模型：无渲染库，降级为提示+下载 -->
      <div v-else-if="resource.resourceType === 'model_3d'" class="card-stage">
        <div class="big-icon">🧊</div>
        <h3>{{ resource.title }}</h3>
        <p>当前环境不支持 3D 模型在线预览，请下载后在本地 3D 查看器中打开。</p>
        <ElButton type="primary" @click="download">下载模型</ElButton>
      </div>

      <!-- 动画 / 文档 / 其他：信息+下载 -->
      <div v-else class="card-stage">
        <div class="big-icon">{{ resource.resourceType === 'animation' ? '✨' : '📄' }}</div>
        <h3>{{ resource.title }}</h3>
        <p class="desc">{{ resource.description || '暂无说明' }}</p>
        <ElButton type="primary" @click="download">下载文件</ElButton>
      </div>

      <!-- 加载失败兜底 -->
      <div v-if="!loading && loadFailed" class="card-stage">
        <div class="big-icon">⚠️</div>
        <h3>文件加载失败</h3>
        <p>浏览器暂时无法读取该文件，可尝试下载到本地打开。</p>
        <ElButton type="primary" @click="download">下载文件</ElButton>
      </div>
    </div>

    <!-- 图片全屏放大遮罩 -->
    <div
      v-if="imageFullscreen && blobUrl"
      class="zoom-mask"
      @click="imageFullscreen = false"
    >
      <img :src="blobUrl" :alt="resource.title" />
      <span class="zoom-close">点击任意位置关闭</span>
    </div>
  </section>
</template>

<style scoped>
.resource-preview {
  display: flex;
  flex-direction: column;
  gap: 16px;
  color: #1f332b;
}

.preview-header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px 18px;
  padding: 14px 18px;
  border: 1px solid #d8ece4;
  border-radius: 12px;
  background: #f4fbf8;
}

.heading {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.type-icon {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  flex: none;
  border-radius: 12px;
  background: #d9f3e9;
  font-size: 22px;
}

.heading-text {
  min-width: 0;
}

.heading-text small {
  color: #2e8d6e;
  font-weight: 700;
}

.heading-text h2 {
  margin: 2px 0 0;
  font-size: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  color: #5c7168;
  font-size: 12px;
}

.actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
}

.stage {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 320px;
  padding: 24px;
  border: 1px solid #e3efe9;
  border-radius: 12px;
  background: #ffffff;
}

.plain.preview {
  display: block;
  max-width: 100%;
  max-height: 60vh;
  border-radius: 10px;
  object-fit: contain;
  cursor: zoom-in;
}

.plain.preview.video {
  width: 100%;
  max-height: 60vh;
  background: #000;
}

.preview-doc {
  width: 100%;
  height: 72vh;
  border: 0;
  border-radius: 10px;
  background: #f7faf9;
}

.click-hint {
  margin-top: 8px;
  color: #82958b;
  font-size: 12px;
  text-align: center;
}

.audio-stage {
  display: grid;
  justify-items: center;
  gap: 12px;
  text-align: center;
}

.album-art {
  display: grid;
  place-items: center;
  width: 120px;
  height: 120px;
  border-radius: 20px;
  background: linear-gradient(145deg, #9fe0c6, #3fae8c);
  color: #fff;
  font-size: 48px;
}

.audio-stage strong {
  font-size: 18px;
}

.card-stage {
  max-width: 520px;
  padding: 30px 34px;
  border-radius: 16px;
  background: #f6fbf8;
  border: 1px dashed #c9e6d9;
  text-align: center;
}

.big-icon {
  font-size: 48px;
}

.card-stage h3 {
  margin: 12px 0 6px;
  font-size: 18px;
}

.card-stage p {
  margin: 0 0 14px;
  color: #5c7168;
  line-height: 1.7;
}

.card-stage .desc {
  color: #1f332b;
}

.hint {
  color: #82958b;
  font-size: 13px;
}

.zoom-mask {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: grid;
  place-items: center;
  padding: 32px;
  background: rgb(10 20 16 / 88%);
}

.zoom-mask img {
  max-width: 100%;
  max-height: 100%;
  border-radius: 10px;
}

.zoom-close {
  position: absolute;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  color: #cfe6dd;
  font-size: 12px;
}
</style>
