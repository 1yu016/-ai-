import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type {
  CourseResource,
  CourseResourceMediaType,
  ServerResource,
} from '@/stores/courseResource'
import {
  buildResourceResult,
  evaluateResourceCommand,
  normalizeCandidates,
  resolveExecuteAction,
  RESOURCE_SAFETY_DECLINE_HINT,
} from '@/classroom/command/ResourceCommandCoordinator'
import {
  isPlayableResource,
  isResourceIntent,
  type ResourceCommandResult,
} from '@/classroom/command/ResourceCommand'
import { runAiCommandFallback } from '@/classroom/command/classroomAiFallback'
import {
  orchestrateCommand,
  type CommandRuntimeExecutors,
} from '@/classroom/command/commandRuntime'
import { runAsrTextThroughCommand } from '@/services/voiceCommand'
import ResourceCandidatePanel from '@/components/classroom/ResourceCandidatePanel.vue'

/**
 * Stage 6.5 Resource Command 测试：
 * 核心约束 = 「AI 辅助、教师确认后儿童才看到」。
 * 任何测试都不得允许未确认即打开/播放。
 */

/** 后端返回形态的候选（ServerResource + score，与 ResourceSearchResult 对齐）。 */
function serverResource(overrides: Partial<ServerResource> = {}): ServerResource {
  return {
    id: 1,
    title: '数字1的视频',
    aliases: [],
    description: null,
    resourceType: 'video',
    category: '视频动画',
    ageGroup: 'middle',
    tags: ['数字', '数学'],
    fileUrl: '/resources/1/download',
    coverUrl: null,
    fileName: 'num1.mp4',
    mimeType: 'video/mp4',
    fileSize: 1000,
    duration: 60,
    reviewStatus: 'approved',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function courseResource(
  id: number,
  title: string,
  mediaType: CourseResourceMediaType = 'video',
): CourseResource {
  return {
    id,
    title,
    fileName: `${title}.mp4`,
    category: '视频动画',
    mediaType,
    aliases: [],
    ageGroup: 'middle',
    ageGroups: ['middle'],
    tags: ['数字'],
    themes: ['数学'],
    description: null,
    coverUrl: null,
    mimeType: mediaType === 'audio' ? 'audio/mp3' : 'video/mp4',
    fileSize: 1000,
    duration: 60,
    reviewStatus: 'approved',
    source: 'library',
  }
}

function mockExecutors() {
  const device = {
    execute: vi.fn(() => ({ executed: false, message: 'x', intent: 'PAUSE_MEDIA' })),
  }
  const classroom = {
    execute: vi.fn(async () => ({ success: true, message: 'x', command: 'next' })),
  }
  const group = { device, classroom } as unknown as CommandRuntimeExecutors
  return { device, classroom, group }
}

function fallback(payload: unknown, raw = '播放数字1的视频') {
  const post = vi.fn(async () => payload)
  const { device, classroom, group } = mockExecutors()
  return {
    post,
    device,
    classroom,
    outcomePromise: runAiCommandFallback(
      1,
      raw,
      { text: raw, context: {} },
      { post, isCurrent: () => true },
      group,
      5000,
    ),
  }
}

describe('ResourceCommand 类型与可播放性判定', () => {
  it('识别三个资源意图', () => {
    expect(isResourceIntent('search_resource')).toBe(true)
    expect(isResourceIntent('open_resource')).toBe(true)
    expect(isResourceIntent('play_resource')).toBe(true)
    expect(isResourceIntent('pause_media')).toBe(false)
    expect(isResourceIntent('unknown')).toBe(false)
  })

  it('只有 audio/video 算可播放媒体', () => {
    expect(isPlayableResource(courseResource(1, '歌', 'audio'))).toBe(true)
    expect(isPlayableResource(courseResource(1, '视频'))).toBe(true)
    expect(isPlayableResource(courseResource(1, '图', 'image'))).toBe(false)
  })
})

describe('buildResourceResult：/ai/command 响应 → 待确认结果', () => {
  it('唯一 matched（resource 字段）→ 单候选、requiresConfirmation 被忽略，仍待确认', () => {
    const result = buildResourceResult(
      {
        intent: 'play_resource',
        reply: '已找到。',
        matchStatus: 'matched',
        requiresConfirmation: false,
        resource: serverResource(),
      },
      'play_resource',
    )
    expect(result).not.toBeNull()
    expect(result!.matchStatus).toBe('matched')
    expect(result!.candidates).toHaveLength(1)
    expect(result!.candidates[0]!.title).toBe('数字1的视频')
  })

  it('multiple → 保留后端候选列表（不自动选第一个）', () => {
    const result = buildResourceResult(
      {
        intent: 'play_resource',
        reply: '找到了以下资源，请选择：',
        matchStatus: 'multiple',
        candidates: [serverResource({ id: 1 }), serverResource({ id: 2, title: '数字2的视频' })],
      },
      'play_resource',
    )!
    expect(result.matchStatus).toBe('multiple')
    expect(result.candidates).toHaveLength(2)
    expect(result.candidates.map((c) => c.id)).toEqual([1, 2])
  })

  it('low_confidence → 保留 low_confidence（必须教师确认）', () => {
    const result = buildResourceResult(
      {
        intent: 'open_resource',
        reply: '我找到了一个可能的资源，请教师确认后再执行。',
        matchStatus: 'low_confidence',
        candidates: [serverResource()],
      },
      'open_resource',
    )!
    expect(result.matchStatus).toBe('low_confidence')
    expect(result.candidates).toHaveLength(1)
  })

  it('not_found → 空候选 + 固定反馈“没有找到合适的资源，未执行。”', () => {
    const result = buildResourceResult(
      {
        intent: 'play_resource',
        reply: '没有找到“数字1”，请试试资源的完整标题或别名。',
        matchStatus: 'not_found',
      },
      'play_resource',
    )!
    expect(result.matchStatus).toBe('not_found')
    expect(result.candidates).toHaveLength(0)
    expect(result.reply).toBe('没有找到合适的资源，未执行。')
  })

  it('脏数据候选被过滤，不进入候选列表', () => {
    const result = buildResourceResult(
      {
        intent: 'play_resource',
        reply: '找到了以下资源，请选择：',
        matchStatus: 'multiple',
        candidates: [serverResource(), { bad: true } as unknown as ServerResource],
      },
      'play_resource',
    )!
    expect(result.candidates).toHaveLength(1)
  })

  it('候选归一化复用 normalizeServerResource（不新建 fetch/endpoint）', () => {
    const list = normalizeCandidates(undefined, [serverResource()])
    expect(list).toHaveLength(1)
    expect(list[0]!.id).toBe(1)
  })
})

describe('evaluateResourceCommand：安全句守卫', () => {
  it('明确祈使句放行，保持 AI 意图', () => {
    expect(evaluateResourceCommand('play_resource', '播放数字1的视频')).toEqual({
      allowed: true,
      intent: 'play_resource',
    })
  })

  it('显式打开语句覆盖错误的模型播放分类', () => {
    expect(evaluateResourceCommand('play_resource', '打开数字1的视频')).toEqual({
      allowed: true,
      intent: 'open_resource',
    })
  })

  it('“不要播放视频”→ 拒绝（否定）', () => {
    const verdict = evaluateResourceCommand('play_resource', '不要播放视频')
    expect(verdict.allowed).toBe(false)
    if (!verdict.allowed) expect(verdict.message).toBe(RESOURCE_SAFETY_DECLINE_HINT)
  })

  it('“数字1的视频为什么打不开”→ 拒绝（疑问且非搜索）', () => {
    expect(evaluateResourceCommand('play_resource', '数字1的视频为什么打不开').allowed).toBe(false)
  })

  it('“播放什么比较好”→ 拒绝（疑问且非搜索）', () => {
    expect(evaluateResourceCommand('play_resource', '播放什么比较好').allowed).toBe(false)
  })

  it('“有什么数字1的视频”→ 放行并强制为 search_resource（只搜索不播放）', () => {
    expect(evaluateResourceCommand('play_resource', '有什么数字1的视频')).toEqual({
      allowed: true,
      intent: 'search_resource',
    })
    expect(evaluateResourceCommand('search_resource', '有什么数字1的视频')).toEqual({
      allowed: true,
      intent: 'search_resource',
    })
  })
})

describe('resolveExecuteAction：确认后的打开/播放决策', () => {
  it('PLAY_RESOURCE + video → autoplay（openResource(resource, true)）', () => {
    expect(resolveExecuteAction('play_resource', courseResource(1, '视频'))).toEqual({
      action: 'play',
      autoPlay: true,
    })
  })

  it('PLAY_RESOURCE + audio → autoplay', () => {
    expect(resolveExecuteAction('play_resource', courseResource(1, '歌', 'audio'))).toEqual({
      action: 'play',
      autoPlay: true,
    })
  })

  it('OPEN_RESOURCE → 打开（openResource(resource, false)）', () => {
    expect(resolveExecuteAction('open_resource', courseResource(1, '视频'))).toEqual({
      action: 'open',
      autoPlay: false,
    })
  })

  it('SEARCH_RESOURCE → 只展示，教师选择后以打开方式查看（不自动播放）', () => {
    expect(resolveExecuteAction('search_resource', courseResource(1, '视频'))).toEqual({
      action: 'open',
      autoPlay: false,
    })
  })

  it('PLAY_RESOURCE + image → 降级为打开并明确告知，绝不 autoplay', () => {
    const action = resolveExecuteAction('play_resource', courseResource(1, '图', 'image'))
    expect(action).toEqual({
      action: 'open',
      autoPlay: false,
      note: '该资源不可播放，将以打开方式展示。',
    })
  })
})

describe('runAiCommandFallback：资源命令进入确认流程、确认前零执行', () => {
  it('唯一 matched：产生待确认结果，未确认前 device/classroom 执行器 0 次', async () => {
    const { outcomePromise, device, classroom } = fallback({
      intent: 'play_resource',
      reply: '已找到。',
      matchStatus: 'matched',
      requiresConfirmation: false,
      resource: serverResource(),
    })
    const outcome = await outcomePromise
    expect(outcome.kind).toBe('resource_pending')
    if (outcome.kind === 'resource_pending') {
      expect(outcome.result.matchStatus).toBe('matched')
      expect(outcome.result.candidates).toHaveLength(1)
    }
    expect(device.execute).not.toHaveBeenCalled()
    expect(classroom.execute).not.toHaveBeenCalled()
  })

  it('multiple：返回全部候选，未选择前 0 次执行', async () => {
    const { outcomePromise, device, classroom } = fallback({
      intent: 'open_resource',
      reply: '找到了以下资源，请选择：',
      matchStatus: 'multiple',
      candidates: [serverResource({ id: 1 }), serverResource({ id: 2 })],
    })
    const outcome = await outcomePromise
    expect(outcome.kind).toBe('resource_pending')
    if (outcome.kind === 'resource_pending') {
      expect(outcome.result.candidates).toHaveLength(2)
      expect(outcome.result.matchStatus).toBe('multiple')
    }
    expect(device.execute).not.toHaveBeenCalled()
    expect(classroom.execute).not.toHaveBeenCalled()
  })

  it('not_found：返回 not_found 结果，无任何执行副作用', async () => {
    const { outcomePromise, device, classroom } = fallback({
      intent: 'play_resource',
      reply: '没有找到合适的资源，未执行。',
      matchStatus: 'not_found',
    })
    const outcome = await outcomePromise
    expect(outcome.kind).toBe('resource_pending')
    if (outcome.kind === 'resource_pending') {
      expect(outcome.result.matchStatus).toBe('not_found')
      expect(outcome.result.candidates).toHaveLength(0)
    }
    expect(device.execute).not.toHaveBeenCalled()
    expect(classroom.execute).not.toHaveBeenCalled()
  })

  it('否定句：直接安全失败，不发起执行、不产生候选', async () => {
    const { outcomePromise, device, classroom } = fallback(
      { intent: 'play_resource', reply: 'x', matchStatus: 'matched', resource: serverResource() },
      '不要播放视频',
    )
    const outcome = await outcomePromise
    expect(outcome.kind).toBe('failed')
    if (outcome.kind === 'failed') expect(outcome.hint).toBe(RESOURCE_SAFETY_DECLINE_HINT)
    expect(device.execute).not.toHaveBeenCalled()
    expect(classroom.execute).not.toHaveBeenCalled()
  })

  it('疑问句（为什么打不开）：安全失败，不执行', async () => {
    const { outcomePromise, device, classroom } = fallback(
      { intent: 'play_resource', reply: 'x', matchStatus: 'matched', resource: serverResource() },
      '数字1的视频为什么打不开',
    )
    const outcome = await outcomePromise
    expect(outcome.kind).toBe('failed')
    if (outcome.kind === 'failed') expect(outcome.hint).toBe(RESOURCE_SAFETY_DECLINE_HINT)
    expect(device.execute).not.toHaveBeenCalled()
    expect(classroom.execute).not.toHaveBeenCalled()
  })

  it('搜索类提问：强制 search_resource（只出候选，不自动播放）', async () => {
    const { outcomePromise, device, classroom } = fallback(
      { intent: 'play_resource', reply: '找到了以下资源，请选择：', matchStatus: 'matched', resource: serverResource() },
      '有什么数字1的视频',
    )
    const outcome = await outcomePromise
    expect(outcome.kind).toBe('resource_pending')
    if (outcome.kind === 'resource_pending') {
      expect(outcome.intent).toBe('search_resource')
      expect(outcome.result.candidates).toHaveLength(1)
    }
    expect(device.execute).not.toHaveBeenCalled()
    expect(classroom.execute).not.toHaveBeenCalled()
  })
})

describe('文本与语音共用同一 commandRuntime', () => {
  async function runThroughRuntime(post: (url: string, body: unknown, config?: unknown) => Promise<unknown>) {
    const { device, classroom, group } = mockExecutors()
    const outcome = await orchestrateCommand({
      text: '播放数字1的视频',
      runId: 1,
      body: { text: '播放数字1的视频', context: {} },
      executors: group,
      deps: { post, isCurrent: () => true },
    })
    return { outcome, device, classroom }
  }

  it('文本路径 → resource_pending（确认前零执行）', async () => {
    const post = vi.fn(async () => ({
      intent: 'play_resource',
      reply: '已找到。',
      matchStatus: 'matched',
      resource: serverResource(),
    }))
    const { outcome, device, classroom } = await runThroughRuntime(post)
    expect(outcome.kind).toBe('resource_pending')
    expect(device.execute).not.toHaveBeenCalled()
    expect(classroom.execute).not.toHaveBeenCalled()
  })

  it('ASR 文本路径 runAsrTextThroughCommand 走同一 orchestrateCommand → 同样 resource_pending', async () => {
    const post = vi.fn(async () => ({
      intent: 'play_resource',
      reply: '已找到。',
      matchStatus: 'matched',
      resource: serverResource(),
    }))
    const { device, classroom, group } = mockExecutors()
    const outcome = await runAsrTextThroughCommand(
      '播放数字1的视频',
      1,
      { currentPage: 'resources', playerStatus: 'idle' },
      group,
      { post, isCurrent: () => true },
    )
    expect(outcome.kind).toBe('resource_pending')
    if (outcome.kind === 'resource_pending') {
      expect(outcome.result.candidates).toHaveLength(1)
    }
    expect(device.execute).not.toHaveBeenCalled()
    expect(classroom.execute).not.toHaveBeenCalled()
  })
})

describe('ResourceCandidatePanel：教师确认 UI', () => {
  function result(overrides: Partial<ResourceCommandResult> = {}): ResourceCommandResult {
    return {
      intent: 'play_resource',
      reply: '找到了以下资源，请选择：',
      matchStatus: 'matched',
      candidates: [courseResource(1, '数字1的视频')],
      ...overrides,
    }
  }

  it('唯一 matched → 显示“找到资源：XXX” + [播放]/[取消]，点击确认携带正确资源', async () => {
    const wrapper = mount(ResourceCandidatePanel, { props: { result: result() } })
    expect(wrapper.text()).toContain('找到资源：数字1的视频')
    const playButton = wrapper.findAll('button').find((b) => b.text() === '播放')
    expect(playButton).toBeTruthy()
    await playButton!.trigger('click')
    expect(wrapper.emitted('confirm')![0]![0]).toMatchObject({ id: 1, title: '数字1的视频' })
  })

  it('multiple → 展示全部候选；选择第 2 个 → 携带正确资源，不自动选第一个', async () => {
    const wrapper = mount(ResourceCandidatePanel, {
      props: {
        result: result({
          matchStatus: 'multiple',
          candidates: [courseResource(1, 'A'), courseResource(2, 'B')],
        }),
      },
    })
    expect(wrapper.findAll('.rcp-candidate')).toHaveLength(2)
    const buttons = wrapper.findAll('.rcp-btn.primary')
    expect(buttons).toHaveLength(2)
    await buttons[1]!.trigger('click')
    expect(wrapper.emitted('confirm')![0]![0]).toMatchObject({ id: 2, title: 'B' })
  })

  it('open_resource → 按钮为 [选择并打开]', async () => {
    const wrapper = mount(ResourceCandidatePanel, {
      props: {
        result: result({ intent: 'open_resource', candidates: [courseResource(1, 'A')] }),
      },
    })
    const buttons = wrapper.findAll('.rcp-btn.primary')
    expect(buttons[0]!.text()).toBe('打开')
  })

  it('play + image → 显示“该资源不可播放”降级说明，按钮为 [打开]', () => {
    const wrapper = mount(ResourceCandidatePanel, {
      props: {
        result: result({
          intent: 'play_resource',
          candidates: [courseResource(1, '图', 'image')],
        }),
      },
    })
    expect(wrapper.text()).toContain('该资源不可播放，将以打开方式展示。')
    const buttons = wrapper.findAll('.rcp-btn.primary')
    expect(buttons[0]!.text()).toBe('打开')
  })

  it('取消 → emit cancel（不产生播放器副作用）', async () => {
    const wrapper = mount(ResourceCandidatePanel, {
      props: { result: result() },
    })
    const cancelButton = wrapper.findAll('button').find((b) => b.text() === '取消')
    await cancelButton!.trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('confirm')).toBeUndefined()
  })
})
