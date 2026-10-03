# 任务9：幼儿启发式课堂助教与安全过滤

## 实现范围

本任务只实现运行课堂中的启发式问答草稿、安全过滤和教师确认播放流程，不实现语音课堂指令控制。

## 接口

所有接口均要求教师 JWT，并在服务端重新校验当前教师、班级和课堂权限。

### 生成启发式草稿

`POST /ai/heuristic-assistant`

```json
{
  "classroomRunId": 12,
  "childText": "我还是不知道",
  "activityGoal": "引导幼儿观察并认识数字1",
  "attemptCount": 1,
  "conversationContext": [
    { "role": "assistant", "content": "先看一看手指。" },
    { "role": "child", "content": "我看到了。" }
  ],
  "requestId": "heuristic-20260928-0001"
}
```

服务端从数据库补充班级年龄段、课堂状态、当前步骤、教案版本教学目标、当前审核通过资源和步骤动作摘要。客户端不能覆盖这些字段。相同教师和 `requestId` 幂等，不会重复调用模型。

### 查看草稿

`GET /ai/heuristic-assistant/:draftId`

只有生成草稿的当前课堂教师可以查看。

### 教师决策

`POST /ai/heuristic-assistant/:draftId/decision`

```json
{ "action": "edit", "editedResponseText": "先看一看伸出的手指，它有什么特点呀？" }
```

`action` 支持 `edit`、`confirm`、`discard`、`abort`。修改后的内容仍会经过适龄、安全、句数和问号校验。

### 教师确认后播放

`POST /ai/heuristic-assistant/:draftId/play`

仅 `confirmed` 草稿可调用现有 TTS；未确认、已放弃或已中止草稿不会播放。

## 五级启发策略

| attemptCount | hintLevel | 固定方向 |
| --- | --- | --- |
| 0 | 1 | 观察提示 |
| 1 | 2 | 比较提示 |
| 2 | 3 | 具体线索/操作任务 |
| 3 | 4 | 二选一 |
| 4及以上 | 5 | 解释答案并邀请验证 |

输出最多三句话、最多一个主要问题；第一至四级会拦截直接公布答案的模型输出。批评、羞辱、能力标签和儿童之间的比较会被替换或降级为安全本地提示。

## 安全和隐私

- 姓名、电话、地址、家庭信息、照片索取会进入 `safety_redirect`。
- 成人内容、危险动作、诊断、负面标签、绕过教师控制和提示词注入会进入 `safety_redirect`。
- 高风险回复只引导幼儿寻找现场老师，不继续普通问答。
- 传给模型的必要上下文在内存中脱敏。
- 数据库不保存 `childText` 或 `conversationContext` 原文，只保存长度、轮次和不可逆 SHA-256 摘要等最小元数据。
- AI 日志不保存儿童原话、完整对话或密钥。
- 推荐资源只允许当前课堂步骤正在使用且教师有权访问的 `approved` 资源。
- AI 永远不直接播放资源或执行课堂动作。

## 数据库变更

迁移：`202609270011-HeuristicAssistantDrafts.ts`

新增 `heuristic_assistant_draft`，记录课堂、教师、幂等请求、提示层级、过滤后的 AI 草稿、教师编辑/确认状态、TTS 播放时间和最小模型调用指标。`teacher_id + request_id` 唯一；课堂、教师和推荐资源均有外键约束。

## 降级行为

模型超时、限流、网络错误、非法 JSON、缺字段和危险模型输出均返回对应提示层级的本地安全草稿，课堂运行状态不受影响。课堂在模型调用期间发生步骤或状态变化时，原输出不会继续作为当前草稿使用。
