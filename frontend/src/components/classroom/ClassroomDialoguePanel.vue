<script setup lang="ts">
import { ref, watch } from 'vue'
import ClassroomListeningPanel from './ClassroomListeningPanel.vue'
import { useClassroomDialogue } from '@/composables/useClassroomDialogue'
import { useUserStore } from '@/stores/user'
import { useDigitalHumanStore } from '@/stores/digitalHuman'
import { useDialogueSpeech } from '@/composables/useDialogueSpeech'

const props = defineProps<{ identity: string; allowed: boolean; speaking: boolean; runId: number; stepIndex: number }>()
const user = useUserStore(), avatar = useDigitalHumanStore()
const enabled = ref(false), autoRead = ref(false), continuousFollowup = ref(false)
const speech = useDialogueSpeech({ identity: () => props.identity, allowed: () => props.allowed && enabled.value, enabled: () => autoRead.value, onSpeaking: active => avatar.transition({ type: active ? 'tts_start' : 'tts_end' }) })
const { occupied: voiceOccupied, speaking: localSpeaking, error: audioError } = speech
const dialogue = useClassroomDialogue({ identity: () => props.identity, allowed: () => enabled.value && props.allowed, runId: () => props.runId, stepIndex: () => props.stepIndex, token: () => user.accessToken, onStart: speech.begin, onPartial: text => speech.append(text), onComplete: text => speech.append(text, true), onStop: speech.stop, onFailure: speech.stop })
const { busy, reply, error } = dialogue
watch(() => props.identity, () => { enabled.value = false; audioError.value = '' }, { flush: 'sync' })
watch(() => props.allowed, allowed => { if (!allowed) { enabled.value = false; speech.stop() } }, { flush: 'sync' })
watch(() => props.speaking, active => { if (active && !localSpeaking.value) dialogue.stop() })
</script>

<template>
  <section class="dialogue-panel" aria-label="数字人课堂对话">
    <strong>数字人课堂对话</strong>
    <label><input v-model="enabled" type="checkbox" :disabled="!allowed" /> 开启普通问题自动回答</label>
    <label><input v-model="autoRead" type="checkbox" :disabled="!enabled" /> 逐句朗读回答</label>
    <label><input v-model="continuousFollowup" type="checkbox" :disabled="!enabled" /> 回答后短时免唤醒追问</label>
    <p>结合当前课堂内容连续回答；只在本页短暂保留对话。课堂操作仍交给老师，暂停后需重新开启。</p>
    <ClassroomListeningPanel :identity="identity" :allowed="allowed && enabled" :speaking="speaking || voiceOccupied || busy" :continuous-followup="continuousFollowup" auto-answer compact @question="dialogue.ask" @reset="dialogue.stop(true)" />
    <div v-if="reply || busy || error || voiceOccupied || audioError" class="dialogue-answer" aria-live="polite"><strong>{{ busy ? '已收到，正在生成并检查回答…' : error ? '回答未完成' : '数字人回答' }}</strong><p data-test="dialogue-reply">{{ reply }}</p><p v-if="error" role="alert">{{ error }}</p><p v-if="audioError" role="alert">{{ audioError }}</p><button v-if="busy || voiceOccupied" @click="dialogue.stop()">停止回答与朗读</button></div>
    <small>先完成输入与整段回答安全检查，再逐句播放；检查期间不会朗读未审核内容，老师可随时停止。不是音素级口型或流式音频。追问窗口为 10 秒，仅支持的本地识别可用；不是远场或回声消除保证。</small>
  </section>
</template>

<style scoped>
.dialogue-panel{display:grid;gap:9px;padding:12px;border:1px solid var(--app-border);border-radius:12px;background:var(--app-surface)}label{font-size:12px;line-height:1.6}p,small{margin:0;color:var(--app-muted);font-size:12px;line-height:1.7}.dialogue-answer{padding:10px;background:var(--app-primary-soft);border-radius:8px}.dialogue-answer p{white-space:pre-wrap}button{padding:8px;cursor:pointer}
.dialogue-panel{min-width:0;overflow-wrap:anywhere}.dialogue-panel :deep(.listening-panel){min-width:0;padding:8px}.dialogue-panel :deep(input){max-width:100%}
</style>
