<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router'
import { http } from '@/api/http'
import { useUserStore } from '@/stores/user'
import type { ClassroomRunPayload } from '@/stores/lessonRun'
import WorkspaceBreadcrumbs from '@/components/WorkspaceBreadcrumbs.vue'
import { activeNavForRole, userRole } from '@/router/routeMeta'
import { logoutAuthenticatedSession } from '@/services/authSession'
import { CLASSROOM_LOGOUT_MESSAGE } from '@/router/classroomExitPolicy'

type WorkspaceNavItem = {
  label: string
  to: RouteLocationRaw
  activeNames?: string[]
}

type WorkspaceNavSection = {
  label: string
  items: WorkspaceNavItem[]
}

const props = withDefaults(
  defineProps<{
    workspaceName: string
    roleLabel: string
    homeRoute: RouteLocationRaw
    sections: WorkspaceNavSection[]
    showActiveClassroom?: boolean
  }>(),
  { showActiveClassroom: false },
)

const route = useRoute()
const router = useRouter()
const user = useUserStore()
const menuOpen = ref(false)
const activeRun = ref<ClassroomRunPayload | null>(null)
const activeRuns = ref<ClassroomRunPayload[]>([])
const activeLoading = ref(false)
const activeError = ref(false)
const activeCheckedAt = ref(0)
const clock = ref(Date.now())
const activeStale = computed(() => !activeCheckedAt.value || clock.value - activeCheckedAt.value >= 60000)
let activeRead = 0
let clockTimer: ReturnType<typeof setInterval> | undefined
const loggingOut = ref(false)

const userName = computed(() => user.teacherInfo?.name || user.teacherInfo?.account || '当前用户')

function isActive(item: WorkspaceNavItem): boolean {
  const routeName = typeof route.name === 'string' ? route.name : ''
  const activeNav = activeNavForRole(route.meta.activeNav, userRole(user.teacherInfo))
  if (activeNav) {
    if (item.activeNames?.includes(activeNav)) return true
    if (typeof item.to === 'object' && 'name' in item.to) return item.to.name === activeNav
  }
  if (item.activeNames?.includes(routeName)) return true
  if (typeof item.to === 'object' && 'name' in item.to) return item.to.name === route.name
  return typeof item.to === 'string' && item.to === route.path
}

async function loadActiveRun(): Promise<void> {
  if (!props.showActiveClassroom) return
  const generation = ++activeRead
  activeLoading.value = true
  try {
    const { data } = await http.get<ClassroomRunPayload | ClassroomRunPayload[] | null>('/classroom-runs/active')
    if (generation !== activeRead) return
    activeRuns.value = (Array.isArray(data) ? data : data ? [data] : []).filter(item => ['running', 'paused'].includes(item.status))
    activeRun.value = activeRuns.value.length === 1 ? activeRuns.value[0]! : null
    activeError.value = false
    activeCheckedAt.value = Date.now()
    clock.value = Date.now()
  } catch {
    if (generation === activeRead) activeError.value = true
  } finally { if (generation === activeRead) activeLoading.value = false }
}

function goHome(): void {
  void router.push(props.homeRoute)
}

function goTo(target: RouteLocationRaw): void {
  void router.push(target)
}

function goDeviceSetup(): void {
  menuOpen.value = false
  if (user.isAdmin) return
  void router.push({ name: 'classroom-scan' })
}

function goBackToClassroom(): void {
  if (!activeRun.value) return
  void router.push({ name: 'lesson-classroom', params: { runId: activeRun.value.id } })
}

async function logout(): Promise<void> {
  if (loggingOut.value) return
  loggingOut.value = true
  try {
    await loadActiveRun()
    if (activeRuns.value.length && !window.confirm(CLASSROOM_LOGOUT_MESSAGE)) return
    menuOpen.value = false
    await logoutAuthenticatedSession()
    await router.replace({ name: 'login' })
  } finally { loggingOut.value = false }
}

function closeMenu(event: MouseEvent): void {
  const target = event.target as HTMLElement
  if (!target.closest('.workspace-user')) menuOpen.value = false
}

onMounted(() => {
  document.addEventListener('click', closeMenu)
  void loadActiveRun()
  window.addEventListener('focus', refreshOnFocus)
  if (props.showActiveClassroom) clockTimer = setInterval(() => { clock.value = Date.now() }, 15000)
})
function refreshOnFocus() { void loadActiveRun() }
async function refreshNavigation() {
  await loadActiveRun()
  // Notify the mounted workspace page to refresh its own read-only projection too.
  window.dispatchEvent(new Event('classroom-navigation-refresh'))
}
watch(() => route.fullPath, () => { void loadActiveRun() })
onBeforeUnmount(() => {
  activeRead++
  document.removeEventListener('click', closeMenu)
  window.removeEventListener('focus', refreshOnFocus)
  if (clockTimer) clearInterval(clockTimer)
})
</script>

