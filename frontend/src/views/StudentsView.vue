<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ClassWorkspaceLayout from '@/components/ClassWorkspaceLayout.vue'
import { platformApi, type Student } from '@/api/platform'
const route = useRoute(); const router = useRouter(); const classId = Number(route.params.classId); const items = ref<Student[]>([]); const loading = ref(true); const error = ref(''); const adding = ref(false); const saving = ref(false); const form = ref({ studentNo: '', name: '', nickname: '' })
const statusMap: Record<string, string> = { active: '在读', enrolled: '在读', inactive: '已停用', graduated: '已毕业' }
function statusText(s: string) { return (statusMap[s] ?? s) || '在读' }
function isInactive(s: string) { return s === 'inactive' }
function avatarChar(item: Student) { return (item.name || item.nickname || '儿').trim().charAt(0) }
async function load(){ loading.value = true; error.value = ''; try { items.value = (await platformApi.students(classId)).data.items } catch { error.value = '学生加载失败，请重试。' } finally { loading.value = false } }
async function create(){ if (!form.value.studentNo.trim() || !form.value.name.trim()) return; saving.value = true; error.value = ''; try { await platformApi.createStudent({ classId, studentNo: form.value.studentNo.trim(), name: form.value.name.trim(), nickname: form.value.nickname.trim() || undefined }); form.value = { studentNo: '', name: '', nickname: '' }; adding.value = false; await load() } catch { error.value = '添加学生失败，请检查学号是否重复或权限是否足够。' } finally { saving.value = false } }
onMounted(load)
</script>
<template>
  <ClassWorkspaceLayout>
    <div class="students-body">
      <div class="act-row">
        <button class="btn-ghost" :disabled="loading" @click="load">刷新</button>
        <button class="btn-solid" @click="adding = !adding">{{ adding ? '取消添加' : '+ 添加学生' }}</button>
      </div>

      <section v-if="adding" class="panel add-form">
        <label>学号<input v-model="form.studentNo" maxlength="64" placeholder="请输入学号" /></label>
        <label>姓名<input v-model="form.name" maxlength="100" placeholder="请输入姓名" /></label>
        <label>昵称（可选）<input v-model="form.nickname" maxlength="100" placeholder="请输入昵称" /></label>
        <button class="btn-solid" :disabled="saving || !form.studentNo.trim() || !form.name.trim()" @click="create">{{ saving ? '保存中…' : '保存学生' }}</button>
      </section>

      <section v-if="loading" class="panel state-state"><p>加载中…</p></section>

      <section v-else-if="error" class="panel state-state error">
        <span class="state-icon">😕</span>
        <p>{{ error }}</p>
        <button class="btn-solid" @click="load">重新加载</button>
      </section>

      <section v-else-if="!items.length" class="panel state-state">
        <span class="state-icon">👧</span>
        <p>当前班级还没有学生</p>
        <button class="btn-solid" @click="adding = true">添加学生</button>
      </section>

      <section v-else class="list-card">
        <table class="student-table">
          <thead><tr><th>学生</th><th>学号</th><th>状态</th><th class="col-op">操作</th></tr></thead>
          <tbody>
            <tr v-for="item in items" :key="item.id">
              <td><div class="stu-cell"><span class="avatar-placeholder">{{ avatarChar(item) }}</span><div class="stu-info"><span class="stu-name">{{ item.name }}</span><span v-if="item.nickname" class="stu-nick">{{ item.nickname }}</span></div></div></td>
              <td class="stu-no">{{ item.studentNo }}</td>
              <td><span class="status-pill" :class="isInactive(item.status) ? 'off' : 'on'"><i class="dot"></i>{{ statusText(item.status) }}</span></td>
              <td class="col-op"><button class="btn-text" @click="router.push({ name: 'student-profile', params: { studentId: item.id }, query: { classId } })">查看资料</button></td>
            </tr>
          </tbody>
        </table>

        <ul class="student-cards">
          <li v-for="item in items" :key="item.id" class="student-card">
            <div class="stu-cell"><span class="avatar-placeholder">{{ avatarChar(item) }}</span><div class="stu-info"><span class="stu-name">{{ item.name }}</span><span v-if="item.nickname" class="stu-nick">{{ item.nickname }}</span></div></div>
            <dl>
              <div><dt>学号</dt><dd>{{ item.studentNo }}</dd></div>
              <div><dt>状态</dt><dd><span class="status-pill" :class="isInactive(item.status) ? 'off' : 'on'"><i class="dot"></i>{{ statusText(item.status) }}</span></dd></div>
            </dl>
            <button class="btn-text" @click="router.push({ name: 'student-profile', params: { studentId: item.id }, query: { classId } })">查看资料</button>
          </li>
        </ul>
      </section>
    </div>
  </ClassWorkspaceLayout>
