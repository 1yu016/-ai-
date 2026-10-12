<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useRoute, useRouter } from 'vue-router'
import { apiErrorMessage, apiErrorStatus } from '@/api/http'
import { platformApi, type Student } from '@/api/platform'
import ClassWorkspaceLayout from '@/components/ClassWorkspaceLayout.vue'
import StudentAuthorizationBadge from '@/components/StudentAuthorizationBadge.vue'
import StudentAvatar from '@/components/StudentAvatar.vue'
import StudentImportPanel from '@/components/StudentImportPanel.vue'
import { withNavigationSource } from '@/router/navigation'
import { studentDisplayName, studentStatusLabel } from '@/utils/student'

const route = useRoute()
const router = useRouter()
const classId = Number(route.params.classId)
const items = ref<Student[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const keyword = ref('')
const status = ref<'' | 'active' | 'disabled'>('')
const loading = ref(true)
const error = ref('')
const forbidden = ref(false)
const editorOpen = ref(false)
const importOpen = ref(false)
const saving = ref(false)
const editingId = ref<number | null>(null)
const form = ref(emptyForm())

function emptyForm() {
  return { studentNo: '', name: '', nickname: '', gender: '', birthday: '' }
}

async function load(resetPage = false) {
  if (resetPage) page.value = 1
  loading.value = true
  error.value = ''
  forbidden.value = false
  try {
    const result = await platformApi.students({
      classId,
      page: page.value,
      pageSize,
      keyword: keyword.value.trim() || undefined,
      status: status.value || undefined,
    })
    items.value = result.data.items
    total.value = result.data.total
  } catch (cause) {
    if (apiErrorStatus(cause) === 403) forbidden.value = true
    else error.value = apiErrorStatus(cause)
      ? apiErrorMessage(cause, '学生加载失败，请重试。')
      : '学生加载失败，请重试。'
  } finally {
    loading.value = false
  }
}

function startCreate() {
  importOpen.value = false
  editingId.value = null
  form.value = emptyForm()
  editorOpen.value = true
  error.value = ''
}

async function importedStudents() {
  await load(true)
}

async function startEdit(student: Student) {
  error.value = ''
  try {
    const { data } = await platformApi.studentDetail(student.id)
    editingId.value = student.id
    form.value = {
      studentNo: data.studentNo,
      name: data.name,
      nickname: data.nickname ?? '',
      gender: data.gender ?? '',
      birthday: data.birthday ?? '',
    }
    editorOpen.value = true
  } catch (cause) {
    error.value = apiErrorMessage(cause, '学生资料加载失败，请重试。')
  }
}

async function saveStudent() {
  if (!form.value.studentNo.trim() || !form.value.name.trim()) return
  saving.value = true
  error.value = ''
  try {
    if (editingId.value) {
      await platformApi.updateStudent(editingId.value, {
        name: form.value.name.trim(),
        nickname: form.value.nickname.trim() || undefined,
        gender: form.value.gender.trim() || undefined,
        birthday: form.value.birthday || undefined,
      })
      ElMessage.success('学生资料已保存')
    } else {
      await platformApi.createStudent({
        classId,
        studentNo: form.value.studentNo.trim(),
        name: form.value.name.trim(),
        nickname: form.value.nickname.trim() || undefined,
        gender: form.value.gender.trim() || undefined,
        birthday: form.value.birthday || undefined,
      })
      ElMessage.success('学生添加成功')
    }
    editorOpen.value = false
    form.value = emptyForm()
    await load()
  } catch (cause) {
    error.value = apiErrorMessage(cause, '保存失败，已保留当前输入，请重试。')
  } finally {
    saving.value = false
  }
}

async function toggleStatus(student: Student) {
  const disabling = student.status === 'active'
  const action = disabling ? '停用' : '恢复'
  try {
    await ElMessageBox.confirm(
      disabling
        ? '停用后，该幼儿不会参与点名和新课堂操作，历史记录仍会保留。'
        : '恢复后，该幼儿将重新参与当前班级的课堂操作。',
      `${action}${studentDisplayName(student)}`,
      { confirmButtonText: action, cancelButtonText: '取消', type: 'warning' },
    )
    await platformApi.updateStudent(student.id, {
      status: disabling ? 'disabled' : 'active',
    })
    ElMessage.success(`${action}成功`)
    await load()
  } catch (cause) {
    if (cause === 'cancel' || cause === 'close') return
    error.value = apiErrorMessage(cause, `${action}失败，请重试。`)
  }
}

function openStudent(studentId: number) {
  void router.push(withNavigationSource({
    name: 'student-profile',
    params: { classId, studentId },
  }, route))
}

function changePage(next: number) {
  page.value = next
  void load()
}

onMounted(() => void load())
</script>
<template>
  <ClassWorkspaceLayout>
    <div class="students-body">
      <div class="toolbar">
        <input v-model="keyword" placeholder="搜索姓名或学号" @keyup.enter="load(true)" />
        <select v-model="status" @change="load(true)">
          <option value="">全部状态</option>
          <option value="active">在读</option>
          <option value="disabled">已停用</option>
        </select>
        <button class="btn-ghost" :disabled="loading" @click="load(true)">查询</button>
        <button class="btn-ghost" @click="importOpen = !importOpen; editorOpen = false">{{ importOpen ? '关闭导入' : '表格导入' }}</button>
        <button class="btn-solid" @click="startCreate">+ 添加学生</button>
      </div>

      <StudentImportPanel
        v-if="importOpen"
        :class-id="classId"
        @cancel="importOpen = false"
        @imported="importedStudents"
      />

      <section v-if="editorOpen" class="panel editor">
        <div class="editor-head">
          <strong>{{ editingId ? '编辑学生' : '添加学生' }}</strong>
          <button class="btn-text" @click="editorOpen = false">关闭</button>
        </div>
        <label>学号<input v-model="form.studentNo" :disabled="Boolean(editingId)" maxlength="64" /></label>
        <label>姓名<input v-model="form.name" maxlength="100" /></label>
        <label>昵称（可选）<input v-model="form.nickname" maxlength="100" /></label>
        <label>性别（可选）<input v-model="form.gender" maxlength="20" /></label>
        <label>生日（可选）<input v-model="form.birthday" type="date" /></label>
        <button class="btn-solid" :disabled="saving || !form.studentNo.trim() || !form.name.trim()" @click="saveStudent">
          {{ saving ? '保存中…' : '保存' }}
        </button>
        <small v-if="editingId" class="hint">学号是班级内唯一标识，现有后端模型不支持修改。</small>
        <p v-if="error" class="form-error">{{ error }}</p>
      </section>

      <section v-if="forbidden" class="panel state-state error">
        <span class="state-icon">🔒</span>
        <p>当前账号无权查看或修改该班级学生。</p>
      </section>
      <section v-else-if="loading" class="panel state-state"><p>加载中…</p></section>
      <section v-else-if="error && !editorOpen" class="panel state-state error">
        <span class="state-icon">😕</span>
        <p>{{ error }}</p>
        <button class="btn-solid" @click="load()">重新加载</button>
      </section>
      <section v-else-if="!items.length" class="panel state-state">
        <span class="state-icon">👧</span>
        <p>当前条件下没有学生</p>
        <button class="btn-solid" @click="startCreate">添加学生</button>
      </section>

      <section v-else class="list-card">
        <table class="student-table">
          <thead><tr><th>学生</th><th>学号</th><th>授权状态</th><th>状态</th><th class="col-op">操作</th></tr></thead>
          <tbody>
            <tr v-for="item in items" :key="item.id">
              <td><div class="stu-cell"><StudentAvatar :student="item" /><div class="stu-info"><span class="stu-name">{{ studentDisplayName(item) }}</span><span v-if="item.nickname && item.nickname !== item.name" class="stu-nick">{{ item.nickname }}</span></div></div></td>
              <td class="stu-no">{{ item.studentNo }}</td>
              <td><StudentAuthorizationBadge :status="item.authorizationStatus" /></td>
              <td><span class="status-pill" :class="item.status === 'disabled' ? 'off' : 'on'"><i class="dot"></i>{{ studentStatusLabel(item.status) }}</span></td>
              <td class="col-op">
                <button class="btn-text" @click="openStudent(item.id)">查看资料</button>
                <button class="btn-text" @click="startEdit(item)">编辑</button>
                <button class="btn-text" @click="toggleStatus(item)">{{ item.status === 'active' ? '停用' : '恢复' }}</button>
              </td>
            </tr>
          </tbody>
        </table>
        <footer class="pager">
          <span>共 {{ total }} 名</span>
          <button :disabled="page <= 1" @click="changePage(page - 1)">上一页</button>
          <span>第 {{ page }} 页</span>
          <button :disabled="page * pageSize >= total" @click="changePage(page + 1)">下一页</button>
        </footer>
      </section>
    </div>
  </ClassWorkspaceLayout>
</template>

<style scoped>
.students-body{width:100%;min-width:0}
.toolbar{display:flex;justify-content:flex-end;gap:10px;margin-bottom:16px;flex-wrap:wrap}
.toolbar input,.toolbar select{min-height:42px;border:1px solid #efd9c8;border-radius:12px;background:#fffdf9;color:#60483e;padding:0 12px}
.toolbar input{min-width:min(300px,100%);flex:1}
.btn-solid{border:0;background:#eb956b;color:#fff;border-radius:12px;padding:11px 18px;cursor:pointer;font-weight:700}
.btn-solid:disabled{opacity:.55;cursor:not-allowed}
.btn-ghost{border:0;background:#fffdf9;color:#876b5d;border-radius:12px;padding:11px 18px;cursor:pointer;border:1px solid #f0ddce}
.btn-ghost:disabled{opacity:.55;cursor:not-allowed}
.btn-text{border:0;background:none;color:#da805f;cursor:pointer;padding:6px 10px;border-radius:10px;font-weight:700}
.btn-text:hover{background:#fff0e3;color:#c96e45}
.panel{background:#fffdf9;border:1px solid #f0ddce;border-radius:16px;padding:18px;box-shadow:0 8px 24px #c88d6012}
.editor{display:grid;grid-template-columns:repeat(5,minmax(130px,1fr)) auto;align-items:end;gap:12px;margin-bottom:16px}
.editor-head{grid-column:1/-1;display:flex;justify-content:space-between;align-items:center}
.editor label{display:grid;gap:6px;color:#876b5d;font-size:13px}
.editor input{height:38px;border:1px solid #efd9c8;background:#fffdf9;border-radius:10px;padding:0 10px;min-width:0}
.editor input:disabled{background:#f4f1ed}
.hint{grid-column:1/-1;color:#9a7e6e}
.form-error{grid-column:1/-1;margin:0;color:#c64e4e}
.state-state{display:grid;justify-items:center;gap:10px;padding:56px 20px;text-align:center;color:#88766b}
.state-state .state-icon{font-size:46px}
.state-state.error{color:#c64e4e}
.list-card{width:100%;background:#fffffff0;border:1px solid #f1decf;border-radius:22px;box-shadow:0 16px 40px #8a5a2a12;overflow:auto}
.student-table{width:100%;min-width:760px;border-collapse:collapse}
.student-table th,.student-table td{text-align:left;padding:16px 22px;border-bottom:1px solid #f4e6dc;font-size:15px}
.student-table thead th{color:#b09285;font-weight:700;font-size:13px;letter-spacing:.02em}
.student-table tbody tr:last-child td{border-bottom:0}
.student-table tbody tr:hover{background:#fffaf4}
.stu-cell{display:flex;align-items:center;gap:14px}
.stu-info{display:flex;flex-direction:column;gap:2px}
.stu-name{font-weight:600;color:#493d36;font-size:16px}
.stu-nick{color:#b09285;font-size:13px}
.stu-no{color:#a38270;font-weight:500}
.col-op{text-align:right}
.student-table .col-op{text-align:right}
.status-pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:4px 11px;font-size:13px;font-weight:700}
.status-pill .dot{width:7px;height:7px;border-radius:50%}
.status-pill.on{background:#e8f7ed;color:#4d9a69}.status-pill.on .dot{background:#4d9a69}
.status-pill.off{background:#f0eef1;color:#9a8f98}.status-pill.off .dot{background:#9a8f98}
.pager{display:flex;justify-content:flex-end;align-items:center;gap:10px;padding:14px 18px;color:#8d7568}
.pager button{border:1px solid #efd9c8;border-radius:9px;background:#fff;padding:7px 11px;color:#8d6654;cursor:pointer}
.pager button:disabled{opacity:.45;cursor:not-allowed}
@media(max-width:899px){
  .editor{grid-template-columns:1fr 1fr}
}
@media(max-width:620px){.editor{grid-template-columns:1fr}.toolbar>*{width:100%}}
</style>
