import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  isStopListeningPhrase,
  matchWakePhrase,
  normalizeSpeechText,
  stripWakePhrase,
  LocalWakeSpeech,
} from '@/services/localWakeSpeech'

describe('本地唤醒词匹配', () => {
  it('标准唤醒词命中，允许标点与空格差异', () => {
    expect(matchWakePhrase('你好，小助手。')).toBeTruthy()
    expect(matchWakePhrase('你好 小 助手')).toBeTruthy()
    expect(matchWakePhrase('您好小助手')).toBeTruthy()
  })

  it('ASR 少一个字仍可唤醒，但普通谈话不会误唤醒', () => {
    expect(matchWakePhrase('你好小助')).toBeTruthy()
    expect(matchWakePhrase('小助手')).toBeNull()
    expect(matchWakePhrase('今天小朋友们都很棒')).toBeNull()
    expect(matchWakePhrase('你好老师')).toBeNull()
    expect(matchWakePhrase('')).toBeNull()
  })

  it('唤醒词可从口令中剥离，避免把唤醒词当成业务指令', () => {
    expect(stripWakePhrase('你好小助手随机点一位小朋友')).toBe('随机点一位小朋友')
    expect(stripWakePhrase('你好，小助手，暂停播放')).toBe('暂停播放')
    expect(stripWakePhrase('你好小助手')).toBe('')
    expect(stripWakePhrase('给小明一朵小红花')).toBe('给小明一朵小红花')
  })

  it('结束监听口令只用于退出指令窗口', () => {
    expect(isStopListeningPhrase('停止听指令')).toBe(true)
    expect(isStopListeningPhrase('结束听指令。')).toBe(true)
    expect(isStopListeningPhrase('暂停课堂')).toBe(false)
  })

  it('归一化保留中文字符并去标点', () => {
    expect(normalizeSpeechText('你好，小助手！')).toBe('你好小助手')
    expect(normalizeSpeechText('ＡＢＣ１２３')).toBe('abc123')
  })
})
describe('bounded continuous listening window (no hardware)',()=>{
  it('joins final child-ASR segments across pauses and submits once after a quiet gap',async()=>{
    vi.useFakeTimers()
    const publicText=vi.fn()
    const engine=new LocalWakeSpeech({publicTranscription:true,maxUtteranceMs:30000,onPublicUtterance:publicText})
    const internal=engine as unknown as {mode:string;handleResult(value:unknown):void}
    internal.mode='waiting'
    internal.handleResult({result:{text:'种子为什么'}})
    vi.advanceTimersByTime(4000)
    internal.handleResult({result:{text:'会发芽'}})
    vi.advanceTimersByTime(4999)
    expect(publicText).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    await Promise.resolve()
    expect(publicText).toHaveBeenCalledOnce()
    expect(publicText).toHaveBeenCalledWith('种子为什么会发芽')
  })
  it('public transcription never wakes or buffers command audio, and ignores speech after stop',async()=>{
    vi.useFakeTimers()
    const command=vi.fn(),wake=vi.fn(),publicText=vi.fn()
    const engine=new LocalWakeSpeech({publicTranscription:true,onUtterance:command,onWake:wake,onPublicUtterance:publicText})
    const internal=engine as unknown as {mode:string;handleResult(value:unknown):void;handlePartial(value:unknown):void;collectFrame(input:AudioBuffer):void}
    internal.mode='waiting'
    internal.collectFrame({} as AudioBuffer)
    internal.handlePartial({result:{partial:'你好小助手，给她一颗星星'}})
    internal.handleResult({result:{text:'你好小助手，结束课堂'}})
    await vi.advanceTimersByTimeAsync(5000)
    await engine.stop()
    internal.handleResult({result:{text:'种子需要什么'}})
    expect(publicText).toHaveBeenCalledOnce();expect(command).not.toHaveBeenCalled();expect(wake).not.toHaveBeenCalled()
  })
  afterEach(()=>vi.useRealTimers())
  it('activity renews 20 seconds but cannot extend beyond 60 seconds',()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-23T00:00:00Z'))
    const end=vi.fn()
    const wake=new LocalWakeSpeech({onCommandWindowEnd:end})
    const internal=wake as unknown as {handleWake():void;extendCommandWindow():void}
    internal.handleWake();expect(wake.state).toBe('awake')
    for(let i=0;i<5;i++){vi.advanceTimersByTime(10000);internal.extendCommandWindow()}
    vi.advanceTimersByTime(10001)
    expect(wake.state).toBe('waiting');expect(end).toHaveBeenCalledOnce()
  })
  it('explicit cancellation exits command mode, not classroom',()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-23T00:00:00Z'))
    const wake=new LocalWakeSpeech()
    const internal=wake as unknown as {handleWake():void;handleResult(m:unknown):void}
    internal.handleWake();internal.handleResult({result:{text:'停止听我说话'}})
    expect(wake.state).toBe('waiting')
    expect(isStopListeningPhrase('取消')).toBe(true)
    expect(isStopListeningPhrase('结束课堂')).toBe(false)
  })
})