</template>

<style scoped>
.students-body{width:100%}
.act-row{display:flex;justify-content:flex-end;gap:10px;margin-bottom:16px;flex-wrap:wrap}
.btn-solid{border:0;background:#eb956b;color:#fff;border-radius:12px;padding:11px 18px;cursor:pointer;font-weight:700}
.btn-solid:disabled{opacity:.55;cursor:not-allowed}
.btn-ghost{border:0;background:#fffdf9;color:#876b5d;border-radius:12px;padding:11px 18px;cursor:pointer;border:1px solid #f0ddce}
.btn-ghost:disabled{opacity:.55;cursor:not-allowed}
.btn-text{border:0;background:none;color:#da805f;cursor:pointer;padding:6px 10px;border-radius:10px;font-weight:700}
.btn-text:hover{background:#fff0e3;color:#c96e45}
.panel{background:#fffdf9;border:1px solid #f0ddce;border-radius:16px;padding:18px;box-shadow:0 8px 24px #c88d6012}
.add-form{display:grid;grid-template-columns:repeat(3,1fr) auto;align-items:end;gap:12px;margin-bottom:16px}
.add-form label{display:grid;gap:6px;color:#876b5d;font-size:13px}
.add-form input{height:38px;border:1px solid #efd9c8;background:#fffdf9;border-radius:10px;padding:0 10px}
.state-state{display:grid;justify-items:center;gap:10px;padding:56px 20px;text-align:center;color:#88766b}
.state-state .state-icon{font-size:46px}
.state-state.error{color:#c64e4e}
.list-card{width:100%;background:#fffffff0;border:1px solid #f1decf;border-radius:22px;box-shadow:0 16px 40px #8a5a2a12;overflow:hidden}
.student-table{width:100%;border-collapse:collapse}
.student-table th,.student-table td{text-align:left;padding:16px 22px;border-bottom:1px solid #f4e6dc;font-size:15px}
.student-table thead th{color:#b09285;font-weight:700;font-size:13px;letter-spacing:.02em}
.student-table tbody tr:last-child td{border-bottom:0}
.student-table tbody tr:hover{background:#fffaf4}
.stu-cell{display:flex;align-items:center;gap:14px}
.avatar-placeholder{width:38px;height:38px;min-width:38px;border-radius:50%;display:inline-grid;place-items:center;background:linear-gradient(145deg,#ffe0c2,#ffd0a8);color:#b2694f;font-weight:800;font-size:18px}
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
.student-cards{display:none}
@media(max-width:899px){
  .student-table{display:none}
  .student-cards{display:grid;gap:14px;list-style:none;margin:0;padding:0;width:100%}
  .student-card{background:#fffffff0;border:1px solid #f1decf;border-radius:18px;padding:18px;display:grid;gap:12px;box-shadow:0 10px 26px #8a5a2a10}
  .student-card dl{display:grid;gap:8px;margin:0}
  .student-card dl div{display:flex;justify-content:space-between}
  .student-card dt{color:#b09285}
  .student-card dd{margin:0;color:#493d36;font-weight:600}
  .add-form{grid-template-columns:1fr}
}
</style>