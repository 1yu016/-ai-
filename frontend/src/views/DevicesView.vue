<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import ManagementLayout from '@/components/ManagementLayout.vue'
import PageShell from '@/components/PageShell.vue'
import PageHeader from '@/components/PageHeader.vue'
import LoadingState from '@/components/LoadingState.vue'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import DeviceStatusBadge from '@/components/DeviceStatusBadge.vue'
import { platformApi, type Classroom, type Device, type SchoolClass } from '@/api/platform'
import { apiErrorMessage } from '@/api/http'
import { useUserStore } from '@/stores/user'

const user = useUserStore()
const devices = ref<Device[]>([])
const classrooms = ref<Classroom[]>([])
const classes = ref<SchoolClass[]>([])
const loading = ref(true)
const error = ref('')
const formMode = ref<'device' | 'binding' | null>(null)
const saving = ref(false)
const pendingUnbind = ref<Device | null>(null)
const pendingStatus = ref<Device | null>(null)
const deviceForm = ref({ deviceCode: '', name: '', type: 'classroom_screen' })
const bindingForm = ref({ deviceId: '', classroomId: '', classId: '' })

const onlineCount = computed(() => devices.value.filter((device) => device.online).length)
const availableDevices = computed(() => devices.value.filter((device) => !device.binding && !['disabled', 'fault'].includes(device.status)))
const availableClassrooms = computed(() => classrooms.value.filter((room) => room.status === 'active'))
const availableClasses = computed(() => classes.value.filter((schoolClass) => schoolClass.status === 'active'))

async function load() {
  loading.value = true
  error.value = ''
  try {
    const requests: Promise<unknown>[] = [platformApi.listDevices()]
    if (user.isAdmin) requests.push(platformApi.listClassrooms(), platformApi.listClasses({ pageSize: 100 }))
    const [deviceResult, classroomResult, classResult] = await Promise.all(requests) as [Awaited<ReturnType<typeof platformApi.listDevices>>, Awaited<ReturnType<typeof platformApi.listClassrooms>>?, Awaited<ReturnType<typeof platformApi.listClasses>>?]
    devices.value = deviceResult.data
    classrooms.value = classroomResult?.data ?? []
    classes.value = classResult?.data.items ?? []
  } catch (cause) {
    error.value = apiErrorMessage(cause, '设备加载失败，请稍后重试。')
  } finally {
    loading.value = false
  }
}

async function createDevice() {
  if (!deviceForm.value.deviceCode.trim() || !deviceForm.value.name.trim()) return
  saving.value = true
  try {
    await platformApi.createDevice({ ...deviceForm.value, deviceCode: deviceForm.value.deviceCode.trim(), name: deviceForm.value.name.trim() })
    deviceForm.value = { deviceCode: '', name: '', type: 'classroom_screen' }
    formMode.value = null
    await load()
  } catch (cause) {
    error.value = apiErrorMessage(cause, '设备添加失败，请检查设备编码是否重复。')
  } finally { saving.value = false }
}

async function bindDevice() {
  if (!bindingForm.value.deviceId || !bindingForm.value.classroomId || !bindingForm.value.classId) return
  saving.value = true
  try {
    await platformApi.bindDevice({ deviceId: Number(bindingForm.value.deviceId), classroomId: Number(bindingForm.value.classroomId), classId: Number(bindingForm.value.classId) })
    bindingForm.value = { deviceId: '', classroomId: '', classId: '' }
    formMode.value = null
    await load()
  } catch (cause) {
    error.value = apiErrorMessage(cause, '设备绑定失败，请检查设备、教室和班级状态。')
  } finally { saving.value = false }
}

async function confirmUnbind() {
  const device = pendingUnbind.value
  if (!device?.binding) return
  saving.value = true
  try {
    await platformApi.unbindDevice(device.binding.id)
    pendingUnbind.value = null
    await load()
  } catch (cause) {
    error.value = apiErrorMessage(cause, '解除绑定失败。')
  } finally { saving.value = false }
}

