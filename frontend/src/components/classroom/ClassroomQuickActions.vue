<script setup lang="ts">
defineProps<{ disabled: boolean; totalStars: number }>()
const emit = defineEmits<{ (event: 'interaction' | 'reward' | 'resources' | 'assistant' | 'leaderboard'): void }>()
</script>

<template>
  <section class="quick-actions launcher-row" aria-label="课堂快捷操作">
    <h2>课堂快捷操作</h2>
    <button type="button" data-test="open-interaction" :disabled="disabled" @click="emit('interaction')">随机点名<span>课堂互动</span></button>
    <button type="button" :disabled="disabled" @click="emit('reward')">快速奖励<span class="l-stars">本节 {{ totalStars }} 朵小红花</span></button>
    <button type="button" @click="emit('resources')">教学资源<span>调整本节展示内容</span></button>
    <button type="button" @click="emit('assistant')">AI教学伙伴<span>提问引导 · 课堂建议</span></button>
    <button class="secondary" type="button" data-test="open-leaderboard" @click="emit('leaderboard')">本节榜单</button>
  </section>
</template>

<style scoped>
.quick-actions{display:flex;flex-direction:column;gap:8px}h2{margin:0 0 2px;font-size:13px;color:var(--app-muted);font-weight:700}button{min-height:50px;display:flex;flex-direction:column;justify-content:center;gap:3px;text-align:left;border:1px solid var(--app-border);border-radius:12px;background:var(--app-surface);padding:9px 12px;color:var(--app-text);font:inherit;font-weight:700;cursor:pointer}button:hover{background:var(--app-primary-soft);border-color:var(--app-primary)}button:disabled{opacity:.5;cursor:not-allowed}button:focus-visible{outline:2px solid var(--app-primary-dark);outline-offset:2px}span{font-size:11px;color:var(--app-muted);font-weight:400}.secondary{min-height:36px;background:transparent;font-size:13px}
</style>
