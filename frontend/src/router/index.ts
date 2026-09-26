import { createRouter, createWebHistory } from 'vue-router'
import { pinia } from '@/stores'
import { useUserStore } from '@/stores/user'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
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
      path: '/classroom/lesson/:runId',
      name: 'lesson-classroom',
      meta: { requiresAuth: true },
      component: () => import('../views/LessonClassroomView.vue'),
    },
  ],
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
})

router.beforeEach((to) => {
  const userStore = useUserStore(pinia)
  userStore.initialize()
  if (to.name === 'login' && userStore.isLogin) {
    return { name: 'chat' }
  }
  if (to.meta.requiresAuth && !userStore.isLogin) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  return true
})

export default router
