import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  guessResourceType,
  normalizeListResourcesParams,
  normalizeResourceResponse,
  resourceApi,
  toArrayField,
  validateResourceFile,
  RESOURCE_UPLOAD_SIZE_LIMITS,
  RESOURCE_TYPES,
  AGE_GROUPS,
  REVIEW_STATUSES,
} from '@/api/resources'
import { http } from '@/api/http'

describe('resources adapter helpers', () => {
  afterEach(() => vi.restoreAllMocks())

  it('guesses resource type from common extensions', () => {
    expect(guessResourceType('lesson.png')).toBe('image')
    expect(guessResourceType('song.mp3')).toBe('audio')
    expect(guessResourceType('clip.mp4')).toBe('video')
    expect(guessResourceType('slides.pdf')).toBe('pdf')
    expect(guessResourceType('deck.pptx')).toBe('ppt')
    expect(guessResourceType('questions.json')).toBe('question_bank')
    expect(guessResourceType('model.glb')).toBe('model_3d')
    expect(guessResourceType('note.docx')).toBeNull()
    expect(guessResourceType('unsafe.shell.pdf')).toBeNull()
    expect(guessResourceType('unknown.xyz')).toBeNull()
  })

  it('validates extension, resource type and type-specific size before upload', () => {
    expect(validateResourceFile(new File(['ok'], 'photo.png'), 'image')).toMatchObject({
      valid: true,
      declaredMime: 'image/png',
    })
    expect(validateResourceFile(new File(['bad'], 'photo.png'), 'audio')).toMatchObject({
      valid: false,
      message: '资源类型与文件格式不匹配',
    })
    expect(validateResourceFile(new File(['bad'], 'archive.exe'), 'document')).toMatchObject({
      valid: false,
    })
    expect(
      validateResourceFile(
        { name: 'large.png', size: RESOURCE_UPLOAD_SIZE_LIMITS.image + 1 } as File,
        'image',
      ),
    ).toMatchObject({ valid: false, message: '文件超过该类型允许的 15MB 上限' })
  })

  it('forwards real chunk progress and abort signals through the common HTTP client', async () => {
    const post = vi.spyOn(http, 'post').mockResolvedValue({ data: {} } as never)
    const progress = vi.fn()
    const controller = new AbortController()
    await resourceApi.uploadChunk('session-1', 2, new Blob(['chunk']), 'a'.repeat(64), {
      signal: controller.signal,
      onProgress: progress,
    })
    const config = post.mock.calls[0]?.[2]
    config?.onUploadProgress?.({ loaded: 7, total: 10 } as never)
    expect(progress).toHaveBeenCalledWith(7, 10)
    expect(config?.signal).toBe(controller.signal)
  })

  it('parses tag/alias fields that may be comma-separated or JSON array strings', () => {
    expect(toArrayField(['a', 'b'])).toEqual(['a', 'b'])
    expect(toArrayField(' 苹果 ，香蕉 ')).toEqual(['苹果', '香蕉'])
    expect(toArrayField('["x","y"]')).toEqual(['x', 'y'])
    expect(toArrayField('')).toEqual([])
    expect(toArrayField(undefined)).toEqual([])
  })

  it('exposes backend-aligned enums without unknown literals', () => {
    expect(RESOURCE_TYPES).toContain('picture_book')
    expect(RESOURCE_TYPES).toContain('nursery_rhyme')
    expect(RESOURCE_TYPES).toContain('question_bank')
    expect(RESOURCE_TYPES).toContain('model_3d')
    expect(AGE_GROUPS).toContain('small')
    expect(REVIEW_STATUSES).toContain('draft')
    expect(REVIEW_STATUSES).toContain('pending_review')
  })

  it('normalizes unknown backend types into the safe unknown state', () => {
    const normalized = normalizeResourceResponse({
      id: 1,
      title: '未来格式资源',
      resourceType: 'future_hologram',
    })
    expect(normalized.resourceType).toBe('unknown')
  })

  it('normalizes legacy review states into the current public workflow states', () => {
    expect(normalizeResourceResponse({ reviewStatus: 'pending' }).reviewStatus)
      .toBe('pending_review')
    expect(normalizeResourceResponse({ reviewStatus: 'disabled' }).reviewStatus)
      .toBe('archived')
  })

  it('normalizes and sends all supported list filters together', async () => {
    vi.spyOn(http, 'get').mockResolvedValue({
      data: { items: [], total: 0, page: 2, pageSize: 50 },
    } as never)

    const filters = normalizeListResourcesParams({
      keyword: '  春天  ',
      resourceType: 'video',
      ageGroup: 'middle',
      domain: ' 科学 ',
      tag: ' 动物 ',
      reviewStatus: 'pending_review',
      isFavorite: false,
      ownerId: ' 42 ',
      categoryId: 3,
      page: 2,
      pageSize: 50,
    })
    await resourceApi.list(filters)

    expect(http.get).toHaveBeenCalledWith('/resources', {
      params: {
        keyword: '春天',
        resourceType: 'video',
        ageGroup: 'middle',
        domain: '科学',
        tag: '动物',
        reviewStatus: 'pending_review',
        isFavorite: false,
        ownerId: '42',
        categoryId: 3,
        page: 2,
        pageSize: 50,
      },
    })
  })
})
