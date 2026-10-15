<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const user = useUserStore()
const homeLabel = computed(() => user.isAdmin ? '返回管理后台' : user.isLogin ? '返回我的班级' : '返回首页')
function goHome(): void {
  if (user.isAdmin) void router.push({ name: 'admin-dashboard' })
  else if (user.isLogin) void router.push({ name: 'my-classes' })
  else void router.push({ name: 'chat' })
}
</script>

<template>
  <main class="not-found">
    <span aria-hidden="true">404</span>
    <h1>这个页面不存在</h1>
    <p>地址可能已更新，或页面已经被移除。</p>
    <button type="button" @click="goHome">{{ homeLabel }}</button>
  </main>
</template>

<style scoped>
.not-found{min-height:100dvh;display:grid;place-content:center;justify-items:center;gap:14px;padding:24px;background:#fff8ee;color:#60483e;text-align:center}.not-found>span{font-size:72px;font-weight:900;color:#efb28f}.not-found h1,.not-found p{margin:0}.not-found p{color:#9a7e6e}.not-found button{margin-top:10px;padding:12px 20px;border:0;border-radius:13px;background:#e99168;color:#fff;font:inherit;font-weight:750;cursor:pointer}
</style>
