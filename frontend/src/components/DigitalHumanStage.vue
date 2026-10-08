<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useDigitalHumanStore } from '@/stores/digitalHuman'
import { useLessonRunStore } from '@/stores/lessonRun'

// 仅在 WebGL 可用、且模型加载未失败时挂载 3D 组件；three 走独立 chunk
const ThreeAvatarStage = defineAsyncComponent(() => import('./avatar/ThreeAvatarStage.vue'))

const store = useDigitalHumanStore()
const { action, visible, compact, fallback, roleName, roleId, roles, error, webglSupported, modelState } = storeToRefs(store)

const actionText: Record<string, string> = { idle: '准备好一起学习啦', listen: '我在认真听哦', think: '让我想一想', talk: '我来和你说一说', happy: '太棒啦', question: '你发现了吗', encourage: '再试一次，你可以的', wave: '我们开始吧', goodbye: '下次再见' }
const face = computed(() => action.value === 'think' ? '🤔' : action.value === 'question' ? '❓' : action.value === 'talk' ? '😊' : action.value === 'happy' ? '🥳' : '🌼')

// opening = 课堂开场视觉专用：隐藏开发用角色选择器/资产名，字幕移到舞台下方，加载与失败文案走友好态。
// controls=false = 普通课堂/大屏卡片模式：隐藏角色选择器与角色名按钮（selector），只保留主体与字幕。
// far = 使用更远的相机机位（配合 ThreeAvatarStage 的 fit 取景），用于数字人大屏。
const props = withDefaults(defineProps<{ opening?: boolean; controls?: boolean; far?: boolean }>(), { opening: false, controls: true, far: false })

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
  <aside v-if="visible" class="digital-human" :class="{ compact, speaking: action === 'talk', opening: props.opening }" aria-label="数字人课堂助手">
    <!-- 普通课堂：说话气泡贴在人物附近 -->
    <div v-if="!props.opening" class="speech"><span>{{ actionText[action] }}</span><small v-if="error">{{ error }}</small></div>

    <ThreeAvatarStage v-if="show3d" :opening="props.opening" :far="props.far" @pointerdown="listen" />
    <div v-else-if="fallback" class="avatar" :class="`action-${action}`" role="img" :aria-label="props.opening ? 'AI 教学伙伴' : roleName">
      <div class="hair">✦</div><div class="face"><span class="eye left">•</span><span class="eye right">•</span><span class="mouth">{{ face }}</span></div><div class="body">{{ face }}</div>
    </div>
    <div v-else class="loading" aria-label="数字人加载中">{{ props.opening ? 'AI 教学伙伴正在准备…' : '加载中…' }}</div>

    <!-- 开场/卡片模式：隐藏 development 角色选择器与资产名，仅保留正式互动区 -->
    <div v-if="!props.opening && props.controls" class="role-controls">
      <select :value="roleId" aria-label="选择数字人角色" @change="store.selectRole(($event.target as HTMLSelectElement).value)">
        <option v-for="role in roles" :key="role.id" :value="role.id">{{ role.name }}</option>
      </select>
      <button class="role-name" type="button" @click="listen">{{ roleName }}</button>
    </div>

    <!-- 开场失败的友好占位（不再展示原生 roleName/asset 名），CTA 仍由上层提供 -->
    <div v-if="props.opening" class="opening-meta" data-test="opening-avatar-state">
      <template v-if="error">🤖 AI 教学伙伴暂时没有准备好，课堂依然可以开始。</template>
    </div>
  </aside>
</template>

<style scoped>
.digital-human {
  position: relative; width: 100%; max-width: 210px; margin: 0 auto;
  display: grid; justify-items: center; align-content: center; gap: 6px;
  pointer-events: none; transition: transform .25s ease, opacity .25s ease;
}
.digital-human.compact { transform: scale(.68); transform-origin: bottom center; }

/* 开场模式：撑满舞台、松开 210px 上限，让数字人完整居中；字幕由上层（字幕区）统一提供。
   用 flex 纵列撑满舞台：grid auto 行轨道下 `height: 82%` 的百分比高度会塌陷成 ~0，
   导致 3D 舞台与 canvas 不可见（Opening 空白根因）。flex: 1 1 auto 保证舞台真正撑满。 */
.digital-human.opening {
  max-width: none;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
}
.digital-human.opening :deep(.three-avatar-stage) {
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
}
.digital-human.opening .avatar { transform-origin: center; }
.digital-human.opening .loading { color: #A98D7A; font-size: 15px; font-weight: 600; padding: 8px 14px; }

.speech {
  max-width: 200px; padding: 8px 12px; border-radius: 16px 16px 4px 16px;
  background: #fff; color: #6b584c; border: 1px solid #F0E4D5;
  box-shadow: 0 6px 20px rgba(79,61,49,.08); font-size: 13px; text-align: center;
}
.speech small { display: block; color: #C07A3E; }
.avatar {
  position: relative; width: 116px; height: 144px; border-radius: 58px 58px 34px 34px;
  background: linear-gradient(160deg,#fff6dc,#ffd9c7); box-shadow: 0 8px 0 #edb99d,0 12px 25px rgba(79,61,49,.14);
  animation: float 3s ease-in-out infinite;
}
.hair { position: absolute; top: 5px; left: 31px; color: #f2a65e; font-size: 38px; transform: rotate(-15deg); }
.face { position: absolute; top: 38px; left: 21px; width: 74px; height: 62px; border-radius: 45%; background: #fff2df; }
.eye { position: absolute; top: 20px; color: #7d5d53; font-size: 18px; }
.eye.left { left: 18px; }
.eye.right { right: 18px; }
.mouth { position: absolute; left: 22px; bottom: 5px; font-size: 21px; }
.body { position: absolute; left: 22px; bottom: -21px; width: 72px; height: 54px; border-radius: 22px 22px 30px 30px; background: #8bd6cb; text-align: center; padding-top: 10px; font-size: 24px; }
.loading { padding: 10px; color: #9b8779; font-size: 12px; }
.opening-meta { color: #A9896B; font-size: 14px; font-weight: 600; text-align: center; }

.role-controls { display: flex; align-items: center; gap: 4px; pointer-events: auto; }
.role-controls select { max-width: 92px; border: 1px solid #E8DED1; border-radius: 99px; padding: 4px 6px; background: #fff; color: #6b584c; font-size: 11px; }
.role-name { pointer-events: auto; border: 0; border-radius: 99px; padding: 5px 12px; background: #FFF8EE; color: #6b584c; font-size: 12px; cursor: pointer; }
.speaking .avatar { animation: bounce .45s ease-in-out infinite alternate; }
.action-listen .face { transform: translateY(2px); }
.action-wave { transform: rotate(-3deg); }
@keyframes float { 50% { transform: translateY(-5px); } }
@keyframes bounce { to { transform: translateY(-5px); } }
</style>
