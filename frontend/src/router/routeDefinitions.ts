import type { RouteMeta, RouteRecordRaw } from 'vue-router'
import type { AppRole, BreadcrumbDefinition } from '@/router/routeMeta'

const ALL: AppRole[] = ['teacher', 'administrator']
const ADMIN: AppRole[] = ['administrator']

const classRoots: BreadcrumbDefinition[] = [
  { label: '班级与学生', to: { name: 'classes' }, roles: ADMIN },
  { label: '我的班级', to: { name: 'my-classes' }, roles: ['teacher'] },
]
const resourceRoot: BreadcrumbDefinition = { label: '资源库', to: { name: 'resources' } }

function meta(
  title: string,
  activeNav: RouteMeta['activeNav'],
  breadcrumb: BreadcrumbDefinition[],
  options: Partial<RouteMeta> = {},
): RouteMeta {
  return {
    requiresAuth: true,
    roles: ALL,
    layout: 'workspace',
    title,
    activeNav,
    breadcrumb,
    ...options,
  }
}

const routeMetadata: Record<string, RouteMeta> = {
  chat: meta('AI助教', 'chat', [{ label: 'AI助教' }], { requiresAuth: false, roles: undefined, layout: 'standalone' }),
  login: meta('登录', '', [{ label: '登录' }], { requiresAuth: false, roles: undefined, layout: 'auth' }),
  classes: meta('班级与学生', 'classes', [{ label: '班级与学生' }], { roles: ADMIN }),
  'admin-dashboard': meta('数据看板', 'admin-dashboard', [{ label: '数据看板' }], { roles: ADMIN }),
  'admin-audit': meta('审计日志', 'admin-audit', [{ label: '审计日志' }], { roles: ADMIN }),
  teachers: meta('教师管理', 'teachers', [{ label: '教师管理' }], { roles: ADMIN }),
  'my-classes': meta('我的班级', { teacher: 'my-classes', administrator: 'classes' }, [{ label: '我的班级' }]),
  'student-center': meta('学生中心', 'classes', [{ label: '班级与学生', to: { name: 'classes' } }, { label: '学生中心' }], { roles: ADMIN, backRoute: { name: 'classes' } }),
  students: meta('学生列表', { teacher: 'my-classes', administrator: 'classes' }, [
    ...classRoots,
    { entity: 'class', param: 'classId', to: (route) => ({ name: 'class-detail', params: { classId: route.params.classId } }) },
    { label: '学生' },
  ], { backRoute: (route) => ({ name: 'class-detail', params: { classId: route.params.classId } }) }),
  'class-rewards': meta('成长奖励', { teacher: 'my-classes', administrator: 'classes' }, [
    ...classRoots,
    { entity: 'class', param: 'classId', to: (route) => ({ name: 'class-detail', params: { classId: route.params.classId } }) },
    { label: '成长奖励' },
  ], { backRoute: (route) => ({ name: 'class-detail', params: { classId: route.params.classId } }) }),
  'class-questions': meta('儿童问题', { teacher: 'my-classes', administrator: 'classes' }, [
    ...classRoots,
    { entity: 'class', param: 'classId', to: (route) => ({ name: 'class-detail', params: { classId: route.params.classId } }) },
    { label: '儿童问题' },
  ], { backRoute: (route) => ({ name: 'class-detail', params: { classId: route.params.classId } }) }),
  'student-profile': meta('学生资料', { teacher: 'my-classes', administrator: 'classes' }, [
    ...classRoots,
    { entity: 'class', param: 'classId', to: (route) => ({ name: 'class-detail', params: { classId: route.params.classId } }) },
    { label: '学生', to: (route) => ({ name: 'students', params: { classId: route.params.classId } }) },
    { entity: 'student', param: 'studentId' },
  ], { backRoute: (route) => ({ name: 'students', params: { classId: route.params.classId } }) }),
  classrooms: meta('教室管理', 'classrooms', [{ label: '教室管理' }]),
  'classroom-detail': meta('教室详情', 'classrooms', [{ label: '教室管理', to: { name: 'classrooms' } }, { label: '教室详情' }], { backRoute: { name: 'classrooms' } }),
  devices: meta('设备管理', 'devices', [{ label: '设备管理' }]),
  'device-detail': meta('设备详情', 'devices', [{ label: '设备管理', to: { name: 'devices' } }, { label: '设备详情' }], { backRoute: { name: 'devices' } }),
  avatars: meta('数字人角色库', 'avatars', [{ label: '数字人角色库' }]),
  'classroom-scan': meta('课堂设备准备', 'classroom-scan', [{ label: '课堂设备准备' }]),
  'classroom-join': meta('加入课堂', '', [{ label: '加入课堂' }], { layout: 'mobile', backRoute: { name: 'my-classes' } }),
  'classroom-screen': meta('课堂大屏', '', [{ label: '课堂大屏' }], { layout: 'screen' }),
  'lesson-plans': meta('备课中心', 'lesson-plans', [{ label: '备课中心' }]),
  'lesson-plan-new': meta('新建教案', 'lesson-plans', [{ label: '备课中心', to: (route) => ({ name: 'lesson-plans', query: route.query.classId ? { classId: route.query.classId } : {} }) }, { label: '新建教案' }], { backRoute: (route) => ({ name: 'lesson-plans', query: route.query.classId ? { classId: route.query.classId } : {} }) }),
  'lesson-plan-edit': meta('编辑教案', 'lesson-plans', [{ label: '备课中心', to: (route) => ({ name: 'lesson-plans', query: route.query.classId ? { classId: route.query.classId } : {} }) }, { label: '编辑教案' }], { backRoute: (route) => ({ name: 'lesson-plans', query: route.query.classId ? { classId: route.query.classId } : {} }) }),
  'lesson-classroom-preflight': meta('课堂准备', 'lesson-plans', [{ label: '备课中心', to: { name: 'lesson-plans' } }, { label: '课堂准备' }], { layout: 'classroom', backRoute: { name: 'lesson-plans' } }),
  'lesson-classroom': meta('课堂', '', [{ label: '课堂' }], { layout: 'classroom', backRoute: { name: 'my-classes' } }),
  'classroom-record': meta('课堂记录', 'classroom-history', [{ label: '课堂记录', to: { name: 'classroom-history' } }, { label: '课堂详情' }], { backRoute: { name: 'classroom-history' } }),
  'lesson-classroom-summary': meta('课堂总结', '', [{ label: '课堂总结' }], { layout: 'classroom', backRoute: (route) => ({ name: 'classroom-record', params: { runId: route.params.runId } }) }),
  'classroom-engagement': meta('课堂互动', '', [{ label: '课堂互动' }], { layout: 'classroom', backRoute: { name: 'my-classes' } }),
  'classroom-insights': meta('课堂洞察', '', [{ label: '课堂洞察' }], { layout: 'classroom', backRoute: { name: 'my-classes' } }),
  'classroom-remote': meta('手机控制', '', [{ label: '手机控制' }], { layout: 'mobile', backRoute: { name: 'my-classes' } }),
  resources: meta('资源库', 'resources', [{ label: '资源库' }]),
  'resource-upload': meta('上传资源', 'resources', [resourceRoot, { label: '上传资源' }], { backRoute: { name: 'resources' } }),
  'resource-preview': meta('资源预览', 'resources', [
    resourceRoot,
    { entity: 'resource', param: 'id', to: (route) => ({ name: 'resource-detail', params: { id: route.params.id } }) },
    { label: '预览' },
  ], { backRoute: (route) => ({ name: 'resource-detail', params: { id: route.params.id } }) }),
  'resource-edit': meta('编辑资源', 'resources', [
    resourceRoot,
    { entity: 'resource', param: 'id', to: (route) => ({ name: 'resource-detail', params: { id: route.params.id } }) },
    { label: '编辑' },
  ], { backRoute: (route) => ({ name: 'resource-detail', params: { id: route.params.id } }) }),
  'resource-review': meta('审核资源', 'resources', [
    resourceRoot,
    { entity: 'resource', param: 'id', to: (route) => ({ name: 'resource-detail', params: { id: route.params.id } }) },
    { label: '审核' },
  ], { roles: ADMIN, backRoute: (route) => ({ name: 'resource-detail', params: { id: route.params.id } }) }),
  'resource-detail': meta('资源详情', 'resources', [resourceRoot, { entity: 'resource', param: 'id' }], { backRoute: { name: 'resources' } }),
  forbidden: meta('无权访问', '', [{ label: '无权访问' }], { requiresAuth: false, roles: undefined, layout: 'standalone' }),
}

