<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import ManagementLayout from '@/components/ManagementLayout.vue'
import { platformApi, type SchoolClass, type TeacherItem } from '@/api/platform'

const teachers = ref<TeacherItem[]>([])
const classes = ref<SchoolClass[]>([])
const pageLoading = ref(true)
const error = ref('')
const keyword = ref('')
const adding = ref(false)
const saving = ref(false)
const form = ref({ account: '', password: '', name: '', role: 'teacher' })

const teacherClass = ref<TeacherItem | null>(null)
const bindLoading = ref(true)
const selectedClasses = ref<number[]>([])
const bindSaving = ref(false)

async function loadTeachers() {
  pageLoading.value = true
  error.value = ''
  try {
    const { items } = (await platformApi.teachers({ pageSize: 100, keyword: keyword.value.trim() || undefined })).data
    teachers.value = items
  } catch {
    error.value = '教师列表加载失败，请检查登录状态后重试。'
  } finally {
    pageLoading.value = false
  }
}

async function loadClasses() {
  const { items } = (await platformApi.classes(1)).data
  classes.value = items
}

async function createTeacher() {
  if (!form.value.account.trim() || !form.value.password.trim() || !form.value.name.trim()) return
  saving.value = true
  try {
    await platformApi.createTeacher({
      account: form.value.account.trim(),
      password: form.value.password,
      name: form.value.name.trim(),
      role: form.value.role,
    })
    form.value = { account: '', password: '', name: '', role: 'teacher' }
    adding.value = false
    ElMessage.success('教师账号创建成功')
    await loadTeachers()
  } catch {
    ElMessage.error('创建失败，请检查账号是否重复或输入是否完整。')
  } finally {
    saving.value = false
  }
}

