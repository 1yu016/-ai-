import { describe, expect, it, vi } from 'vitest'
import { ClassroomIntent } from '@/classroom/command/ClassroomIntent'
import { classifyAiIntent, resolveIntent } from '@/classroom/command/ClassroomIntentRouter'
import { ClassroomCommandExecutor } from '@/classroom/command/ClassroomCommandExecutor'
import { useLessonRunStore } from '@/stores/lessonRun'
import { useResourcePlayerStore } from '@/stores/resourcePlayer'

/**
 * 借鉴 OHF-Voice/intents 的 sentence fixtures 测试思想：
 * 用「预期 intent + valid/invalid 语料」组织，专门盯防 false positive。
 */

type Fixture = {
  intent: ClassroomIntent
  valid: string[]
  /** 明确应被否定/疑问守卫拦截的句子，不得解析为目标 intent */
  invalid: string[]
}

const FIXTURES: Fixture[] = [
  {
    intent: ClassroomIntent.NEXT_STEP,
    valid: ['下一步', '下一个环节', '进入下一环节', '我们继续下一个环节吧', '进入下一个步骤'],
    // 含“下一步”关键词但语义不是执行
    invalid: ['不要进入下一步', '下一步我们要做什么？', '什么时候进入下一步', '怎么进入下一个环节'],
  },
  {
    intent: ClassroomIntent.PREVIOUS_STEP,
    valid: ['上一步', '上一个环节', '回到上一环节', '上一个步骤'],
    invalid: ['不要回到上一环节', '上一环节是什么内容？'],
  },
  {
    intent: ClassroomIntent.PAUSE_CLASS,
    valid: ['暂停', '暂停一下', '先停一下', '停一停', '先暂停'],
    invalid: ['不要暂停', '什么时候暂停？'],
  },
  {
    intent: ClassroomIntent.RESUME_CLASS,
    valid: ['继续', '继续上课', '接着上课', '继续课堂', '继续吧'],
    invalid: ['不要继续', '继续什么？'],
  },
]

describe('ClassroomIntentRouter sentence fixtures', () => {
  it.each(FIXTURES)(
    '应解析 $intent 的合法说法',
    ({ intent, valid }) => {
      for (const sentence of valid) {
        const match = resolveIntent(sentence)
        expect(match.local, `"${sentence}" 应本地命中`).toBe(true)
        expect(match.intent, `"${sentence}" 应解析为 ${intent}`).toBe(intent)
      }
    },
  )

  it.each(FIXTURES)(
    '不应误判 $intent 的否定/疑问表达',
    ({ intent, invalid }) => {
      for (const sentence of invalid) {
        const match = resolveIntent(sentence)
        expect(match.intent, `"${sentence}" 不应解析为 ${intent}`).not.toBe(intent)
      }
    },
  )
})

describe('常见指令的正常化与识别', () => {
  it('全角/半角与标点不影响识别', () => {
    expect(resolveIntent('下一　步！').intent).toBe(ClassroomIntent.NEXT_STEP)
    expect(resolveIntent('我们，继续下一个环节吧').intent).toBe(ClassroomIntent.NEXT_STEP)
  })

  it('“继续”优先解析为 RESUME，而不是与 NEXT 冲突', () => {
    expect(resolveIntent('继续').intent).toBe(ClassroomIntent.RESUME_CLASS)
    expect(resolveIntent('继续上课').intent).toBe(ClassroomIntent.RESUME_CLASS)
    expect(resolveIntent('继续下一个环节').intent).toBe(ClassroomIntent.NEXT_STEP)
  })

  it('RESET_STEP 映射到 reset 命令（本地 Device/UI，不写后端）', () => {
    const match = resolveIntent('重置本环节')
    expect(match.intent).toBe(ClassroomIntent.RESET_STEP)
    expect(match.command).toBe('reset')
    expect(match.local).toBe(true)
  })
})

describe('UNKNOWN 与 AI fallback', () => {
  it('无法可靠判断的表达归为 UNKNOWN 且 local=false', () => {
    const match = resolveIntent('我们回到刚刚认识数字外形的那个环节')
    expect(match.intent).toBe(ClassroomIntent.UNKNOWN)
    expect(match.local).toBe(false)
  })

  it('空输入归为 UNKNOWN', () => {
    expect(resolveIntent('  ').intent).toBe(ClassroomIntent.UNKNOWN)
  })
})

