<script setup lang="ts">
import BaseWorkspaceLayout from '@/components/BaseWorkspaceLayout.vue'

const sections = [
  { label: '工作台', items: [
    { label: '教师工作台', to: { name: 'teacher-home' }, activeNames: ['teacher-home'] },
  ] },
  { label: '备课与资源', items: [
    { label: '备课中心', to: { name: 'lesson-plans' }, activeNames: ['lesson-plans', 'lesson-plan-new', 'lesson-plan-edit'] },
    { label: '资源库', to: { name: 'resources' }, activeNames: ['resources', 'resource-detail', 'resource-preview', 'resource-edit', 'resource-upload'] },
  ] },
  { label: '班级与学生', items: [
    { label: '我的班级', to: { name: 'my-classes' }, activeNames: ['my-classes', 'class-detail', 'students', 'class-rewards', 'class-questions', 'class-artworks', 'student-profile'] },
  ] },
  { label: '课堂记录与复盘', items: [
    { label: '课堂记录', to: { name: 'classroom-history' }, activeNames: ['classroom-history', 'classroom-record'] },
  ] },
  { label: 'AI与数字人', items: [
    { label: 'AI助教', to: { name: 'chat' }, activeNames: ['chat'] },
    { label: '数字人角色库', to: { name: 'avatars' }, activeNames: ['avatars'] },
  ] },
  { label: '教室与设备', items: [
    { label: '我的教室', to: { name: 'classrooms' }, activeNames: ['classrooms', 'classroom-detail'] },
    { label: '我的设备', to: { name: 'devices' }, activeNames: ['devices', 'device-detail'] },
  ] },
]
</script>

<template><BaseWorkspaceLayout workspace-name="幼教教师工作台" role-label="教师" :home-route="{ name: 'teacher-home' }" :sections="sections" show-active-classroom><slot /></BaseWorkspaceLayout></template>
