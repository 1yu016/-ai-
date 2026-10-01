import { describe, expect, it, vi } from 'vitest'
import { DeviceIntent } from '@/classroom/command/DeviceIntent'
import { resolveDeviceIntent, classifyAiDeviceIntent } from '@/classroom/command/DeviceIntentRouter'
import { DeviceCommandExecutor } from '@/classroom/command/DeviceCommandExecutor'
import { runAiCommandFallback } from '@/classroom/command/classroomAiFallback'
import { orchestrateCommand } from '@/classroom/command/commandRuntime'
import { ClassroomCommandExecutor } from '@/classroom/command/ClassroomCommandExecutor'
import { useResourcePlayerStore } from '@/stores/resourcePlayer'

type Player = ReturnType<typeof useResourcePlayerStore>

/** 构造可注入状态/记录的假 player。 */
function fakePlayer(overrides: Partial<Player> = {}) {
  const requestControl = vi.fn()
  const setVolume = vi.fn()
  return {
    currentResource: null,
    hasPlayableMedia: false,
    volume: 0.8,
    requestControl,
    setVolume,
    ...overrides,
  } as unknown as Player
}

/** 断言 resolveDeviceIntent(text) 命中某 intent。 */
function hit(text: string): DeviceIntent {
  const match = resolveDeviceIntent(text)
  expect(match).not.toBeNull()
  expect(match!.normalized).toBeTruthy()
  return match!.intent
}

/** 断言 resolveDeviceIntent(text) 为 null（无明确媒体语义）。 */
function miss(text: string) {
  expect(resolveDeviceIntent(text)).toBeNull()
}

describe('DeviceIntentRouter：明确媒体语义 → DeviceIntent', () => {
  it('“暂停视频”→ PAUSE_MEDIA', () => expect(hit('暂停视频')).toBe(DeviceIntent.PAUSE_MEDIA))
  it('“暂停播放”→ PAUSE_MEDIA', () => expect(hit('暂停播放')).toBe(DeviceIntent.PAUSE_MEDIA))
  it('“暂停音频”→ PAUSE_MEDIA', () => expect(hit('暂停音频')).toBe(DeviceIntent.PAUSE_MEDIA))
  it('“继续播放”→ RESUME_MEDIA', () => expect(hit('继续播放')).toBe(DeviceIntent.RESUME_MEDIA))
  it('“继续视频”→ RESUME_MEDIA', () => expect(hit('继续视频')).toBe(DeviceIntent.RESUME_MEDIA))
  it('“恢复播放”→ RESUME_MEDIA', () => expect(hit('恢复播放')).toBe(DeviceIntent.RESUME_MEDIA))
  it('“停止播放”→ STOP_MEDIA', () => expect(hit('停止播放')).toBe(DeviceIntent.STOP_MEDIA))
  it('“关闭资源”→ CLOSE_RESOURCE', () => expect(hit('关闭资源')).toBe(DeviceIntent.CLOSE_RESOURCE))
  it('“关闭播放器”→ CLOSE_RESOURCE', () => expect(hit('关闭播放器')).toBe(DeviceIntent.CLOSE_RESOURCE))
  it('“声音大一点”→ VOLUME_UP', () => expect(hit('声音大一点')).toBe(DeviceIntent.VOLUME_UP))
  it('“媒体声音大一点”→ VOLUME_UP', () => expect(hit('媒体声音大一点')).toBe(DeviceIntent.VOLUME_UP))
  it('“声音小一点”→ VOLUME_DOWN', () => expect(hit('声音小一点')).toBe(DeviceIntent.VOLUME_DOWN))

  it('裸口令“暂停”→ 不命中（保持 PAUSE_CLASS）', () => miss('暂停'))
  it('裸口令“暂停一下”→ 不命中（保持 PAUSE_CLASS）', () => miss('暂停一下'))
  it('裸口令“继续”→ 不命中（保持 RESUME_CLASS）', () => miss('继续'))
  it('“继续上课”→ 不命中（保持 RESUME_CLASS）', () => miss('继续上课'))
  it('“继续下一个环节”→ 不命中（课堂命令），无媒体语义', () => miss('继续下一个环节'))

  it('疑问句“视频为什么暂停了”→ 不执行', () => miss('视频为什么暂停了'))
  it('疑问句“声音为什么这么小”→ 不执行', () => miss('声音为什么这么小'))
  it('疑问句“下一步播放什么”→ 不执行', () => miss('下一步播放什么'))
  it('疑问句“暂停了吗”→ 不执行', () => miss('暂停了吗'))
  it('否定句“不要暂停视频”→ 不执行', () => miss('不要暂停视频'))
  it('否定句“别把声音调大”→ 不执行', () => miss('别把声音调大'))
})

