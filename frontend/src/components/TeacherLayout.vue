<script setup lang="ts">
import BaseWorkspaceLayout from '@/components/BaseWorkspaceLayout.vue'

const sections = [
  { label: 'AI助教', items: [
    { label: 'AI助教', to: { name: 'chat' }, activeNames: ['chat'] },
  ] },
  { label: '课堂教学', items: [
    { label: '我的班级', to: { name: 'my-classes' }, activeNames: ['my-classes', 'class-detail', 'students', 'class-rewards', 'class-questions', 'student-profile'] },
    { label: '备课中心', to: { name: 'lesson-plans' }, activeNames: ['lesson-plans', 'lesson-plan-new', 'lesson-plan-edit'] },
    { label: '数字人角色库', to: { name: 'avatars' }, activeNames: ['avatars'] },
    { label: '我的教室', to: { name: 'classrooms' }, activeNames: ['classrooms', 'classroom-detail'] },
    { label: '我的设备', to: { name: 'devices' }, activeNames: ['devices', 'device-detail'] },
  ] },
  { label: '教学资源', items: [
    { label: '资源库', to: { name: 'resources' }, activeNames: ['resources', 'resource-detail', 'resource-preview', 'resource-edit', 'resource-upload'] },
  ] },
]
</script>

<template><BaseWorkspaceLayout workspace-name="幼教教师工作台" role-label="教师" :home-route="{ name: 'my-classes' }" :sections="sections" show-active-classroom><slot /></BaseWorkspaceLayout></template>
