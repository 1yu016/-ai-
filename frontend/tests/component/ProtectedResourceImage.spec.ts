import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProtectedResourceImage from '@/components/resources/ProtectedResourceImage.vue'
import type { CourseResource } from '@/stores/courseResource'

const { fetchAuthedBlob } = vi.hoisted(() => ({ fetchAuthedBlob: vi.fn() }))

vi.mock('@/api/resources', () => ({ fetchAuthedBlob }))

const libraryResource: CourseResource = {
  id: 12,
  title: '春天图片',
  fileName: 'spring.png',
  category: '图片卡片',
  mediaType: 'image',
  aliases: [],
  ageGroup: 'all',
  ageGroups: ['all'],
  tags: [],
  themes: [],
  source: 'library',
}

describe('ProtectedResourceImage', () => {
  beforeEach(() => fetchAuthedBlob.mockReset())

  it('通过鉴权 Blob 加载服务器资源，并在卸载时释放 URL', async () => {
    const revoke = vi.fn()
    fetchAuthedBlob.mockResolvedValue({ url: 'blob:protected-image', revoke })
    const wrapper = mount(ProtectedResourceImage, { props: { resource: libraryResource } })
    await flushPromises()

    expect(fetchAuthedBlob).toHaveBeenCalledWith(12)
    expect(wrapper.get('img').attributes('src')).toBe('blob:protected-image')

    wrapper.unmount()
    expect(revoke).toHaveBeenCalledOnce()
  })

  it('本地旧素材直接使用 data URL，不发起后端请求', async () => {
    const wrapper = mount(ProtectedResourceImage, {
      props: {
        resource: {
          ...libraryResource,
          id: 'legacy-image',
          source: 'browser',
          dataUrl: 'data:image/png;base64,AAAA',
        },
      },
    })
    await flushPromises()

    expect(fetchAuthedBlob).not.toHaveBeenCalled()
    expect(wrapper.get('img').attributes('src')).toBe('data:image/png;base64,AAAA')
  })
})
