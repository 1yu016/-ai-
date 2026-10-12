<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useRoute, useRouter } from 'vue-router'
import { apiErrorMessage, apiErrorStatus } from '@/api/http'
import { platformApi, type SchoolClass } from '@/api/platform'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import ForbiddenState from '@/components/ForbiddenState.vue'
import LoadingState from '@/components/LoadingState.vue'
import ManagementLayout from '@/components/ManagementLayout.vue'
import PageHeader from '@/components/PageHeader.vue'
import PageShell from '@/components/PageShell.vue'
import { withNavigationSource } from '@/router/navigation'

type ClassForm = { name: string; grade: string; ageRange: string; schoolYear: string }
const route = useRoute()
const router = useRouter()
const pageSize = 10
const items = ref<SchoolClass[]>([])
const total = ref(0)
const queryText = (value: unknown) => typeof value === 'string' ? value : ''
const queryPage = Number(queryText(route.query.page))
const page = ref(Number.isInteger(queryPage) && queryPage > 0 ? queryPage : 1)
const keyword = ref(queryText(route.query.keyword))
const status = ref(queryText(route.query.status))
const loading = ref(true)
const error = ref('')
const forbidden = ref(false)
const editorOpen = ref(false)
const editingId = ref<number | null>(null)
const saving = ref(false)
const pendingToggle = ref<SchoolClass | null>(null)
const toggleBusy = ref(false)
function emptyForm(): ClassForm { const year = new Date().getFullYear(); return { name: '', grade: '', ageRange: '', schoolYear: `${year}-${year + 1}` } }
const form = ref<ClassForm>(emptyForm())
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))
const isEditing = computed(() => editingId.value !== null)
const confirmOpen = computed({ get: () => pendingToggle.value !== null, set: (value: boolean) => { if (!value) pendingToggle.value = null } })
const confirmMessage = computed(() => pendingToggle.value?.status === 'active' ? `停用“${pendingToggle.value.name}”后，教师将不能再为该班级创建新课堂。` : `确认恢复“${pendingToggle.value?.name ?? ''}”吗？`)

function teacherNames(item: SchoolClass): string { return item.teachers?.length ? item.teachers.map((teacher) => teacher.name).join('、') : '未分配' }
function roleLabel(role: string): string { return ({ lead: '主班', assistant: '协班', observer: '观察' } as Record<string, string>)[role] ?? role }
async function syncQuery(): Promise<void> { await router.replace({ query: { ...(keyword.value.trim() ? { keyword: keyword.value.trim() } : {}), ...(status.value ? { status: status.value } : {}), ...(page.value > 1 ? { page: String(page.value) } : {}) } }) }
async function load(): Promise<void> {
  loading.value = true; error.value = ''; forbidden.value = false
  try {
    const response = await platformApi.classes({ page: page.value, pageSize, keyword: keyword.value.trim() || undefined, status: status.value || undefined })
    items.value = response.data.items; total.value = response.data.total
    if (page.value > totalPages.value) { page.value = totalPages.value; await syncQuery(); await load() }
  } catch (cause) {
    if (apiErrorStatus(cause) === 403) forbidden.value = true
    else error.value = apiErrorMessage(cause, '班级加载失败，请检查登录状态后重试。')
  } finally { loading.value = false }
}
async function applyFilters(): Promise<void> { page.value = 1; await syncQuery(); await load() }
async function changePage(nextPage: number): Promise<void> { if (nextPage < 1 || nextPage > totalPages.value || nextPage === page.value) return; page.value = nextPage; await syncQuery(); await load() }
function resetFilters(): void { keyword.value = ''; status.value = ''; void applyFilters() }
function openCreate(): void { editingId.value = null; form.value = emptyForm(); editorOpen.value = true }
function openEdit(item: SchoolClass): void { editingId.value = item.id; form.value = { name: item.name, grade: item.grade ?? '', ageRange: item.ageRange ?? '', schoolYear: item.schoolYear }; editorOpen.value = true }
function closeEditor(): void { if (saving.value) return; editorOpen.value = false; editingId.value = null; form.value = emptyForm() }
async function save(): Promise<void> {
  const name = form.value.name.trim(); const schoolYear = form.value.schoolYear.trim(); if (!name || !schoolYear) return
  saving.value = true
  try {
    const payload = { name, grade: form.value.grade.trim(), ageRange: form.value.ageRange.trim(), schoolYear }
    if (editingId.value === null) { await platformApi.createClass(payload); ElMessage.success('班级添加成功') }
    else { await platformApi.updateClass(editingId.value, payload); ElMessage.success('班级信息已保存') }
    closeEditor(); await load()
  } catch (cause) { ElMessage.error(apiErrorMessage(cause, isEditing.value ? '班级保存失败，请检查填写内容后重试。' : '班级添加失败，请检查班级名称和学年。')) }
  finally { saving.value = false }
}
async function confirmToggle(): Promise<void> {
  const item = pendingToggle.value; if (!item) return
  const nextStatus = item.status === 'active' ? 'disabled' : 'active'; toggleBusy.value = true
  try { await platformApi.updateClass(item.id, { status: nextStatus }); ElMessage.success(nextStatus === 'active' ? '班级已恢复' : '班级已停用'); pendingToggle.value = null; await load() }
  catch (cause) { ElMessage.error(apiErrorMessage(cause, '班级状态更新失败，请重试。')) }
  finally { toggleBusy.value = false }
}
function openClass(classId: number): void { void router.push(withNavigationSource({ name: 'class-detail', params: { classId } }, route)) }
onMounted(() => { void load() })
</script>

