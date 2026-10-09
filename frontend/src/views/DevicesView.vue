<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import ManagementLayout from '@/components/ManagementLayout.vue'
import { platformApi, type Classroom, type Device, type SchoolClass } from '@/api/platform'
import { apiErrorMessage } from '@/api/http'

const devices = ref<Device[]>([])
const classrooms = ref<Classroom[]>([])
const classes = ref<SchoolClass[]>([])
const loading = ref(true)
const error = ref('')
const mode = ref<'room' | 'device' | 'binding' | ''>('')
const saving = ref(false)
const roomForm = ref({ name: '', location: '' })
const deviceForm = ref({ deviceCode: '', name: '', type: 'classroom_screen' })
const bindingForm = ref({ deviceId: '', classroomId: '', classId: '' })

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [deviceResult, classroomResult, classResult] = await Promise.all([
      platformApi.devices(),
      platformApi.classrooms(),
      platformApi.classes(),
    ])
    devices.value = deviceResult.data
    classrooms.value = classroomResult.data
    classes.value = classResult.data.items
  } catch (cause) {
    error.value = apiErrorMessage(cause, '教室、设备或班级加载失败，请检查登录状态后重试。')
  } finally {
    loading.value = false
  }
}

async function createRoom() {
  if (!roomForm.value.name.trim()) return
  saving.value = true
  try {
    await platformApi.createClassroom({
      name: roomForm.value.name.trim(),
      location: roomForm.value.location.trim() || undefined,
    })
    roomForm.value = { name: '', location: '' }
    mode.value = ''
    ElMessage.success('教室添加成功')
    await load()
  } catch (cause) {
    ElMessage.error(apiErrorMessage(cause, '教室添加失败'))
  } finally {
    saving.value = false
  }
}

async function createDevice() {
  if (!deviceForm.value.deviceCode.trim() || !deviceForm.value.name.trim()) return
  saving.value = true
  try {
    await platformApi.createDevice({
      ...deviceForm.value,
      deviceCode: deviceForm.value.deviceCode.trim(),
      name: deviceForm.value.name.trim(),
    })
    deviceForm.value = { deviceCode: '', name: '', type: 'classroom_screen' }
    mode.value = ''
    ElMessage.success('设备添加成功')
    await load()
  } catch (cause) {
    ElMessage.error(apiErrorMessage(cause, '设备添加失败，请检查设备编码是否重复。'))
  } finally {
    saving.value = false
  }
}

async function bindDevice() {
  if (!bindingForm.value.deviceId || !bindingForm.value.classroomId || !bindingForm.value.classId) return
  saving.value = true
  try {
    await platformApi.bindDevice({
      deviceId: Number(bindingForm.value.deviceId),
      classroomId: Number(bindingForm.value.classroomId),
      classId: Number(bindingForm.value.classId),
    })
    bindingForm.value = { deviceId: '', classroomId: '', classId: '' }
    mode.value = ''
    ElMessage.success('设备绑定成功')
    await load()
  } catch (cause) {
    ElMessage.error(apiErrorMessage(cause, '设备绑定失败，请检查设备是否已有其他绑定。'))
  } finally {
    saving.value = false
  }
}

async function toggleDisabled(device: Device) {
  const disabling = device.status !== 'disabled'
  try {
    await ElMessageBox.confirm(
      disabling ? '停用后该设备不能生成课堂二维码或参与课堂，确定停用吗？' : '确定重新启用该设备吗？',
      disabling ? '停用设备' : '启用设备',
      { type: disabling ? 'warning' : 'info' },
    )
  } catch {
    return
  }
  try {
    await platformApi.updateDevice(device.id, { status: disabling ? 'disabled' : 'offline' })
    ElMessage.success(disabling ? '设备已停用' : '设备已启用，等待下一次心跳上线')
    await load()
  } catch (cause) {
    ElMessage.error(apiErrorMessage(cause, '设备状态更新失败'))
  }
}

function statusText(value: string) {
  return value === 'online' ? '在线' : value === 'fault' ? '故障' : value === 'disabled' ? '停用' : '离线'
}
function deviceType(value: string) {
  return value === 'classroom_screen' ? '课堂大屏' : value === 'teacher_tablet' ? '教师平板' : value === 'teacher_phone' ? '教师手机' : '其他'
}
function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : '暂无心跳'
}

onMounted(load)
</script>

