<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import PageActions from '@/components/PageActions.vue'
import BackButton from '@/components/BackButton.vue'
// 统一「管理态」页面头部：页面标题 + 副标题 + 明确的返回目标 + 主操作区。
// 返回目标必须是明确命名（如「← 我的班级」「← 备课中心」），不允许笼统的「返回」。
withDefaults(
  defineProps<{
    title: string
    subtitle?: string
    backTo?: RouteLocationRaw
    backLabel?: string
    eyebrow?: string
  }>(),
  { subtitle: '', backTo: undefined, backLabel: '', eyebrow: '' },
)
</script>

<template>
  <header class="page-header">
    <div class="head-titles">
      <small v-if="eyebrow" class="eyebrow">{{ eyebrow }}</small>
      <h1 class="page-title">{{ title }}</h1>
      <p v-if="subtitle" class="page-subtitle">{{ subtitle }}</p>
    </div>
    <PageActions class="head-actions">
      <slot name="actions" />
      <BackButton v-if="backTo" :fallback="backTo" :label="backLabel || '返回'" data-test="page-back" />
    </PageActions>
  </header>
</template>

<style scoped>
.page-header{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;flex-wrap:wrap}
.eyebrow{color:#c27b59;font-weight:800;letter-spacing:.1em;font-size:13px}
.page-title{margin:6px 0 4px;font-size:34px;line-height:1.12;color:#493d36}
.page-subtitle{margin:0;color:#a38270;font-size:16px}
.head-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
@media(max-width:700px){.page-header{align-items:flex-start;flex-direction:column}.page-title{font-size:28px}}
</style>