<template>
  <ManagementLayout><PageShell variant="list">
    <PageHeader eyebrow="平台管理" title="班级管理" subtitle="查询、维护班级资料，并查看负责教师与在册幼儿数量。"><template v-if="!forbidden" #actions><button class="button secondary" :disabled="loading" @click="load">刷新</button><button class="button" @click="openCreate">新增班级</button></template></PageHeader>
    <section v-if="!forbidden" class="panel filters" aria-label="班级筛选"><label><span>查询</span><input v-model="keyword" placeholder="班级名称、年级、年龄段或学年" @keyup.enter="applyFilters" /></label><label><span>状态</span><select v-model="status" @change="applyFilters"><option value="">全部状态</option><option value="active">启用</option><option value="disabled">停用</option></select></label><button class="button" :disabled="loading" @click="applyFilters">查询</button><button class="button secondary" :disabled="loading" @click="resetFilters">重置</button></section>
    <section v-if="editorOpen && !forbidden" class="panel editor" aria-label="班级表单"><div class="editor-heading"><div><strong>{{ isEditing ? '编辑班级' : '新增班级' }}</strong><p>字段与后端班级 DTO 保持一致。</p></div><button class="text-button" :disabled="saving" @click="closeEditor">关闭</button></div><div class="form-grid"><label>班级名称<input v-model="form.name" maxlength="100" placeholder="如：阳光中班" /></label><label>年级<input v-model="form.grade" maxlength="50" placeholder="如：中班" /></label><label>年龄段<input v-model="form.ageRange" maxlength="50" placeholder="如：4-5岁" /></label><label>学年<input v-model="form.schoolYear" maxlength="20" placeholder="如：2026-2027" /></label></div><div class="editor-actions"><button class="button secondary" :disabled="saving" @click="closeEditor">取消</button><button class="button" :disabled="saving || !form.name.trim() || !form.schoolYear.trim()" @click="save">{{ saving ? '保存中…' : '确认保存' }}</button></div></section>
    <ForbiddenState v-if="forbidden" class="state" description="当前账号没有管理班级的权限。请使用管理员账号，或联系园所管理员。" />
    <LoadingState v-else-if="loading" class="state" title="正在加载班级" description="正在读取班级、负责教师和幼儿数量。" />
    <ErrorState v-else-if="error" class="state" :description="error" @retry="load" />
    <EmptyState v-else-if="!items.length" class="state" :title="keyword || status ? '没有符合条件的班级' : '还没有班级'" :description="keyword || status ? '请调整查询条件后重试。' : '新增第一个班级后，可以在详情页进入学生、奖励、问题和课堂记录。'" :action-label="keyword || status ? '清除筛选' : '新增班级'" @action="keyword || status ? resetFilters() : openCreate()" />
    <template v-else><div class="panel table-scroll"><table class="table"><thead><tr><th>班级</th><th>年级/年龄段</th><th>学年</th><th>负责教师</th><th>在册幼儿</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="item in items" :key="item.id"><td><button class="class-link" @click="openClass(item.id)">{{ item.name }}</button></td><td>{{ item.grade || '未填写' }}<small>{{ item.ageRange || '未填写' }}</small></td><td>{{ item.schoolYear }}</td><td>{{ teacherNames(item) }}<small v-if="item.teachers?.length">{{ item.teachers.map((teacher) => roleLabel(teacher.role)).join('、') }}</small></td><td>{{ item.studentCount ?? 0 }} 人</td><td><span class="badge" :class="item.status === 'active' ? 'ok' : 'warn'">{{ item.status === 'active' ? '启用' : '停用' }}</span></td><td class="actions"><button class="link" @click="openClass(item.id)">查看</button><button class="link" @click="openEdit(item)">编辑</button><button class="link" :class="{ danger: item.status === 'active' }" @click="pendingToggle = item">{{ item.status === 'active' ? '停用' : '恢复' }}</button></td></tr></tbody></table></div><nav class="pagination" aria-label="班级分页"><span>共 {{ total }} 个班级，第 {{ page }} / {{ totalPages }} 页</span><div><button class="button secondary" :disabled="page <= 1 || loading" @click="changePage(page - 1)">上一页</button><button class="button secondary" :disabled="page >= totalPages || loading" @click="changePage(page + 1)">下一页</button></div></nav></template>
    <ConfirmDialog v-model="confirmOpen" :title="pendingToggle?.status === 'active' ? '停用班级' : '恢复班级'" :message="confirmMessage" :confirm-label="pendingToggle?.status === 'active' ? '确认停用' : '确认恢复'" :danger="pendingToggle?.status === 'active'" :busy="toggleBusy" @confirm="confirmToggle" />
  </PageShell></ManagementLayout>
