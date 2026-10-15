<script setup lang="ts">
import DigitalHumanStage from '@/components/DigitalHumanStage.vue'
defineProps<{ courseTitle: string }>()
</script>
<template>
  <section class="screen-summary" data-test="screen-summary">
    <div class="summary-character"><DigitalHumanStage :controls="false" opening far framing="screen" /></div>
    <div><span>今天的课堂结束啦</span><h1>{{ courseTitle }}</h1><p>谢谢小朋友一起探索，<br>我们下次再见！</p></div>
  </section>
</template>
<style scoped>
.screen-summary { height:calc(100dvh - 74px); box-sizing:border-box; display:grid; grid-template-columns:minmax(0,1.3fr) minmax(0,.7fr); align-items:center; padding:3vh 6vw; gap:4vw; }
.summary-character { height:100%; min-height:0; pointer-events:none; }
.summary-character :deep(.digital-human) { height:100%; width:100%; }
.summary-character :deep(.avatar) { scale:2; }
.summary-character :deep(.opening-meta) { position:absolute; bottom:0; }
span { color:#46735b; font-size:26px; font-weight:800; }
h1 { font-size:clamp(30px,3vw,48px); line-height:1.25; overflow-wrap:anywhere; }
p { color:#716257; font-size:28px; line-height:1.7; }
@media(max-width:900px) { .screen-summary { grid-template-columns:1fr; grid-template-rows:minmax(250px,1fr) auto; padding:20px; gap:12px; text-align:center; } h1 { margin:10px 0; } p { margin:10px 0; } }
</style>
