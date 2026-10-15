<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'
import { ElButton, ElMessage } from 'element-plus'
import {
  fetchAuthedBlob,
  type ResourceAgeGroup,
  type ResourceResponse,
  type ResourceReviewStatus,
  type ResourceType,
} from '@/api/resources'
import ResourcePlayer from '@/components/ResourcePlayer.vue'
import type { CourseResource, CourseResourceMediaType } from '@/stores/courseResource'
import { useResourcePlayerStore } from '@/stores/resourcePlayer'

const props = defineProps<{ resource: ResourceResponse }>()
const emit = defineEmits<{ (event: 'close'): void }>()
const playerStore = useResourcePlayerStore()

const TYPE_LABELS: Record<ResourceType, string> = {
  image: '图片', audio: '音频', video: '视频', pdf: 'PDF', ppt: 'PPT 课件',
  picture_book: '绘本', nursery_rhyme: '儿歌', animation: '动画',
  question_bank: '题库', experiment: '实验素材', model_3d: '3D 模型',
  document: '文档', unknown: '未知类型',
}
const STATUS_LABELS: Record<ResourceReviewStatus, string> = {
  draft: '草稿', pending_review: '待审核', approved: '已通过', rejected: '已驳回', archived: '已归档',
}
const AGE_LABELS: Record<ResourceAgeGroup, string> = {
  small: '小班', middle: '中班', large: '大班', all: '通用',
}

function toPlayerResource(resource: ResourceResponse): CourseResource {
  const mediaType = resource.resourceType === 'unknown'
    ? 'document'
    : resource.resourceType as CourseResourceMediaType
  const playerMediaType =
    mediaType === 'audio' || mediaType === 'nursery_rhyme'
      ? 'audio'
      : mediaType === 'video' || mediaType === 'animation'
        ? 'video'
        : mediaType === 'image'
          ? 'image'
          : 'document'
  return {
    id: resource.id,
    title: resource.title,
    fileName: resource.fileName,
    uploadedAt: resource.createdAt,
    category: resource.category as CourseResource['category'],
    mediaType,
    playerMediaType,
    aliases: resource.aliases,
    ageGroup: resource.ageGroup,
    ageGroups: [resource.ageGroup],
    tags: resource.tags,
    themes: resource.tags,
    description: resource.description,
    contentUrl: resource.fileUrl,
    coverUrl: resource.coverUrl,
    mimeType: resource.mimeType,
    fileSize: resource.fileSize,
    duration: resource.duration,
    reviewStatus: resource.reviewStatus,
    source: 'library',
  }
}

const playerResource = computed(() => toPlayerResource(props.resource))
const typeLabel = computed(() => TYPE_LABELS[props.resource.resourceType] ?? '未知类型')
const statusLabel = computed(() => STATUS_LABELS[props.resource.reviewStatus] ?? props.resource.reviewStatus)
const ageLabel = computed(() => AGE_LABELS[props.resource.ageGroup] ?? props.resource.ageGroup)

watch(playerResource, (resource) => playerStore.openResource(resource, false), { immediate: true })

onBeforeUnmount(() => {
  if (String(playerStore.currentResource?.id) === String(props.resource.id)) playerStore.close()
})

async function download() {
  try {
    const { url, revoke } = await fetchAuthedBlob(props.resource.id)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = props.resource.fileName || props.resource.title
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(revoke, 0)
  } catch {
    ElMessage.error('下载失败，请稍后重试。')
  }
}

function close() {
  playerStore.close()
  emit('close')
}

function formatSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`
}
</script>

<template>
  <section class="resource-preview">
    <header class="preview-header">
      <div>
        <small>{{ typeLabel }} · 审核：{{ statusLabel }}</small>
        <h2>{{ resource.title }}</h2>
      </div>
      <div class="meta">
        <span>大小 {{ formatSize(resource.fileSize) }}</span>
        <span>{{ resource.mimeType }}</span>
        <span>年龄段 {{ ageLabel }}</span>
        <span v-if="resource.category">{{ resource.category }}</span>
      </div>
      <div class="actions">
        <ElButton @click="download">下载</ElButton>
        <ElButton type="primary" @click="close">关闭</ElButton>
      </div>
    </header>
    <div class="player-shell">
      <ResourcePlayer :resources="[playerResource]" :show-close="false" />
    </div>
  </section>
</template>

<style scoped>
.resource-preview { display: flex; min-height: 0; flex: 1; flex-direction: column; gap: 14px; }
.preview-header {
  display: flex; align-items: center; flex-wrap: wrap; gap: 12px 18px;
  padding: 14px 18px; border: 1px solid #d8ece4; border-radius: 12px; background: #f4fbf8;
}
.preview-header small { color: #2e8d6e; font-weight: 700; }
.preview-header h2 { margin: 2px 0 0; font-size: 20px; }
.meta { display: flex; min-width: 0; flex: 1; flex-wrap: wrap; gap: 6px 12px; color: #687b72; font-size: 13px; }
.actions { display: flex; gap: 8px; }
.player-shell { position: relative; min-height: 560px; overflow: hidden; border: 1px solid #eadfd5; border-radius: 14px; }
@media (max-width: 900px) { .player-shell { min-height: 480px; } }
</style>