<template>
  <div class="workspace-layout">
    <aside class="workspace-sidebar" aria-label="工作台导航">
      <button class="workspace-brand brand" type="button" @click="goHome">
        <span class="workspace-logo" aria-hidden="true">🌼</span>
        <span class="workspace-brand-copy">
          <strong>幼儿园数字人课堂</strong>
          <small>{{ workspaceName }}</small>
        </span>
      </button>

      <nav class="workspace-nav">
        <section v-for="section in sections" :key="section.label" class="workspace-nav-section">
          <p>{{ section.label }}</p>
          <button
            v-for="item in section.items"
            :key="item.label"
            type="button"
            class="workspace-nav-link"
            :class="{ active: isActive(item) }"
            @click="goTo(item.to)"
          >
            {{ item.label }}
          </button>
        </section>
      </nav>
    </aside>

    <div class="workspace-main">
      <header class="workspace-topbar">
        <div class="workspace-context">
          <span class="workspace-context-logo" aria-hidden="true">🌼</span>
          <div>
            <strong>{{ workspaceName }}</strong>
            <small>{{ roleLabel }}</small>
          </div>
        </div>

        <button
          v-if="activeRun && !activeError && !activeStale"
          class="active-classroom"
          data-test="active-run-entry"
          type="button"
          @click="goBackToClassroom"
        >
          <i aria-hidden="true"></i>
          课堂进行中 · 返回课堂
        </button>
        <div v-if="showActiveClassroom" class="classroom-freshness" aria-live="polite">
          <span v-if="activeLoading">正在查询当前课堂…</span>
          <span v-else-if="activeError">当前课堂状态未知，请重新查询</span>
          <span v-else-if="activeStale">课堂状态已过期，请刷新</span>
          <span v-else-if="!activeRuns.length">暂无活动课堂</span>
          <select v-else-if="activeRuns.length > 1" aria-label="选择当前课堂" @change="goTo({ name: 'lesson-classroom', params: { runId: ($event.target as HTMLSelectElement).value } })">
            <option value="" disabled selected>选择要继续的课堂</option>
            <option v-for="item in activeRuns" :key="item.id" :value="item.id">{{ item.title || `课堂 ${item.id}` }}</option>
          </select>
          <small v-if="activeCheckedAt">查询于 {{ new Date(activeCheckedAt).toLocaleTimeString() }}</small>
          <button type="button" :disabled="activeLoading" @click="refreshNavigation">刷新课堂状态</button>
        </div>

        <div class="workspace-user">
          <button
            class="workspace-user-trigger"
            data-test="topbar-user"
            type="button"
            :aria-expanded="menuOpen"
            @click.stop="menuOpen = !menuOpen"
          >
            <span class="workspace-user-copy">
              <strong>{{ userName }}</strong>
              <small>{{ roleLabel }}</small>
            </span>
            <span aria-hidden="true">▾</span>
          </button>
          <div v-if="menuOpen" class="workspace-user-menu" data-test="settings-menu">
            <div class="workspace-user-summary">
              <strong>{{ userName }}</strong>
              <span>{{ roleLabel }}</span>
            </div>
    <button v-if="!user.isAdmin" type="button" @click="goDeviceSetup">课堂设备 · 连接手机</button>
    <button v-else type="button" @click="goTo({ name: 'devices' }); menuOpen = false">设备配置与绑定检查</button>
            <button type="button" :disabled="loggingOut" @click="logout">
              {{ loggingOut ? '正在退出…' : '退出登录' }}
            </button>
          </div>
        </div>
      </header>

      <section class="workspace-content">
        <WorkspaceBreadcrumbs />
        <slot />
      </section>
    </div>
  </div>
</template>

