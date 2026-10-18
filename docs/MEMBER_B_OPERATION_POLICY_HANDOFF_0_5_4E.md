# 成员 B 接口交接：0.5-4E

本文件是后端契约交接，不代表前端已适配或浏览器验收通过。不修改前端、DeviceSession、Online Policy、课堂生命周期。

## 1. 首次业务结果与当前课堂状态

CommandBus 在业务已提交、最终响应保存失败时，重试有严格 canonical 回执才返回恢复结果：

```json
{
  "status": "success",
  "result": { "committedRunVersion": 12 },
  "classroomState": null,
  "currentClassroomState": { "version": 15 },
  "recovery": {
    "source": "canonical_business_receipt",
    "contractVersion": 1,
    "committedRunVersion": 12,
    "refreshRequired": true
  }
}
```

示意只列关键字段，result 的具体结构按奖励/考勤/点名契约。refreshRequired 位于 recovery，不是顶层。触发条件是已有非 Success 命令记录、权限/hash/digest 均合法，且存在严格持久业务回执；无回执不得猜测成功。重试不重新发奖/考勤/随机，不改变首次回执，不新增事实/Event/Snapshot。

收到 recovery.refreshRequired=true：把 result 作为首次执行结果展示一次；不要把 committedRunVersion 或 currentClassroomState 当成完整可恢复大屏状态，不回填旧播放/环节。教师端读取 `GET /classroom-runs/:id/restore?deviceId=...`；学生端继续读取 `GET /classroom-runs/screen-state?deviceId=...&handoffId=...` 或同一 SSE 投影，按 phase/page 更新。restore 提供 currentStep、playerRecoverySuggestion、各投影、timing、allowedActions；普通 get/响应中简化 state 不替代完整 restore。

普通已保存 Success 也可能直接返回首次缓存的 classroomState；没有 refreshRequired 不代表它是当前版本。客户端维持当前最高已知 Run version，旧响应不能倒灌新状态；命令后/冲突后刷新或接受更新的权威状态流。不要自动重播缓存 result 的动画/TTS/奖励效果，UI 去重按业务 requestId/record identity。跨 Run 的版本不可比较为同一时间线。

## 2. 播放器反馈身份（必须在事件产生时冻结）

公开 HTTP checkpoint 的 playerState 是 observation envelope：

```json
{
  "requestId": "feedback-unique-id",
  "deviceId": 7,
  "version": 15,
  "checkpointType": "timed",
  "playerState": {
    "presentationCommandId": "command-for-this-player-instance",
    "presentationRevision": 15,
    "currentTime": 8.5,
    "status": "paused"
  }
}
```

checkpointType 使用现有 DTO 的真实枚举值（见 classroom-run.types.ts，进度用 timed）。presentationRevision 必须来自服务端 playerRecoverySuggestion，不用当前时间、Run 最新 version 或 resourceId 自己生成。Run version 与 presentationRevision 是不同并发标识：反馈本身可以改变 Run version，但不代表新展示。

权威控制状态由 checkpointControl/captureRequired 分配 presentationCommandId + presentationRevision。新展示命令成功后从权威课堂状态取此身份，不只信任命令 result 内发送前构造的 playerState。旧 Snapshot 缺少身份时不猜测，不自动播放；先请求完整状态/由教师重新明确展示。

```ts
// 示意：绑定给特定播放器实例，不是执行到发送时才读取 store 的当前身份。
const origin = Object.freeze({
  presentationCommandId: state.presentationCommandId,
  presentationRevision: state.presentationRevision,
});
player.onProgress = time => enqueueFeedback({ ...origin, currentTime: time });
```

队列、节流、加载完成、error、ended、组件卸载前回调都保留 origin。切资源时注销旧监听/取消旧任务；不能发送前把 A 的旧回调重新标记成 B 的当前身份，哪怕 resourceId 相同。

服务端仅匹配 commandId 和 revision 的反馈才能合并白名单：合法时间/页码、completed、有限 status、结构化 errorCode；不接受任意异常文本/URL。陈旧或缺身份反馈可能以兼容成功返回但观测值不合并，不承诺全部 409。HTTP checkpointType=command、rewardState、interactionState 等不授予控制权限；不要把这些对象作为前端写事实 API。

