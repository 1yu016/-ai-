<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import ManagementLayout from '@/components/ManagementLayout.vue'
import ChunkedUploader from '@/components/resources/ChunkedUploader.vue'
import type { ResourceResponse } from '@/api/resources'
import { useCourseLibraryStore } from '@/stores/library'

const router = useRouter()
const store = useCourseLibraryStore()

const hasPendingUpload = ref(false)

function beforeUnload(event: BeforeUnloadEvent) {
  if (!hasPendingUpload.value) return
  event.preventDefault()
}

onBeforeRouteLeave(
  () =>
    !hasPendingUpload.value ||
    window.confirm('资源仍在上传或等待续传。离开后可以重新选择同一文件继续，确定离开吗？'),
)

onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))

function backToLibrary() {
  void router.push({ name: 'resources' })
}

function onDone(resource: ResourceResponse) {
  hasPendingUpload.value = false
  store.pushOrReplace(resource)
  void router.push({ name: 'resource-detail', params: { id: resource.id } })
}
</script>

<template>
  <ManagementLayout>
    <div class="upload-view">
      <div class="head">
        <h1>上传资源</h1>
        <button class="button outline" @click="backToLibrary">返回资源库</button>
      </div>

      <div class="panel">
        <p class="desc">
          文件先建立服务端上传会话，再按 4MB 分片上传。进度来自真实网络传输，支持暂停、续传、失败重试和取消清理。
        </p>
        <ChunkedUploader
          @done="onDone"
          @pending-change="hasPendingUpload = $event"
        />
      </div>
    </div>
  </ManagementLayout>
</template>

<style scoped>
.upload-view {
  display: grid;
  gap: 18px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}
.head h1 {
  margin: 0;
  font-size: 28px;
  color: #26364a;
}
.panel {
  background: #fff;
  border: 1px solid #e7edf3;
  border-radius: 12px;
  padding: 20px;
}
.desc {
  margin: 0 0 16px;
  font-size: 13px;
  color: #8191a2;
}
.button {
  border: 0;
  border-radius: 8px;
  padding: 10px 18px;
  cursor: pointer;
  font-size: 14px;
}
.button.outline {
  background: #fff;
  border: 1px solid #36aa89;
  color: #229a7d;
}
.button.outline:hover {
  background: #edf7f4;
}
</style>
