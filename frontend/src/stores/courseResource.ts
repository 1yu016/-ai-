import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { apiErrorMessage, http } from '@/api/http'
import { useUserStore } from '@/stores/user'

export const COURSE_RESOURCE_STORAGE_KEY = 'course_resources_v2'
export const LEGACY_RESOURCE_STORAGE_KEY = 'course_resources_v1'

export const COURSE_RESOURCE_CATEGORIES = [
  '歌曲音乐',
  '故事绘本',
  '视频动画',
  '教案课件',
  '图片卡片',
  '游戏活动',
  '手工美术',
  '练习材料',
] as const

export const RESOURCE_AGE_GROUPS = ['small', 'middle', 'large', 'all'] as const
export const RESOURCE_TYPES = ['image', 'audio', 'video', 'document'] as const

export type CourseResourceCategory = (typeof COURSE_RESOURCE_CATEGORIES)[number]
export type ResourceAgeGroup = (typeof RESOURCE_AGE_GROUPS)[number]
export type CourseResourceMediaType = (typeof RESOURCE_TYPES)[number]

export type CourseResource = {
  id: number | string
  title: string
  fileName: string
  uploadedAt?: string
  category: CourseResourceCategory
  mediaType: CourseResourceMediaType
  aliases: string[]
  ageGroup: ResourceAgeGroup
  ageGroups: string[]
  tags: string[]
  themes: string[]
  description?: string | null
  dataUrl?: string
  contentUrl?: string
  coverUrl?: string | null
  mimeType?: string
  fileSize?: number
  duration?: number | null
  reviewStatus?: string
  source: 'library' | 'browser'
}

export type ResourceFilters = {
  category?: CourseResourceCategory
  resourceType?: CourseResourceMediaType
  ageGroup?: ResourceAgeGroup
  keyword?: string
}

export type ResourceForm = {
  title: string
  aliases: string[]
  description?: string
  category: CourseResourceCategory
  ageGroup: ResourceAgeGroup
  tags: string[]
  duration?: number
}

export type ServerResource = {
  id: number
  title: string
  aliases: string[]
  description: string | null
  resourceType: CourseResourceMediaType
  category: string
  ageGroup: ResourceAgeGroup
  tags: string[]
  fileUrl: string
  coverUrl: string | null
  fileName: string
  mimeType: string
  fileSize: number
  duration: number | null
  reviewStatus: string
  createdAt: string
}

type ResourcePage = {
  items: ServerResource[]
  total: number
  page: number
  pageSize: number
}

function isCourseResourceCategory(value: unknown): value is CourseResourceCategory {
  return COURSE_RESOURCE_CATEGORIES.some((category) => category === value)
}

function migratedCategory(value: unknown): CourseResourceCategory | null {
  if (isCourseResourceCategory(value)) return value
  if (value === '课堂游戏') return '游戏活动'
  if (value === '绘本图片') return '故事绘本'
  if (value === '手工素材') return '手工美术'
  return null
}

function titleFromFileName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').trim() || fileName
}

function normalizeLegacyResource(value: unknown): CourseResource | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<CourseResource>
  const category = migratedCategory(item.category)
  if (
    typeof item.id !== 'string' ||
    typeof item.fileName !== 'string' ||
    !category ||
    typeof item.dataUrl !== 'string' ||
    !/^data:image\/(?:jpeg|png);base64,/.test(item.dataUrl)
  ) return null

  return {
    id: item.id,
    title: typeof item.title === 'string' && item.title.trim()
      ? item.title.trim()
      : titleFromFileName(item.fileName),
    fileName: item.fileName,
    uploadedAt: typeof item.uploadedAt === 'string' ? item.uploadedAt : new Date(0).toISOString(),
    category,
    mediaType: 'image',
    aliases: Array.isArray(item.aliases) ? item.aliases : [],
    ageGroup: 'all',
    ageGroups: [],
    tags: [],
    themes: Array.isArray(item.themes) ? item.themes : [],
    dataUrl: item.dataUrl,
    source: 'browser',
  }
}

export function normalizeServerResource(value: ServerResource): CourseResource | null {
  if (
    !value || !Number.isInteger(value.id) || typeof value.title !== 'string' ||
    !isCourseResourceCategory(value.category) ||
    !RESOURCE_TYPES.includes(value.resourceType) || typeof value.fileUrl !== 'string'
  ) return null

  return {
    id: value.id,
    title: value.title,
    fileName: value.fileName,
    uploadedAt: value.createdAt,
    category: value.category,
    mediaType: value.resourceType,
    aliases: Array.isArray(value.aliases) ? value.aliases : [],
    ageGroup: value.ageGroup,
    ageGroups: [value.ageGroup],
    tags: Array.isArray(value.tags) ? value.tags : [],
    themes: Array.isArray(value.tags) ? value.tags : [],
    description: value.description,
    contentUrl: resolveFileUrl(value.fileUrl),
    coverUrl: value.coverUrl ? resolveFileUrl(value.coverUrl) : null,
    mimeType: value.mimeType,
    fileSize: value.fileSize,
    duration: value.duration,
    reviewStatus: value.reviewStatus,
    source: 'library',
  }
}

