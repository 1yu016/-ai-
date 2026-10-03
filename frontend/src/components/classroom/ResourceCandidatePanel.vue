<script setup lang="ts">
/**
 * ResourceCandidatePanel（Stage 6.5）—— 轻量「资源候选/确认」区域。
 *
 * 职责：展示待确认资源（单个高置信命中 or 候选列表），由教师明确选择后才 emit confirm；
 * 绝不自动执行，也不在这里调用 openResource（执行由课堂页在 confirm 后统一进行）。
 *
 * 按钮语义取决于最初意图（§六）：
 *  - search_resource / open_resource → [选择并打开]（openResource(resource, false)）
 *  - play_resource + 可播放媒体    → [选择并播放]（openResource(resource, true)）
 *  - play_resource + 不可播放媒体  → 降级为打开，按钮显示「打开」并附明确说明（§十）
 */
import { computed } from 'vue'
import type { CourseResource } from '@/stores/courseResource'
import {
  hasDegradedPlay,
  resolveExecuteAction,
} from '@/classroom/command/ResourceCommandCoordinator'
import type { ResourceCommandResult } from '@/classroom/command/ResourceCommand'

const props = defineProps<{
  result: ResourceCommandResult
}>()

const emit = defineEmits<{
  confirm: [resource: CourseResource]
  cancel: []
}>()

const AGE_GROUP_LABEL: Record<string, string> = {
  small: '小班',
  middle: '中班',
  large: '大班',
  all: '全龄',
}

const TYPE_LABEL: Record<string, string> = {
  image: '图片',
  audio: '音频',
  video: '视频',
  document: '文档/课件',
}

const single = computed(() =>
  props.result.matchStatus === 'matched' && props.result.candidates.length === 1
    ? props.result.candidates[0]
    : null,
)

const isPlayIntent = computed(() => props.result.intent === 'play_resource')

/** 候选的按钮文案：根据意图 + 可播放性决定（选择并打开 / 选择并播放）。 */
function actionLabel(resource: CourseResource): string {
  const action = resolveExecuteAction(props.result.intent, resource)
  return action.action === 'play' ? '选择并播放' : '选择并打开'
}

/** 单个高置信命中时的主按钮文案。 */
function singleActionLabel(resource: CourseResource): string {
  const action = resolveExecuteAction(props.result.intent, resource)
  return action.action === 'play' ? '播放' : '打开'
}

/** 资源简介：类型 · 年龄段（有则显示）· 标签。 */
function summary(resource: CourseResource): string {
  const parts: string[] = [TYPE_LABEL[resource.mediaType] ?? resource.mediaType]
  const age = AGE_GROUP_LABEL[resource.ageGroup]
  if (age) parts.push(age)
  if (Array.isArray(resource.tags) && resource.tags.length) {
    parts.push(resource.tags.slice(0, 3).join('、'))
  }
  return parts.join(' · ')
}

/** 不可播放降级说明（play + image/pdf/ppt…）。 */
function degradedNote(resource: CourseResource): string {
  const action = resolveExecuteAction(props.result.intent, resource)
  return hasDegradedPlay(action) ? action.note : ''
}
</script>