async function confirmStatusChange() {
  const device = pendingStatus.value
  if (!device) return
  saving.value = true
  try {
    await platformApi.updateDevice(device.id, { status: device.status === 'disabled' ? 'offline' : 'disabled' })
    pendingStatus.value = null
    await load()
  } catch (cause) {
    error.value = apiErrorMessage(cause, '设备状态更新失败。')
  } finally { saving.value = false }
}

function formatTime(value: string | null) { return value ? new Date(value).toLocaleString() : '尚未上报' }
function deviceType(value: string) { return ({ classroom_screen: '课堂大屏', teacher_tablet: '教师平板', teacher_phone: '教师手机' } as Record<string, string>)[value] ?? '其他设备' }

onMounted(load)
</script>

<template>
  <ManagementLayout>
    <PageShell variant="wide">
      <template #header>
        <PageHeader title="设备管理" subtitle="在线状态来自设备会话心跳；打开本页面不会改变设备状态。" eyebrow="教室与设备">
          <template #actions>
            <button class="button secondary" type="button" @click="load">刷新状态</button>
            <RouterLink class="button secondary" :to="{ name: 'classrooms' }">教室管理</RouterLink>
            <template v-if="user.isAdmin">
              <button class="button" type="button" @click="formMode = formMode === 'device' ? null : 'device'">添加设备</button>
              <button class="button" type="button" @click="formMode = formMode === 'binding' ? null : 'binding'">绑定班级</button>
            </template>
          </template>
        </PageHeader>
      </template>

      <section v-if="formMode === 'device'" class="panel form-grid">
        <label>设备编码<input v-model="deviceForm.deviceCode" autocomplete="off" placeholder="设备唯一编码" /></label>
        <label>设备名称<input v-model="deviceForm.name" placeholder="如：阳光班课堂大屏" /></label>
        <label>设备类型<select v-model="deviceForm.type"><option value="classroom_screen">课堂大屏</option><option value="teacher_tablet">教师平板</option><option value="teacher_phone">教师手机</option></select></label>
        <button class="button" type="button" :disabled="saving || !deviceForm.deviceCode.trim() || !deviceForm.name.trim()" @click="createDevice">保存设备</button>
      </section>

      <section v-if="formMode === 'binding'" class="panel form-grid">
        <label>未绑定设备<select v-model="bindingForm.deviceId"><option value="">请选择设备</option><option v-for="item in availableDevices" :key="item.id" :value="String(item.id)">{{ item.name }}（{{ item.deviceCode }}）</option></select></label>
        <label>启用教室<select v-model="bindingForm.classroomId"><option value="">请选择教室</option><option v-for="item in availableClassrooms" :key="item.id" :value="String(item.id)">{{ item.name }}</option></select></label>
        <label>启用班级<select v-model="bindingForm.classId"><option value="">请选择班级</option><option v-for="item in availableClasses" :key="item.id" :value="String(item.id)">{{ item.name }}</option></select></label>
        <button class="button" type="button" :disabled="saving || !bindingForm.deviceId || !bindingForm.classroomId || !bindingForm.classId" @click="bindDevice">保存绑定</button>
      </section>

      <div class="summary"><span>设备 {{ devices.length }}</span><span>在线 {{ onlineCount }}</span><span>已绑定 {{ devices.filter((item) => item.binding).length }}</span></div>
      <LoadingState v-if="loading" title="正在加载设备" description="正在读取后端设备会话和最近心跳。" />
      <ErrorState v-else-if="error" :description="error" @retry="load" />
      <EmptyState v-else-if="!devices.length" title="暂无设备" :description="user.isAdmin ? '添加首台设备后，可将它绑定到教室和班级。' : '你的班级目前没有已绑定设备。'" action-label="添加设备" :can-act="user.isAdmin" @action="formMode = 'device'" />
      <section v-else class="panel table-wrap">
        <table><thead><tr><th>设备</th><th>设备码</th><th>类型</th><th>连接</th><th>绑定</th><th>最近心跳</th><th>操作</th></tr></thead>
          <tbody><tr v-for="item in devices" :key="item.id">
            <td><RouterLink class="row-link" :to="{ name: 'device-detail', params: { deviceId: item.id } }">{{ item.name }}</RouterLink></td>
            <td><code>{{ item.deviceCode }}</code></td><td>{{ deviceType(item.type) }}</td>
            <td><DeviceStatusBadge :status="item.status" /></td>
            <td><DeviceStatusBadge :status="item.status" :bound="Boolean(item.binding)" /><small v-if="item.binding">{{ item.binding.classroomName }} · {{ item.binding.className }}</small></td>
            <td>{{ formatTime(item.lastOnlineAt) }}</td>
            <td class="actions"><RouterLink class="link" :to="{ name: 'device-detail', params: { deviceId: item.id } }">详情/设备码</RouterLink><button v-if="user.isAdmin && item.binding" class="link danger" type="button" @click="pendingUnbind = item">解除绑定</button><button v-if="user.isAdmin" class="link" type="button" @click="pendingStatus = item">{{ item.status === 'disabled' ? '启用' : '停用' }}</button></td>
          </tr></tbody>
        </table>
      </section>
    </PageShell>
    <ConfirmDialog :model-value="Boolean(pendingUnbind)" title="解除设备绑定" :message="`解除后，课堂准备页将不能再选择「${pendingUnbind?.name ?? ''}」。`" confirm-label="确认解绑" danger :busy="saving" @update:model-value="(value) => { if (!value) pendingUnbind = null }" @confirm="confirmUnbind" />
    <ConfirmDialog :model-value="Boolean(pendingStatus)" :title="pendingStatus?.status === 'disabled' ? '启用设备' : '停用设备'" :message="pendingStatus?.status === 'disabled' ? '启用后仍需等待设备重新发送心跳才会显示在线。' : '停用后该设备不能参与新课堂。'" :confirm-label="pendingStatus?.status === 'disabled' ? '确认启用' : '确认停用'" :danger="pendingStatus?.status !== 'disabled'" :busy="saving" @update:model-value="(value) => { if (!value) pendingStatus = null }" @confirm="confirmStatusChange" />
  </ManagementLayout>