describe('DeviceIntentRouter：AI fallback 放行 6 个媒体 intent', () => {
  it('pause_media/resume_media/stop_media/close_resource/volume_up/volume_down 放行', () => {
    expect(classifyAiDeviceIntent('pause_media').allowed).toBe(true)
    expect(classifyAiDeviceIntent('resume_media').allowed).toBe(true)
    expect(classifyAiDeviceIntent('stop_media').allowed).toBe(true)
    expect(classifyAiDeviceIntent('close_resource').allowed).toBe(true)
    expect(classifyAiDeviceIntent('volume_up').allowed).toBe(true)
    expect(classifyAiDeviceIntent('volume_down').allowed).toBe(true)
  })
  it('资源类 intent 不放行（search/open/play_resource/open_resources）', () => {
    for (const name of ['search_resource', 'open_resource', 'play_resource', 'open_resources', 'open_chat', 'start_activity', 'unknown']) {
      expect(classifyAiDeviceIntent(name).allowed).toBe(false)
    }
  })
})

describe('DeviceCommandExecutor：有媒体时的执行', () => {
  function playablePlayer() {
    return fakePlayer({ currentResource: { id: 1 } as never, hasPlayableMedia: true, volume: 0.8 })
  }
  function matchFor(intent: DeviceIntent) {
    return { intent, raw: '', normalized: '' }
  }

  it('PAUSE_MEDIA → requestControl(\'pause\')，executed=true', () => {
    const player = playablePlayer()
    const executor = new DeviceCommandExecutor(player)
    const r = executor.execute(matchFor(DeviceIntent.PAUSE_MEDIA))
    expect(r.executed).toBe(true)
    expect(player.requestControl).toHaveBeenCalledWith('pause')
  })
  it('RESUME_MEDIA → requestControl(\'resume\')', () => {
    const player = playablePlayer()
    const executor = new DeviceCommandExecutor(player)
    expect(executor.execute(matchFor(DeviceIntent.RESUME_MEDIA)).executed).toBe(true)
    expect(player.requestControl).toHaveBeenCalledWith('resume')
  })
  it('STOP_MEDIA → requestControl(\'stop\')', () => {
    const player = playablePlayer()
    const executor = new DeviceCommandExecutor(player)
    expect(executor.execute(matchFor(DeviceIntent.STOP_MEDIA)).executed).toBe(true)
    expect(player.requestControl).toHaveBeenCalledWith('stop')
  })
  it('CLOSE_RESOURCE → requestControl(\'close\')', () => {
    const player = playablePlayer()
    const executor = new DeviceCommandExecutor(player)
    expect(executor.execute(matchFor(DeviceIntent.CLOSE_RESOURCE)).executed).toBe(true)
    expect(player.requestControl).toHaveBeenCalledWith('close')
  })
  it('VOLUME_UP → setVolume(volume+0.1)，最高不超过 1', () => {
    const player = playablePlayer()
    const executor = new DeviceCommandExecutor(player)
    expect(executor.execute(matchFor(DeviceIntent.VOLUME_UP)).executed).toBe(true)
    expect(player.setVolume).toHaveBeenCalledWith(0.9)
  })
  it('VOLUME_DOWN → setVolume(volume-0.1)，最低不低于 0', () => {
    const player = playablePlayer()
    const executor = new DeviceCommandExecutor(player)
    expect(executor.execute(matchFor(DeviceIntent.VOLUME_DOWN)).executed).toBe(true)
    expect(player.setVolume).toHaveBeenCalledWith(0.7)
  })
})

describe('DeviceCommandExecutor：无媒体时的安全 no-op（不假装成功）', () => {
  function emptyPlayer() {
    return fakePlayer({ currentResource: null, hasPlayableMedia: false, volume: 0.8 })
  }
  function matchFor(intent: DeviceIntent) {
    return { intent, raw: '', normalized: '' }
  }

  it('无资源时 PAUSE_MEDIA → executed=false，无副作用，反馈“当前没有正在播放的媒体。”', () => {
    const player = emptyPlayer()
    const executor = new DeviceCommandExecutor(player)
    const r = executor.execute(matchFor(DeviceIntent.PAUSE_MEDIA))
    expect(r.executed).toBe(false)
    expect(r.message).toBe('当前没有正在播放的媒体。')
    expect(player.requestControl).not.toHaveBeenCalled()
    expect(player.setVolume).not.toHaveBeenCalled()
  })
  it('无资源时 RESUME_MEDIA / STOP_MEDIA → executed=false', () => {
    const executor = new DeviceCommandExecutor(emptyPlayer())
    expect(executor.execute(matchFor(DeviceIntent.RESUME_MEDIA)).executed).toBe(false)
    expect(executor.execute(matchFor(DeviceIntent.STOP_MEDIA)).executed).toBe(false)
  })
  it('无资源时 CLOSE_RESOURCE → executed=false（安全 no-op，不显示假成功）', () => {
    const player = emptyPlayer()
    const executor = new DeviceCommandExecutor(player)
    const r = executor.execute(matchFor(DeviceIntent.CLOSE_RESOURCE))
    expect(r.executed).toBe(false)
    expect(r.message).toBe('当前没有打开的媒体。')
    expect(player.requestControl).not.toHaveBeenCalled()
  })
  it('无资源时 VOLUME_UP / VOLUME_DOWN → executed=false，不改音量，反馈准确', () => {
    const player = emptyPlayer()
    const executor = new DeviceCommandExecutor(player)
    const up = executor.execute(matchFor(DeviceIntent.VOLUME_UP))
    const down = executor.execute(matchFor(DeviceIntent.VOLUME_DOWN))
    expect(up.executed).toBe(false)
    expect(down.executed).toBe(false)
    expect(up.message).toBe('当前没有可调整音量的媒体。')
    expect(player.setVolume).not.toHaveBeenCalled()
    expect(player.volume).toBe(0.8)
  })
})

