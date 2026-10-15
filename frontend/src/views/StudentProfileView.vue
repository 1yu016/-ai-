<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useRoute, useRouter } from 'vue-router'
import { apiErrorMessage, apiErrorStatus } from '@/api/http'
import { platformApi, type StudentDetail } from '@/api/platform'
import BackButton from '@/components/BackButton.vue'
import ErrorState from '@/components/ErrorState.vue'
import ForbiddenState from '@/components/ForbiddenState.vue'
import LoadingState from '@/components/LoadingState.vue'
import ManagementLayout from '@/components/ManagementLayout.vue'
import PageHeader from '@/components/PageHeader.vue'
import PageShell from '@/components/PageShell.vue'
import StudentAuthorizationBadge from '@/components/StudentAuthorizationBadge.vue'
import StudentAvatar from '@/components/StudentAvatar.vue'
import {
  CONSENT_STATUS_LABELS,
  CONSENT_TYPE_LABELS,
  studentDisplayName,
  studentStatusLabel,
} from '@/utils/student'

const route = useRoute()
const router = useRouter()
const student = ref<StudentDetail | null>(null)
const name = ref('')
const nickname = ref('')
const gender = ref('')
const birthday = ref('')
const message = ref('')
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const forbidden = ref(false)

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  forbidden.value = false
  try {
    const id = Number(route.params.studentId)
    const classId = Number(route.params.classId)
    const result = await platformApi.studentDetail(id)
    if (result.data.classId !== classId) {
      student.value = null
      error.value = '该学生不属于当前班级。'
      return
    }
    student.value = result.data
    name.value = student.value.name
    nickname.value = student.value.nickname ?? ''
    gender.value = student.value.gender ?? ''
    birthday.value = student.value.birthday ?? ''
  } catch (cause) {
    if (apiErrorStatus(cause) === 403) forbidden.value = true
    else error.value = apiErrorMessage(cause, '学生资料加载失败，请重试。')
  } finally {
    loading.value = false
  }
}

async function save(): Promise<void> {
  if (!student.value) return
  message.value = ''
  error.value = ''
  saving.value = true
  try {
    await platformApi.updateStudent(student.value.id, {
      name: name.value.trim(),
      nickname: nickname.value.trim() || undefined,
      gender: gender.value.trim() || undefined,
      birthday: birthday.value || undefined,
    })
    message.value = '已保存'
    await load()
  } catch (cause) {
    error.value = apiErrorMessage(cause, '保存失败，已保留当前输入，请重试。')
  } finally {
    saving.value = false
  }
}

async function toggleStatus(): Promise<void> {
  if (!student.value) return
  const disabling = student.value.status === 'active'
  const action = disabling ? '停用' : '恢复'
  try {
    await ElMessageBox.confirm(
      disabling
        ? '停用后，该幼儿不会参与点名和新课堂操作，历史记录仍会保留。'
        : '恢复后，该幼儿将重新参与班级课堂操作。',
      `${action}学生`,
      { confirmButtonText: action, cancelButtonText: '取消', type: 'warning' },
    )
    await platformApi.updateStudent(student.value.id, {
      status: disabling ? 'disabled' : 'active',
    })
    ElMessage.success(`${action}成功`)
    await load()
  } catch (cause) {
    if (cause === 'cancel' || cause === 'close') return
    error.value = apiErrorMessage(cause, `${action}失败，请重试。`)
  }
}

function openBusiness(name: 'class-rewards' | 'class-questions' | 'class-detail') {
  if (!student.value) return
  void router.push({ name, params: { classId: student.value.classId } })
}

onMounted(load)
</script>

