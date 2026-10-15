<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import ManagementLayout from '@/components/ManagementLayout.vue'
import StudentAuthorizationBadge from '@/components/StudentAuthorizationBadge.vue'
import StudentAvatar from '@/components/StudentAvatar.vue'
import StudentImportPanel from '@/components/StudentImportPanel.vue'
import { platformApi, type SchoolClass, type Student } from '@/api/platform'
import { withNavigationSource } from '@/router/navigation'
import { studentDisplayName, studentStatusLabel } from '@/utils/student'

type StudentRow = Student & { className: string }

type ClassState = {
  class: SchoolClass
  status: 'loading' | 'success' | 'empty' | 'error'
  students: StudentRow[]
  errorMessage: string
  timedOut: boolean
}

const TIMEOUT_MS = 10000

const route = useRoute()
const router = useRouter()
const pageLoading = ref(true)
const classesError = ref('')
const classes = ref<SchoolClass[]>([])
const classStates = ref<ClassState[]>([])
const query = ref('')
const classFilter = ref('all')
const statusFilter = ref<'active' | 'all' | 'disabled'>('active')
const adding = ref(false)
const saving = ref(false)
const form = ref({ classId: '', studentNo: '', name: '', nickname: '' })
const importing = ref(false)
const importClassId = ref('')
const classCount = computed(() => Array.isArray(classes.value) ? classes.value.length : 0)

function makeState(schoolClass: SchoolClass): ClassState {
  return { class: schoolClass, status: 'loading', students: [], errorMessage: '', timedOut: false }
}

async function loadClass(cs: ClassState) {
  cs.status = 'loading'
  cs.students = []
  cs.errorMessage = ''
  cs.timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      platformApi.students({
        classId: cs.class.id,
        page: 1,
        pageSize: 100,
        keyword: query.value.trim() || undefined,
        status: statusFilter.value === 'all' ? undefined : statusFilter.value,
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)
      }),
    ])
    if (timer) clearTimeout(timer)
    cs.students = result.data.items.map((student) => ({ ...student, className: cs.class.name }))
    cs.status = cs.students.length ? 'success' : 'empty'
  } catch (err) {
    if (timer) clearTimeout(timer)
    cs.status = 'error'
    cs.timedOut = err instanceof Error && err.message === 'timeout'
    cs.errorMessage = cs.timedOut
      ? '该班级学生加载超时（超过10秒），请重试。'
      : '学生数据加载失败，请检查登录状态或稍后重试。'
  }
}

async function loadClasses() {
  pageLoading.value = true
  classesError.value = ''
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      platformApi.classes(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS) }),
    ])
    if (timer) clearTimeout(timer)
    classes.value = result.data.items
    classStates.value = classes.value.map(makeState)
    // 每个班级独立加载，单个班级失败不影响其他班级
    classStates.value.forEach((cs) => void loadClass(cs))
  } catch (err) {
    if (timer) clearTimeout(timer)
    classesError.value = err instanceof Error && err.message === 'timeout'
      ? '班级列表加载超时，请确认后端服务已启动后重试。'
      : '学生数据加载失败，请检查登录状态或稍后重试。'
  } finally {
    pageLoading.value = false
  }
}

onMounted(loadClasses)

function matches(item: StudentRow): boolean {
  const q = query.value.trim().toLowerCase()
  if (!q) return true
  return `${item.name} ${item.nickname ?? ''} ${item.studentNo}`.toLowerCase().includes(q)
}

function sectionRows(cs: ClassState): StudentRow[] {
  if (classFilter.value !== 'all' && String(cs.class.id) !== classFilter.value) return []
  return cs.students.filter((item) => {
    if (statusFilter.value === 'active' && item.status !== 'active') return false
    if (statusFilter.value === 'disabled' && item.status !== 'disabled') return false
    return matches(item)
  })
}

const filteredCount = computed(() =>
  classStates.value.reduce((sum, cs) => sum + sectionRows(cs).length, 0),
)
const loadedStudentCount = computed(() =>
  classStates.value.reduce((sum, cs) => sum + cs.students.length, 0),
)

