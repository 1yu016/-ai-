<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import { ElDrawer } from 'element-plus'
import MobilePairingPanel from './MobilePairingPanel.vue'
import { platformApi, type ClassDeviceBinding } from '@/api/platform'
import { apiErrorMessage } from '@/api/http'

const props = defineProps<{ run: { id: number; classId?: number; deviceId: number; lessonTitle: string; status: string } }>()
const open = defineModel<boolean>({ default: false })
const binding = ref<ClassDeviceBinding | null>(null)
const className = ref('')
const error = ref('')
const loading = ref(false)
let generation = 0
async function load() {
  const current = ++generation
  const { classId, deviceId } = props.run
  binding.value = null; error.value = ''; loading.value = true
  try {
    if (!classId) throw new Error('当前课堂班级尚未确认，请刷新课堂状态。')
    const [room, group] = await Promise.all([platformApi.classDeviceBindings(classId), platformApi.classDetail(classId)])
    if (current !== generation) return
    binding.value = room.data.find(item => item.deviceId === deviceId && item.device?.type === 'classroom_screen') || null
    className.value = group.data.name
    if (!binding.value) throw new Error('当前课堂的大屏绑定已失效，请联系管理员检查。')
  } catch (cause) { if (current === generation) error.value = apiErrorMessage(cause, '无法确认当前课堂的设备，请重试。') }
  finally { if (current === generation) loading.value = false }
}
watch([() => open.value, () => props.run.id, () => props.run.classId, () => props.run.deviceId, () => ['running', 'paused'].includes(props.run.status)], () => {
  generation++; binding.value = null
  if (open.value && ['running', 'paused'].includes(props.run.status)) void load()
}, { immediate: true })
onBeforeUnmount(() => { generation++ })
</script>

<template>
  <ElDrawer v-model="open" title="连接手机 · 继续当前课堂" size="min(520px, 95vw)">
    <p v-if="!['running', 'paused'].includes(run.status)">本节课堂已结束，不能继续连接手机。</p>
    <p v-else-if="loading" role="status">正在确认当前课堂和大屏…</p>
    <div v-else-if="error" role="alert"><p>{{ error }}</p><button type="button" @click="load">重新检查</button></div>
    <template v-else-if="binding && run.classId">
      <p>{{ className }} · {{ binding.classroom?.name }} · {{ binding.device?.name }}</p>
      <MobilePairingPanel :key="`${run.id}:${run.deviceId}`" auto-create :class-id="run.classId" :classroom-id="binding.classroomId" :device-id="run.deviceId" :run-id="run.id" :title="run.lessonTitle" />
    </template>
    <template #footer><button type="button" @click="open = false">关闭面板，继续上课</button></template>
  </ElDrawer>
</template>