<style scoped>
.workspace-layout{min-height:100dvh;display:grid;grid-template-columns:248px minmax(0,1fr);background:#fff8ee;color:#60483e;overflow-x:hidden}
.workspace-sidebar{position:sticky;top:0;height:100dvh;box-sizing:border-box;display:flex;flex-direction:column;gap:22px;padding:20px 14px;background:#fffaf2;border-right:1px solid #f2dfcf;overflow-y:auto}
.workspace-brand{display:flex;align-items:center;gap:11px;width:100%;padding:10px;border:0;border-radius:14px;background:transparent;color:#734d3c;text-align:left;cursor:pointer}
.workspace-brand:hover{background:#fff1e2}.workspace-logo,.workspace-context-logo{display:grid;place-items:center;flex:0 0 auto;width:38px;height:38px;border-radius:12px;background:#fff0bf;font-size:21px}
.workspace-brand-copy,.workspace-context>div,.workspace-user-copy{display:grid;min-width:0;gap:2px}.workspace-brand-copy strong{font-size:15px;white-space:nowrap}.workspace-brand-copy small,.workspace-context small,.workspace-user-copy small{color:#a38270;font-size:12px}
.workspace-nav{display:grid;gap:20px}.workspace-nav-section{display:grid;gap:4px}.workspace-nav-section p{margin:0 10px 4px;color:#b47d62;font-size:11px;font-weight:800;letter-spacing:.08em}
.workspace-nav-link{display:block;width:100%;padding:11px 12px;border:0;border-radius:12px;background:transparent;color:#876b5d;text-align:left;font:inherit;font-size:14px;font-weight:650;cursor:pointer}.workspace-nav-link:hover{background:#fff1e2;color:#c96e45}.workspace-nav-link.active{background:#ffe9d8;color:#bd6847;box-shadow:inset 3px 0 #eb956b}
.workspace-main{min-width:0}.workspace-topbar{position:sticky;top:0;z-index:30;min-height:68px;box-sizing:border-box;display:flex;align-items:center;gap:16px;padding:10px 26px;background:#fffaf4ef;border-bottom:1px solid #f2dfcf;backdrop-filter:blur(14px)}
.classroom-freshness{display:flex;align-items:center;flex-wrap:wrap;gap:6px;font-size:12px;color:#876b5d;max-width:330px}.classroom-freshness small{font-size:11px}.classroom-freshness button,.classroom-freshness select{border:1px solid #ecd9cb;background:#fffaf4;color:#875d48;border-radius:8px;padding:6px;font:inherit}.classroom-freshness button:disabled{opacity:.5}@media(max-width:640px){.workspace-topbar{flex-wrap:wrap}.classroom-freshness{order:3;width:100%;max-width:none}}
.workspace-context{display:flex;align-items:center;gap:10px;margin-right:auto}.workspace-context>div strong{font-size:15px}.workspace-context-logo{display:none;width:34px;height:34px;font-size:18px}
.active-classroom{display:inline-flex;align-items:center;gap:8px;border:1px solid #f6dcc4;border-radius:999px;padding:8px 14px;background:#fff1e2;color:#c96e45;font:inherit;font-size:13px;font-weight:800;cursor:pointer}.active-classroom i{width:8px;height:8px;border-radius:50%;background:#4d9a69;animation:pulse 1.2s infinite}
.workspace-user{position:relative}.workspace-user-trigger{display:flex;align-items:center;gap:12px;min-width:170px;padding:8px 12px;border:1px solid #f2dfcf;border-radius:13px;background:#fffdf9;color:#60483e;text-align:left;cursor:pointer}.workspace-user-copy{flex:1}.workspace-user-copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}
.workspace-user-menu{position:absolute;right:0;top:calc(100% + 7px);z-index:40;display:grid;min-width:190px;padding:7px;border:1px solid #f0ddce;border-radius:14px;background:#fffdf9;box-shadow:0 16px 36px #8a5a2a20}.workspace-user-summary{display:grid;gap:2px;padding:10px 11px;border-bottom:1px solid #f4e6dc}.workspace-user-summary span{color:#a38270;font-size:12px}.workspace-user-menu button{margin-top:5px;padding:10px 11px;border:0;border-radius:10px;background:transparent;color:#b45145;text-align:left;cursor:pointer}.workspace-user-menu button:hover{background:#fff0ed}
.workspace-content{min-width:0;padding:28px;box-sizing:border-box}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
@media(max-width:960px){.workspace-layout{grid-template-columns:1fr}.workspace-sidebar{position:static;width:100%;height:auto;padding:10px 14px;gap:8px;border-right:0;border-bottom:1px solid #f2dfcf;overflow:hidden}.workspace-brand{display:none}.workspace-nav{display:flex;gap:12px;overflow-x:auto;padding-bottom:4px}.workspace-nav-section{display:flex;gap:4px;align-items:center;flex:0 0 auto}.workspace-nav-section p{display:none}.workspace-nav-link{white-space:nowrap}.workspace-nav-link.active{box-shadow:inset 0 -3px #eb956b}.workspace-context-logo{display:grid}.workspace-topbar{padding:9px 16px}.workspace-content{padding:22px 18px}}
@media(max-width:640px){.workspace-context>div{display:none}.active-classroom{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.workspace-user-trigger{min-width:0}.workspace-user-copy small{display:none}.workspace-content{padding:18px 12px}}
</style>
