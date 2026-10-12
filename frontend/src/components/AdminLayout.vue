<script setup lang="ts">
import BaseWorkspaceLayout from '@/components/BaseWorkspaceLayout.vue'

const sections = [
  { label: '平台管理', items: [
    { label: '数据看板', to: { name: 'admin-dashboard' }, activeNames: ['admin-dashboard'] },
    { label: '审计日志', to: { name: 'admin-audit' }, activeNames: ['admin-audit'] },
    { label: '教师管理', to: { name: 'teachers' }, activeNames: ['teachers'] },
    { label: '班级与学生', to: { name: 'classes' }, activeNames: ['classes', 'class-detail', 'students', 'class-rewards', 'class-questions', 'student-center', 'student-profile'] },
    { label: '教室管理', to: { name: 'classrooms' }, activeNames: ['classrooms', 'classroom-detail'] },
    { label: '设备管理', to: { name: 'devices' }, activeNames: ['devices', 'device-detail'] },
  ] },
  { label: '内容管理', items: [
    { label: '资源审核', to: { name: 'resources', query: { reviewStatus: 'pending_review' } }, activeNames: ['resources', 'resource-detail', 'resource-preview', 'resource-edit', 'resource-review', 'resource-upload'] },
    { label: '数字人角色库', to: { name: 'avatars' }, activeNames: ['avatars'] },
  ] },
  { label: '课堂设备', items: [
    { label: '设备准备', to: { name: 'classroom-scan' }, activeNames: ['classroom-scan'] },
  ] },
]
</script>

<template><BaseWorkspaceLayout workspace-name="幼教管理员控制台" role-label="管理员" :home-route="{ name: 'admin-dashboard' }" :sections="sections"><slot /></BaseWorkspaceLayout></template>
