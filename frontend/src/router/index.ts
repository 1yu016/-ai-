import { createRouter, createWebHistory } from 'vue-router'
import { pinia } from '@/stores'
import { useUserStore } from '@/stores/user'
import { enhanceRoutes } from '@/router/routeDefinitions'
import { resolveAuthNavigation } from '@/router/authNavigation'

const routes = enhanceRoutes([
    {
      path: '/',
      redirect: '/chat',
    },
    {
      path: '/chat',
      name: 'chat',
      component: () => import('../views/ChatView.vue'),
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/LoginView.vue'),
    },
    { path: '/classes', name: 'classes', meta: { requiresAuth: true, adminOnly: true }, component: () => import('../views/ClassesView.vue') },
    { path: '/admin', name: 'admin-dashboard', meta: { requiresAuth: true, adminOnly: true }, component: () => import('../views/AdminDashboardView.vue') },
    { path: '/admin/audit', name: 'admin-audit', meta: { requiresAuth: true, adminOnly: true }, component: () => import('../views/AdminAuditView.vue') },
    { path: '/teachers', name: 'teachers', meta: { requiresAuth: true, adminOnly: true }, component: () => import('../views/TeacherManagementView.vue') },
    { path: '/my-classes', name: 'my-classes', meta: { requiresAuth: true }, component: () => import('../views/MyClassesView.vue') },
    { path: '/students', name: 'student-center', meta: { requiresAuth: true, adminOnly: true }, component: () => import('../views/StudentCenterView.vue') },
    { path: '/classes/:classId/students', name: 'students', meta: { requiresAuth: true }, component: () => import('../views/StudentsView.vue') },
    { path: '/classes/:classId/rewards', name: 'class-rewards', meta: { requiresAuth: true }, component: () => import('../views/ClassRewardHistoryView.vue') },
    { path: '/classes/:classId/questions', name: 'class-questions', meta: { requiresAuth: true }, component: () => import('../views/ClassQuestionHistoryView.vue') },
    { path: '/students/:studentId', name: 'student-profile', meta: { requiresAuth: true }, component: () => import('../views/StudentProfileView.vue') },
    { path: '/classrooms', name: 'classrooms', meta: { requiresAuth: true }, component: () => import('../views/ClassroomsView.vue') },
    { path: '/classrooms/:classroomId', name: 'classroom-detail', meta: { requiresAuth: true }, component: () => import('../views/ClassroomDetailView.vue') },
    { path: '/devices', name: 'devices', meta: { requiresAuth: true }, component: () => import('../views/DevicesView.vue') },
    { path: '/devices/:deviceId', name: 'device-detail', meta: { requiresAuth: true }, component: () => import('../views/DeviceDetailView.vue') },
    { path: '/avatars', name: 'avatars', meta: { requiresAuth: true }, component: () => import('../views/AvatarLibraryView.vue') },
    { path: '/classroom/scan', name: 'classroom-scan', meta: { requiresAuth: true }, component: () => import('../views/ClassroomScanView.vue') },
    { path: '/classroom/join', name: 'classroom-join', meta: { requiresAuth: true }, component: () => import('../views/ClassroomJoinView.vue') },
    { path: '/classroom/screen/:deviceId?', name: 'classroom-screen', meta: { requiresAuth: true }, component: () => import('../views/ClassroomScreenView.vue') },
    { path: '/forbidden', name: 'forbidden', component: () => import('../views/ForbiddenView.vue') },
    {
      path: '/lesson-plans',
      name: 'lesson-plans',
      meta: { requiresAuth: true },
      component: () => import('../views/LessonPlanListView.vue'),
    },
    {
      path: '/lesson-plans/new',
      name: 'lesson-plan-new',
      meta: { requiresAuth: true },
      component: () => import('../views/LessonPlanEditorView.vue'),
    },
    {
      path: '/lesson-plans/:id/edit',
      name: 'lesson-plan-edit',
      meta: { requiresAuth: true },
      component: () => import('../views/LessonPlanEditorView.vue'),
    },
    {
      path: '/classroom/preflight/:planId',
      name: 'lesson-classroom-preflight',
      meta: { requiresAuth: true },
      component: () => import('../views/ClassroomPreflightView.vue'),
    },
    {
      path: '/classroom/lesson/:runId',
      name: 'lesson-classroom',
      meta: { requiresAuth: true },
      component: () => import('../views/LessonClassroomView.vue'),
    },
    {
      path: '/classroom/records/:runId',
      name: 'classroom-record',
      meta: { requiresAuth: true },
      component: () => import('../views/ClassroomRecordView.vue'),
    },
    {
      path: '/classroom/lesson/:runId/summary',
      name: 'lesson-classroom-summary',
      meta: { requiresAuth: true },
      component: () => import('../views/ClassroomRunSummaryView.vue'),
    },
    { path: '/classroom/engagement', name: 'classroom-engagement', meta: { requiresAuth: true }, component: () => import('../views/ClassroomOperationsView.vue') },
    { path: '/classroom/insights', name: 'classroom-insights', meta: { requiresAuth: true }, component: () => import('../views/ClassroomOperationsView.vue') },
    { path: '/classroom/remote', name: 'classroom-remote', meta: { requiresAuth: true }, component: () => import('../views/ClassroomMobileRemoteView.vue') },
    // 资源库（静态路由在前，动态 :id 在后，避免抢先匹配 upload/preview/edit/review）
    { path: '/resources', name: 'resources', meta: { requiresAuth: true }, component: () => import('../views/resources/ResourceLibraryView.vue') },
    { path: '/resources/upload', name: 'resource-upload', meta: { requiresAuth: true }, component: () => import('../views/resources/UploadView.vue') },
    { path: '/resources/:id/preview', name: 'resource-preview', meta: { requiresAuth: true }, props: true, component: () => import('../views/resources/ResourcePreviewView.vue') },
    { path: '/resources/:id/edit', name: 'resource-edit', meta: { requiresAuth: true }, props: true, component: () => import('../views/resources/ResourceEditView.vue') },
    { path: '/resources/:id/review', name: 'resource-review', meta: { requiresAuth: true, adminOnly: true }, props: true, component: () => import('../views/resources/ResourceReviewView.vue') },
    { path: '/resources/:id', name: 'resource-detail', meta: { requiresAuth: true }, props: true, component: () => import('../views/resources/ResourceDetailView.vue') },
  ])

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

const CHUNK_RELOAD_STORAGE_KEY = 'kindergarten-ai:chunk-reload-target'
const DYNAMIC_IMPORT_ERROR = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i

router.onError((error, to) => {
  const message = error instanceof Error ? error.message : String(error)
  if (!DYNAMIC_IMPORT_ERROR.test(message)) return
  const target = to.fullPath
  if (sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY) === target) {
    sessionStorage.removeItem(CHUNK_RELOAD_STORAGE_KEY)
    return
  }
  sessionStorage.setItem(CHUNK_RELOAD_STORAGE_KEY, target)
  window.location.replace(target)
})

router.afterEach((to) => {
  if (sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY) === to.fullPath) {
    sessionStorage.removeItem(CHUNK_RELOAD_STORAGE_KEY)
  }
  document.title = to.meta.title ? `${to.meta.title} · 幼儿园数字人课堂` : '幼儿园数字人课堂'
})

router.beforeEach((to) => {
  const userStore = useUserStore(pinia)
  userStore.initialize()
  return resolveAuthNavigation(to, {
    isLogin: userStore.isLogin,
    isAdmin: userStore.isAdmin,
    teacherInfo: userStore.teacherInfo,
  })
})

export { routes }
export default router
