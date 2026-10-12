<script setup lang="ts">
import WorkspaceState from '@/components/WorkspaceState.vue'

withDefaults(
  defineProps<{ title?: string; description?: string; actionLabel?: string; compact?: boolean }>(),
  { title: '暂无访问权限', description: '当前账号不能查看或操作此内容。', actionLabel: '', compact: false },
)
defineEmits<{ action: [] }>()
</script>

<template>
  <WorkspaceState tone="forbidden" icon="🔒" :title="title" :description="description" :compact="compact">
    <template v-if="actionLabel" #actions>
      <button class="state-button" type="button" @click="$emit('action')">{{ actionLabel }}</button>
    </template>
  </WorkspaceState>
</template>

<style scoped>.state-button{border:1px solid #ecd5ad;border-radius:12px;padding:9px 15px;background:#fffaf0;color:#92601a;font:inherit;font-weight:700;cursor:pointer}</style>
