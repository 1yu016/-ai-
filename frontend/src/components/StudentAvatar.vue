<script setup lang="ts">
import { computed } from 'vue'
import type { Student } from '@/api/platform'
import { studentAuthorizationStatus } from '@/utils/student'

const props = withDefaults(defineProps<{ student: Partial<Student>; size?: number }>(), {
  size: 42,
})
const status = computed(() => studentAuthorizationStatus(props.student))
const label = computed(() => status.value === 'authorized'
  ? '当前系统没有可展示的学生照片，使用默认卡通头像'
  : '照片未授权，使用默认卡通头像')
</script>

<template>
  <span
    class="student-avatar"
    :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.max(18, size * 0.48)}px` }"
    role="img"
    :aria-label="label"
    :title="label"
  >🧒</span>
</template>

<style scoped>
.student-avatar{display:inline-grid;flex:0 0 auto;place-items:center;border-radius:50%;background:linear-gradient(145deg,#ffe9d2,#ffd8b6);box-shadow:inset 0 0 0 1px #efcdb4;color:#9a5e45}
</style>
