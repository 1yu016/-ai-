/**
 * 设备媒体命令的结构化意图定义（Stage 6.4）。
 *
 * 与 ClassroomIntent 同源思想：任何口令在进入处理流水线前必须被解析为
 * 一个明确的 DeviceIntent，禁止把裸字符串散落在 Vue/store。
 *
 * 边界：本组意图只作用于「当前设备上的资源播放器」（ResourcePlayer），
 * 纯前端、不写 ClassroomRun 后端。课堂状态命令（PAUSE_CLASS 等）留在
 * ClassroomIntent 层，二者基于「明确媒体语义」区分，绝不混淆。
 *
 * 空值 NO_MATCH 用 null 表达（router 返回 DeviceIntentMatch | null），
 * 因此这里只定义受支持的真实媒体意图。
 */
export const DeviceIntent = {
  PAUSE_MEDIA: 'PAUSE_MEDIA',
  RESUME_MEDIA: 'RESUME_MEDIA',
  STOP_MEDIA: 'STOP_MEDIA',
  CLOSE_RESOURCE: 'CLOSE_RESOURCE',
  VOLUME_UP: 'VOLUME_UP',
  VOLUME_DOWN: 'VOLUME_DOWN',
} as const

export type DeviceIntent = (typeof DeviceIntent)[keyof typeof DeviceIntent]

/** 结构化解析结果：intent 必为上述 6 个真实媒体意图之一，无 NO_MATCH。 */
export interface DeviceIntentMatch {
  intent: DeviceIntent
  /** 原始输入 */
  raw: string
  /** 规范化后的输入 */
  normalized: string
  /** 命中的模板文本，便于可观测性 */
  matchedPattern?: string
}