function buildExecutor(overrides: Partial<Record<'next' | 'previous' | 'pause' | 'resume' | 'reset', ReturnType<typeof vi.fn>>> = {}) {
  const lessonRun = {
    next: overrides.next ?? vi.fn(),
    previous: overrides.previous ?? vi.fn(),
    pause: overrides.pause ?? vi.fn(),
    resume: overrides.resume ?? vi.fn(),
    repeat: overrides.reset ?? vi.fn(),
  } as unknown as ReturnType<typeof useLessonRunStore>
  const resourcePlayer = {} as ReturnType<typeof useResourcePlayerStore>
  return new ClassroomCommandExecutor(lessonRun, resourcePlayer)
}

describe('Executor 仅接受结构化命令并把权威命令交回后端', () => {
  it('把 NEXT_STEP 交给 lessonRun.next（最终走后端）', async () => {
    const next = vi.fn()
    const exec = buildExecutor({ next })
    await exec.execute({ intent: ClassroomIntent.NEXT_STEP, raw: '下一步', normalized: '下一步', local: true, command: 'next' })
    expect(next).toHaveBeenCalledTimes(1)
    expect(next).not.toHaveBeenCalledWith(expect.stringContaining('下一步')) // 不把原文塞给后端
  })

  it('把 PAUSE_CLASS / RESUME_CLASS 交给对应后端操作', async () => {
    const pause = vi.fn()
    const resume = vi.fn()
    const exec = buildExecutor({ pause, resume })
    await exec.execute({ intent: ClassroomIntent.PAUSE_CLASS, raw: '暂停', normalized: '暂停', local: true, command: 'pause' })
    await exec.execute({ intent: ClassroomIntent.RESUME_CLASS, raw: '继续', normalized: '继续', local: true, command: 'resume' })
    expect(pause).toHaveBeenCalledTimes(1)
    expect(resume).toHaveBeenCalledTimes(1)
  })

  it('UNKNOWN 或无 command 不调用任何后端方法', async () => {
    const next = vi.fn()
    const exec = buildExecutor({ next })
    await exec.execute({ intent: ClassroomIntent.UNKNOWN, raw: 'x', normalized: 'x', local: false, command: null })
    expect(next).not.toHaveBeenCalled()
  })
})

describe('ASR 无标点语义疑问守卫（不得仅依赖 ? ？）', () => {
  it('明确指令仍正常解析', () => {
    expect(resolveIntent('下一步').intent).toBe(ClassroomIntent.NEXT_STEP)
    expect(resolveIntent('我们继续上课').intent).toBe(ClassroomIntent.RESUME_CLASS)
  })

  it('“下一步我们要做什么”不得解析为 NEXT_STEP', () => {
    expect(resolveIntent('下一步我们要做什么').intent).not.toBe(ClassroomIntent.NEXT_STEP)
    expect(resolveIntent('下一步我们要做什么').local).toBe(false)
  })

  it('“下一步应该怎么做”不得解析为 NEXT_STEP', () => {
    expect(resolveIntent('下一步应该怎么做').intent).not.toBe(ClassroomIntent.NEXT_STEP)
  })

  it('“什么时候暂停”不得解析为 PAUSE_CLASS', () => {
    expect(resolveIntent('什么时候暂停').intent).not.toBe(ClassroomIntent.PAUSE_CLASS)
  })

  it('“继续是什么意思”不得解析为 RESUME_CLASS', () => {
    expect(resolveIntent('继续是什么意思').intent).not.toBe(ClassroomIntent.RESUME_CLASS)
  })
})

