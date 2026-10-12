<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import ManagementLayout from '@/components/ManagementLayout.vue'
import PageShell from '@/components/PageShell.vue'
import PageHeader from '@/components/PageHeader.vue'
import LoadingState from '@/components/LoadingState.vue'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { platformApi, type Classroom } from '@/api/platform'
import { apiErrorMessage } from '@/api/http'
import { useUserStore } from '@/stores/user'

const user = useUserStore()
const classrooms = ref<Classroom[]>([])
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const showForm = ref(false)
const form = ref({ name: '', location: '' })
const pendingStatus = ref<Classroom | null>(null)

async function load() {
  loading.value = true; error.value = ''
  try { classrooms.value = (await platformApi.listClassrooms()).data }
  catch (cause) { error.value = apiErrorMessage(cause, '教室加载失败，请稍后重试。') }
  finally { loading.value = false }
}
async function createRoom() {
  if (!form.value.name.trim()) return
  saving.value = true
  try {
    await platformApi.createClassroom({ name: form.value.name.trim(), location: form.value.location.trim() || undefined })
    form.value = { name: '', location: '' }; showForm.value = false; await load()
  } catch (cause) { error.value = apiErrorMessage(cause, '教室添加失败。') }
  finally { saving.value = false }
}
async function toggleStatus() {
  const room = pendingStatus.value
  if (!room) return
  saving.value = true
  try { await platformApi.updateClassroom(room.id, { status: room.status === 'active' ? 'disabled' : 'active' }); pendingStatus.value = null; await load() }
  catch (cause) { error.value = apiErrorMessage(cause, '教室状态更新失败。') }
  finally { saving.value = false }
}
onMounted(load)
</script>

<template><ManagementLayout><PageShell variant="list">
  <template #header><PageHeader title="教室管理" subtitle="查看教室与班级、大屏的实际绑定关系。" eyebrow="教室与设备"><template #actions><button class="button secondary" @click="load">刷新</button><RouterLink class="button secondary" :to="{ name: 'devices' }">设备管理</RouterLink><button v-if="user.isAdmin" class="button" @click="showForm = !showForm">添加教室</button></template></PageHeader></template>
  <section v-if="showForm" class="panel form"><label>教室名称<input v-model="form.name" placeholder="如：一号教室" /></label><label>位置<input v-model="form.location" placeholder="如：一楼东侧" /></label><button class="button" :disabled="saving || !form.name.trim()" @click="createRoom">保存教室</button></section>
  <LoadingState v-if="loading" title="正在加载教室" description="正在读取教室和设备绑定。" />
  <ErrorState v-else-if="error" :description="error" @retry="load" />
  <EmptyState v-else-if="!classrooms.length" title="暂无可见教室" :description="user.isAdmin ? '添加教室后，可在设备管理中完成班级绑定。' : '你的班级目前没有已绑定教室。'" action-label="添加教室" :can-act="user.isAdmin" @action="showForm = true" />
  <section v-else class="panel cards"><article v-for="room in classrooms" :key="room.id" class="room-card"><div><small>{{ room.location || '未填写位置' }}</small><h2>{{ room.name }}</h2><p><span :class="['state', room.status]">{{ room.status === 'active' ? '启用' : '停用' }}</span> 已绑定 {{ room.bindingCount ?? room.bindings?.length ?? 0 }} 台 · 在线 {{ room.onlineDeviceCount ?? 0 }} 台</p></div><div class="actions"><RouterLink class="button secondary" :to="{ name: 'classroom-detail', params: { classroomId: room.id } }">查看详情</RouterLink><button v-if="user.isAdmin" class="link" @click="pendingStatus = room">{{ room.status === 'active' ? '停用' : '恢复' }}</button></div></article></section>
</PageShell><ConfirmDialog :model-value="Boolean(pendingStatus)" :title="pendingStatus?.status === 'active' ? '停用教室' : '恢复教室'" :message="pendingStatus?.status === 'active' ? '停用后该教室不能用于新课堂。已有绑定会保留。' : '恢复后可继续用于设备绑定和课堂。'" :confirm-label="pendingStatus?.status === 'active' ? '确认停用' : '确认恢复'" :danger="pendingStatus?.status === 'active'" :busy="saving" @update:model-value="(value) => { if (!value) pendingStatus = null }" @confirm="toggleStatus" /></ManagementLayout></template>

<style scoped>.button{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:0 17px;border:0;border-radius:12px;background:#e99168;color:#fff;font:inherit;font-weight:700;text-decoration:none;cursor:pointer}.button.secondary{border:1px solid #edd5c5;background:#fff;color:#a9644b}.button:disabled{opacity:.5}.panel{margin-top:20px;padding:20px;border:1px solid #f0ddce;border-radius:18px;background:#fffdf9}.form{display:flex;align-items:end;gap:12px;flex-wrap:wrap}.form label{display:grid;gap:6px;color:#765d51}.form input{height:40px;padding:0 10px;border:1px solid #efd9c8;border-radius:10px}.cards{display:grid;gap:12px}.room-card{display:flex;justify-content:space-between;align-items:center;gap:18px;padding:18px;border:1px solid #f2e2d6;border-radius:15px;background:#fff}.room-card h2{margin:5px 0;color:#60483e}.room-card p,.room-card small{margin:0;color:#8e786c}.state{display:inline-flex;padding:3px 8px;border-radius:99px;background:#def3e7;color:#26734e}.state.disabled{background:#ffe0dc;color:#a13c35}.actions{display:flex;gap:10px;align-items:center}.link{border:0;background:none;color:#c65f4f;cursor:pointer}@media(max-width:650px){.room-card{align-items:flex-start;flex-direction:column}}</style>
