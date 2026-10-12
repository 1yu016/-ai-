<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiErrorMessage, apiErrorStatus } from '@/api/http'
import { platformApi, type ClassroomRunSummary, type SchoolClass } from '@/api/platform'
import BackButton from '@/components/BackButton.vue'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import ForbiddenState from '@/components/ForbiddenState.vue'
import LoadingState from '@/components/LoadingState.vue'
import ManagementLayout from '@/components/ManagementLayout.vue'
import PageHeader from '@/components/PageHeader.vue'
import PageShell from '@/components/PageShell.vue'
import { withNavigationSource } from '@/router/navigation'

const route = useRoute()
const router = useRouter()
const classId = Number(route.params.classId)
const schoolClass = ref<SchoolClass | null>(null)
const classroomRuns = ref<ClassroomRunSummary[]>([])
const classroomRunTotal = ref(0)
const loading = ref(true)
const error = ref('')
const forbidden = ref(false)

async function load(): Promise<void> {
  loading.value = true; error.value = ''; forbidden.value = false
  try {
    const [classResult, runResult] = await Promise.all([
      platformApi.classDetail(classId),
      platformApi.classRuns(classId, { page: 1, pageSize: 10 }),
    ])
    schoolClass.value = classResult.data
    classroomRuns.value = runResult.data.items
    classroomRunTotal.value = runResult.data.total
  } catch (cause) {
    if (apiErrorStatus(cause) === 403) forbidden.value = true
    else error.value = apiErrorMessage(cause, '班级详情加载失败，请重试。')
  } finally { loading.value = false }
}

