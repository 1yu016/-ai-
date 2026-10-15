<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { resolveBreadcrumbs, type BreadcrumbItem } from '@/router/breadcrumbResolver'
import { useUserStore } from '@/stores/user'

const route = useRoute()
const router = useRouter()
const user = useUserStore()
const items = ref<BreadcrumbItem[]>([])
let resolution = 0

watch(
  () => [route.fullPath, user.teacherInfo] as const,
  async () => {
    const current = ++resolution
    const next = await resolveBreadcrumbs(route, user.teacherInfo)
    if (current === resolution) items.value = next
  },
  { immediate: true },
)

function open(item: BreadcrumbItem): void {
  if (item.to) void router.push(item.to)
}
</script>

<template>
  <nav v-if="items.length" class="breadcrumbs" aria-label="面包屑" data-test="breadcrumbs">
    <ol>
      <li v-for="(item, index) in items" :key="`${item.label}-${index}`">
        <button v-if="item.to && index < items.length - 1" type="button" @click="open(item)">{{ item.label }}</button>
        <span v-else :aria-current="index === items.length - 1 ? 'page' : undefined">{{ item.label }}</span>
        <i v-if="index < items.length - 1" aria-hidden="true">/</i>
      </li>
    </ol>
  </nav>
</template>

<style scoped>
.breadcrumbs{min-width:0;margin:0 0 18px}.breadcrumbs ol{display:flex;align-items:center;gap:8px;min-width:0;margin:0;padding:0;list-style:none;color:#a38270;font-size:13px}.breadcrumbs li{display:flex;align-items:center;gap:8px;min-width:0}.breadcrumbs button{max-width:220px;padding:2px 0;border:0;background:transparent;color:#b76849;font:inherit;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.breadcrumbs button:hover{text-decoration:underline}.breadcrumbs span{display:block;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.breadcrumbs span[aria-current='page']{color:#60483e;font-weight:700}.breadcrumbs i{color:#d7bca9;font-style:normal}
</style>