describe('多 intent / 冲突检测', () => {
  it('“先暂停一下然后继续”不得直接执行任一课堂状态命令', () => {
    const m = resolveIntent('先暂停一下然后继续')
    expect(m.intent).not.toBe(ClassroomIntent.PAUSE_CLASS)
    expect(m.intent).not.toBe(ClassroomIntent.RESUME_CLASS)
    expect(m.command).toBeNull()
  })

  it('“不要下一步我们继续讲”→ UNKNOWN 且不执行任何 command', () => {
    const m = resolveIntent('不要下一步我们继续讲')
    expect(m.intent).toBe(ClassroomIntent.UNKNOWN)
    expect(m.local).toBe(false)
    expect(m.command).toBeNull()
  })

  it('“下一步我们继续认识数字”→ 不得因“继续”触发 RESUME_CLASS', () => {
    expect(resolveIntent('下一步我们继续认识数字').intent).not.toBe(ClassroomIntent.RESUME_CLASS)
  })

  it('“上一环节还是下一环节”不得直接执行（二选一歧义），最终 UNKNOWN', () => {
    const m = resolveIntent('上一环节还是下一环节')
    expect(m.intent).toBe(ClassroomIntent.UNKNOWN)
    expect(m.command).toBeNull()
  })

  it('“继续下一个环节”命中多意图但无组合结构词，视为 NEXT_STEP（一体措辞）', () => {
    expect(resolveIntent('继续下一个环节').intent).toBe(ClassroomIntent.NEXT_STEP)
  })
})

describe('RESUME_CLASS“继续”误执行卫士', () => {
  it('明确的恢复措辞解析为 RESUME_CLASS', () => {
    expect(resolveIntent('继续上课').intent).toBe(ClassroomIntent.RESUME_CLASS)
    expect(resolveIntent('恢复上课').intent).toBe(ClassroomIntent.RESUME_CLASS)
    expect(resolveIntent('我们接着上课').intent).toBe(ClassroomIntent.RESUME_CLASS)
    expect(resolveIntent('继续课堂').intent).toBe(ClassroomIntent.RESUME_CLASS)
  })

  it('“继续+内容动作宾语”不得触发 RESUME_CLASS → UNKNOWN 且 command=null', () => {
    const a = resolveIntent('继续讲这个故事')
    expect(a.intent).toBe(ClassroomIntent.UNKNOWN)
    expect(a.command).toBeNull()

    const b = resolveIntent('继续讲')
    expect(b.intent).toBe(ClassroomIntent.UNKNOWN)
    expect(b.command).toBeNull()

    const c = resolveIntent('继续认识数字')
    expect(c.intent).toBe(ClassroomIntent.UNKNOWN)
    expect(c.command).toBeNull()
  })

  it('“继续下一个环节”→ 视为 NEXT_STEP（无内容动作宾语）', () => {
    expect(resolveIntent('继续下一个环节').intent).toBe(ClassroomIntent.NEXT_STEP)
  })
})

describe('RESET_STEP 语义（本地 Device/UI，只接受重置措辞）', () => {
  it('接受明确的“重置/重新开始本环节”措辞', () => {
    expect(resolveIntent('重置本环节').intent).toBe(ClassroomIntent.RESET_STEP)
    expect(resolveIntent('重新开始本环节').intent).toBe(ClassroomIntent.RESET_STEP)
    expect(resolveIntent('本环节从头来').intent).toBe(ClassroomIntent.RESET_STEP)
    expect(resolveIntent('重新开始当前环节').intent).toBe(ClassroomIntent.RESET_STEP)
  })

  it('“自动重新播放”类的措辞不得映射为 RESET（当前无真实 replay 能力，不得谎称已重播）', () => {
    for (const s of ['再来一次', '再播放一次', '再讲一遍', '重复本环节']) {
      expect(resolveIntent(s).intent, `"${s}" 不应解析为 RESET_STEP`).not.toBe(ClassroomIntent.RESET_STEP)
      expect(resolveIntent(s).command, `"${s}" 不应携带 command`).toBeNull()
    }
  })

  it('RESET_STEP 走 Executor case reset，交给 lessonRun.repeat()（本地行为，不写后端）', async () => {
    const reset = vi.fn()
    const exec = buildExecutor({ reset })
    await exec.execute({ intent: ClassroomIntent.RESET_STEP, raw: '重置本环节', normalized: '重置本环节', local: true, command: 'reset' })
    expect(reset).toHaveBeenCalledTimes(1)
  })
})