<template>
  <ManagementLayout>
    <main class="page">
      <header>
        <div><h1>教室与设备</h1><p>维护教室、大屏设备、班级绑定和在线状态。</p></div>
        <div class="toolbar">
          <button class="button secondary" @click="load">刷新</button>
          <button class="button" @click="mode = mode === 'room' ? '' : 'room'">{{ mode === 'room' ? '取消' : '添加教室' }}</button>
          <button class="button" @click="mode = mode === 'device' ? '' : 'device'">{{ mode === 'device' ? '取消' : '添加设备' }}</button>
          <button class="button" @click="mode = mode === 'binding' ? '' : 'binding'">{{ mode === 'binding' ? '取消' : '绑定设备' }}</button>
        </div>
      </header>

      <section v-if="mode === 'room'" class="panel form">
        <label>教室名称<input v-model="roomForm.name" placeholder="如：一号教室" /></label>
        <label>位置<input v-model="roomForm.location" placeholder="如：一楼东侧" /></label>
        <button class="button" :disabled="saving || !roomForm.name.trim()" @click="createRoom">保存教室</button>
      </section>
      <section v-if="mode === 'device'" class="panel form">
        <label>设备编码<input v-model="deviceForm.deviceCode" placeholder="设备唯一编码" /></label>
        <label>设备名称<input v-model="deviceForm.name" placeholder="如：一号教室大屏" /></label>
        <label>设备类型<select v-model="deviceForm.type"><option value="classroom_screen">教室大屏</option><option value="teacher_tablet">教师平板</option><option value="teacher_phone">教师手机</option></select></label>
        <button class="button" :disabled="saving || !deviceForm.deviceCode.trim() || !deviceForm.name.trim()" @click="createDevice">保存设备</button>
      </section>
      <section v-if="mode === 'binding'" class="panel form">
        <label>设备<select v-model="bindingForm.deviceId"><option value="">请选择设备</option><option v-for="item in devices" :key="item.id" :value="String(item.id)" :disabled="Boolean(item.binding)">{{ item.name }}{{ item.binding ? '（已绑定）' : '' }}</option></select></label>
        <label>教室<select v-model="bindingForm.classroomId"><option value="">请选择教室</option><option v-for="item in classrooms" :key="item.id" :value="String(item.id)">{{ item.name }}</option></select></label>
        <label>班级<select v-model="bindingForm.classId"><option value="">请选择班级</option><option v-for="item in classes" :key="item.id" :value="String(item.id)">{{ item.name }}</option></select></label>
        <button class="button" :disabled="saving || !bindingForm.deviceId || !bindingForm.classroomId || !bindingForm.classId" @click="bindDevice">保存绑定</button>
      </section>

      <div class="summary"><span>教室 {{ classrooms.length }}</span><span>设备 {{ devices.length }}</span><span>在线 {{ devices.filter((item) => item.online).length }}</span></div>
      <section v-if="loading" class="panel">正在加载教室和设备…</section>
      <section v-else-if="error" class="panel bad">{{ error }} <button class="link" @click="load">重试</button></section>
      <template v-else>
        <section class="panel">
          <h2>教室</h2>
          <p v-if="!classrooms.length" class="muted">暂无教室，请先添加。</p>
          <div v-else class="table-wrap"><table class="table"><thead><tr><th>名称</th><th>位置</th><th>状态</th></tr></thead><tbody><tr v-for="item in classrooms" :key="item.id"><td>{{ item.name }}</td><td>{{ item.location || '—' }}</td><td>{{ item.status === 'active' ? '启用' : '停用' }}</td></tr></tbody></table></div>
        </section>
        <section class="panel">
          <h2>设备与绑定</h2>
          <p v-if="!devices.length" class="muted">暂无设备，请先添加。</p>
          <div v-else class="table-wrap"><table class="table"><thead><tr><th>设备</th><th>编码</th><th>类型</th><th>教室</th><th>班级</th><th>在线状态</th><th>最后心跳</th><th>停用状态</th><th>操作</th></tr></thead><tbody><tr v-for="item in devices" :key="item.id"><td>{{ item.name }}</td><td>{{ item.deviceCode }}</td><td>{{ deviceType(item.type) }}</td><td>{{ item.binding?.classroomName || '未绑定' }}</td><td>{{ item.binding?.className || '未绑定' }}</td><td><span class="state-pill" :class="item.status">{{ statusText(item.status) }}</span></td><td>{{ formatTime(item.lastOnlineAt) }}</td><td>{{ item.status === 'disabled' ? '已停用' : '可用' }}</td><td><button class="link" @click="toggleDisabled(item)">{{ item.status === 'disabled' ? '启用' : '停用' }}</button></td></tr></tbody></table></div>
        </section>
      </template>
    </main>
  </ManagementLayout>
</template>

<style scoped>
.page{max-width:1280px;margin:auto}.page header{display:flex;justify-content:space-between;align-items:flex-end;gap:18px}.page h1{margin:0 0 8px;color:#60483e;font-size:40px}.page p{margin:0;color:#9a7e6e}.toolbar{display:flex;gap:10px;flex-wrap:wrap}.button{border:0;border-radius:12px;padding:0 18px;min-height:42px;background:#e99168;color:#fff;font:inherit;cursor:pointer}.button.secondary{background:#fff1e7;color:#a9644b}.button:disabled{opacity:.55}.panel{margin-top:20px;padding:20px;border:1px solid #f0ddce;border-radius:18px;background:#fffdf9;box-shadow:0 10px 28px #b9795114}.form{display:flex;align-items:end;gap:12px;flex-wrap:wrap}.form label{display:grid;gap:6px;color:#876b5d;font-size:13px}.form input,.form select{height:40px;min-width:180px;border:1px solid #efd9c8;border-radius:10px;padding:0 10px;background:#fffdf9}.summary{display:flex;gap:14px;margin-top:18px}.summary span{padding:10px 15px;border-radius:12px;background:#fff0e4;color:#a9654c}.table-wrap{overflow:auto}.table{width:100%;min-width:980px;border-collapse:collapse;color:#60483e}.table th,.table td{text-align:left;padding:13px 10px;border-bottom:1px solid #f4e6dc;white-space:nowrap}.link{border:0;background:none;color:#d67b59;cursor:pointer}.bad{color:#c64e4e}.muted{color:#9a7e6e}.panel h2{margin:0 0 12px;color:#60483e}.state-pill{display:inline-flex;padding:4px 9px;border-radius:999px;background:#eee;color:#655}.state-pill.online{background:#def3e7;color:#26734e}.state-pill.offline{background:#f0f0f0;color:#686868}.state-pill.disabled,.state-pill.fault{background:#ffe0dc;color:#a13c35}@media(max-width:850px){.page header{align-items:flex-start;flex-direction:column}}
</style>