describe('commandRuntime 总编排：Device / Classroom / fallback 共用单入口', () => {
  function build() {
    const resourcePlayer = fakePlayer({
      currentResource: { id: 1 } as never,
      hasPlayableMedia: true,
      volume: 0.8,
    })
    const next = vi.fn()
    const classroom = new ClassroomCommandExecutor(
      { next, previous: vi.fn(), pause: vi.fn(), resume: vi.fn(), repeat: vi.fn() } as never,
      resourcePlayer,
    )
    const device = new DeviceCommandExecutor(resourcePlayer)
    const executors = { classroom, device }
    return { resourcePlayer, executors, next }
  }

  function deps(overrides: Partial<{ post: () => Promise<unknown>; isCurrent: () => boolean }> = {}) {
    return {
      post: overrides.post ?? vi.fn(async () => ({ intent: 'unknown', reply: '' })),
      isCurrent: overrides.isCurrent ?? (() => true),
    }
  }

  const run = (executors: { classroom: unknown; device: unknown }, deps: unknown, text: string, runId = 1) =>
    orchestrateCommand({ text, runId, body: { text, context: {} }, executors: executors as never, deps: deps as never })

  it('“暂停视频”→ device_executed（走媒体，不写课堂后端）', async () => {
    const { executors, next } = build()
    const outcome = await run(executors, deps(), '暂停视频')
    expect(outcome.kind).toBe('device_executed')
    if (outcome.kind === 'device_executed') expect(outcome.intent).toBe(DeviceIntent.PAUSE_MEDIA)
    expect(next).not.toHaveBeenCalled()
  })

  it('“下一步”→ classroom executed（课堂状态命令不被媒体抢占）', async () => {
    const { executors, next } = build()
    const outcome = await run(executors, deps(), '下一步')
    expect(outcome.kind).toBe('executed')
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('裸口令“暂停”→ classroom PAUSE_CLASS（不是 pause_media）', async () => {
    const { executors } = build()
    const post = vi.fn() // 不应触发 /ai/command
    const outcome = await orchestrateCommand({ text: '暂停', runId: 1, body: { text: '暂停', context: {} }, executors, deps: { post, isCurrent: () => true } as never })
    expect(outcome.kind).toBe('executed')
    expect(post).not.toHaveBeenCalled()
  })

  it('AI fallback 放行 pause_media → 路由到 DeviceCommandExecutor，真实暂停', async () => {
    const { executors, resourcePlayer } = build()
    const post = vi.fn(async () => ({ intent: 'pause_media', reply: '准备暂停当前媒体。' }))
    const outcome = await runAiCommandFallback(1, '复杂表达', { text: '复杂表达' }, { post, isCurrent: () => true }, executors)
    expect(outcome.kind).toBe('device_executed')
    if (outcome.kind === 'device_executed') {
      expect(outcome.intent).toBe(DeviceIntent.PAUSE_MEDIA)
      expect(outcome.executed).toBe(true)
    }
    expect(resourcePlayer.requestControl).toHaveBeenCalledWith('pause')
  })

  it('AI fallback 未放行 play_resource → unsupported，不执行', async () => {
    const { executors, resourcePlayer } = build()
    const post = vi.fn(async () => ({ intent: 'play_resource', reply: 'xx' }))
    const outcome = await runAiCommandFallback(1, '帮我播放小星星', { text: '帮我播放小星星' }, { post, isCurrent: () => true }, executors)
    expect(outcome.kind).toBe('unsupported')
    if (outcome.kind === 'unsupported') expect(outcome.intent).toBe('play_resource')
    expect(resourcePlayer.requestControl).not.toHaveBeenCalled()
  })
})