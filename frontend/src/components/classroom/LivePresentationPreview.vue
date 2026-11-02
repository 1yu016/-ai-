<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElButton } from 'element-plus'
import { useLessonRunStore } from '@/stores/lessonRun'
import { useCourseResourceStore, type CourseResource } from '@/stores/courseResource'
import ProtectedResourceImage from '@/components/resources/ProtectedResourceImage.vue'
import DigitalHumanStage from '@/components/DigitalHumanStage.vue'
import { usePresentationQueue } from '@/composables/usePresentationQueue'
const collapsed = ref(false)
const store = useLessonRunStore()
const resources = useCourseResourceStore()
const resource = ref<CourseResource | null>(null)
const snapshot = computed(() => store.run?.playerRecoverySuggestion)
const qaCaption = computed(() => {
  const state = snapshot.value
  if (!state || store.run?.status !== 'running' || state.childQaStepIndex !== store.run.currentStepIndex || state.childQaRunVersion !== store.run.version || !['set_presentation', 'speak_text'].includes(String(state.operation))) return null
  return state.childQaQuestionText ? { question: state.childQaQuestionText, answer: state.operation === 'speak_text' ? state.ttsText : '', status: state.childQaAnswerStatus === 'handoff' ? '请老师一起想一想' : '等待教师确认' } : null
})
const { canShow, canPause, canResume, previousItem, nextItem, show, saving, media, error } = usePresentationQueue()
let sequence = 0
watch(() => snapshot.value?.resourceId, async id => {
  const current = ++sequence; resource.value = null
  if (!id) return
  try { const result = await resources.ensureResourceById(id); if (current === sequence) resource.value = result }
  catch { /* Display an honest unavailable preview, never claim a screen receipt. */ }
}, { immediate: true })
</script>

<template>
  <section class="live-preview" aria-label="大屏展示状态预览">
    <header><strong>大屏预览</strong><span>静音监看</span><ElButton data-test="preview-toggle" :aria-expanded="!collapsed" @click="collapsed = !collapsed">{{ collapsed ? '展开预览' : '折叠预览' }}</ElButton></header>
    <div v-show="!collapsed" class="stage">
      <DigitalHumanStage v-if="snapshot?.presentationMode === 'avatar' || (!snapshot?.resourceId && !snapshot?.artworkId)" :controls="false" mode="immersive" />
      <ProtectedResourceImage v-else-if="resource?.mediaType === 'image'" :resource="resource" />
      <div v-else class="resource-summary"><h2>{{ resource?.title ?? '等待老师选择展示内容' }}</h2><p v-if="resource">{{ snapshot?.status === 'playing' ? '播放指令已写入课堂状态' : '展示已就绪' }} · 第 {{ snapshot?.pageIndex ?? 1 }} 页</p><p>预览不自动发声，不会影响学生大屏。</p></div>
      <div v-if="qaCaption" class="qa-caption" aria-live="polite"><strong>{{ qaCaption.question }}</strong><p>{{ qaCaption.answer || qaCaption.status }}</p></div>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <footer>
      <ElButton :disabled="saving || !canShow || !previousItem" @click="previousItem && show(previousItem)">上一项</ElButton>
      <ElButton :disabled="saving || !(snapshot?.status === 'playing' ? canPause : canResume) || !resource || snapshot?.presentationMode === 'avatar'" @click="media(snapshot?.status === 'playing' ? 'pause_media' : 'resume_media')">{{ snapshot?.status === 'playing' ? '暂停播放' : '继续播放' }}</ElButton>
      <ElButton :disabled="saving || !canShow || !nextItem" @click="nextItem && show(nextItem)">下一项</ElButton>
      <slot />
    </footer>
  </section>
</template>

<style scoped>
.live-preview{border:1px solid var(--app-border);border-radius:24px;overflow:hidden;background:var(--app-surface);margin-bottom:20px}header,footer{padding:16px 20px;display:flex;gap:12px;align-items:center;justify-content:space-between;background:var(--app-surface-soft)}header span{font-size:12px;color:var(--app-muted)}.stage{min-height:340px;display:grid;place-items:center;background:var(--app-bg)}.stage :deep(img){max-width:100%;max-height:420px;object-fit:contain}.resource-summary{text-align:center;padding:32px;color:var(--app-text)}p{color:var(--app-muted)}footer{justify-content:flex-start}
header,footer{flex-wrap:wrap}footer :deep(.el-button){margin-left:0}
.live-preview{display:flex;flex-direction:column;flex:1;min-height:0;margin-bottom:0;height:100%}header{flex:none;padding:12px 18px}.stage{flex:1;min-height:0;overflow:hidden}.stage :deep(.digital-human-stage){width:100%;height:100%;min-height:0}.stage :deep(img){max-height:100%}footer{flex:none;padding:12px 16px;gap:8px;min-height:64px}
.stage :deep(.digital-human.immersive){width:min(100%,680px);height:100%;min-height:0}.stage :deep(.digital-human.immersive .three-avatar-stage){min-height:0}
.live-preview{height:auto;flex:none;border-radius:16px}.stage{flex:none;aspect-ratio:16/9;width:min(100%,533px);height:auto;max-height:300px;margin:auto;box-sizing:border-box}.stage :deep(.digital-human.immersive){width:100%;height:100%}.resource-summary{padding:12px}.resource-summary h2{font-size:18px}header{gap:8px}header strong{margin-right:auto}footer{min-height:0;gap:6px;padding:12px}footer :deep(.el-button){padding:8px 10px}
.stage{position:relative}.qa-caption{position:absolute;bottom:8px;left:8px;right:8px;border-radius:12px;background:var(--app-surface);border:1px solid var(--app-border);padding:10px;font-size:14px;line-height:1.5}.qa-caption p{margin:4px 0 0}</style>
