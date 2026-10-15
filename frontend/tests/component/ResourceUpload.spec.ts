import { webcrypto } from 'node:crypto'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ChunkedUploader from '@/components/resources/ChunkedUploader.vue'
import { resourceApi, type ResourceResponse } from '@/api/resources'

const resource: ResourceResponse = {
  id: 91,
  title: '春天图片',
  aliases: [],
  description: null,
  resourceType: 'image',
  category: '图片卡片',
  categoryId: null,
  ageGroup: 'middle',
  domain: '艺术',
  tags: ['春天'],
  fileUrl: '/resources/91/download',
  coverUrl: null,
  fileName: 'spring.png',
  mimeType: 'image/png',
  fileSize: 8,
  duration: null,
  sha256: 'a'.repeat(64),
  reviewStatus: 'draft',
  ownerId: '1',
  ownerType: 'teacher',
  schoolId: 'school-1',
  currentVersionId: 1,
  referenceCount: 0,
  isFavorite: false,
  createdAt: '2026-10-11T00:00:00.000Z',
  updatedAt: '2026-10-11T00:00:00.000Z',
}

function selectFile(wrapper: ReturnType<typeof mount>, file = new File(['png-data'], 'spring.png', {
  type: 'image/png',
  lastModified: 123,
})) {
  const input = wrapper.find<HTMLInputElement>('input[type="file"]')
  Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
  return input.trigger('change')
}

async function fillMetadata(wrapper: ReturnType<typeof mount>) {
  const inputs = wrapper.findAll<HTMLInputElement>('input[type="text"]')
  await inputs[0]!.setValue('春天图片')
  await inputs[1]!.setValue('图片卡片')
  await inputs[2]!.setValue('艺术')
  await inputs[3]!.setValue('春天')
}

function button(wrapper: ReturnType<typeof mount>, label: string) {
  const found = wrapper.findAll('button').find((item) => item.text().includes(label))
  if (!found) throw new Error(`button not found: ${label}`)
  return found
}

describe('resource upload session UI', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', webcrypto)
    vi.spyOn(resourceApi, 'categories').mockResolvedValue({ data: [] } as never)
    vi.spyOn(resourceApi, 'createUploadSession').mockResolvedValue({
      data: { id: 'upload-1', chunkSize: 4 * 1024 * 1024, totalChunks: 1 },
    } as never)
    vi.spyOn(resourceApi, 'listUploadedChunks').mockResolvedValue({
      data: { sessionId: 'upload-1', status: 'active', totalChunks: 1, uploadedChunks: [] },
    } as never)
    vi.spyOn(resourceApi, 'uploadChunk').mockImplementation(async (_id, _chunkNo, chunk, _sha, options) => {
      options?.onProgress?.(chunk.size, chunk.size)
      return { data: {} } as never
    })
    vi.spyOn(resourceApi, 'completeUpload').mockResolvedValue({ data: resource } as never)
    vi.spyOn(resourceApi, 'get').mockResolvedValue({ data: resource } as never)
    vi.spyOn(resourceApi, 'abortUpload').mockResolvedValue({ data: undefined } as never)
  })

  it('creates a session, uploads with real progress, saves metadata and reloads detail', async () => {
    const wrapper = mount(ChunkedUploader)
    await selectFile(wrapper)
    await button(wrapper, '创建会话并上传').trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('填写资源信息'))
    expect(resourceApi.completeUpload).not.toHaveBeenCalled()
    await fillMetadata(wrapper)
    await button(wrapper, '保存元数据并完成').trigger('click')
    await vi.waitFor(() => expect(resourceApi.get).toHaveBeenCalledWith(91))

    expect(resourceApi.createUploadSession).toHaveBeenCalledWith(expect.objectContaining({
      title: 'spring',
      category: '待完善',
      resourceType: 'image',
      declaredMime: 'image/png',
    }))
    expect(resourceApi.uploadChunk).toHaveBeenCalledTimes(1)
    expect(resourceApi.completeUpload).toHaveBeenCalledWith('upload-1', expect.objectContaining({
      title: '春天图片',
      category: '图片卡片',
      domain: '艺术',
      tags: ['春天'],
    }))
    expect(wrapper.emitted('done')?.[0]?.[0]).toEqual(resource)
    expect(sessionStorage.getItem('course-library-resource-chunk-session')).toBeNull()
  })

  it('retries a failed network chunk with the same server session', async () => {
    vi.mocked(resourceApi.uploadChunk)
      .mockRejectedValueOnce(new Error('network down'))
      .mockImplementationOnce(async (_id, _chunkNo, chunk, _sha, options) => {
        options?.onProgress?.(chunk.size, chunk.size)
        return { data: {} } as never
      })
    const wrapper = mount(ChunkedUploader)
    await selectFile(wrapper)
    await button(wrapper, '创建会话并上传').trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('填写资源信息'), {
      timeout: 2_000,
    })
    expect(resourceApi.createUploadSession).toHaveBeenCalledTimes(1)
    expect(resourceApi.uploadChunk).toHaveBeenCalledTimes(2)
    expect(resourceApi.completeUpload).not.toHaveBeenCalled()
  })

  it('aborts active requests and asks the backend to clean the session', async () => {
    vi.mocked(resourceApi.uploadChunk).mockImplementation(
      (_id, _chunkNo, _chunk, _sha, options) =>
        new Promise((_, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('canceled')))
        }),
    )
    const wrapper = mount(ChunkedUploader)
    await selectFile(wrapper)
    void button(wrapper, '创建会话并上传').trigger('click')
    await vi.waitFor(() => expect(resourceApi.uploadChunk).toHaveBeenCalledTimes(1))
    await button(wrapper, '取消并清理').trigger('click')
    await vi.waitFor(() => expect(resourceApi.abortUpload).toHaveBeenCalledWith('upload-1'))
    expect(sessionStorage.getItem('course-library-resource-chunk-session')).toBeNull()
  })

  it('restores an active server session after refresh and clears an invalid one safely', async () => {
    sessionStorage.setItem('course-library-resource-chunk-session', JSON.stringify({
      sessionId: 'upload-old',
      totalChunks: 2,
      chunkSize: 4 * 1024 * 1024,
      totalSize: 8,
      fileName: 'spring.png',
      fileLastModified: 123,
      meta: { title: '恢复标题', category: '图片卡片', ageGroup: 'all', resourceType: 'image' },
    }))
    vi.mocked(resourceApi.listUploadedChunks).mockResolvedValueOnce({
      data: { sessionId: 'upload-old', status: 'active', totalChunks: 2, uploadedChunks: [] },
    } as never)
    const wrapper = mount(ChunkedUploader)
    await flushPromises()
    expect(wrapper.text()).toContain('检测到未完成的上传')

    wrapper.unmount()
    vi.mocked(resourceApi.listUploadedChunks).mockRejectedValueOnce(new Error('expired'))
    const invalid = mount(ChunkedUploader)
    await flushPromises()
    expect(invalid.text()).not.toContain('检测到未完成的上传')
    expect(sessionStorage.getItem('course-library-resource-chunk-session')).toBeNull()
  })
})