async function toggleStatus(row: TeacherItem) {
  const disabling = row.status === 'active'
  const action = disabling ? '停用' : '恢复'
  try {
    await ElMessageBox.confirm(
      disabling
        ? '停用后该教师将无法登录，但历史课堂记录会保留。'
        : '恢复后该教师可正常登录。',
      `${action}教师`,
      { confirmButtonText: action, cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return
  }
  await platformApi.updateTeacher(row.id, { status: disabling ? 'disabled' : 'active' })
  ElMessage.success(`${action}成功`)
  await loadTeachers()
}

async function openBind(row: TeacherItem) {
  teacherClass.value = row
  selectedClasses.value = row.classes.map((c) => c.classId)
  bindLoading.value = true
  if (!classes.value.length) {
    try { await loadClasses() } catch { /* 班级列表失败由页面提示 */ }
  }
  bindLoading.value = false
}

function isSelected(classId: number) {
  return selectedClasses.value.includes(classId)
}

function toggleClass(classId: number) {
  if (isSelected(classId)) {
    selectedClasses.value = selectedClasses.value.filter((id) => id !== classId)
  } else {
    selectedClasses.value.push(classId)
  }
}

async function saveBind() {
  if (!teacherClass.value) return
  const tid = teacherClass.value.id
  bindSaving.value = true
  try {
    const currentIds = teacherClass.value.classes.map((c) => c.classId)
    const nextIds = selectedClasses.value
    const addIds = nextIds.filter((id) => !currentIds.includes(id))
    const removeIds = currentIds.filter((id) => !nextIds.includes(id))
    for (const classId of addIds) {
      await platformApi.bindTeacher(classId, { teacherId: tid, role: 'assistant' })
    }
    for (const classId of removeIds) {
      await platformApi.unbindTeacher(classId, tid)
    }
    ElMessage.success('班级绑定已更新')
    teacherClass.value = null
    await loadTeachers()
    if (teacherClass.value === null) teacherClass.value = null
  } catch {
    ElMessage.error('班级绑定更新失败。')
  } finally {
    bindSaving.value = false
  }
}

onMounted(async () => {
  await Promise.all([loadTeachers(), loadClasses()])
})
</script>

<template>
  <ManagementLayout>
    <div class="management-page">
      <h1>教师管理</h1>
      <p class="muted">创建教师账号、启停账号，并为教师分配负责班级。</p>

      <div class="toolbar">
        <input v-model="keyword" placeholder="搜索账号或姓名" @keyup.enter="loadTeachers" />
        <button class="button" @click="loadTeachers">搜索</button>
        <button class="button" @click="adding = !adding">{{ adding ? '取消新建' : '新建教师' }}</button>
      </div>

      <div v-if="adding" class="panel add-form">
        <label>账号<input v-model="form.account" maxlength="64" placeholder="登录账号" /></label>
        <label>姓名<input v-model="form.name" maxlength="100" placeholder="教师姓名" /></label>
        <label>初始密码<input v-model="form.password" type="password" maxlength="128" placeholder="设置初始密码" /></label>
        <label>角色<select v-model="form.role"><option value="teacher">教师</option></select></label>
        <button class="button" :disabled="saving || !form.account.trim() || !form.password.trim() || !form.name.trim()" @click="createTeacher">{{ saving ? '保存中…' : '创建教师' }}</button>
      </div>

      <div class="panel">
        <p v-if="pageLoading">加载中…</p>
        <p v-else-if="error" class="bad">{{ error }}</p>
        <p v-else-if="!teachers.length">暂无教师，请先创建。</p>
        <table v-else class="table">
          <thead><tr><th>账号</th><th>姓名</th><th>状态</th><th>负责班级</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="item in teachers" :key="item.id">
              <td>{{ item.account }}</td>
              <td>{{ item.name }}</td>
              <td><span class="badge" :class="item.status === 'active' ? 'ok' : 'warn'">{{ item.status }}</span></td>
              <td>
                <span v-if="!item.classes.length" class="muted">未绑定</span>
                <span v-for="c in item.classes" :key="c.classId" class="class-tag">{{ c.className }}</span>
              </td>
              <td class="actions">
                <button class="button" @click="openBind(item)">分配班级</button>
                <button class="button ghost" @click="toggleStatus(item)">{{ item.status === 'active' ? '停用' : '恢复' }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="teacherClass" class="modal-mask">
        <div class="modal panel">
          <h3>分配班级：{{ teacherClass.name }}</h3>
          <p class="muted">勾选教师负责的班级（{{ selectedClasses.length }} 个）。</p>
          <div v-if="bindLoading" class="muted">班级加载中…</div>
          <div v-else class="class-list">
            <label v-for="c in classes" :key="c.id" class="class-option">
              <input type="checkbox" :checked="isSelected(c.id)" @change="toggleClass(c.id)" />
              <span>{{ c.name }}</span>
            </label>
            <p v-if="!classes.length" class="muted">暂无班级可分配。</p>
          </div>
          <div class="modal-actions">
            <button class="button ghost" @click="teacherClass = null">取消</button>
            <button class="button" :disabled="bindSaving" @click="saveBind">{{ bindSaving ? '保存中…' : '保存绑定' }}</button>
          </div>
        </div>
      </div>
    </div>
  </ManagementLayout>
</template>

<style scoped>
.add-form{display:grid;grid-template-columns:repeat(4,1fr) auto;align-items:end;gap:12px;margin-bottom:16px}
.add-form label{display:grid;gap:6px;color:#876b5d;font-size:13px}
.add-form input,.add-form select{height:38px;border:1px solid #efd9c8;background:#fffdf9;border-radius:10px;padding:0 10px}
.actions{display:flex;gap:8px}
.button.ghost{background:#fffdf9;color:#c96e45;border:1px solid #efd9c8}
.class-tag{display:inline-block;background:#ffeadc;color:#c96e45;border-radius:12px;padding:3px 10px;margin:2px 4px 2px 0;font-size:12px}
.modal-mask{position:fixed;inset:0;background:rgba(96,72,62,.4);display:flex;align-items:center;justify-content:center;z-index:50}
.modal{width:460px;max-width:92vw}
.class-list{display:grid;gap:8px;margin:14px 0;max-height:320px;overflow:auto}
.class-option{display:flex;align-items:center;gap:10px;border:1px solid #f0ddce;border-radius:12px;padding:10px 14px;cursor:pointer}
.modal-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:14px}
@media(max-width:800px){.add-form{grid-template-columns:1fr}}
</style>