<script setup lang="ts">
import { computed } from 'vue'
import type { StudentAuthorizationStatus } from '@/api/platform'
import { STUDENT_AUTHORIZATION_LABELS } from '@/utils/student'

const props = defineProps<{ status?: StudentAuthorizationStatus }>()
const resolved = computed<StudentAuthorizationStatus>(() => props.status ?? 'pending')
</script>

<template>
  <span class="authorization-badge" :class="resolved" :data-status="resolved">
    {{ STUDENT_AUTHORIZATION_LABELS[resolved] }}
  </span>
</template>

<style scoped>
.authorization-badge{display:inline-flex;align-items:center;border-radius:999px;padding:5px 10px;font-size:12px;font-weight:700;white-space:nowrap}
.authorized{background:#e8f7ed;color:#388557}.partial{background:#fff3dc;color:#a66f19}.unauthorized{background:#ffebeb;color:#bb4949}.pending{background:#f0eef1;color:#7f737c}
</style>
