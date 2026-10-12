import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { platformApi } from '@/api/platform'
import StudentImportPanel from '@/components/StudentImportPanel.vue'

const preview = {
  data: {
    sessionId: 'preview-1',
    classId: 1,
    className: '阳光中班',
    expiresAt: '2026-10-11T12:00:00.000Z',
    summary: { total: 2, valid: 1, invalid: 1 },
    validRows: [{ rowNumber: 2, studentNo: 'S-100', name: '小云', nickname: null, gender: null, birthday: null, status: 'active', valid: true, errors: [] }],
    invalidRows: [{ rowNumber: 3, studentNo: 'S-100', name: '小雨', nickname: null, gender: null, birthday: null, status: 'active', valid: false, errors: ['文件内学号重复'] }],
  },
}

describe('StudentImportPanel 服务端导入流程', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(platformApi, 'previewStudentImport').mockResolvedValue(preview as never)
    vi.spyOn(platformApi, 'confirmStudentImport').mockResolvedValue({
      data: { sessionId: 'preview-1', requestId: '894ac385-6d06-449d-bade-a4b0a33c2121', classId: 1, created: 1, skipped: 1, replayed: false },
    } as never)
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('894ac385-6d06-449d-bade-a4b0a33c2121')
  })

  it('拒绝非 XLSX 文件且不会调用后端解析', async () => {
    const wrapper = mount(StudentImportPanel, { props: { classId: 1 }, global: { plugins: [ElementPlus] } })
    const input = wrapper.get('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [new File(['bad'], 'students.csv', { type: 'text/csv' })] })
    await input.trigger('change')
    expect(wrapper.text()).toContain('仅支持 .xlsx 格式')
    expect(platformApi.previewStudentImport).not.toHaveBeenCalled()
  })

  it('预览不会写入，确认后才调用确认接口并通知刷新', async () => {
    const wrapper = mount(StudentImportPanel, { props: { classId: 1, className: '阳光中班' }, global: { plugins: [ElementPlus] } })
    const input = wrapper.get('input[type="file"]')
    const file = new File(['PK-test'], 'students.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await wrapper.findAll('button').find((button) => button.text() === '上传并解析')!.trigger('click')
    await flushPromises()

    expect(platformApi.previewStudentImport).toHaveBeenCalledWith(1, file)
    expect(platformApi.confirmStudentImport).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('可导入 1')
    expect(wrapper.text()).toContain('失败 1')
    expect(wrapper.text()).toContain('文件内学号重复')

    await wrapper.findAll('button').find((button) => button.text() === '确认导入')!.trigger('click')
    await flushPromises()
    expect(platformApi.confirmStudentImport).toHaveBeenCalledWith(
      1,
      'preview-1',
      '894ac385-6d06-449d-bade-a4b0a33c2121',
    )
    expect(wrapper.emitted('imported')).toHaveLength(1)
    expect(wrapper.text()).toContain('已写入 1 名学生')
  })
})
