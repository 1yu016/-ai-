<script setup lang="ts">
import AdminLayout from '@/components/AdminLayout.vue'
import TeacherLayout from '@/components/TeacherLayout.vue'
import { useUserStore } from '@/stores/user'

// 兼容现有页面：页面继续使用 ManagementLayout，内部按当前身份选择明确的工作台布局。
const user = useUserStore()
</script>

<template>
  <AdminLayout v-if="user.isAdmin"><slot /></AdminLayout>
  <TeacherLayout v-else><slot /></TeacherLayout>
</template>
