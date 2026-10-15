import type {
  RouteLocationRaw,
  RouteMeta,
} from 'vue-router'
import { userRole } from '@/router/routeMeta'
import type { TeacherInfo } from '@/stores/user'

export type AuthSessionSnapshot = {
  isLogin: boolean
  isAdmin: boolean
  teacherInfo: TeacherInfo | null
}

type AuthRouteTarget = {
  name: string | symbol | null | undefined
  meta: RouteMeta
  fullPath: string
}

export function workspaceHome(info: TeacherInfo | null): RouteLocationRaw {
  return userRole(info) === 'administrator'
    ? { name: 'admin-dashboard' }
    : { name: 'my-classes' }
}

export function safeInternalRedirect(
  value: unknown,
  fallback: RouteLocationRaw,
): RouteLocationRaw {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : fallback
}

export function resolveAuthNavigation(
  to: AuthRouteTarget,
  session: AuthSessionSnapshot,
): true | RouteLocationRaw {
  if (to.name === 'login') {
    return session.isLogin ? workspaceHome(session.teacherInfo) : true
  }
  if (to.meta.requiresAuth && !session.isLogin) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  const role = userRole(session.teacherInfo)
  if (to.meta.roles?.length && (!role || !to.meta.roles.includes(role))) {
    return { name: 'forbidden', query: { from: to.fullPath } }
  }
  if (to.meta.adminOnly && !session.isAdmin) {
    return { name: 'forbidden', query: { from: to.fullPath } }
  }
  return true
}