describe('AI fallback 输出契约与白名单', () => {
  it('next_step / previous_step 是唯一被允许转交 Executor 的 AI 权威命令', () => {
    const next = classifyAiIntent('next_step', '下一步')
    expect(next.allowed).toBe(true)
    if (next.allowed) expect(next.match.intent).toBe(ClassroomIntent.NEXT_STEP)

    const prev = classifyAiIntent('previous_step', '上一步')
    expect(prev.allowed).toBe(true)
    if (prev.allowed) expect(prev.match.intent).toBe(ClassroomIntent.PREVIOUS_STEP)
  })

  it.each(['play_resource', 'open_resources', 'volume_up', 'open_chat', 'start_activity', 'pause_media', 'resume_media'])(
    'AI 返回 %s 时判定 unsupported，不转交 Executor',
    (name) => {
      const verdict = classifyAiIntent(name, '任意表达')
      expect(verdict.allowed).toBe(false)
    },
  )

  it('unknown 也不转交 Executor', () => {
    expect(classifyAiIntent('unknown', 'x').allowed).toBe(false)
  })
})

// ─── Stage 6.2.2：/ai/command 显式 timeout + 安全失败 ───────────────────────
import {
  AI_COMMAND_FAILURE_HINT,
  AI_COMMAND_PENDING_HINT,
  AI_COMMAND_TIMEOUT_MS,
  isExecutableOutcome,
  runAiCommandFallback,
} from '@/classroom/command/classroomAiFallback'

/** 构造统计型假 Executor：记录 execute 调用次数与实参。 */
function countExecutor() {
  const args: import('@/classroom/command/ClassroomIntent').ClassroomIntentMatch[] = []
  const execute = vi.fn(async (m: import('@/classroom/command/ClassroomIntent').ClassroomIntentMatch) => {
    args.push(m)
    return { success: true, message: '已进入下一环节。', command: 'next' }
  })
  return { execute, args, obj: { execute } as unknown as import('@/classroom/command/ClassroomCommandExecutor').ClassroomCommandExecutor }
}

