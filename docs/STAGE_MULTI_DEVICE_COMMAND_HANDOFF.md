# Stage 多端 设备指令 / 大屏投递 —— 后端跨端 command channel 交接单

> 背景：成员 B 已调查现有远程控制与多端同步链路，确认一个边界缺口：
> 课堂运行**状态**（pause/resume/next/step/break/checkpoint/reward）通过
> `/classroom-runs/*` 状态机 + 各端 2s polling 真实多端同步（LessonClassroomView + ClassroomOperationsView 共用 lessonRun store）。
>
> 但 **资源播放 / TTS / 大屏投递** 没有跨设备的命令广播通道：当前资源播放与 TTS 只在
> "发起操作的这台设备上"本地执行（`new Audio(url)` + 本机 ResourcePlayer）。
> 成员 B 不伪造跨端投递。

---

## 一、现状（已确认支持的控制）

- `pause / resume / next / previous / steps/:index / complete / cancel`：真实 `POST /classroom-runs/:id/*`，全端同步。
- `break / break/end`：真实 `POST /classroom-runs/:id/break`，多端同步课间状态。
- `checkpoints`（考勤）、`rewards`（奖励）：真实写后端，同步到各端 restore。
- 多端同步 = 各端 `lessonRun.startPolling()`（2s GET run）+ serverNow 时钟校准。

## 二、缺的能力（需后端/多端负责人）

1. **跨端资源播放投递**：教师手机发起 / 或大屏作为播放器 —— 需要一个命令通道把 "open/play resource ABC" 投给指定大屏端执行，而非仅本机 ResourcePlayer。
2. **跨端 TTS 播报**：教师确认的评价/回答，要在独立大屏端发音 —— 需要一个共享 TTS 指令（目标设备 id + 要朗读的正式文本）。
3. 以上都需要：
   - 明确 target device（绑定大屏设备 id）
   - 指令排队 + 送达确认 + 幂等 requestId
   - 失败重试与过期丢弃

## 三、第一版建议契约（供后端评估，成员 B 不实现）

`POST /devices/:deviceId/commands`（或沿用 classroom-runs 的设备的命令轮询）

```
{ "requestId": "...", "command": "play_resource"|"speak_tts", "payload": {...}, "ttlSeconds": 60 }
```

需保证：

- 目标设备在线才可投递（已有 `/devices` + lastOnlineAt，可参考）
- 幂等 + 送达成功反馈
- **只投递教师已确认/正式状态的内容**（评价/AI 回答未确认绝不投给大屏播放）

## 四、成员 B 前端边界

- 已把"播放资源 / 随机点名 / 课间"的歧义快捷按钮从 RemoteControlPanel 移除，避免误认可投大屏。
- 这些入口现在明确引导到：文本/语音课堂指令（本机 intent 路由）或考勤奖励页的专属真实功能。
- 未造假的本地素材：资源播放与 TTS 仅限发起设备本地执行并如实反馈。

## 五、阻塞状态

跨端投递为 `BLOCKED_BACKEND / MULTI_DEVICE`。前端侧本机可用控制（pause/resume/next/step/break/checkpoint/reward）已真实可用。