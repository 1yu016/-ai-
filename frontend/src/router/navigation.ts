import type { RouteLocationNormalizedLoaded, RouteLocationRaw, Router } from 'vue-router'
import { canAccessLocation, resolveRouteTarget } from '@/router/routeMeta'
import type { TeacherInfo } from '@/stores/user'

export const NAVIGATION_SOURCE_QUERY = 'from'

export function withNavigationSource(
  target: Exclude<RouteLocationRaw, string>,
  route: RouteLocationNormalizedLoaded,
): RouteLocationRaw {
  return {
    ...target,
    query: {
      ...('query' in target ? target.query : undefined),
      [NAVIGATION_SOURCE_QUERY]: route.fullPath,
    },
  }
}

function safePath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null
  return value
}

function historyBackPath(): string | null {
  if (typeof window === 'undefined') return null
  return safePath((window.history.state as { back?: unknown } | null)?.back)
}

export async function navigateBack(
  router: Router,
  route: RouteLocationNormalizedLoaded,
  session: { isLogin: boolean; teacherInfo: TeacherInfo | null },
  fallbackOverride?: RouteLocationRaw,
): Promise<void> {
  const source = safePath(route.query[NAVIGATION_SOURCE_QUERY])
  const browserBack = historyBackPath()

  if (source && canAccessLocation(router, source, session)) {
    if (browserBack === source) router.back()
    else await router.push(source)
    return
  }

  const configured = fallbackOverride ?? resolveRouteTarget(route.meta.backRoute, route)
  if (configured && canAccessLocation(router, configured, session)) {
    await router.push(configured)
    return
  }

  // A route's configured back target represents the product's contextual
  // hierarchy (for example, student detail -> that class's student list).
  // Browser history can point at an unrelated page or even another workflow,
  // so only use it after the contextual target has been considered.
  if (browserBack && canAccessLocation(router, browserBack, session)) {
    router.back()
    return
  }

  const home: RouteLocationRaw = session.teacherInfo?.userType === 'administrator' || session.teacherInfo?.role === 'admin'
    ? { name: 'admin-dashboard' }
    : { name: 'my-classes' }
  if (canAccessLocation(router, home, session)) await router.push(home)
  else await router.push({ name: 'chat' })
}
