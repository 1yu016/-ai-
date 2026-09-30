<script setup lang="ts">
import { ref } from 'vue'
import { ElAlert, ElButton, ElInput, ElMessage } from 'element-plus'
import { useRoute, useRouter } from 'vue-router'
import { apiErrorMessage, http } from '@/api/http'
import { useConversationStore } from '@/stores/conversation'
import { useUserStore, type TeacherInfo } from '@/stores/user'

type LoginResponse = {
  access_token: string
  refresh_token: string
  expires_in: number
  userType: 'teacher' | 'administrator'
  teacherId?: number
  administratorId?: number
}

type MigrationResponse = {
  success: boolean
  migratedCount?: number
  message?: string
}

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()
const conversationStore = useConversationStore()
const account = ref('')
const password = ref('')
const submitting = ref(false)
const errorText = ref('')
const loginType = ref<'teacher' | 'administrator'>('teacher')

async function submitLogin() {
  const normalizedAccount = account.value.trim()
  if (!normalizedAccount || !password.value) {
    errorText.value = '请输入账号和密码。'
    return
  }
  if (submitting.value) return

  submitting.value = true
  errorText.value = ''
  try {
    const login = await http.post<LoginResponse>(loginType.value === 'teacher' ? '/auth/login' : '/auth/admin/login', {
      account: normalizedAccount,
      password: password.value,
      deviceInfo: 'web',
    })
    const profile = await http.get<TeacherInfo>('/auth/profile', {
      headers: {
        Authorization: `Bearer ${login.data.access_token}`,
      },
    })
    userStore.setLogin(login.data.access_token, profile.data, login.data.refresh_token)

    // 登录已经成功。迁移异常只提示，不阻塞教师进入聊天页面。
    try {
      const migration = await http.post<MigrationResponse>(
        '/data/migrate-visitor',
        { visitorId: userStore.visitorId },
      )
      const alreadyMigrated =
        migration.data.success === false &&
        migration.data.message?.includes('已经迁移过')
      if (migration.data.success || alreadyMigrated) {
        if (profile.data.teacherId) conversationStore.migrateVisitorToTeacher(userStore.visitorId, profile.data.teacherId)
      }
    } catch (error) {
      console.error('游客会话迁移失败：', error)
      ElMessage.warning('登录成功，但历史会话迁移失败，可稍后重新登录再试。')
    }

    const redirect = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/') && !route.query.redirect.startsWith('//')
      ? route.query.redirect
      : '/chat'
    await router.push(redirect)
  } catch (error) {
    userStore.logout()
    errorText.value = apiErrorMessage(error, '登录失败，请检查账号和密码。')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="login-page">
    <section class="login-card" aria-labelledby="login-title">
      <div class="login-icon" aria-hidden="true">🌼</div>
      <p class="eyebrow">幼儿园小助手</p>
      <div class="login-tabs"><button type="button" :class="{active: loginType === 'teacher'}" @click="loginType = 'teacher'">教师登录</button><button type="button" :class="{active: loginType === 'administrator'}" @click="loginType = 'administrator'">管理员登录</button></div>
      <h1 id="login-title">{{ loginType === 'teacher' ? '教师登录' : '管理员登录' }}</h1>
      <p class="description">登录后进入对应的教学管理功能。</p>

      <ElAlert
        v-if="errorText"
        class="login-error"
        :title="errorText"
        type="error"
        show-icon
        :closable="false"
      />

      <form class="login-form" @submit.prevent="submitLogin">
        <label for="teacher-account">账号</label>
        <ElInput
          id="teacher-account"
          v-model="account"
          size="large"
          autocomplete="username"
          placeholder="请输入教师账号"
          :disabled="submitting"
        />

        <label for="teacher-password">密码</label>
        <ElInput
          id="teacher-password"
          v-model="password"
          size="large"
          type="password"
          autocomplete="current-password"
          placeholder="请输入密码"
          show-password
          :disabled="submitting"
          @keydown.enter="submitLogin"
        />

        <ElButton
          class="login-button"
          type="primary"
          native-type="submit"
          size="large"
          :loading="submitting"
        >
          登录
        </ElButton>
      </form>

      <button class="back-link" type="button" @click="router.push('/')">
        暂不登录，返回游客聊天
      </button>
    </section>
  </main>
</template>

<style scoped>
.login-tabs{display:flex;gap:8px;margin:0 0 18px;padding:4px;border-radius:12px;background:#fff4e8}.login-tabs button{flex:1;border:0;border-radius:9px;background:transparent;color:#9a806f;padding:9px;cursor:pointer}.login-tabs button.active{background:#fff;color:#bd6d4f;box-shadow:0 2px 8px #c68b6822;font-weight:700}
.login-page {
  min-height: 100dvh;
  box-sizing: border-box;
  display: grid;
  place-items: center;
  padding: 24px;
  background:
    radial-gradient(circle at 15% 18%, #fff7c9 0, transparent 33%),
    radial-gradient(circle at 90% 80%, #ffe5dc 0, transparent 33%), #fffaf2;
  color: #473d36;
}

.login-card {
  width: min(100%, 420px);
  box-sizing: border-box;
  padding: 38px;
  border: 1px solid #f5e5d5;
  border-radius: 28px;
  background: #fffdfa;
  box-shadow: 0 20px 60px rgb(130 83 42 / 12%);
  text-align: center;
}

.login-icon {
  display: grid;
  place-items: center;
  width: 68px;
  height: 68px;
  margin: 0 auto 14px;
  border-radius: 22px;
  background: #ffedb8;
  font-size: 34px;
}

.eyebrow {
  margin: 0;
  color: #be8065;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

h1 {
  margin: 6px 0 8px;
  font-size: 28px;
}

.description {
  margin: 0 0 24px;
  color: #907b6c;
  line-height: 1.7;
}

.login-error {
  margin-bottom: 18px;
  text-align: left;
}

.login-form {
  display: grid;
  gap: 12px;
  text-align: left;
}

.login-form label {
  margin-top: 4px;
  color: #725e50;
  font-size: 14px;
  font-weight: 700;
}

.login-form :deep(.el-input__wrapper) {
  border-radius: 12px;
  box-shadow: 0 0 0 1px #e9dacc inset;
}

.login-button {
  width: 100%;
  margin-top: 10px;
  border: 0;
  border-radius: 12px;
  background: #e9956e;
  font-weight: 700;
}

.login-button:not(.is-disabled):hover,
.login-button:not(.is-disabled):focus {
  background: #dc855f;
}

.back-link {
  margin-top: 20px;
  border: 0;
  background: transparent;
  color: #9a725f;
  cursor: pointer;
  font: inherit;
  font-size: 14px;
}

.back-link:hover,
.back-link:focus-visible {
  color: #b85f45;
  text-decoration: underline;
}

@media (max-width: 520px) {
  .login-page {
    padding: 16px;
  }

  .login-card {
    padding: 28px 22px;
  }
}
</style>