## 3. allowedActions 消费

- 有活动 Run：`restore.allowedActions` / `screenState.classroomState.allowedActions`。
- IDLE/READY/SUMMARY：`screenState.allowedActions` 顶层；不要只读顶层而丢失活动课堂能力。
- 能力缺失/状态断流：保持安全 UI、重新请求权威状态，不默认全部允许。
- 这是阶段级能力提示，不是授权令牌；服务端还检查 owner、设备/绑定、资源审核、学生资格、目标记录、版本和事务内 phase。
- 操作映射：步骤→change_step，资源启动/恢复/展示→resource_start，翻页/缩放/音量→media_control，停止/暂停媒体/静音→safe_stop，播报→tts，新奖励→reward，点名→roll_call，初次/混合考勤→attendance_new，全部已有考勤纠正→attendance_correction，个人撤销→reward_revoke，集体撤销→collective_reward_revoke，队列编辑→queue_edit。
- READY 不是假 Run；OPENING 的 Run 已 running 但禁止正式教学启动。PAUSED 优先 opening。开场完成/跳过不推进步骤。break 不等于 paused。
- SUMMARY 只靠合法 handoff 投影；不能根据最近 completed 课恢复画面。同标签刷新保留 handoff；新页面无关联进入 IDLE。
- 旧 prepared 与 READY 不同；旧 BreakRun 与核心 break 不等价。recovery/prepared 特殊纠正尚未统一，不新增通用按钮推断支持。

## 4. 拒绝码、幂等与刷新

|响应|前端行为|
|---|---|
|409 CLASSROOM_OPERATION_FORBIDDEN + phase/operation|停止自动执行，刷新完整状态，更新可操作入口；不能无限换 requestId 重试|
|409 LEGACY_SEMANTICS_UNSUPPORTED + operation|明确告知旧语义不支持，不能截断字段、折算成长值或改用 Snapshot 模拟成功|
|409 BUSINESS_PROJECTION_OWNERSHIP|内部控制误写业务投影，修复调用映射，不能绕过；公开 checkpoint 不具业务写权限|
|其他 409|可能为 CAS、requestId/payload 冲突、Processing、数据资格或生命周期校验；并非都有结构化 code。不要只按一句文案判断可重试|
|401/403|重新认证/提示无权限，不能通过生成新 ID 获取他人回执|
|400|参数/内容错误，按具体响应修正，不盲重试|
|410 preparation gone|重新准备，不伪造 READY 或继续使用旧 preparation revision|

CommandBus 409 常附 latestClassroomState，可能只是简化/当时状态，不包含完整 allowedActions 或资源恢复信息；仍以完整刷新结果为准。普通领域错误并不保证带该字段。

同一业务网络失败/响应丢失，保留原 requestId 和业务 payload 重试。改变学生、奖励参数、撤销原因、点名范围等属于新业务，不能沿用原 ID；相同 ID 不同 digest 必须冲突。不要把 Processing 误认为成功。只有获得严格成功回执后才能显示确认成功；终态成功重放与终态新请求是两件事。

手机包装的结果位于 result；其外层 session/online/TTL 门槛可能先拒绝，终态已失效会话不能承诺等价于 canonical 直接只读重放。此边界待合并时联调确认，不要求成员 B 绕过鉴权。

## 5. 合并后验收清单（本批未执行）

- 校验 READY/OPENING/PAUSED/SUMMARY 的按钮与状态来源；教师预览只读，不建立第二套课堂状态机。
- 延迟 A 的加载/错误/进度回调，切到相同资源的 B；确认发送仍携带 A 身份，不能污染 B。
- 模拟普通 Success 缓存和 post-commit recovery；历史结果不覆盖当前课堂，不重复动画/语音/发奖。
- 验证恢复后明确点击才播放；phase 变化期间 pending 操作正确刷新并提示。
- 三领域 legacy 不支持语义稳定拒绝；历史读取保留 source + recordType + recordId，不能按数字 ID 合并。

后端自动化通过不等于上述浏览器项已完成。不得把延期验收标记为已封版正式环境。