</template>

<style scoped>
.button{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:0 17px;border:0;border-radius:12px;background:#e99168;color:#fff;font:inherit;font-weight:700;text-decoration:none;cursor:pointer}.button.secondary{border:1px solid #edd5c5;background:#fff;color:#a9644b}.button:disabled{opacity:.5;cursor:not-allowed}.panel{margin-top:20px;padding:20px;border:1px solid #f0ddce;border-radius:18px;background:#fffdf9;box-shadow:0 10px 28px #b9795114}.form-grid{display:grid;grid-template-columns:repeat(3,minmax(180px,1fr)) auto;gap:12px;align-items:end}.form-grid label{display:grid;gap:7px;color:#765d51;font-size:13px}.form-grid input,.form-grid select{box-sizing:border-box;width:100%;height:42px;padding:0 11px;border:1px solid #efd9c8;border-radius:10px;background:#fff}.summary{display:flex;gap:12px;margin-top:20px;flex-wrap:wrap}.summary span{padding:10px 15px;border-radius:12px;background:#fff0e4;color:#9a6049}.table-wrap{overflow:auto}table{width:100%;min-width:1040px;border-collapse:collapse;color:#60483e}th,td{padding:13px 10px;border-bottom:1px solid #f4e6dc;text-align:left;vertical-align:middle}td small{display:block;margin-top:6px;color:#8e786c}.row-link,.link{border:0;background:none;color:#bd674b;text-decoration:none;cursor:pointer}.row-link{font-weight:800}.actions{white-space:nowrap}.actions>*{margin-right:10px}.danger{color:#c44949}code{font-family:ui-monospace,monospace;color:#685348}@media(max-width:900px){.form-grid{grid-template-columns:1fr 1fr}}@media(max-width:620px){.form-grid{grid-template-columns:1fr}}
</style>
