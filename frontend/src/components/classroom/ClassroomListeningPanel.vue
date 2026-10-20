<script setup lang="ts">
import { ref, watch } from 'vue'
import { useClassroomListening } from '@/composables/useClassroomListening'
import { useDigitalHumanStore } from '@/stores/digitalHuman'
import type { ListeningRoute } from '@/services/classroomListening'
import { isRealAsrEnabled } from '@/services/backendAsrRecognition'

const props = defineProps<{ identity: string; allowed: boolean; speaking: boolean; autoAnswer?: boolean; compact?: boolean; continuousFollowup?: boolean }>()
const emit = defineEmits<{ question: [text: string]; reset: [] }>()
const avatar = useDigitalHumanStore()
const wakeWord = ref('小星小星'), manual = ref(''), result = ref<ListeningRoute | null>(null)
const realAsr = isRealAsrEnabled()
watch(() => props.identity, () => { manual.value = ''; result.value = null; emit('reset') }, { flush: 'sync' })
const session = useClassroomListening({
  identity: () => props.identity, allowed: () => props.allowed, speaking: () => props.speaking, wakeWord: () => wakeWord.value,
  // A build flag is not guardian consent or approval for continuous external processing.
  // Keep manual questions available; do not silently replace local recognition with cloud upload.
  createRecognition: realAsr ? async () => { throw new Error('云端持续监听尚未完成授权与隐私验证，请使用手动提问。') } : undefined,
  continueAfterSpeech: () => props.continuousFollowup === true,
  onListening: active => {
    if (active) avatar.transition({ type: 'teacher_command', command: 'listen' })
    else if (avatar.currentState === 'listen') avatar.transition({ type: 'settle' })
  },
  onRoute: route => { result.value = route; if (route.kind === 'question') emit('question', route.text) },
})
const { enabled, phase, feedback, error } = session
function submit() { session.submitManual(manual.value); manual.value = '' }
function begin() { result.value = null; void session.start() }
</script>

<template>
  <section class="listening-panel" aria-label="课堂唤醒与聆听" :data-listening-phase="phase">
    <strong v-if="!compact">课堂唤醒与聆听</strong>
    <details :open="!compact"><summary v-if="compact">麦克风与唤醒设置（原型）</summary>
    <p>{{ realAsr ? '云端持续监听暂不可用：尚未完成课堂录音授权与外部处理隐私验证。不会上传麦克风语音，请使用手动提问。' : '本地转写匹配原型：仅本地中文识别可用时开启，不回退云端。不保存录音；不是远场识别保证。' }}</p>
    <label>唤醒词 <input v-model="wakeWord" maxlength="20" :disabled="enabled" aria-label="课堂唤醒词" /></label>
    <button v-if="!enabled" type="button" :disabled="!allowed" @click="begin">开启课堂互动</button>
    <button v-else type="button" @click="session.stop()">关闭课堂互动</button>
    <p v-if="error" role="alert">{{ error }}</p>
    </details>
    <p role="status">{{ feedback }}</p>
    <p v-if="enabled && (phase === 'waiting' || phase === 'listening')" role="status" data-test="microphone-active">麦克风本地监听中 · 可随时关闭；数字人说话时暂停采集。</p>
    <p v-if="result" :data-route-kind="result.kind">{{ result.message }}</p>
    <label>手动问题（无需唤醒）<input v-model="manual" maxlength="300" aria-label="手动课堂问题" @keydown.enter="submit" /></label>
    <button type="button" :disabled="!allowed || !manual.trim()" @click="submit">{{ autoAnswer ? '向数字人提问' : '提交问题供老师查看' }}</button>
    <small>{{ autoAnswer ? '普通问题进入自动回答；公共麦克风不执行教师命令。' : '公共麦克风只分类，不执行课堂操作，也不自动调用 AI。' }}暂停后需老师重新开启互动。</small>
  </section>
</template>

<style scoped>
.listening-panel { display:grid; gap:8px; padding:14px; border:1px solid var(--app-border); border-radius:12px; background:var(--app-surface); }
details[open]{display:grid;gap:8px}summary{font-size:12px;cursor:pointer}input{min-width:0;max-width:100%;box-sizing:border-box;width:100%}label,details{min-width:0}
p,small { margin:0; font-size:12px; color:var(--app-muted); } label { display:grid; gap:4px; font-size:13px; } input { padding:7px; border:1px solid var(--app-border); border-radius:6px; } button { padding:8px; cursor:pointer; } button:disabled { cursor:not-allowed; opacity:.5; }
</style>
