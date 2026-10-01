<script setup lang="ts">
import DigitalHumanStage from '@/components/DigitalHumanStage.vue'

defineProps<{
  roleName: string
  actionText: string
  micReady: boolean
  assistantOnline: boolean
  classroomStatusText: string
}>()
</script>

<template>
  <aside class="partner-panel">
    <section class="digital-human-card">
      <div class="card-head"><strong>🤖 AI 教学伙伴</strong></div>
      <div class="dh-role-line">
        <strong class="dh-role">{{ roleName }}</strong>
        <span class="dh-state">{{ actionText }}</span>
      </div>
      <div class="dh-stage">
        <DigitalHumanStage />
      </div>
    </section>
    <section class="status-card">
      <div class="card-head"><strong>课堂状态</strong></div>
      <ul class="status-list">
        <li><span>麦克风</span><em :class="micReady ? 'ok' : 'warn'">{{ micReady ? '就绪' : '不可用' }}</em></li>
        <li><span>AI 助教</span><em :class="assistantOnline ? 'ok' : 'off'">{{ assistantOnline ? '在线' : '待命' }}</em></li>
        <li><span>课堂</span><em class="ok">{{ classroomStatusText }}</em></li>
      </ul>
    </section>
  </aside>
</template>

<style scoped>
.partner-panel {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
}
.digital-human-card,
.status-card {
  padding: 16px 14px 14px;
  border: 1px solid #E8DED1;
  border-radius: 16px;
  background: #FFFDF9;
  box-shadow: 0 6px 20px rgba(79, 61, 49, 0.08);
}
.card-head { margin-bottom: 6px; }
.card-head strong { color: #4F3D31; font-size: 15px; font-weight: 800; }
.dh-role-line {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 4px 0 2px;
}
.dh-role { color: #4F3D31; font-size: 15px; font-weight: 800; }
.dh-state { padding: 3px 10px; border-radius: 999px; background: #FFF8EE; color: #8D6732; font-size: 12px; font-weight: 700; }
.dh-stage { width: 100%; height: 250px; }
.status-list { display: grid; gap: 8px; margin: 4px 0 0; padding: 0; list-style: none; }
.status-list li { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.status-list span { color: #9B8779; font-size: 13px; }
.status-list em {
  min-width: 44px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 12px;
  font-style: normal;
  font-weight: 800;
  text-align: center;
}
.status-list em.ok { background: #E7F0E3; color: #5B8C5C; }
.status-list em.warn { background: #FFF0E6; color: #C07A3E; }
.status-list em.off { background: #F3EDE6; color: #9B8779; }

/* <1280px：教学伙伴压缩到 200px 并精简，绝不隐藏（数字人是课堂核心能力） */
@media (max-width: 1280px) {
  .partner-panel { gap: 12px; }
  .digital-human-card,
  .status-card { padding: 12px 10px 10px; }
  .dh-role-line { gap: 6px; }
  .dh-role { font-size: 14px; }
  .dh-stage { height: 180px; }
  .status-list { gap: 6px; }
  .status-list span { font-size: 12px; }
  .status-list em { min-width: 40px; padding: 2px 7px; font-size: 11px; }
}
</style>
