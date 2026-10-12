<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import { useRoute, useRouter } from 'vue-router'
import { navigateBack } from '@/router/navigation'
import { useUserStore } from '@/stores/user'

const props = withDefaults(defineProps<{ label?: string; fallback?: RouteLocationRaw }>(), {
  label: '返回',
  fallback: undefined,
})
const route = useRoute()
const router = useRouter()
const user = useUserStore()

function goBack(): void {
  void navigateBack(router, route, user, props.fallback)
}
</script>

<template>
  <button class="back-button" type="button" data-test="back-button" @click="goBack">
    <span aria-hidden="true">←</span>{{ label }}
  </button>
</template>

<style scoped>
.back-button{display:inline-flex;align-items:center;gap:7px;min-height:42px;padding:0 17px;border:1px solid #efd9c8;border-radius:13px;background:#fffdf9;color:#b76849;font:inherit;font-weight:750;cursor:pointer;box-shadow:0 8px 18px #b9795110}
.back-button:hover{background:#fff2e7;color:#c65f3c}.back-button:focus-visible{outline:3px solid #f6c8ac;outline-offset:2px}
</style>