const canonicalPaths: Record<string, string> = {
  classes: '/admin/classes',
  teachers: '/admin/teachers',
  'student-center': '/admin/students',
  students: '/admin/classes/:classId/students',
  classrooms: '/admin/classrooms',
  'classroom-detail': '/admin/classrooms/:classroomId',
  devices: '/admin/devices',
  'device-detail': '/admin/devices/:deviceId',
  'student-profile': '/admin/classes/:classId/students/:studentId',
}

export function enhanceRoutes(base: RouteRecordRaw[]): RouteRecordRaw[] {
  const enriched = base.map<RouteRecordRaw>((route, index) => {
    const name = typeof route.name === 'string' ? route.name : ''
    if (!name && index === 0) {
      return { ...route, name: 'home-redirect', meta: { layout: 'standalone', title: '首页', activeNav: 'chat', breadcrumb: [] } } as RouteRecordRaw
    }
    return {
      ...route,
      ...(canonicalPaths[name] ? { path: canonicalPaths[name] } : {}),
      meta: { ...(route.meta ?? {}), ...(routeMetadata[name] ?? {}) },
    } as RouteRecordRaw
  })

  return [
    ...enriched,
    {
      path: '/teacher/home',
      name: 'teacher-home',
      component: () => import('../views/TeacherHomeView.vue'),
      meta: meta('教师首页', 'teacher-home', [{ label: '教师首页' }], { roles: ['teacher'] }),
    },
    {
      path: '/classroom/history',
      name: 'classroom-history',
      component: () => import('../views/ClassroomHistoryView.vue'),
      meta: meta('课堂记录', 'classroom-history', [{ label: '课堂记录' }]),
    },
    {
      path: '/admin/classes/:classId',
      name: 'class-detail',
      component: () => import('../views/ClassDetailView.vue'),
      meta: meta('班级详情', { teacher: 'my-classes', administrator: 'classes' }, [
        ...classRoots,
        { entity: 'class', param: 'classId' },
      ], { backRoute: { name: 'classes' } }),
    },
    {
      path: '/classes/:classId',
      name: 'legacy-class-detail',
      redirect: (route) => ({ name: 'class-detail', params: { classId: route.params.classId }, query: route.query }),
      meta: meta('班级详情', { teacher: 'my-classes', administrator: 'classes' }, []),
    },
    { path: '/classes', name: 'legacy-classes', redirect: { name: 'classes' }, meta: meta('班级与学生', 'classes', [], { roles: ADMIN }) },
    { path: '/students', name: 'legacy-students', redirect: { name: 'student-center' }, meta: meta('学生中心', 'classes', [], { roles: ADMIN }) },
    {
      path: '/classes/:classId/students',
      name: 'legacy-class-students',
      redirect: (route) => ({ name: 'students', params: { classId: route.params.classId }, query: route.query }),
      meta: meta('学生列表', { teacher: 'my-classes', administrator: 'classes' }, []),
    },
    {
      path: '/classes/:classId/students/:studentId',
      name: 'legacy-class-student-profile',
      redirect: (route) => ({
        name: 'student-profile',
        params: { classId: route.params.classId, studentId: route.params.studentId },
        query: route.query,
      }),
      meta: meta('学生资料', { teacher: 'my-classes', administrator: 'classes' }, []),
    },
    { path: '/devices', name: 'legacy-devices', redirect: { name: 'devices' }, meta: meta('设备管理', 'devices', []) },
    {
      path: '/students/:studentId',
      name: 'legacy-student-profile',
      redirect: (route) => {
        const rawClassId = Array.isArray(route.query.classId) ? route.query.classId[0] : route.query.classId
        const rawStudentId = Array.isArray(route.params.studentId) ? route.params.studentId[0] : route.params.studentId
        return rawClassId && rawStudentId
          ? { name: 'student-profile', params: { classId: String(rawClassId), studentId: String(rawStudentId) } }
          : { name: 'my-classes' }
      },
      meta: meta('学生资料', { teacher: 'my-classes', administrator: 'classes' }, []),
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('../views/NotFoundView.vue'),
      meta: meta('页面不存在', '', [{ label: '页面不存在' }], { requiresAuth: false, roles: undefined, layout: 'standalone' }),
    },
  ]
}
