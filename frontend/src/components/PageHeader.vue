<script setup lang="ts">
import { useRouter } from 'vue-router'
// 统一「管理态」页面头部：页面标题 + 副标题 + 明确的返回目标 + 主操作区。
// 返回目标必须是明确命名（如「← 我的班级」「← 备课中心」），不允许笼统的「返回」。
const props = withDefaults(
  defineProps<{
    title: string
    subtitle?: string
    backTo?: string
    backLabel?: string
    eyebrow?: string
  }>(),
  { subtitle: '', backTo: '', backLabel: '', eyebrow: '' },
)
const router = useRouter()
function goBack() {
  if (props.backTo) void router.push(props.backTo)
}
</script>

<template>
  <header class="page-header">
    <div class="head-titles">
      <small v-if="eyebrow" class="eyebrow">{{ eyebrow }}</small>
      <h1 class="page-title">{{ title }}</h1>
      <p v-if="subtitle" class="page-subtitle">{{ subtitle }}</p>
    </div>
    <div class="head-actions">
      <slot name="actions" />
      <button v-if="backTo" class="btn-back" data-test="page-back" @click="goBack">← {{ backLabel || '返回' }}</button>
    </div>
  </header>
</template>

<style scoped>
.page-header{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;flex-wrap:wrap}
.eyebrow{color:#c27b59;font-weight:800;letter-spacing:.1em;font-size:13px}
.page-title{margin:6px 0 4px;font-size:34px;line-height:1.12;color:#493d36}
.page-subtitle{margin:0;color:#a38270;font-size:16px}
.head-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.btn-back{border:0;background:#eb956b;color:#fff;border-radius:14px;padding:11px 18px;cursor:pointer;font-weight:700;box-shadow:0 8px 20px #eb956b30}
@media(max-width:700px){.page-header{align-items:flex-start;flex-direction:column}.page-title{font-size:28px}}
</style>