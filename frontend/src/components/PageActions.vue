<script setup lang="ts">
withDefaults(defineProps<{ align?: 'start' | 'end' | 'between' }>(), { align: 'end' })
</script>

<template><div class="page-actions" :class="`page-actions--${align}`"><slot /></div></template>

<style scoped>
.page-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.page-actions--start{justify-content:flex-start}.page-actions--end{justify-content:flex-end}.page-actions--between{justify-content:space-between}
@media(max-width:640px){.page-actions{width:100%;justify-content:flex-start}}
</style>