describe('Stage 6.2.2 /ai/command 显式 timeout + 安全失败', () => {
  it('仅 /ai/command 使用显式 timeout（5000ms），调用即传 config.timeout', async () => {
    expect(AI_COMMAND_TIMEOUT_MS).toBe(5000)
    const post = vi.fn(async () => ({ intent: 'next_step', reply: '' }))
    const { obj } = countExecutor()
    await runAiCommandFallback(1, '复杂表达', { text: '复杂表达' }, { post, isCurrent: () => true }, obj, AI_COMMAND_TIMEOUT_MS)
    // post 必须是 /ai/command，且只传 { timeout } 这一项覆盖，不设全局 timeout。
    expect(post).toHaveBeenCalledWith('/ai/command', expect.anything(), { timeout: 5000 })
  })

  it('A) 本地“下一步”→ local 命中且带 command，第一层直接短路，不走 /ai/command', () => {
    const m = resolveIntent('下一步')
    expect(m.local).toBe(true)
    expect(m.command).toBe('next')
    // runCommand 第一层在本地命中即 return，根本不进入第二层 fallback，因此无 /ai/command 调用。
  })

  it('B) fallback success：/ai/command 5s 内返回 next_step → Executor → lessonRun.next', async () => {
    const post = vi.fn(async () => ({ intent: 'next_step', reply: '' }))
    const { execute, args, obj } = countExecutor()
    const outcome = await runAiCommandFallback(1, '复杂表达', { text: '复杂表达' }, { post, isCurrent: () => true }, obj, AI_COMMAND_TIMEOUT_MS)
    expect(outcome.kind).toBe('executed')
    if (outcome.kind === 'executed') expect(outcome.intent).toBe('next_step')
    // Executor 只收被白名单批准的意图（next_step → NEXT_STEP），经 Executor 才落到 lessonRun.next。
    expect(execute).toHaveBeenCalledTimes(1)
    expect(args).toHaveLength(1)
    expect(args[0]!.intent).toBe(ClassroomIntent.NEXT_STEP)
    expect(args[0]!.command).toBe('next')
  })

  it('C) timeout：/ai/command 超时 → Executor 0 次、lessonRun 任意命令 0 次、未执行', async () => {
    // post 拒绝＝超时/网络失败统一入口；真实 5s 由 axios per-request timeout 触发，这里以 reject 等价模拟。
    const next = vi.fn(); const previous = vi.fn(); const pause = vi.fn(); const resume = vi.fn(); const reset = vi.fn()
    const exec = buildExecutor({ next, previous, pause, resume, reset })
    const realExecutor = { execute: vi.fn((m: import('@/classroom/command/ClassroomIntent').ClassroomIntentMatch) => exec.execute(m)) } as unknown as import('@/classroom/command/ClassroomCommandExecutor').ClassroomCommandExecutor
    const post = vi.fn(async () => { throw new Error('timeout') })
    const outcome = await runAiCommandFallback(1, '复杂表达', { text: '复杂表达' }, { post, isCurrent: () => true }, realExecutor, AI_COMMAND_TIMEOUT_MS)
    expect(outcome.kind).toBe('failed')
    if (outcome.kind === 'failed') expect(outcome.hint).toContain('未能识别该课堂指令，未执行。')
    expect(isExecutableOutcome(outcome)).toBe(false)
    expect((realExecutor as unknown as { execute: ReturnType<typeof vi.fn> }).execute).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled(); expect(previous).not.toHaveBeenCalled()
    expect(pause).not.toHaveBeenCalled(); expect(resume).not.toHaveBeenCalled(); expect(reset).not.toHaveBeenCalled()
  })

  it('D) 500 / network / 格式非法 → 同样安全失败、不执行', async () => {
    for (const errOf of [
      () => { throw new Error('network error') },
      () => { throw { response: { status: 500 } } },
      () => { throw { response: { status: 502 } } },
      () => { throw { response: { status: 503 } } },
    ]) {
      const post = vi.fn(async () => { errOf() })
      const { execute, obj } = countExecutor()
      const outcome = await runAiCommandFallback(1, 'x', { text: 'x' }, { post, isCurrent: () => true }, obj, AI_COMMAND_TIMEOUT_MS)
      expect(outcome.kind).toBe('failed')
      if (outcome.kind === 'failed') expect(outcome.hint).toBe(AI_COMMAND_FAILURE_HINT)
      expect(execute).not.toHaveBeenCalled()
    }
    // 返回格式非法（无 string intent）→ 归 unknown → 不执行
    const post = vi.fn(async () => ({ intent: 123, reply: {} }))
    const { execute, obj } = countExecutor()
    const outcome = await runAiCommandFallback(1, 'x', { text: 'x' }, { post, isCurrent: () => true }, obj, AI_COMMAND_TIMEOUT_MS)
    expect(outcome.kind).toBe('unsupported')
    expect(execute).not.toHaveBeenCalled()
  })

  it('E) unsupported intent（play_resource）→ 不执行、返回 unsupported 提示', async () => {
    const post = vi.fn(async () => ({ intent: 'play_resource', reply: '当前处于资源步骤。' }))
    const { execute, obj } = countExecutor()
    const outcome = await runAiCommandFallback(1, '播放资源', { text: '播放资源' }, { post, isCurrent: () => true }, obj, AI_COMMAND_TIMEOUT_MS)
    expect(outcome.kind).toBe('unsupported')
    if (outcome.kind === 'unsupported') expect(outcome.intent).toBe('play_resource')
    expect(execute).not.toHaveBeenCalled()
  })

  it('F) late response：已 timeout 后迟到的 next_step → isCurrent=false → 不得执行', async () => {
    // isCurrent 返回 false（runId 已失效：本请求超时期间用户又发起新指令）。
    const post = vi.fn(async () => ({ intent: 'next_step', reply: '' }))
    const { execute, obj } = countExecutor()
    const outcome = await runAiCommandFallback(42, '复杂表达', { text: '复杂表达' }, { post, isCurrent: () => false }, obj, AI_COMMAND_TIMEOUT_MS)
    // 迟到响应必须被丢弃：即便后端返回了可执行的 next_step，也绝不执行。
    expect(post).toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
    expect(outcome.kind).toBe('failed')
  })

  it('busy 由组件 finally 恢复：失败结果仍返回（不抛错），组件可走 finally 复位 loading', async () => {
    // 控制器对任何失败都 resolve 一个 failed outcome（而非 reject），保证组件 finally 一定能执行并复位 commandBusy。
    const post = vi.fn(async () => { throw new Error('timeout') })
    const { obj } = countExecutor()
    const outcome = await runAiCommandFallback(1, 'x', { text: 'x' }, { post, isCurrent: () => true }, obj, AI_COMMAND_TIMEOUT_MS)
    expect(outcome.kind).toBe('failed')
    expect(AI_COMMAND_PENDING_HINT).toBe('正在识别课堂指令…')
  })
})