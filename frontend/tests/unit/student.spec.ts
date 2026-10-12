import { describe, expect, it } from 'vitest'
import {
  CONSENT_STATUS_LABELS,
  CONSENT_TYPE_LABELS,
  STUDENT_AUTHORIZATION_LABELS,
  studentAuthorizationStatus,
  studentDisplayName,
  studentStatusLabel,
} from '@/utils/student'

describe('学生展示模型', () => {
  it('统一授权状态、授权类型和学生状态中文文案', () => {
    expect(STUDENT_AUTHORIZATION_LABELS).toEqual({
      authorized: '已授权',
      partial: '部分授权',
      unauthorized: '未授权',
      pending: '待确认',
    })
    expect(CONSENT_TYPE_LABELS).toMatchObject({ photo: '照片', voice: '声音', artwork: '作品' })
    expect(CONSENT_STATUS_LABELS).toMatchObject({ granted: '已授权', revoked: '未授权', pending: '待确认' })
    expect(studentStatusLabel('active')).toBe('在读')
    expect(studentStatusLabel('disabled')).toBe('已停用')
  })

  it('缺少授权摘要时安全回退到待确认', () => {
    expect(studentAuthorizationStatus({})).toBe('pending')
    expect(studentAuthorizationStatus({ authorizationStatus: 'partial' })).toBe('partial')
  })

  it('姓名字段异常时不会显示 undefined', () => {
    expect(studentDisplayName({ id: 7, name: ' 小雨 ', nickname: null })).toBe('小雨')
    expect(studentDisplayName({ id: 8, name: '', nickname: '雨雨' })).toBe('雨雨')
    expect(studentDisplayName({ id: 9, name: undefined, nickname: undefined })).toBe('幼儿 9')
  })
})
