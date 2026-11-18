<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import MobilePairingPanel from '@/components/classroom/MobilePairingPanel.vue'
import ManagementLayout from '@/components/ManagementLayout.vue'
import { platformApi, type ClassDeviceBinding, type SchoolClass } from '@/api/platform'
import { apiErrorMessage } from '@/api/http'

const classes = ref<SchoolClass[]>([])
const bindings = ref<ClassDeviceBinding[]>([])
const classId = ref(0)
const classroomId = ref(0)
const deviceId = ref(0)





const error = ref('')
let bindingRead = 0



const selectedBinding = computed(() =>
  bindings.value.find(
    (item) => item.classroomId === classroomId.value && item.deviceId === deviceId.value,
  ),
)
const canCreate = computed(() =>
  Boolean(classId.value && classroomId.value && deviceId.value && selectedBinding.value),
)

async function loadClasses() {
  error.value = ''
  try {
    const response = await platformApi.classes()
    classes.value = response.data.items
  } catch (cause) {
    error.value = apiErrorMessage(cause, '无法加载班级信息。')
  }
}

async function loadBindings(value: number) {
  const current = ++bindingRead
  bindings.value = []
  classroomId.value = 0
  deviceId.value = 0

  if (!value) return
  try {
    const response = await platformApi.classDeviceBindings(value)
    if (current !== bindingRead || value !== classId.value) return
    bindings.value = response.data.filter((item) => item.device?.type === 'classroom_screen')
  } catch (cause) {
    error.value = apiErrorMessage(cause, '无法加载该班级绑定的大屏。')
  }
}

async function refreshDeviceList() {
  await loadClasses()
  const selectedClass = classId.value
  if (!selectedClass) return
  try {
    const response = await platformApi.classDeviceBindings(selectedClass)
    if (selectedClass === classId.value) bindings.value = response.data.filter(item => item.device?.type === 'classroom_screen')
  } catch (cause) {
    error.value = apiErrorMessage(cause, '设备状态刷新失败，请重试。')
  }
}

watch(classId, (value) => void loadBindings(value))
watch(classroomId, () => {
  deviceId.value = 0

})
onMounted(() => void loadClasses())
</script>

<template>
  <ManagementLayout>
    <main class="scan-page">
      <header>
        <div>
          <p class="eyebrow">教师扫码配对</p>
          <h1>课堂设备准备</h1>
          <p class="muted">选择已绑定的大屏，生成两分钟内有效的一次性二维码。</p>
        </div>
        <button class="button secondary" type="button" @click="refreshDeviceList">刷新设备</button>
      </header>

      <section class="panel scan-form">
        <label>
          班级
          <select v-model.number="classId">
            <option :value="0">请选择班级</option>
            <option v-for="item in classes" :key="item.id" :value="item.id">{{ item.name }}</option>
          </select>
        </label>
        <label>
          教室
          <select v-model.number="classroomId" :disabled="!classId">
            <option :value="0">请选择教室</option>
            <option v-for="item in bindings" :key="item.id" :value="item.classroomId">
              {{ item.classroom?.name || `教室 ${item.classroomId}` }}
            </option>
          </select>
        </label>
        <label>
          大屏设备
          <select v-model.number="deviceId" :disabled="!classroomId">
            <option :value="0">请选择设备</option>
            <option
              v-for="item in bindings.filter((binding) => binding.classroomId === classroomId)"
              :key="item.deviceId"
              :value="item.deviceId"
              :disabled="item.device?.status === 'disabled' || item.device?.status === 'fault'"
            >
              {{ item.device?.name || `设备 ${item.deviceId}` }}（{{ item.device?.status || '未知' }}）
            </option>
          </select>
        </label>
        <p v-if="error" class="bad">{{ error }}</p>
        <p v-if="deviceId" class="device-hint">本页只生成配对二维码，不维持设备在线。请在教室大屏打开
          <a :href="`/classroom/screen/${deviceId}`" target="_blank" rel="noopener">正式课堂大屏页面</a>，由设备会话心跳证明在线。
        </p>

        <MobilePairingPanel v-if="canCreate" :key="`${classId}:${classroomId}:${deviceId}`" :class-id="classId" :classroom-id="classroomId" :device-id="deviceId" />
      </section>
    </main>
  </ManagementLayout>
</template>

<style scoped>
.scan-page{max-width:980px;margin:auto;color:#60483e}.scan-page header{display:flex;justify-content:space-between;align-items:end;gap:20px}.eyebrow{margin:0;color:#d17859;font-weight:800}.scan-page h1{margin:6px 0 8px;font-size:40px}.muted{margin:0;color:#927b6e}.panel{margin-top:22px;padding:24px;border:1px solid #efddcf;border-radius:20px;background:#fffdf9;box-shadow:0 12px 30px #a46e4d16}.scan-form{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.scan-form label{display:grid;gap:7px;font-weight:700}.scan-form select{height:44px;border:1px solid #efd9c8;background:#fff;border-radius:11px;padding:0 11px}.button{min-height:44px;border:0;border-radius:12px;padding:0 20px;background:#e99168;color:#fff;font:inherit;font-weight:700;cursor:pointer}.button:disabled{cursor:not-allowed;opacity:.5}.secondary{background:#fff1e7;color:#a9644b}.scan-form>.button,.bad,.ticket{grid-column:1/-1}.bad{margin:0;color:#bd4747}.ticket{display:grid;grid-template-columns:minmax(220px,340px) 1fr;gap:28px;align-items:center;margin-top:8px;padding:24px;border-radius:18px;background:#edf9f4;color:#347b69}.qr-shell{display:grid;place-items:center;padding:14px;border-radius:16px;background:#fff}.qr-shell img{display:block;width:min(100%,320px);height:auto}.ticket-copy{display:grid;gap:12px}.ticket-copy strong{font-size:24px}.ticket-copy p{margin:0;line-height:1.7}.ticket-copy small{font-size:16px;font-weight:800}.secure{color:#658277;font-size:13px}.ticket-copy .button{justify-self:start}@media(max-width:720px){.scan-page header{align-items:flex-start;flex-direction:column}.scan-form{grid-template-columns:1fr}.ticket{grid-template-columns:1fr}.scan-page h1{font-size:32px}}
.network-hint{padding:10px 12px;border-radius:10px;background:#fff3da;color:#9a642a;font-size:13px;line-height:1.5}
.device-hint{grid-column:1/-1;color:var(--app-muted);line-height:1.6}.device-hint a{color:var(--app-primary-dark)}
</style>

<style scoped>.scan-form :deep(.pairing-panel){grid-column:1 / -1}</style>