</template>

<style scoped>
.state,.panel,.pagination{margin-top:22px}.button{border:0;border-radius:12px;padding:0 18px;min-height:42px;background:#e99168;color:#fff;font:inherit;cursor:pointer}.button.secondary{border:1px solid #efd9c8;background:#fffdf9;color:#b76849}.button:disabled{cursor:not-allowed;opacity:.55}.panel{padding:20px;border:1px solid #f0ddce;border-radius:18px;background:#fffdf9;box-shadow:0 10px 28px #b9795114}.filters{display:grid;grid-template-columns:minmax(260px,1fr) 180px auto auto;align-items:end;gap:12px}.filters label,.form-grid label{display:grid;gap:7px;color:#876b5d;font-size:13px}.filters input,.filters select,.form-grid input{min-width:0;height:42px;box-sizing:border-box;border:1px solid #efd9c8;border-radius:10px;padding:0 12px;background:#fff;color:#60483e;font:inherit}.editor-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.editor-heading strong{color:#60483e;font-size:19px}.editor-heading p{margin:5px 0 0;color:#a38270}.text-button,.link,.class-link{border:0;background:none;color:#d67b59;font:inherit;cursor:pointer}.form-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-top:18px}.editor-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}.table-scroll{max-width:100%;overflow-x:auto}.table{width:100%;min-width:1040px;border-collapse:collapse;color:#60483e}.table th,.table td{text-align:left;padding:13px 10px;border-bottom:1px solid #f4e6dc;vertical-align:middle}.table small{display:block;margin-top:4px;color:#a38270}.class-link{padding:0;font-weight:750}.badge{display:inline-block;border-radius:999px;padding:5px 10px;font-size:12px}.ok{background:#e8f7ed;color:#4d9a69}.warn{background:#fff3dc;color:#b77d20}.link{margin-right:9px;padding:4px 0}.link.danger{color:#cf5f58}.actions{white-space:nowrap}.pagination{display:flex;align-items:center;justify-content:space-between;gap:18px;color:#876b5d}.pagination div{display:flex;gap:10px}@media(max-width:900px){.filters{grid-template-columns:1fr 1fr}.form-grid{grid-template-columns:1fr 1fr}}@media(max-width:600px){.filters,.form-grid{grid-template-columns:1fr}.pagination{align-items:stretch;flex-direction:column}.pagination div{display:grid;grid-template-columns:1fr 1fr}}
</style>
