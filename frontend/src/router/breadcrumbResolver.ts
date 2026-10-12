import type { RouteLocationNormalizedLoaded, RouteLocationRaw } from 'vue-router'
import { platformApi } from '@/api/platform'
import { resourceApi } from '@/api/resources'
import { userRole, type AppRole, type BreadcrumbDefinition } from '@/router/routeMeta'
import type { TeacherInfo } from '@/stores/user'

export type BreadcrumbItem = { label: string; to?: RouteLocationRaw }

const classNames = new Map<number, string>()
const studentNames = new Map<string, string>()
const resourceNames = new Map<number, string>()

function numberParam(route: RouteLocationNormalizedLoaded, key: string): number | null {
  const value = Number(route.params[key])
  return Number.isInteger(value) && value > 0 ? value : null
}

async function resolveEntityLabel(
  entry: BreadcrumbDefinition,
  route: RouteLocationNormalizedLoaded,
): Promise<string> {
  const param = entry.param ?? `${entry.entity}Id`
  const id = numberParam(route, param)
  if (!entry.entity || !id) return entry.label ?? '详情'

  if (entry.entity === 'class') {
    const cached = classNames.get(id)
    if (cached) return cached
    try {
      const { data } = await platformApi.classDetail(id)
      classNames.set(id, data.name)
      return data.name
    } catch {
      return `班级 #${id}`
    }
  }

  if (entry.entity === 'student') {
    const classId = numberParam(route, 'classId')
    if (!classId) return `幼儿 #${id}`
    const cacheKey = `${classId}:${id}`
    const cached = studentNames.get(cacheKey)
    if (cached) return cached
    try {
      const { data } = await platformApi.students(classId)
      const found = data.items.find((student) => student.id === id)
      if (found) {
        studentNames.set(cacheKey, found.name)
        return found.name
      }
    } catch {
      // 使用不泄露其他班级数据的安全占位名。
    }
    return `幼儿 #${id}`
  }

  const cached = resourceNames.get(id)
  if (cached) return cached
  try {
    const { data } = await resourceApi.get(id)
    resourceNames.set(id, data.title)
    return data.title
  } catch {
    return `资源 #${id}`
  }
}

export async function resolveBreadcrumbs(
  route: RouteLocationNormalizedLoaded,
  teacherInfo: TeacherInfo | null,
): Promise<BreadcrumbItem[]> {
  const definitions = route.meta.breadcrumb ?? []
  const role: AppRole | null = userRole(teacherInfo)
  const visible = definitions.filter((entry) => !entry.roles?.length || (role && entry.roles.includes(role)))

  return Promise.all(visible.map(async (entry) => {
    const label = entry.entity ? await resolveEntityLabel(entry, route) : (entry.label ?? route.meta.title ?? '当前页面')
    const to = typeof entry.to === 'function' ? entry.to(route) : entry.to
    return { label, ...(to ? { to } : {}) }
  }))
}

export function clearBreadcrumbCache(): void {
  classNames.clear()
  studentNames.clear()
  resourceNames.clear()
}
