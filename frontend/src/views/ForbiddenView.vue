<script setup lang="ts">
import { computed } from 'vue'
import { useUserStore } from '@/stores/user'
import { workspaceHome } from '@/router/authNavigation'

const user = useUserStore()
const destination = computed(() => user.isLogin ? workspaceHome(user.teacherInfo) : { name: 'login' })
</script>

<template>
  <main class="forbidden">
    <section>
      <div class="icon" aria-hidden="true">🔒</div>
      <h1>暂无访问权限</h1>
      <p>当前账号没有访问此页面的权限。</p>
      <RouterLink :to="destination">{{ user.isLogin ? '返回工作台' : '前往登录' }}</RouterLink>
    </section>
  </main>
</template>

<style scoped>
.forbidden{min-height:100dvh;display:grid;place-items:center;padding:24px;background:#fffaf2;text-align:center;color:#516579}.forbidden section{padding:38px;border:1px solid #f0dfd1;border-radius:24px;background:#fff}.icon{font-size:56px}.forbidden a{display:inline-flex;margin-top:12px;padding:10px 18px;border-radius:12px;background:#e99068;color:#fff;text-decoration:none}
</style>
