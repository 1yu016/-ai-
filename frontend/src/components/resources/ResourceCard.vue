<script setup lang="ts">
import { computed } from 'vue'
import type { ResourceAgeGroup, ResourceResponse, ResourceReviewStatus, ResourceType } from '@/api/resources'

// ResourceResponse 即库内约定的 ResourceItem 契约。
const TYPE_LABELS: Record<ResourceType, string> = {
  image: '图片',
  audio: '音频',
  video: '视频',
  pdf: 'PDF',
  ppt: 'PPT',
  picture_book: '绘本',
  animation: '动画',
  question_bank: '题库',
  experiment: '实验',
  model_3d: '3D模型',
  document: '文档',
}
const AGE_LABELS: Record<ResourceAgeGroup, string> = {
  small: '小班',
  middle: '中班',
  large: '大班',
  all: '全龄段',
}
const STATUS_LABELS: Record<ResourceReviewStatus, string> = {
  draft: '草稿',
  pending: '待审核',
  approved: '已通过',
  rejected: '已驳回',
  disabled: '已停用',
}

const props = defineProps<{ resource: ResourceResponse }>()
const emit = defineEmits<{
  (e: 'open-detail', resource: ResourceResponse): void
  (e: 'preview', resource: ResourceResponse): void
  (e: 'toggle-favorite', resource: ResourceResponse): void
}>()

const typeLabel = computed(() => TYPE_LABELS[props.resource.resourceType] ?? props.resource.resourceType)
const ageLabel = computed(() => AGE_LABELS[props.resource.ageGroup] ?? props.resource.ageGroup)
const statusLabel = computed(() => STATUS_LABELS[props.resource.reviewStatus] ?? props.resource.reviewStatus)
const statusClass = computed(() => {
  if (props.resource.reviewStatus === 'approved') return 'ok'
  if (props.resource.reviewStatus === 'pending') return 'warn'
  return 'bad'
})
const showTags = computed(() => props.resource.tags.slice(0, 3))

function formatSize(bytes: number): string {
  if (!bytes && bytes !== 0) return '—'
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}
function open(): void { emit('open-detail', props.resource) }
function preview(): void { emit('preview', props.resource) }
</script>
<template>
  <article class="card" @click="open">
    <div class="cover">
      <img v-if="resource.coverUrl" :src="resource.coverUrl" alt="" loading="lazy" />
      <span v-else class="cover-fallback">{{ typeLabel }}</span>
      <span class="status-badge" :class="statusClass">{{ statusLabel }}</span>
    </div>
    <div class="body">
      <h3 class="title" :title="resource.title">{{ resource.title }}</h3>
      <p class="meta">
        <span>{{ typeLabel }}</span>
        <span>·</span>
        <span>{{ ageLabel }}</span>
        <span v-if="resource.domain">·</span>
        <span v-if="resource.domain">{{ resource.domain }}</span>
      </p>
      <div v-if="showTags.length" class="tags">
        <span v-for="tag in showTags" :key="tag" class="tag">{{ tag }}</span>
      </div>
      <div class="foot">
        <span class="time">{{ formatSize(resource.fileSize) }}</span>
        <button
          class="fav"
          :class="{ on: resource.isFavorite }"
          :title="resource.isFavorite ? '取消收藏' : '收藏'"
          :aria-label="resource.isFavorite ? '取消收藏' : '收藏'"
          @click.stop="emit('toggle-favorite', resource)"
        >{{ resource.isFavorite ? '★' : '☆' }}</button>
      </div>
      <div class="actions">
        <button class="link" @click.stop="open">详情</button>
        <button class="link primary" @click.stop="preview">预览</button>
      </div>
    </div>
  </article>
</template>
<style scoped>
.card {
  background: #fff;
  border: 1px solid #e7edf3;
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  cursor: pointer;
  transition: box-shadow 0.18s ease;
}
.card:hover { box-shadow: 0 6px 18px rgba(34, 154, 125, 0.14); }
.cover {
  position: relative;
  height: 140px;
  background: linear-gradient(135deg, #eef7f4, #dceee8);
  display: flex;
  align-items: center;
  justify-content: center;
}
.cover img { width: 100%; height: 100%; object-fit: cover; }
.cover-fallback {
  font-size: 26px;
  font-weight: 700;
  color: #229a7d;
}
.status-badge {
  position: absolute;
  top: 10px;
  right: 10px;
  border-radius: 12px;
  padding: 3px 9px;
  font-size: 12px;
}
.ok { background: #e6f7ef; color: #21936f; }
.warn { background: #fff3dc; color: #b77d20; }
.bad { background: #ffebeb; color: #c64e4e; }
.body { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 8px; flex: 1; }
.title { margin: 0; font-size: 15px; font-weight: 600; color: #26364a; line-height: 1.4; }
.meta { margin: 0; font-size: 13px; color: #8191a2; display: flex; gap: 5px; flex-wrap: wrap; }
.tags { display: flex; gap: 6px; flex-wrap: wrap; }
.tag {
  background: #f0f6f4;
  color: #229a7d;
  border-radius: 6px;
  padding: 2px 7px;
  font-size: 12px;
}
.foot { display: flex; justify-content: space-between; align-items: center; margin-top: auto; }
.time { font-size: 12px; color: #8191a2; }
.fav { border: 0; background: none; color: #cbd6dd; font-size: 20px; line-height: 1; cursor: pointer; }
.fav.on { color: #f0a020; }
.actions { display: flex; gap: 8px; }
.link { flex: 1; border: 1px solid #e0e9ee; background: #fff; color: #66788c; border-radius: 8px; padding: 6px 0; font-size: 13px; cursor: pointer; }
.link:hover { border-color: #229a7d; color: #229a7d; }
.link.primary { background: #229a7d; border-color: #229a7d; color: #fff; }
.link.primary:hover { background: #36aa89; border-color: #36aa89; }
</style>