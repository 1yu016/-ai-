<script setup lang="ts">
import DigitalHumanStage from '@/components/DigitalHumanStage.vue'
defineProps<{ courseTitle: string; paused?: boolean }>()
</script>

<template>
  <section class="screen-opening" data-test="screen-opening">
    <div class="opening-character"><DigitalHumanStage :controls="false" opening far framing="screen" /></div>
    <div class="opening-copy">
      <span>欢迎来到课堂</span>
      <h1>{{ courseTitle }}</h1>
      <p>小朋友们好，我们一起探索今天的新知识吧！</p>
      <strong>{{ paused ? '课堂暂停，等待老师继续' : '等待老师进入教学' }}</strong>
    </div>
  </section>
</template>

<style scoped>
.screen-opening { box-sizing:border-box; height:calc(100dvh - 74px); display:grid; grid-template-columns:minmax(0,1.3fr) minmax(0,.7fr); align-items:center; gap:4vw; padding:3vh 6vw; }
.opening-character { height:100%; min-height:0; pointer-events:none; }
.opening-character :deep(.digital-human) { width:100%; height:100%; }
.opening-character :deep(.avatar) { scale:2; }
.opening-character :deep(.opening-meta) { position:absolute; bottom:0; }
.opening-copy span { color:#d17a53; font-weight:800; font-size:24px; }
h1 { margin:18px 0; font-size:clamp(30px,3vw,48px); line-height:1.25; overflow-wrap:anywhere; }
p { color:#716257; font-size:clamp(22px,1.7vw,28px); line-height:1.65; }
strong { display:block; margin-top:28px; color:#46735b; font-size:26px; }
@media(max-width:900px) { .screen-opening { grid-template-columns:1fr; grid-template-rows:minmax(250px,1fr) auto; text-align:center; padding:20px; gap:12px; } .opening-copy h1 { margin:8px 0; } .opening-copy p { margin:8px 0; } .opening-copy strong { margin-top:12px; } }
</style>