<template>
  <section class="resource-candidate-panel" aria-label="资源候选确认">
    <header class="rcp-header">
      <strong class="rcp-title">
        {{
          result.matchStatus === 'matched'
            ? `找到资源：${single?.title ?? ''}`
            : result.matchStatus === 'low_confidence'
              ? '找到可能相关的资源，请确认是否使用。'
              : `找到 ${result.candidates.length} 个相关资源，请选择：`
        }}
      </strong>
      <span class="rcp-role">仅教师确认后执行</span>
    </header>

    <p v-if="result.matchStatus === 'not_found'" class="rcp-note">
      {{ result.reply }}
    </p>

    <!-- 单个高置信命中：明确“找到资源：XXX” + [打开/播放] + [取消] -->
    <div v-if="single" class="rcp-single">
      <div class="rcp-candidate">
        <span class="rcp-type" aria-hidden="true">
          {{
            single.mediaType === 'audio'
              ? '🎵'
              : single.mediaType === 'video'
                ? '🎬'
                : single.mediaType === 'image'
                  ? '🖼️'
                  : '📄'
          }}
        </span>
        <span class="rcp-candidate-body">
          <strong>{{ single.title }}</strong>
          <small>{{ summary(single) }}</small>
        </span>
      </div>
      <p v-if="degradedNote(single)" class="rcp-note">
        {{ degradedNote(single) }}
      </p>
      <div class="rcp-actions">
        <button
          type="button"
          class="rcp-btn primary"
          :class="{ 'is-play': isPlayIntent }"
          @click="emit('confirm', single)"
        >
          {{ singleActionLabel(single) }}
        </button>
        <button type="button" class="rcp-btn" @click="emit('cancel')">取消</button>
      </div>
    </div>

    <!-- 多个 / 低置信候选：教师必须明确选择其一 -->
    <div v-else-if="result.candidates.length" class="rcp-list">
      <div
        v-for="resource in result.candidates"
        :key="resource.id"
        class="rcp-candidate"
      >
        <span class="rcp-type" aria-hidden="true">
          {{
            resource.mediaType === 'audio'
              ? '🎵'
              : resource.mediaType === 'video'
                ? '🎬'
                : resource.mediaType === 'image'
                  ? '🖼️'
                  : '📄'
          }}
        </span>
        <span class="rcp-candidate-body">
          <strong>{{ resource.title }}</strong>
          <small>{{ summary(resource) }}</small>
          <em v-if="degradedNote(resource)">{{ degradedNote(resource) }}</em>
        </span>
        <button
          type="button"
          class="rcp-btn primary"
          :class="{ 'is-play': isPlayIntent }"
          @click="emit('confirm', resource)"
        >
          {{ actionLabel(resource) }}
        </button>
      </div>
      <div class="rcp-actions">
        <button type="button" class="rcp-btn" @click="emit('cancel')">取消</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.resource-candidate-panel {
  padding: 16px 18px;
  border: 1px solid #E8DED1;
  border-radius: 14px;
  background: #FFFDF9;
  box-shadow: 0 4px 14px rgba(79, 61, 49, 0.06);
}
.rcp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.rcp-title { color: #4F3D31; font-size: 16px; font-weight: 800; }
.rcp-role {
  color: #9B8779;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1px;
  white-space: nowrap;
}
.rcp-note {
  margin: 10px 0 0;
  padding: 8px 12px;
  border: 1px solid #F0E4D5;
  border-radius: 10px;
  background: #FFF8EE;
  color: #B07236;
  font-size: 13px;
  line-height: 1.6;
}
.rcp-single { margin-top: 12px; }
.rcp-list { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.rcp-candidate {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid #F0E4D5;
  border-radius: 12px;
  background: #FFFDF9;
}
.rcp-candidate:hover { border-color: #EACFB4; }
.rcp-type { font-size: 20px; }
.rcp-candidate-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.rcp-candidate-body strong {
  color: #4F3D31;
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rcp-candidate-body small { margin-top: 2px; color: #9B8779; font-size: 12px; }
.rcp-candidate-body em {
  margin-top: 4px;
  color: #B07236;
  font-size: 12px;
  font-style: normal;
}
.rcp-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 12px;
}
.rcp-btn {
  padding: 7px 18px;
  border: 1px solid #E8DED1;
  border-radius: 10px;
  background: #FFFDF9;
  color: #6B584C;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.rcp-btn:hover { border-color: #C8B6A2; }
.rcp-btn.primary {
  border-color: #EACFB4;
  background: #FBEFE3;
  color: #C07A3E;
}
.rcp-btn.primary.is-play {
  border-color: #DCE9D5;
  background: #F4FAF0;
  color: #5E8B57;
}
.rcp-btn.primary:hover { filter: brightness(0.98); }
</style>
