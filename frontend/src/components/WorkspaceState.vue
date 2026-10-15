<script setup lang="ts">
withDefaults(
  defineProps<{
    tone?: 'loading' | 'empty' | 'error' | 'forbidden'
    icon?: string
    title: string
    description?: string
    compact?: boolean
  }>(),
  { tone: 'empty', icon: '', description: '', compact: false },
)
</script>

<template>
  <section
    class="workspace-state"
    :class="[`workspace-state--${tone}`, { compact }]"
    :role="tone === 'error' || tone === 'forbidden' ? 'alert' : 'status'"
    :aria-live="tone === 'loading' ? 'polite' : undefined"
  >
    <div class="workspace-state__icon" aria-hidden="true">
      <span v-if="tone === 'loading'" class="workspace-state__spinner"></span>
      <span v-else>{{ icon }}</span>
    </div>
    <div class="workspace-state__copy">
      <h2>{{ title }}</h2>
      <p v-if="description">{{ description }}</p>
      <div v-if="$slots.actions" class="workspace-state__actions"><slot name="actions" /></div>
    </div>
  </section>
</template>

<style scoped>
.workspace-state{display:flex;align-items:flex-start;justify-content:center;gap:16px;min-height:190px;box-sizing:border-box;padding:38px 28px;border:1px solid #f0ddce;border-radius:18px;background:#fffdf9;color:#60483e;text-align:left;box-shadow:0 8px 24px #c88d6012}.workspace-state.compact{min-height:0;padding:20px}.workspace-state__icon{display:grid;place-items:center;flex:0 0 auto;width:46px;height:46px;border-radius:15px;background:#fff1e2;font-size:24px}.workspace-state--error .workspace-state__icon{background:#ffebeb;color:#c64e4e}.workspace-state--forbidden .workspace-state__icon{background:#fff3dc;color:#a36a17}.workspace-state__copy{max-width:560px}.workspace-state h2{margin:1px 0 7px;font-size:19px}.workspace-state p{margin:0;color:#8f7465;line-height:1.65}.workspace-state__actions{display:flex;gap:10px;margin-top:17px;flex-wrap:wrap}.workspace-state__spinner{width:21px;height:21px;border:3px solid #f1c8ae;border-top-color:#d87853;border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
@media(max-width:600px){.workspace-state{justify-content:flex-start;padding:26px 20px}}
</style>
