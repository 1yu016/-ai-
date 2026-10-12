<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ManagementLayout from '@/components/ManagementLayout.vue'
import BackButton from '@/components/BackButton.vue'
import ResourcePreview from '@/components/resources/ResourcePreview.vue'
import { useCourseLibraryStore } from '@/stores/library'
import { navigateBack } from '@/router/navigation'
import { useUserStore } from '@/stores/user'

const props = defineProps<{ id: string | number }>()
const route = useRoute()
const router = useRouter()
const user = useUserStore()
const store = useCourseLibraryStore()
const resourceId = () => Number(props.id)

onMounted(() => {
  store.getById(resourceId()).catch(() => undefined)
})

function goBack(): void {
  void navigateBack(router, route, user)
}
</script>

<template>
  <ManagementLayout>
    <h1>资源预览</h1>
    <p class="muted">查看与下载资源文件</p>
    <div class="toolbar">
      <BackButton label="返回资源详情" />
    </div>

    <div class="panel">
      <p v-if="store.detailLoading">加载中…</p>
      <p v-else-if="store.detailError" class="bad">{{ store.detailError }}</p>
      <ResourcePreview
        v-else-if="store.detail && store.detail.id === resourceId()"
        :resource="store.detail"
        @close="goBack"
      />
      <p v-else>未找到该资源。</p>
    </div>
  </ManagementLayout>
</template>

<style scoped>
.panel {
  padding: 18px;
}
</style>
