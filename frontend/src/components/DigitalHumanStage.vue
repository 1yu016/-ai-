<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useDigitalHumanStore } from '@/stores/digitalHuman'
import { useLessonRunStore } from '@/stores/lessonRun'

// 仅在 WebGL 可用、且模型加载未失败时挂载 3D 组件；three 走独立 chunk
const ThreeAvatarStage = defineAsyncComponent(() => import('./avatar/ThreeAvatarStage.vue'))

const store = useDigitalHumanStore()
const { action, visible, compact, fallback, roleName, roleId, roles, error, webglSupported, modelState } = storeToRefs(store)

const actionText: Record<string, string> = { idle: '准备好一起学习啦', listen: '我在认真听哦', thinking: '让我想一想', talk: '我来和你说一说', happy: '太棒啦', question: '你发现了吗', encourage: '再试一次，你可以的', praise: '给你一个大大的表扬', wave: '我们开始吧', goodbye: '下次再见' }
const face = computed(() => action.value === 'thinking' ? '🤔' : action.value === 'question' ? '❓' : action.value === 'talk' ? '😊' : action.value === 'praise' || action.value === 'happy' ? '🥳' : '🌼')

function detectWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
    return Boolean(gl)
  } catch {
    return false
  }
}
store.setWebglSupported(detectWebGL())
onMounted(async () => {
  void store.loadRoles()
  // 课堂运行时：resolve 当前课堂应使用的角色与模型，失败时保持内置占位形象，不阻塞课堂。
  const run = useLessonRunStore().run
  if (run) await store.loadRuntime({ lessonPlanId: run.lessonPlanId, classroomRunId: run.id, deviceId: run.deviceId })
})

const show3d = computed(() => webglSupported.value && modelState.value !== 'error')
function listen() { store.transition({ type: 'teacher_command', command: 'listen' }) }
</script>

<template>
  <aside v-if="visible" class="digital-human" :class="{ compact, speaking: action === 'talk' }" aria-label="数字人课堂助手">
    <div class="speech"><span>{{ actionText[action] }}</span><small v-if="error">{{ error }}</small></div>
    <ThreeAvatarStage v-if="show3d" @pointerdown="listen" />
    <div v-else-if="fallback" class="avatar" :class="`action-${action}`" role="img" :aria-label="roleName">
      <div class="hair">✦</div><div class="face"><span class="eye left">•</span><span class="eye right">•</span><span class="mouth">{{ face }}</span></div><div class="body">{{ face }}</div>
    </div>
    <div v-else class="loading" aria-label="数字人加载中">加载中…</div>
    <div class="role-controls">
      <select :value="roleId" aria-label="选择数字人角色" @change="store.selectRole(($event.target as HTMLSelectElement).value)">
        <option v-for="role in roles" :key="role.id" :value="role.id">{{ role.name }}</option>
      </select>
      <button class="role-name" type="button" @click="listen">{{ roleName }}</button>
    </div>
  </aside>
</template>

<style scoped>
.digital-human{position:fixed;z-index:30;right:28px;bottom:105px;width:180px;display:grid;justify-items:center;gap:5px;pointer-events:none;transition:transform .25s ease,opacity .25s ease}.digital-human.compact{transform:scale(.62);transform-origin:bottom right;right:12px;bottom:84px}.speech{max-width:180px;padding:9px 12px;border-radius:16px 16px 4px 16px;background:#fff;color:#6d574e;box-shadow:0 7px 20px #0003;font-size:13px;text-align:center}.speech small{display:block;color:#b05c4e}.avatar{position:relative;width:116px;height:144px;border-radius:58px 58px 34px 34px;background:linear-gradient(160deg,#fff6dc,#ffd9c7);box-shadow:0 8px 0 #edb99d,0 12px 25px #0004;animation:float 3s ease-in-out infinite}.hair{position:absolute;top:5px;left:31px;color:#f2a65e;font-size:38px;transform:rotate(-15deg)}.face{position:absolute;top:38px;left:21px;width:74px;height:62px;border-radius:45%;background:#fff2df}.eye{position:absolute;top:20px;color:#7d5d53;font-size:18px}.eye.left{left:18px}.eye.right{right:18px}.mouth{position:absolute;left:22px;bottom:5px;font-size:21px}.body{position:absolute;left:22px;bottom:-21px;width:72px;height:54px;border-radius:22px 22px 30px 30px;background:#8bd6cb;text-align:center;padding-top:10px;font-size:24px}.loading{padding:10px;color:#8a7568;font-size:12px}.role-controls{display:flex;align-items:center;gap:4px;pointer-events:auto}.role-controls select{max-width:92px;border:1px solid #f1d8c8;border-radius:99px;padding:4px 6px;background:#fff;color:#756158;font-size:11px}.role-name{pointer-events:auto;border:0;border-radius:99px;padding:5px 12px;background:#ffffffd9;color:#756158;font-size:12px;cursor:pointer}.speaking .avatar{animation:bounce .45s ease-in-out infinite alternate}.action-listen .face{transform:translateY(2px)}.action-wave{transform:rotate(-3deg)}@keyframes float{50%{transform:translateY(-5px)}}@keyframes bounce{to{transform:translateY(-5px)}}@media(max-width:800px){.digital-human{right:10px;bottom:155px;transform:scale(.8);transform-origin:bottom right}.digital-human.compact{transform:scale(.5)}}</style>
