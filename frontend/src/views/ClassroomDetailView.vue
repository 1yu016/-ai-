<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import ManagementLayout from '@/components/ManagementLayout.vue'
import PageShell from '@/components/PageShell.vue'
import PageHeader from '@/components/PageHeader.vue'
import LoadingState from '@/components/LoadingState.vue'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import DeviceStatusBadge from '@/components/DeviceStatusBadge.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { platformApi, type Classroom, type ClassroomBindingSummary } from '@/api/platform'
import { apiErrorMessage } from '@/api/http'
import { useUserStore } from '@/stores/user'

const route = useRoute(); const user = useUserStore()
const room = ref<Classroom | null>(null); const loading = ref(true); const saving = ref(false); const error = ref(''); const pending = ref<ClassroomBindingSummary | null>(null)
async function load() { loading.value = true; error.value = ''; try { room.value = (await platformApi.classroomDetail(Number(route.params.classroomId))).data } catch (cause) { error.value = apiErrorMessage(cause, '教室详情加载失败。') } finally { loading.value = false } }
async function unbind() { if (!pending.value) return; saving.value = true; try { await platformApi.unbindDevice(pending.value.id); pending.value = null; await load() } catch (cause) { error.value = apiErrorMessage(cause, '解除绑定失败。') } finally { saving.value = false } }
function formatTime(value: string | null) { return value ? new Date(value).toLocaleString() : '尚未上报' }
onMounted(load)
</script>
<template><ManagementLayout><PageShell variant="detail"><template #header><PageHeader :title="room?.name || '教室详情'" :subtitle="room?.location || '未填写位置'" eyebrow="教室详情" :back-to="{ name: 'classrooms' }" back-label="返回教室列表"><template #actions><button class="button secondary" @click="load">刷新状态</button></template></PageHeader></template><LoadingState v-if="loading" /><ErrorState v-else-if="error" :description="error" @retry="load" /><template v-else-if="room"><section class="panel summary"><div><span>教室状态</span><strong>{{ room.status === 'active' ? '启用' : '停用' }}</strong></div><div><span>绑定设备</span><strong>{{ room.bindings?.length ?? 0 }} 台</strong></div><div><span>在线设备</span><strong>{{ room.onlineDeviceCount ?? 0 }} 台</strong></div></section><section class="panel"><h2>班级与设备绑定</h2><EmptyState v-if="!room.bindings?.length" title="暂无绑定" description="管理员可前往设备管理，将设备、教室和班级绑定。" action-label="前往设备管理" @action="$router.push({ name: 'devices' })" /><div v-else class="bindings"><article v-for="binding in room.bindings" :key="binding.id"><div><strong>{{ binding.className || '未知班级' }}</strong><p v-if="binding.device"><RouterLink :to="{ name: 'device-detail', params: { deviceId: binding.device.id } }">{{ binding.device.name }}</RouterLink> · {{ binding.device.deviceCode }}</p></div><div><DeviceStatusBadge v-if="binding.device" :status="binding.device.status" :bound="true" /><small>{{ formatTime(binding.device?.lastOnlineAt ?? null) }}</small><button v-if="user.isAdmin" class="link danger" @click="pending = binding">解除绑定</button></div></article></div></section></template></PageShell><ConfirmDialog :model-value="Boolean(pending)" title="解除设备绑定" message="解除后，该班级的课堂准备页不再显示这台设备。" confirm-label="确认解绑" danger :busy="saving" @update:model-value="(value) => { if (!value) pending = null }" @confirm="unbind" /></ManagementLayout></template>
<style scoped>.button{min-height:42px;padding:0 16px;border:0;border-radius:12px;background:#e99168;color:#fff;font:inherit;cursor:pointer}.button.secondary{border:1px solid #edd5c5;background:#fff;color:#a9644b}.panel{margin-top:20px;padding:20px;border:1px solid #f0ddce;border-radius:18px;background:#fffdf9}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.summary div{display:grid;gap:6px;padding:16px;border-radius:14px;background:#fff5ea}.summary span{color:#9b7d6c}.summary strong{font-size:22px;color:#60483e}.panel h2{margin:0 0 14px;color:#60483e}.bindings{display:grid;gap:10px}.bindings article{display:flex;justify-content:space-between;gap:18px;padding:15px;border:1px solid #f1e2d7;border-radius:14px}.bindings p{margin:5px 0 0}.bindings a,.link{border:0;background:none;color:#bd674b;text-decoration:none;cursor:pointer}.bindings small{display:block;margin:5px 0;color:#90776a}.danger{color:#c44949}@media(max-width:650px){.summary{grid-template-columns:1fr}.bindings article{flex-direction:column}}</style>
