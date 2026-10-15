import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import StudentAuthorizationBadge from '@/components/StudentAuthorizationBadge.vue'
import StudentAvatar from '@/components/StudentAvatar.vue'

describe('学生隐私展示', () => {
  it('未授权学生只渲染默认卡通头像，不创建图片或音频元素', () => {
    const wrapper = mount(StudentAvatar, {
      props: {
        student: {
          id: 1,
          name: '小雨',
          authorizationStatus: 'unauthorized',
          permissions: { photo: false, voice: false, artwork: false },
        },
      },
    })
    expect(wrapper.text()).toContain('🧒')
    expect(wrapper.attributes('aria-label')).toContain('照片未授权')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('audio').exists()).toBe(false)
  })

  it('四种授权状态使用统一中文标签', () => {
    for (const [status, label] of [
      ['authorized', '已授权'],
      ['partial', '部分授权'],
      ['unauthorized', '未授权'],
      ['pending', '待确认'],
    ] as const) {
      const wrapper = mount(StudentAuthorizationBadge, { props: { status } })
      expect(wrapper.text()).toBe(label)
      expect(wrapper.attributes('data-status')).toBe(status)
    }
  })
})
