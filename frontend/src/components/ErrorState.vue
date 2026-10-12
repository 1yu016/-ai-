<script setup lang="ts">
import WorkspaceState from '@/components/WorkspaceState.vue'

withDefaults(
  defineProps<{ title?: string; description: string; retryLabel?: string; retryable?: boolean; compact?: boolean }>(),
  { title: '加载失败', retryLabel: '重新加载', retryable: true, compact: false },
)
defineEmits<{ retry: [] }>()
</script>

<template>
  <WorkspaceState tone="error" icon="!" :title="title" :description="description" :compact="compact">
    <template v-if="retryable" #actions>
      <button class="state-button" type="button" @click="$emit('retry')">{{ retryLabel }}</button>
    </template>
  </WorkspaceState>
</template>

<style scoped>.state-button{border:1px solid #efc0ba;border-radius:12px;padding:9px 15px;background:#fff6f5;color:#b45145;font:inherit;font-weight:700;cursor:pointer}</style>
