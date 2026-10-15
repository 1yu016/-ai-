<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ status: string; bound?: boolean }>()
const label = computed(() => ({
  online: '在线',
  offline: '离线',
  fault: '故障',
  disabled: '停用',
}[props.status] ?? props.status))
</script>

<template>
  <span class="device-state" :class="`device-state--${status}`">{{ label }}</span>
  <span v-if="bound !== undefined" class="binding-state" :class="{ unbound: !bound }">{{ bound ? '已绑定' : '未绑定' }}</span>
</template>

<style scoped>
.device-state,.binding-state{display:inline-flex;align-items:center;margin-right:6px;padding:4px 9px;border-radius:999px;background:#f0f0f0;color:#686868;font-size:13px;font-weight:700}.device-state--online{background:#def3e7;color:#26734e}.device-state--fault,.device-state--disabled{background:#ffe0dc;color:#a13c35}.binding-state{background:#e7f0ff;color:#42699a}.binding-state.unbound{background:#f2ede8;color:#806f63}
</style>
