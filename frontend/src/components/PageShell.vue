<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'list' | 'detail' | 'form' | 'wide' | 'split'
  }>(),
  { variant: 'list' },
)
</script>

<template>
  <main class="page-shell" :class="`page-shell--${variant}`">
    <slot name="header" />
    <div v-if="variant === 'split'" class="page-shell__split">
      <aside class="page-shell__aside"><slot name="aside" /></aside>
      <section class="page-shell__main"><slot /></section>
    </div>
    <slot v-else />
  </main>
</template>

<style scoped>
.page-shell{width:100%;min-width:0;margin:0 auto;box-sizing:border-box}.page-shell--list{max-width:1180px}.page-shell--detail{max-width:1040px}.page-shell--form{max-width:920px}.page-shell--wide,.page-shell--split{max-width:1320px}.page-shell__split{display:grid;grid-template-columns:minmax(260px,340px) minmax(0,1fr);gap:22px;align-items:start}.page-shell__aside,.page-shell__main{min-width:0}
@media(max-width:900px){.page-shell__split{grid-template-columns:1fr}.page-shell__aside{order:2}}
</style>
