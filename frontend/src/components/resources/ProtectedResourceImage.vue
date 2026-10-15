<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { fetchAuthedBlob } from '@/api/resources'
import type { CourseResource } from '@/stores/courseResource'

const props = defineProps<{
  resource: CourseResource
}>()

const source = ref('')
const failed = ref(false)
let revokeCurrent: (() => void) | null = null
let loadSequence = 0

function releaseCurrent(): void {
  revokeCurrent?.()
  revokeCurrent = null
  source.value = ''
}

async function load(): Promise<void> {
  const sequence = ++loadSequence
  releaseCurrent()
  failed.value = false

  if (props.resource.source !== 'library') {
    source.value = props.resource.dataUrl || props.resource.contentUrl || ''
    failed.value = !source.value
    return
  }

  const id = Number(props.resource.id)
  if (!Number.isInteger(id) || id <= 0) {
    failed.value = true
    return
  }

  try {
    const result = await fetchAuthedBlob(id)
    if (sequence !== loadSequence) {
      result.revoke()
      return
    }
    revokeCurrent = result.revoke
    source.value = result.url
  } catch {
    if (sequence === loadSequence) failed.value = true
  }
}

watch(
  () => [props.resource.id, props.resource.source, props.resource.contentUrl, props.resource.dataUrl],
  () => void load(),
  { immediate: true },
)

onBeforeUnmount(() => {
  loadSequence += 1
  releaseCurrent()
})
</script>

<template>
  <img v-if="source" :src="source" :alt="resource.title" @error="failed = true" />
  <div v-else class="protected-image-state" :class="{ failed }" role="img" :aria-label="`${resource.title}预览${failed ? '加载失败' : '加载中'}`">
    {{ failed ? '预览不可用' : '正在加载预览' }}
  </div>
</template>

<style scoped>
.protected-image-state{display:grid;width:100%;height:100%;place-items:center;padding:12px;background:#fff8f0;color:#9a7e6e;font-size:12px;text-align:center}
.protected-image-state.failed{background:#f7f3ef;color:#8d8179}
</style>