<template>
  <ManagementLayout>
    <PageShell variant="detail">
      <PageHeader eyebrow="班级学生" :title="student ? studentDisplayName(student) : '学生资料'" subtitle="查看授权状态并维护幼儿基础资料。">
        <template #actions><BackButton label="返回学生列表" /></template>
      </PageHeader>
      <ForbiddenState v-if="forbidden" class="state" description="当前账号无权查看该班级幼儿资料。" />
      <LoadingState v-else-if="loading" class="state" title="正在加载学生资料" description="正在读取基础信息与监护人授权状态。" />
      <ErrorState v-else-if="error && !student" class="state" :description="error" @retry="load" />
      <div v-else-if="student" class="detail-grid">
        <ErrorState v-if="error" :description="error" @retry="save" />
        <section class="panel identity-card">
          <StudentAvatar :student="student" :size="76" />
          <div><strong>{{ studentDisplayName(student) }}</strong><span>{{ student.className }} · {{ student.studentNo }}</span></div>
          <StudentAuthorizationBadge :status="student.authorizationStatus" />
          <span class="status" :class="student.status">{{ studentStatusLabel(student.status) }}</span>
        </section>
        <section class="panel form">
          <h2>基础资料</h2>
          <label>学号<input :value="student.studentNo" disabled /></label>
          <label>姓名<input v-model="name" maxlength="100" /></label>
          <label>昵称<input v-model="nickname" maxlength="100" /></label>
          <label>性别<input v-model="gender" maxlength="20" /></label>
          <label>生日<input v-model="birthday" type="date" /></label>
          <div class="save-row">
            <button class="button" :disabled="saving || !name.trim()" @click="save">{{ saving ? '保存中…' : '保存资料' }}</button>
            <button class="soft" @click="toggleStatus">{{ student.status === 'active' ? '停用学生' : '恢复学生' }}</button>
            <span class="ok">{{ message }}</span>
          </div>
        </section>
        <section class="panel consent-card">
          <h2>监护人授权</h2>
          <p class="privacy-note">未授权照片和声音不会在页面中加载或播放。</p>
          <div class="consent-list">
            <article v-for="consent in student.consents" :key="consent.id">
              <strong>{{ CONSENT_TYPE_LABELS[consent.consentType] }}</strong>
              <span :class="consent.status">{{ CONSENT_STATUS_LABELS[consent.status] }}</span>
              <small v-if="consent.note">{{ consent.note }}</small>
            </article>
            <p v-if="!student.consents.length" class="muted">尚无授权记录，当前状态为待确认。</p>
          </div>
        </section>
        <section class="panel business-card">
          <h2>业务记录</h2>
          <div class="business-actions">
            <button class="soft" @click="openBusiness('class-rewards')">成长奖励</button>
            <button class="soft" @click="openBusiness('class-questions')">儿童问题</button>
            <button class="soft" @click="openBusiness('class-detail')">班级与课堂记录</button>
          </div>
        </section>
      </div>
    </PageShell>
  </ManagementLayout>
</template>

<style scoped>
.state,.detail-grid{margin-top:22px}.detail-grid{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(300px,.8fr);gap:18px}.detail-grid>.state,.identity-card,.business-card{grid-column:1/-1}.panel{padding:22px;border:1px solid #f0ddce;border-radius:18px;background:#fffdf9;box-shadow:0 10px 28px #b9795114}.panel h2{margin:0 0 16px;color:#60483e}.identity-card{display:flex;align-items:center;gap:16px}.identity-card>div{display:grid;gap:5px;margin-right:auto}.identity-card strong{font-size:24px;color:#493d36}.identity-card span{color:#9a7e6e}.status{border-radius:999px;padding:5px 10px;font-size:12px;font-weight:700}.status.active{background:#e8f7ed;color:#388557}.status.disabled{background:#f0eef1;color:#7f737c}.form{display:grid;grid-template-columns:1fr 1fr;gap:16px}.form h2,.save-row{grid-column:1/-1}.form label{display:grid;gap:7px;font-weight:700;color:#60483e}.form input{height:40px;border:1px solid #efd9c8;background:#fffdf9;border-radius:10px;padding:0 10px}.form input:disabled{background:#f4f1ed;color:#8d8179}.save-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.button,.soft{width:max-content;border-radius:12px;padding:11px 18px;cursor:pointer}.button{border:0;background:#e99168;color:#fff}.button:disabled{opacity:.5;cursor:not-allowed}.soft{border:1px solid #efd9c8;background:#fff;color:#876b5d}.ok{color:#4d9a69}.muted,.privacy-note{color:#a38270;font-weight:400}.consent-list{display:grid;gap:10px}.consent-list article{display:grid;grid-template-columns:1fr auto;gap:5px 12px;padding:12px;border-radius:12px;background:#fff8f0}.consent-list article span{font-weight:700}.consent-list article span.granted{color:#388557}.consent-list article span.revoked{color:#bb4949}.consent-list article span.pending{color:#a66f19}.consent-list article small{grid-column:1/-1;color:#8d7568}.business-actions{display:flex;gap:10px;flex-wrap:wrap}@media(max-width:800px){.detail-grid{grid-template-columns:1fr}.identity-card{flex-wrap:wrap}.form{grid-template-columns:1fr}.form h2,.save-row{grid-column:auto}}
</style>
