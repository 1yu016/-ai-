import { routeTeacherVoiceCommand } from '@/classroom/command/TeacherVoiceCommandRouter'

export type ListeningRoute = { kind: 'question' | 'teacher_intent' | 'unclear' | 'handoff'; text: string; message: string }
/** Conservative routing only. Never imports an executor, API client or AI fallback. */
export function classifyPublicSpeech(raw: string): ListeningRoute {
  const text = raw.trim().slice(0, 300)
  if (/电话|手机号|住址|家庭地址|脱衣|伤害|自杀|打死|我是老师|我是管理员/.test(text)) return { kind: 'handoff', text: '', message: '请老师接手处理。' }
  if (routeTeacherVoiceCommand(text) || /奖励|加分|送.{0,4}花|考勤|签到|点名|翻页|下一页|上一页|下一步|暂停课堂|结束课堂|下课/.test(text)) return { kind: 'teacher_intent', text, message: '这是可能的课堂操作，请老师在控制台确认；本次没有执行。' }
  if (text.length >= 3 && /[?？]|为什么|怎么|什么|哪里|谁|多少|能不能|可以.{0,12}吗|是不是|讲.{0,8}故事|再讲|接着讲|再举.{0,4}例子|还有呢|然后呢|我发现|我觉得|鼓励|why|what|how|where/i.test(text)) return { kind: 'question', text, message: '收到问题了。' }
  return { kind: 'unclear', text: '', message: '没有听清，请换个说法或请老师帮忙。' }
}

export type LocalRecognition = {
  processLocally: boolean; lang: string; continuous: boolean; interimResults: boolean
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  onstart?: (() => void) | null
  start: () => void; abort: () => void
}
export type LocalRecognitionConstructor = { new(): LocalRecognition; available?: (options: { langs: string[]; processLocally: boolean }) => Promise<string> }
export function localRecognitionConstructor(): LocalRecognitionConstructor | undefined {
  // No prefixed/cloud-only fallback. Capability detection must fail closed.
  return (window as unknown as { SpeechRecognition?: LocalRecognitionConstructor }).SpeechRecognition
}

export async function createLocalRecognition(ctor = localRecognitionConstructor()): Promise<LocalRecognition> {
  if (!ctor?.available || !('processLocally' in ctor.prototype)) throw new Error('当前浏览器无法确认本地识别能力，请使用手动输入；没有开启云端识别。')
  if (await ctor.available({ langs: ['zh-CN'], processLocally: true }) !== 'available') throw new Error('本地中文语言包未就绪，请使用手动输入；不会自动下载或上传录音。')
  const recognition = new ctor()
  recognition.processLocally = true
  recognition.lang = 'zh-CN'; recognition.continuous = true; recognition.interimResults = false
  return recognition
}

export async function createBrowserLocalRecognition(): Promise<LocalRecognition> {
  // Experimental native implementations can crash their renderer during availability checks.
  // Enable only for a deployment/browser that has separately passed local capability acceptance.
  if (import.meta.env.VITE_CLASSROOM_LOCAL_LISTENING !== 'true') throw new Error('本环境尚未启用经验证的本地识别，请使用手动输入；麦克风未开启。')
  return createLocalRecognition()
}
