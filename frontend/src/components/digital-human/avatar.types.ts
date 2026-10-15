// 数字人统一业务状态：本项目自己的状态定义。
// 该状态是「课堂业务语义层」，与任何第三方（Agent Robot Avatar / xAI GrokBot）实现解耦。
// 业务代码只允许消费 DigitalHumanState，不得直接把第三方的 success/waiting/inspect/send 等散落到业务层。
export type DigitalHumanState =
  | 'idle'
  | 'greeting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'happy'
  | 'encouraging'
  | 'surprised'
  | 'celebrating'
  | 'error'