async function toggleStatus(row: StudentRow) {
  const disabling = row.status === 'active'
  const action = disabling ? '停用' : '恢复'
  try {
    await ElMessageBox.confirm(
      disabling
        ? '停用后，该学生不会出现在默认学生列表中，但历史课堂记录会保留。'
        : '恢复后，该学生将重新出现在默认学生列表中。',
      `${action}学生`,
      { confirmButtonText: action, cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return
  }
  await platformApi.updateStudent(row.id, { status: disabling ? 'disabled' : 'active' })
  ElMessage.success(`${action}成功`)
  const cs = classStates.value.find((item) => item.class.id === row.classId)
  if (cs) await loadClass(cs)
}

async function createStudent() {
  if (!form.value.classId || !form.value.studentNo.trim() || !form.value.name.trim()) return
  saving.value = true
  try {
    await platformApi.createStudent({
      classId: Number(form.value.classId),
      studentNo: form.value.studentNo.trim(),
      name: form.value.name.trim(),
      nickname: form.value.nickname.trim() || undefined,
    })
    form.value = { classId: '', studentNo: '', name: '', nickname: '' }
    adding.value = false
    ElMessage.success('学生添加成功')
    await loadClasses()
  } catch {
    ElMessage.error('添加学生失败，请检查学号是否重复或权限是否足够。')
  } finally {
    saving.value = false
  }
}

function toggleImport() {
  importing.value = !importing.value
  adding.value = false
  if (importing.value && !importClassId.value) {
    importClassId.value = classFilter.value !== 'all' ? classFilter.value : String(classes.value[0]?.id ?? '')
  }
}

async function importedStudents() {
  await loadClasses()
}
function openStudent(item: StudentRow): void {
  void router.push(withNavigationSource({ name: 'student-profile', params: { classId: item.classId, studentId: item.id } }, route))
}
</script>

<template>
  <ManagementLayout>
    <div class="management-page">
    <h1>学生管理中心</h1>
    <p class="muted">统一定位各班学生，添加、编辑、停用与恢复都由此处完成。</p>

    <div class="toolbar">
      <input v-model="query" placeholder="搜索姓名、昵称或学号" />
      <select v-model="classFilter">
        <option value="all">全部班级</option>
        <option v-for="item in classes" :key="item.id" :value="String(item.id)">{{ item.name }}</option>
      </select>
      <select v-model="statusFilter">
        <option value="active">仅在读</option>
        <option value="all">全部状态</option>
        <option value="disabled">已停用</option>
      </select>
      <button class="button" @click="loadClasses">查询</button>
      <button class="button" @click="adding = !adding; importing = false">{{ adding ? '取消添加' : '添加学生' }}</button>
      <button class="button" :disabled="!classes.length" @click="toggleImport">{{ importing ? '关闭导入' : '表格导入' }}</button>
    </div>

    <div v-if="adding" class="panel add-form">
      <label>所属班级<select v-model="form.classId"><option value="">请选择班级</option><option v-for="item in classes" :key="item.id" :value="String(item.id)">{{ item.name }}</option></select></label>
      <label>学号<input v-model="form.studentNo" maxlength="64" placeholder="请输入学号" /></label>
      <label>姓名<input v-model="form.name" maxlength="100" placeholder="请输入姓名" /></label>
      <label>昵称（可选）<input v-model="form.nickname" maxlength="100" placeholder="请输入昵称" /></label>
      <button class="button" :disabled="saving || !form.classId || !form.studentNo.trim() || !form.name.trim()" @click="createStudent">{{ saving ? '保存中…' : '保存学生' }}</button>
    </div>

    <section v-if="importing" class="import-section">
      <label>导入班级
        <select v-model="importClassId"><option value="">请选择班级</option><option v-for="item in classes" :key="item.id" :value="String(item.id)">{{ item.name }}</option></select>
      </label>
      <StudentImportPanel
        v-if="importClassId"
        :key="importClassId"
        :class-id="Number(importClassId)"
        :class-name="classes.find((item) => String(item.id) === importClassId)?.name"
        @cancel="importing = false"
        @imported="importedStudents"
      />
    </section>

    <div class="summary">
      <span>班级 {{ classCount }}</span>
      <span>已加载学生 {{ loadedStudentCount }}</span>
      <span>当前显示 {{ filteredCount }}</span>
    </div>

    <div v-if="pageLoading" class="panel">
      <p>正在加载班级列表…</p>
    </div>
    <div v-else-if="classesError" class="panel">
      <p class="bad">{{ classesError }}</p>
      <button class="button" @click="loadClasses">重试</button>
    </div>
    <div v-else-if="!classStates.length" class="panel">
      <p class="muted">暂无班级。</p>
    </div>
    <template v-else>
      <div v-for="cs in classStates" :key="cs.class.id" class="panel class-block">
        <div class="class-head">
          <strong>{{ cs.class.name }}</strong>
          <span class="badge warn" v-if="cs.status === 'loading'">加载中…</span>
          <span class="badge ok" v-else-if="cs.status === 'success'">{{ cs.students.length }} 名学生</span>
          <span class="badge ok" v-else-if="cs.status === 'empty'">暂无学生</span>
          <span class="badge bad" v-else>加载失败</span>
          <button class="retry" v-if="cs.status === 'error' || cs.status === 'empty'" @click="loadClass(cs)">重试</button>
        </div>

        <p v-if="cs.status === 'loading'">该班级学生加载中…</p>
        <p v-else-if="cs.status === 'error'" class="bad">{{ cs.errorMessage }}</p>
        <p v-else-if="cs.status === 'empty'" class="muted">该班级暂无学生。</p>
        <div v-else-if="sectionRows(cs).length">
          <table class="table">
            <thead>
              <tr><th>头像</th><th>姓名</th><th>学号</th><th>授权状态</th><th>状态</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="item in sectionRows(cs)" :key="item.id">
                <td><StudentAvatar :student="item" /></td>
                <td>{{ studentDisplayName(item) }}<small v-if="item.nickname && item.nickname !== item.name">（{{ item.nickname }}）</small></td>
                <td>{{ item.studentNo }}</td>
                <td><StudentAuthorizationBadge :status="item.authorizationStatus" /></td>
                <td><span class="badge" :class="item.status === 'active' ? 'ok' : 'bad'">{{ studentStatusLabel(item.status) }}</span></td>
                <td class="row-actions">
                  <button @click="openStudent(item)">资料/编辑</button>
                  <button v-if="item.status === 'active'" @click="toggleStatus(item)">停用</button>
                  <button v-else @click="toggleStatus(item)">恢复</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="muted">当前筛选条件下无匹配学生。</p>
      </div>
    </template>
    </div>
  </ManagementLayout>
</template>

<style scoped>
.management-page { max-width: 1180px; margin: 0 auto }
.management-page h1 { margin: 0 0 8px; color: #60483e; font-size: clamp(30px, 4vw, 44px); line-height: 1.2 }
.management-page .muted { margin: 0; color: #9a7e6e; font-size: 16px }
.toolbar { display: flex; flex-wrap: wrap; gap: 10px; margin: 24px 0 16px }
.toolbar input, .toolbar select { min-width: 150px; height: 42px; box-sizing: border-box; border: 1px solid #ecd8c9; border-radius: 12px; padding: 0 13px; background: #fffdf9; color: #60483e; font: inherit; outline: none }
.toolbar input { flex: 1; min-width: 240px }
.toolbar input:focus, .toolbar select:focus { border-color: #e89a73; box-shadow: 0 0 0 3px #e89a7322 }
.button { border: 0; border-radius: 12px; padding: 0 18px; min-height: 42px; background: #e99168; color: #fff; font: inherit; cursor: pointer; box-shadow: 0 5px 12px #c9775420 }
.button:hover { background: #dc7f58 }
.button:disabled { cursor: not-allowed; opacity: .55 }
.panel { box-sizing: border-box; padding: 20px; border: 1px solid #f0ddce; border-radius: 18px; background: #fffdf9; box-shadow: 0 10px 28px #b9795114 }
.add-form { display: grid; grid-template-columns: 1.2fr repeat(3, 1fr) auto; align-items: end; gap: 12px; margin-bottom: 16px }
.add-form label { display: grid; gap: 6px; color: #876b5d; font-size: 13px }
.add-form input, .add-form select { height: 38px; border: 1px solid #efd9c8; border-radius: 10px; padding: 0 10px; background: #fffdf9; color: #60483e }
.import-section { display: grid; gap: 12px; margin-bottom: 16px }
.import-section > label { display: grid; grid-template-columns: 100px minmax(180px, 320px); align-items: center; gap: 10px; color: #876b5d }
.import-section > label select { height: 40px; border: 1px solid #efd9c8; border-radius: 10px; padding: 0 10px; background: #fffdf9; color: #60483e }
.hint { grid-column: 1 / -1; color: #a38270; font-size: 12px }
.summary { display: flex; gap: 14px; margin: 14px 0; color: #a38270 }
.summary span { padding: 10px 15px; background: #fff0e4; border-radius: 12px; color: #a9654c }
.class-block { margin-top: 16px }
.class-head { display: flex; align-items: center; gap: 12px; margin-bottom: 10px }
.class-head strong { font-size: 16px; color: #60483e }
.retry { border: 0; background: #fff3dc; color: #b77d20; border-radius: 10px; padding: 6px 12px; cursor: pointer }
.row-actions button { border: 0; background: none; color: #df8b62; cursor: pointer; margin-right: 10px }
.table small { color: #a38270 }
.table { width: 100%; border-collapse: collapse; color: #60483e }
.table th, .table td { padding: 13px 10px; border-bottom: 1px solid #f4e6dc; text-align: left; font-size: 14px }
.badge { display: inline-block; border-radius: 999px; padding: 5px 10px; font-size: 12px }
.badge.ok { background: #e8f7ed; color: #4d9a69 }
.badge.warn { background: #fff3dc; color: #b77d20 }
.badge.bad { background: #ffebeb; color: #c64e4e }
.bad { color: #c64e4e }
@media (max-width: 900px) { .add-form { grid-template-columns: 1fr 1fr } }
@media (max-width: 600px) { .add-form { grid-template-columns: 1fr } }
</style>
