<script setup lang="ts">
import WorkspaceState from '@/components/WorkspaceState.vue'
withDefaults(defineProps<{ title?: string; description?: string; compact?: boolean }>(), { title: '正在加载', description: '请稍候，正在获取最新数据。', compact: false })
</script>

<template><WorkspaceState tone="loading" :title="title" :description="description" :compact="compact" /></template>