function resolveFileUrl(fileUrl: string): string {
  if (/^https?:\/\//i.test(fileUrl)) return fileUrl
  const baseUrl = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
  return `${baseUrl}${fileUrl.startsWith('/') ? '' : '/'}${fileUrl}`
}

function parseLegacyStorage(key: string): CourseResource[] {
  try {
    const saved = localStorage.getItem(key)
    const parsed: unknown = saved ? JSON.parse(saved) : []
    return Array.isArray(parsed)
      ? parsed.map(normalizeLegacyResource).filter((item): item is CourseResource => !!item)
      : []
  } catch {
    return []
  }
}

function dataUrlToFile(resource: CourseResource): File {
  const [header, encoded = ''] = resource.dataUrl?.split(',') ?? []
  const mimeType = (header ?? '').match(/^data:([^;]+);base64$/)?.[1]
  if (!mimeType || !encoded) throw new Error('旧素材数据已损坏')
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
  return new File([bytes], resource.fileName, { type: mimeType })
}

export const useCourseResourceStore = defineStore('courseResource', () => {
  const userStore = useUserStore()
  const serverResources = ref<CourseResource[]>([])
  const legacyResources = ref<CourseResource[]>([])
  const loading = ref(false)
  const loadError = ref('')
  const total = ref(0)
  let initialized = false
  let refreshSequence = 0

  const resources = computed(() => [...serverResources.value, ...legacyResources.value])
  const sortedResources = computed(() => [...resources.value].sort((left, right) => {
    if (left.source !== right.source) return left.source === 'library' ? -1 : 1
    return left.title.localeCompare(right.title, 'zh-CN')
  }))
  const hasLegacyResources = computed(() => legacyResources.value.length > 0)

  function persistLegacy() {
    const serialized = JSON.stringify(legacyResources.value)
    localStorage.setItem(LEGACY_RESOURCE_STORAGE_KEY, serialized)
    localStorage.setItem(COURSE_RESOURCE_STORAGE_KEY, serialized)
  }

  function loadLegacyResources() {
    const combined = [
      ...parseLegacyStorage(LEGACY_RESOURCE_STORAGE_KEY),
      ...parseLegacyStorage(COURSE_RESOURCE_STORAGE_KEY),
    ]
    legacyResources.value = [...new Map(combined.map((item) => [String(item.id), item])).values()]
  }

  async function refreshLibrary(filters: ResourceFilters = {}) {
    const sequence = ++refreshSequence
    if (!userStore.accessToken) {
      serverResources.value = []
      total.value = 0
      loadError.value = ''
      return
    }
    loading.value = true
    loadError.value = ''
    try {
      const { data } = await http.get<ResourcePage>('/resources', {
        params: { ...filters, page: 1, pageSize: 100 },
      })
      if (sequence !== refreshSequence) return
      serverResources.value = Array.isArray(data.items)
        ? data.items.map(normalizeServerResource).filter((item): item is CourseResource => !!item)
        : []
      total.value = data.total
    } catch (error) {
      if (sequence !== refreshSequence) return
      console.error('加载课程资源失败：', error)
      loadError.value = apiErrorMessage(error, '资源加载失败，请稍后重试。')
      serverResources.value = []
      total.value = 0
    } finally {
      if (sequence === refreshSequence) loading.value = false
    }
  }

  async function uploadResource(
    file: File,
    form: ResourceForm,
    onProgress?: (percentage: number) => void,
  ): Promise<CourseResource> {
    const body = new FormData()
    body.set('file', file)
    body.set('title', form.title)
    body.set('aliases', JSON.stringify(form.aliases))
    body.set('description', form.description ?? '')
    body.set('category', form.category)
    body.set('ageGroup', form.ageGroup)
    body.set('tags', JSON.stringify(form.tags))
    if (form.duration !== undefined) body.set('duration', String(form.duration))
    const { data } = await http.post<ServerResource>('/resources/upload', body, {
      onUploadProgress: (event) => {
        if (!event.total) return
        onProgress?.(Math.round((event.loaded / event.total) * 100))
      },
    })
    const resource = normalizeServerResource(data)
    if (!resource) throw new Error('服务端返回了无效的资源数据')
    serverResources.value.unshift(resource)
    total.value += 1
    return resource
  }

  async function updateResource(id: number, form: ResourceForm): Promise<CourseResource> {
    const { data } = await http.patch<ServerResource>(`/resources/${id}`, form)
    const resource = normalizeServerResource(data)
    if (!resource) throw new Error('服务端返回了无效的资源数据')
    const index = serverResources.value.findIndex((item) => item.id === id)
    if (index >= 0) serverResources.value.splice(index, 1, resource)
    return resource
  }

  async function deleteResource(id: number): Promise<void> {
    await http.delete(`/resources/${id}`)
    serverResources.value = serverResources.value.filter((item) => item.id !== id)
    total.value = Math.max(0, total.value - 1)
  }

  function deleteLegacyResource(id: string): void {
    legacyResources.value = legacyResources.value.filter((item) => item.id !== id)
    persistLegacy()
  }

  async function migrateLegacyResource(resource: CourseResource): Promise<void> {
    if (resource.source !== 'browser') return
    const file = dataUrlToFile(resource)
    await uploadResource(file, {
      title: resource.title,
      aliases: resource.aliases,
      category: resource.category,
      ageGroup: 'all',
      tags: resource.themes,
    })
    legacyResources.value = legacyResources.value.filter((item) => item.id !== resource.id)
    persistLegacy()
  }

  async function initialize() {
    if (initialized) return
    initialized = true
    loadLegacyResources()
    await refreshLibrary()
  }

  return {
    resources,
    sortedResources,
    legacyResources,
    hasLegacyResources,
    loading,
    loadError,
    total,
    initialize,
    refreshLibrary,
    uploadResource,
    updateResource,
    deleteResource,
    deleteLegacyResource,
    migrateLegacyResource,
  }
})
