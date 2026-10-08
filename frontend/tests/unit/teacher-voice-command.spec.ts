import { describe, expect, it } from 'vitest'
import {
  routeTeacherVoiceCommand,
  synonymConflictReason,
} from '@/classroom/command/TeacherVoiceCommandRouter'

describe('教师点击录音课堂指令路由', () => {
  it.each([
    ['下一步', 'next_step'], ['上一步', 'previous_step'], ['next', 'next_step'],
    ['pause', 'pause_media'], ['resume', 'resume_media'], ['上一页', 'previous_page'],
    ['next page', 'next_page'], ['zoom in', 'zoom_in'], ['静音', 'mute'],
    ['随机点名', 'random_roll_call'], ['进入课间', 'start_break'], ['结束课间', 'end_break'],
  ])('%s 使用本地确定性规则映射为 %s', (raw, operation) => {
    const result = routeTeacherVoiceCommand(raw)
    expect(result?.kind).toBe('command')
    if (result?.kind === 'command') expect(result.match.operation).toBe(operation)
  })

  it('指定步骤使用人类的一基序号并转换为 stepIndex', () => {
    const result = routeTeacherVoiceCommand('切换到第3步')
    expect(result?.kind).toBe('command')
    if (result?.kind === 'command') expect(result.match.parameters).toEqual({ stepIndex: 2 })
  })

  it.each(['点名小明', '奖励小红', '第一组点名', '完成课堂'])(
    '%s 必须教师确认', (raw) => {
      const result = routeTeacherVoiceCommand(raw)
      expect(result?.kind).toBe('command')
      if (result?.kind === 'command') expect(result.match.requiresConfirmation).toBe(true)
    },
  )

  it.each(['不要下一步', '下一步是什么？', '要不要暂停播放', 'can you pause?'])(
    '否定句或疑问句 %s 不执行', (raw) => expect(routeTeacherVoiceCommand(raw)).toBeNull(),
  )

  it('复杂资源名称只进入资源搜索，不直接播放', () => {
    expect(routeTeacherVoiceCommand('播放小星星')).toEqual({
      kind: 'resource_search', keyword: '小星星', normalized: '播放小星星',
    })
  })

  it('自定义同义词只能精确命中白名单指令', () => {
    const synonyms = [{ id: 1, phrase: '往前走', operation: 'next_step' as const }]
    const result = routeTeacherVoiceCommand('往前走', synonyms)
    expect(result?.kind).toBe('command')
    if (result?.kind === 'command') {
      expect(result.match.operation).toBe('next_step')
      expect(result.match.source).toBe('custom')
    }
    expect(routeTeacherVoiceCommand('请往前走一下', synonyms)).toBeNull()
  })

  it('内置冲突、重复和否定同义词不能保存', () => {
    expect(synonymConflictReason('下一步')).toContain('冲突')
    expect(synonymConflictReason('不要往前')).toContain('否定')
    expect(synonymConflictReason('往前走', [{ phrase: '往前走', operation: 'next_step' }])).toContain('存在')
  })
})
