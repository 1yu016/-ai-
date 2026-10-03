<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import ManagementLayout from '@/components/ManagementLayout.vue'
import UploadPanel from '@/components/resources/UploadPanel.vue'
import ChunkedUploader from '@/components/resources/ChunkedUploader.vue'
import type { ResourceResponse } from '@/api/resources'
import { useCourseLibraryStore } from '@/stores/library'

const router = useRouter()
const store = useCourseLibraryStore()

type Mode = 'normal' | 'chunk'
const mode = ref<Mode>('normal')

function backToLibrary() {
  void router.push({ name: 'resources' })
}

function onDone(resource: ResourceResponse) {
  store.pushOrReplace(resource)
  ElMessage.success('资源上传成功')
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

      <div class="tabs">
        <button
          class="tab"
          :class="{ active: mode === 'normal' }"
          @click="mode = 'normal'"
        >
          普通上传
        </button>
        <button
          class="tab"
          :class="{ active: mode === 'chunk' }"
          @click="mode = 'chunk'"
        >
          大文件分片上传
        </button>
      </div>

      <div v-show="mode === 'normal'" class="panel">
        <p class="desc">适用于常规文件（≤ 200MB），一次性上传。</p>
        <UploadPanel @done="onDone" />
      </div>

      <div v-show="mode === 'chunk'" class="panel">
        <p class="desc">适用于大文件：自动按 4MB 分片并发上传，支持暂停、续传与失败重试。</p>
        <ChunkedUploader @done="onDone" />
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
.tabs {
  display: flex;
  gap: 8px;
  border-bottom: 1px solid #e7edf3;
}
.tab {
  border: 0;
  background: none;
  padding: 10px 18px;
  font-size: 15px;
  color: #66788c;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.tab:hover {
  color: #229a7d;
}
.tab.active {
  color: #229a7d;
  border-bottom-color: #36aa89;
  font-weight: 700;
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