<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { http } from '@/api/http'
import type { ClassroomRunPayload } from '@/stores/lessonRun'

const router = useRouter()
const user = useUserStore()
const isAdmin = computed(() => user.isAdmin)
function logout() { user.logout(); void router.push({ name: 'login' }) }

// 用户/设置菜单（右上角）
const settingsOpen = ref(false)
function toggleSettings() { settingsOpen.value = !settingsOpen.value }
function closeSettings() { settingsOpen.value = false }
function goDeviceSetup() { closeSettings(); void router.push({ name: 'classroom-scan' }) }
function onWindowClick(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (!target.closest('.settings-wrap')) settingsOpen.value = false
}
onMounted(() => document.addEventListener('click', onWindowClick))
onBeforeUnmount(() => document.removeEventListener('click', onWindowClick))

// Active Classroom：有进行中的 ClassroomRun 时，顶栏显示「返回课堂」入口。
// 复用现有 GET /classroom-runs/active（可能返回单个对象或数组），不新建后端。
const activeRun = ref<ClassroomRunPayload | null>(null)
function normalizeActive(data: ClassroomRunPayload | ClassroomRunPayload[]): ClassroomRunPayload | null {
  const current = Array.isArray(data) ? (data[0] ?? null) : data
  if (!current) return null
  return current.status === 'running' || current.status === 'paused' ? current : null
}
async function loadActiveRun() {
  try {
    const { data } = await http.get<ClassroomRunPayload | ClassroomRunPayload[]>('/classroom-runs/active')
    activeRun.value = normalizeActive(data)
  } catch {
    activeRun.value = null
  }
}
function goBackToClassroom() {
  if (!activeRun.value) return
  void router.push({ name: 'lesson-classroom', params: { runId: activeRun.value.id } })
}
onMounted(loadActiveRun)
</script>
<template><div class="management"><aside><button class="brand" @click="router.push({ name: isAdmin ? 'classes' : 'my-classes' })">🌼 {{ isAdmin ? '幼教管理员控制台' : '幼教教师工作台' }}</button><nav><template v-if="isAdmin"><small class="nav-title">平台管理</small><button @click="router.push({ name: 'admin-dashboard' })">数据看板</button><button @click="router.push({ name: 'admin-audit' })">审计日志</button><button @click="router.push({ name: 'resources', query: { reviewStatus: 'pending' } })">资源审核</button><button @click="router.push({ name: 'avatars' })">数字人角色库</button><button @click="router.push({ name: 'teachers' })">教师管理</button><button @click="router.push({ name: 'classes' })">班级与学生</button><button @click="router.push({ name: 'student-center' })">学生管理中心</button><button @click="router.push({ name: 'devices' })">教室与设备</button><button @click="router.push({ name: 'classroom-scan' })">课堂设备准备</button></template><template v-else><small class="nav-title">AI助教</small><button @click="router.push({ name: 'chat' })">AI助教</button><small class="nav-title lesson-nav">课堂教学</small><button @click="router.push({ name: 'my-classes' })">我的班级</button><button @click="router.push({ name: 'lesson-plans' })">备课中心</button><button @click="router.push({ name: 'avatars' })">数字人角色库</button><small class="nav-title lesson-nav">教学资源</small><button @click="router.push({ name: 'resources' })">资源库</button></template></nav><button class="logout" @click="logout">退出登录</button></aside><main><header><div class="topbar-left"><span v-if="activeRun" class="active-chip" data-test="active-run-entry" @click="goBackToClassroom"><i class="pulse"></i>课堂进行中 · <button class="link-like" @click.prevent="goBackToClassroom">返回课堂</button></span></div><div class="settings-wrap"><button class="userbtn" data-test="topbar-user" @click="toggleSettings">{{ user.teacherInfo?.name || '当前账号' }} · {{ isAdmin ? '管理员' : '教师' }} ▾</button><div v-if="settingsOpen" class="settings-menu" data-test="settings-menu"><button @click="goDeviceSetup">课堂设备</button><button @click="logout">退出登录</button></div></div></header><section class="content"><slot /></section></main></div></template>
<style scoped>.management{min-height:100dvh;display:flex;background:#fff8ee;color:#60483e}.management aside{width:232px;background:#fffaf2;border-right:1px solid #f2dfcf;padding:22px 14px;display:flex;flex-direction:column}.brand{border:0;background:none;font-size:17px;font-weight:800;color:#734d3c;text-align:left;padding:10px;cursor:pointer;white-space:nowrap}.management nav{display:grid;gap:5px;margin-top:24px}.nav-title{padding:0 12px 4px;color:#b47d62;font-size:11px;font-weight:800}.lesson-nav{margin-top:16px}.management nav button,.logout{border:0;background:none;text-align:left;color:#876b5d;padding:11px 12px;border-radius:12px;cursor:pointer}.management nav button:hover{background:#ffeadc;color:#c96e45}.logout{margin-top:auto}.management main{flex:1;min-width:0}.management header{min-height:60px;background:#fffaf4;border-bottom:1px solid #f2dfcf;display:flex;justify-content:space-between;align-items:center;gap:18px;padding:0 26px;color:#8a6d5f}.topbar-left{display:flex;align-items:center;gap:12px}.active-chip{display:inline-flex;align-items:center;gap:8px;background:#fff1e2;border:1px solid #f6dcc4;color:#c96e45;font-weight:700;border-radius:999px;padding:6px 14px;cursor:pointer;font-size:13px}.active-chip .pulse{width:8px;height:8px;border-radius:50%;background:#4d9a69;animation:blink 1.2s infinite}.active-chip .link-like{border:0;background:none;color:#c96e45;cursor:pointer;font-weight:800;font-size:13px;padding:0}.active-chip .link-like:hover{text-decoration:underline}@keyframes blink{0%,100%{opacity:1}50%{opacity:.25}}.settings-wrap{position:relative}.userbtn{border:1px solid #f2dfcf;background:#fffdf9;color:#8a6d5f;border-radius:12px;padding:9px 14px;cursor:pointer}.settings-menu{position:absolute;right:0;top:calc(100% + 6px);z-index:40;min-width:150px;background:#fffdf9;border:1px solid #f0ddce;border-radius:14px;box-shadow:0 14px 34px #8a5a2a1c;padding:6px;display:grid;gap:2px}.settings-menu button{border:0;background:none;text-align:left;color:#60483e;padding:10px 12px;border-radius:10px;cursor:pointer}.settings-menu button:hover{background:#fff1e2;color:#c96e45}.content{max-width:1320px;margin:auto;padding:26px 28px}.content h1{margin:0 0 8px;font-size:28px;color:#60483e}.muted{color:#a38270}.toolbar{display:flex;gap:10px;margin:22px 0}.toolbar input,.toolbar select{height:38px;border:1px solid #efd9c8;border-radius:12px;padding:0 11px;background:#fffdf9;color:#60483e}.button{border:0;background:#eb956b;color:#fff;border-radius:12px;padding:10px 16px;cursor:pointer}.panel{background:#fffdf9;border:1px solid #f0ddce;border-radius:16px;padding:18px;box-shadow:0 8px 24px #c88d6012}.table{width:100%;border-collapse:collapse}.table th,.table td{text-align:left;padding:13px 10px;border-bottom:1px solid #f4e6dc;font-size:14px}.badge{border-radius:12px;padding:4px 8px;font-size:12px}.ok{background:#e8f7ed;color:#4d9a69}.warn{background:#fff3dc;color:#b77d20}.bad{background:#ffebeb;color:#c64e4e}@media(max-width:900px){.management aside{width:64px;padding:12px 6px}.brand{font-size:0}.management nav button,.nav-title{font-size:0}.nav-title{text-align:center}.content{padding:18px}.management header{padding:0 14px}}</style>
