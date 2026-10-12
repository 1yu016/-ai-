import type {
  RouteLocationNormalizedLoaded,
  RouteLocationRaw,
  Router,
} from 'vue-router'
import type { TeacherInfo } from '@/stores/user'

export type AppRole = 'teacher' | 'administrator'
export type AppLayout = 'auth' | 'workspace' | 'classroom' | 'screen' | 'mobile' | 'standalone'
export type BreadcrumbEntity = 'class' | 'student' | 'resource'

export type BreadcrumbDefinition = {
  label?: string
  entity?: BreadcrumbEntity
  param?: string
  to?: RouteLocationRaw | ((route: RouteLocationNormalizedLoaded) => RouteLocationRaw)
  roles?: AppRole[]
}

export type BackRouteDefinition =
  | RouteLocationRaw
  | ((route: RouteLocationNormalizedLoaded) => RouteLocationRaw)

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean
    roles?: AppRole[]
    layout?: AppLayout
    title?: string
    activeNav?: string | Partial<Record<AppRole, string>>
    breadcrumb?: BreadcrumbDefinition[]
    backRoute?: BackRouteDefinition
    /** 旧路由兼容；新路由统一使用 roles。 */
    adminOnly?: boolean
  }
}

export function userRole(info: TeacherInfo | null): AppRole | null {
  if (info?.userType === 'administrator' || info?.role === 'admin') return 'administrator'
  if (info) return 'teacher'
  return null
}

export function activeNavForRole(
  value: RouteLocationNormalizedLoaded['meta']['activeNav'],
  role: AppRole | null,
): string {
  if (typeof value === 'string') return value
  if (!value || !role) return ''
  return value[role] ?? ''
}

export function canAccessLocation(
  router: Router,
  target: RouteLocationRaw,
  session: { isLogin: boolean; teacherInfo: TeacherInfo | null },
): boolean {
  const resolved = router.resolve(target)
  if (!resolved.matched.length) return false
  const meta = resolved.meta
  if (meta.requiresAuth && !session.isLogin) return false
  const role = userRole(session.teacherInfo)
  if (meta.roles?.length && (!role || !meta.roles.includes(role))) return false
  if (meta.adminOnly && role !== 'administrator') return false
  if (session.isLogin && resolved.name === 'login') return false
  return resolved.name !== 'forbidden' && resolved.name !== 'not-found'
}

export function resolveRouteTarget(
  definition: BackRouteDefinition | undefined,
  route: RouteLocationNormalizedLoaded,
): RouteLocationRaw | null {
  if (!definition) return null
  return typeof definition === 'function' ? definition(route) : definition
}
