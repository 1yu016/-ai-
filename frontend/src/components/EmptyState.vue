<script setup lang="ts">
import WorkspaceState from '@/components/WorkspaceState.vue'

withDefaults(
  defineProps<{ title: string; description: string; actionLabel?: string; canAct?: boolean; compact?: boolean }>(),
  { actionLabel: '', canAct: true, compact: false },
)
defineEmits<{ action: [] }>()
</script>

<template>
  <WorkspaceState tone="empty" icon="🌱" :title="title" :description="description" :compact="compact">
    <template v-if="actionLabel && canAct" #actions>
      <button class="state-button" type="button" @click="$emit('action')">{{ actionLabel }}</button>
    </template>
  </WorkspaceState>
</template>

<style scoped>.state-button{border:0;border-radius:12px;padding:10px 16px;background:#eb956b;color:#fff;font:inherit;font-weight:700;cursor:pointer}</style>