function openSection(name: 'students' | 'class-rewards' | 'class-questions'): void {
  void router.push(withNavigationSource({ name, params: { classId } }, route))
}
function openRun(runId: number): void { void router.push(withNavigationSource({ name: 'classroom-record', params: { runId } }, route)) }
function focusRuns(): void { document.querySelector('#classroom-records')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
function roleLabel(role: string): string { return ({ lead: '主班教师', assistant: '协班教师', observer: '观察教师' } as Record<string, string>)[role] ?? role }
function runStatusLabel(status: string): string { return ({ prepared: '已准备', running: '进行中', paused: '已暂停', completed: '已完成', cancelled: '已取消', failed: '异常' } as Record<string, string>)[status] ?? status }
function formatTime(value: string | null): string { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未开始' }
onMounted(() => { void load() })
</script>

<template>
  <ManagementLayout><PageShell variant="detail">
    <PageHeader eyebrow="班级详情" :title="schoolClass?.name || '班级'" subtitle="查看班级资料，并进入学生、奖励、问题和课堂记录。"><template #actions><BackButton label="返回班级列表" /></template></PageHeader>
    <ForbiddenState v-if="forbidden" class="state" description="当前账号没有访问这个班级的权限。" />
    <LoadingState v-else-if="loading" class="state" title="正在加载班级" description="正在获取班级、负责教师和课堂记录。" />
    <ErrorState v-else-if="error" class="state" :description="error" @retry="load" />
    <EmptyState v-else-if="!schoolClass" class="state" title="未找到班级" description="该班级不存在，或当前账号没有访问权限。" :can-act="false" />
    <template v-else>
      <section class="summary-card"><dl><div><dt>年级</dt><dd>{{ schoolClass.grade || '未填写' }}</dd></div><div><dt>年龄段</dt><dd>{{ schoolClass.ageRange || '未填写' }}</dd></div><div><dt>学年</dt><dd>{{ schoolClass.schoolYear }}</dd></div><div><dt>在册幼儿</dt><dd>{{ schoolClass.studentCount ?? 0 }} 人</dd></div><div><dt>班级状态</dt><dd><span class="status" :class="schoolClass.status === 'active' ? 'active' : 'disabled'">{{ schoolClass.status === 'active' ? '启用' : '停用' }}</span></dd></div></dl></section>
      <section class="teacher-card"><h2>负责教师</h2><p v-if="!schoolClass.teachers?.length" class="muted">暂未分配负责教师</p><ul v-else><li v-for="teacher in schoolClass.teachers" :key="`${teacher.teacherId}-${teacher.role}`"><strong>{{ teacher.name }}</strong><span>{{ roleLabel(teacher.role) }}</span></li></ul></section>
      <section class="entry-grid" aria-label="班级功能"><button type="button" @click="openSection('students')"><strong>学生列表</strong><span>查看和维护本班幼儿资料</span></button><button type="button" @click="openSection('class-rewards')"><strong>成长奖励</strong><span>查看奖励与成长记录</span></button><button type="button" @click="openSection('class-questions')"><strong>儿童问题</strong><span>查看课堂问题与问题地图</span></button><button type="button" @click="focusRuns"><strong>课堂记录</strong><span>查看本班课堂时间线和总结</span></button></section>
      <section id="classroom-records" class="record-card"><div class="section-heading"><div><h2>课堂记录</h2><p>共 {{ classroomRunTotal }} 节课堂，显示最近 10 节。</p></div><button class="refresh" @click="load">刷新</button></div><p v-if="!classroomRuns.length" class="muted">本班还没有课堂记录。完成课堂后会在这里显示。</p><ul v-else class="record-list"><li v-for="run in classroomRuns" :key="run.id"><button type="button" @click="openRun(run.id)"><span><strong>{{ run.title }}</strong><small>{{ formatTime(run.startedAt || run.createdAt) }}</small></span><span class="run-status">{{ runStatusLabel(run.status) }}</span></button></li></ul></section>
    </template>
  </PageShell></ManagementLayout>
</template>

<style scoped>
.state,.summary-card,.teacher-card,.entry-grid,.record-card{margin-top:24px}.summary-card,.teacher-card,.record-card{padding:22px;border:1px solid #f0ddce;border-radius:18px;background:#fffdf9}.summary-card dl{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:16px;margin:0}.summary-card div{display:grid;gap:6px}.summary-card dt{color:#a38270;font-size:13px}.summary-card dd{margin:0;color:#60483e;font-size:19px;font-weight:750}.status{display:inline-block;border-radius:999px;padding:5px 10px;font-size:13px}.status.active{background:#e8f7ed;color:#4d9a69}.status.disabled{background:#fff3dc;color:#b77d20}.teacher-card h2,.record-card h2{margin:0;color:#60483e;font-size:20px}.teacher-card ul{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0 0;padding:0;list-style:none}.teacher-card li{display:flex;gap:8px;padding:9px 12px;border-radius:12px;background:#fff4e9;color:#60483e}.teacher-card li span{color:#a38270}.entry-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}.entry-grid button{display:grid;gap:8px;min-height:130px;padding:22px;border:1px solid #efd9c8;border-radius:18px;background:#fffaf4;color:#60483e;text-align:left;cursor:pointer}.entry-grid button:hover{border-color:#e99168;box-shadow:0 12px 28px #b9795120}.entry-grid strong{font-size:18px}.entry-grid span,.muted,.section-heading p,.record-list small{color:#a38270;line-height:1.6}.section-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.section-heading p{margin:5px 0 0}.refresh{border:1px solid #efd9c8;border-radius:10px;padding:8px 14px;background:#fff;color:#b76849;cursor:pointer}.record-list{display:grid;gap:10px;margin:18px 0 0;padding:0;list-style:none}.record-list button{display:flex;width:100%;align-items:center;justify-content:space-between;gap:18px;padding:14px;border:1px solid #f1dfd1;border-radius:12px;background:#fff;color:#60483e;text-align:left;cursor:pointer}.record-list button>span:first-child{display:grid;gap:3px}.run-status{white-space:nowrap;color:#d67b59}@media(max-width:900px){.summary-card dl{grid-template-columns:1fr 1fr}.entry-grid{grid-template-columns:1fr 1fr}}@media(max-width:560px){.summary-card dl,.entry-grid{grid-template-columns:1fr}.section-heading{align-items:stretch;flex-direction:column}}
</style>
