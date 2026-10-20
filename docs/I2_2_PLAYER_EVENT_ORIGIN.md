# I-2-2 播放器事件来源身份与迟到反馈修复

## Scope / Baseline

- 工作目录：`D:\trae_project\new1\integration-I1`。
- 分支：`integration/i1-ab`；HEAD：`368cf69844776e06ffba2a13973141e9dfb266f0`，未创建提交。
- 保留本批前已存在的 I-2-1 未提交实现、测试和报告。`lessonRun.ts` 为两批共用文件，不能将当前 Git 总差异误记为本批新增。
- 不修改后端、schema、allowedActions、语音政策、移动端 TTL、作品成功文案及 A2 cockpit。

## Root Cause

1. 原 `lessonRun.savePlayerState` 将当前 `run.playerRecoverySuggestion` 合并到反馈中。旧事件没有身份时，也可能带上当前展示的 command/revision。
2. `ClassroomScreenView.queueSnapshot` 在 1800ms 定时器执行时读取当前播放器数据，而不是保存排队时的样本及来源。
3. ResourcePlayer 原生事件直接更新共享 Store；`media.play()` 返回后也直接更新状态，没有核对播放世代。仅比较资源 ID 或 URL，不能区分同资源的两次展示。
4. 资源加载已有 `mediaLoadSeq` 保护，但原加载 watcher 不包含展示世代，同资源重新展示不会可靠地产生新媒体事件边界。

修复前证据来自本批源码审查，不声称曾对未修改版本执行新增测试并观察失败。

## Event Origin Contract

- `PresentationOrigin`：只读、冻结副本，包含 `runId / deviceId / presentationCommandId / presentationRevision`。身份来自已加载的权威展示控制，不由资源 ID 推断。
- 每次 `openResource` 都递增本地 `playbackSession`，包括同一个资源再次打开；本地世代不是新的课堂状态机或服务端 revision。
- DOM 媒体元素以世代和加载地址作为 key，事件核对其自身元素上的世代和地址。旧元素不会被改写为新展示的身份。
- `play()` 的 Promise 捕获调用时的世代和媒体元素；旧完成/失败不能更新后来展示的状态。加载 Promise 继续复用原有 loadSeq，并在展示切换时同步失效。
- 延时上报先冻结样本、复制来源上下文，再排队；切换/卸载后丢弃。发送层不合并当前 control JSON，只发送 observation 白名单和原始 command/revision。
- 缺少可靠身份：本地预览可以继续，反馈不发送，不从当前 Run 补齐身份；历史缺失身份不自动播放。
- Run/device 不一致或 command/revision 已更换：前端跳过旧反馈；发送后发生竞争时，继续由冻结后端 `mergePresentationObservation` 检查。
- checkpoint 返回采用 Run/device、版本及 `stateEpoch` 防迟到覆盖；HTTP 成功本身不是 observation 已被采信的证明。只有返回 observation 身份匹配时，方法才返回该匹配结果，否则返回 null。
- `checkpointType=command` 是现有 URL 的普通请求类型，不是内部控制权限。后端未改。
- 不增加设备 ACK，不设置 delivery=confirmed。浏览器报告开始/结束/失败不等于物理屏幕确认；设备在线、命令提交均不能证明真实播放成功。

## Feedback Sources / Async Boundaries

| 来源 | 异步边界 | 本批处理 |
| --- | --- | --- |
| audio/video play、pause、ended、error、timeupdate、loadedmetadata | 浏览器事件队列 | keyed 元素、来源世代和媒体地址校验 |
| img load/error、iframe load | 浏览器加载事件 | 同样检查事件所属元素，不采信旧展示事件 |
| media.play() | Promise resolve/reject | 捕获媒体元素和世代，成功/失败均检查 |
| 受保护资源 blob、PPT manifest、绘本页面 | 网络 Promise / nextTick | 保留 loadSeq 与 blob 清理，增加展示切换同步失效和 await 后世代检查 |
| Screen 播放器状态 watch | 1800ms 定时器 | 固定样本和来源；发送前世代检查；旧请求错误也不能触发新展示刷新 |
| 开始课间前保存进度 | await checkpoint | 使用播放器已有 origin；无身份时跳过反馈，不伪造身份 |
| 大屏恢复 / 相同资源新展示 | ensureResourceById Promise | 保留 A 的 displayGeneration，command+revision 变化建立新播放世代 |
| 关闭 / 卸载 | fullscreen Promise、nextTick、事件尾部回调 | 关闭后检查世代，卸载标记 disposed、停止旧媒体并保留 blob 释放 |
| CommandRuntime | 命令执行 Promise | 只编排命令，不直接发送 observation；本批只读检查、不修改 |

全仓搜索 player feedback 的真实网络入口为 `lessonRun.savePlayerState`，实际调用者为大屏延时上报和课间前进度保存。没有独立的播放器超时上报入口；网络失败走现有异常路径。作品计时器、设备心跳和数字人渲染不是本批新增的播放器反馈事实，不把它们改造成 ACK。旧 `classroomCheckpoint.ts` 是奖励/考勤兼容路径，不是播放器反馈，本批未改动。

## Changed

1. `frontend/src/stores/resourcePlayer.ts`：来源类型、权威控制身份解析、每次打开/关闭的播放世代及来源失效。
2. `frontend/src/components/ResourcePlayer.vue`：事件来源检查、同资源媒体节点替换、Promise/卸载/关闭保护、保留资源释放和暂停行为。
3. `frontend/src/stores/lessonRun.ts`：显式来源参数、observation 白名单、响应竞争保护；课间与资源打开接入 origin。保留 I-2-1 恢复信封、首次 result、刷新失败与轮询世代逻辑。
4. `frontend/src/views/ClassroomScreenView.vue`：恢复 key 包含 revision，同资源不同身份重新打开，延时样本和来源固定；保留生命周期、handoff、作品错误和 displayGeneration。
5. `frontend/tests/unit/player-feedback-origin.spec.ts`：新增反馈契约测试。
6. `frontend/tests/unit/resource-player-media.spec.ts`：新增同资源旧 DOM 事件、迟到 play Promise 完成/失败/卸载测试。
7. `frontend/tests/component/ClassroomScreenView.spec.ts`：新增延时反馈/切换/卸载测试；原迟到 checkpoint 测试补真实来源字段，保留原断言。
8. 本报告。

## Before / After Evidence

- 同资源 A→B：修复前可能复用元素并在发送时补上 B 身份；修复后 A 元素仍属于 A 世代，迟到 play/ended/error/timeupdate/metadata 均不改变 B。测试还确认 B 的正常 play 仍可工作。
- A 的 play Promise 在 B 失败后才 resolve/reject：不能将 B 的错误状态覆盖为 playing/paused；卸载后的回调同样被忽略。
- A 的上报定时器跨 B：排队时即冻结 A 样本；不会发送 `B + A的99秒`。卸载后不再发送。
- 无身份：返回 null，不发送网络请求；不会补成当前展示。
- 服务端返回 HTTP 200 但当前为 B、没有匹配 A 的 observation：不报告 A 已被采信；采用可用的权威 B 状态，而非将 A 的 playing 解释成 B 播放成功。
- 迟到 checkpoint 响应：即使返回版本数更大，也不能越过已变化的本地 epoch 去覆盖新展示。

## Tests — 本轮实际执行

日志目录：`D:\trae_project\new1\integration-I1-evidence`，非正式运行环境证据。

| 执行 | 结果 | 证据 |
| --- | --- | --- |
| 专项四文件：origin、media、screen、I-2-1 recovery | 52 通过，0 失败，0 跳过 | i2-2-targeted-approved.log |
| 扩展六文件，加 resource-command、interaction-fullscreen | 96 通过，0 失败，0 跳过 | i2-2-targeted-expanded.log |
| 最终完整前端 unit/component | 88 文件、679 通过，0 失败，0 跳过 | i2-2-full-frontend-final-2.log |
| 后端冻结 presentation-ownership 用例 | 1 文件、5 通过，0 失败，0 跳过 | i2-2-backend-ownership.log |
| vue-tsc --build | 退出码 0 | i2-2-typecheck-delivery.log |
| vite build | 退出码 0 | i2-2-build-delivery.log |
| eslint .（不带 --fix） | 退出码 0，无诊断 | 本轮执行回执；空输出未生成日志 |
| git diff --check | 退出码 0 | 本轮执行回执 |

实际命令：

```text
frontend: npm test -- --pool=vmThreads --maxWorkers=1 [专项文件...]
frontend: npm test -- --pool=vmThreads --maxWorkers=1
backend: npm test -- --runInBand presentation-ownership.spec.ts
frontend: npm run type-check
frontend: npm run build-only
frontend: node node_modules/eslint/bin/eslint.js .
```

保留中间失败，不将其抹去：

- `i2-2-targeted.log`：沙箱 spawn EPERM，测试尚未启动；批准子进程后专项通过。
- `i2-2-typecheck.log`：新增测试 helper 的字面量类型过窄，修正测试类型注解为 PresentationOrigin，非后端契约变更。
- `i2-2-full-frontend-final.log`：678 通过、1 失败（合法图片 error 被额外空地址过滤挡住）。删除本批多余的空地址过滤，保留世代/地址/身份守卫及原断言；最终 679 全部通过。未删除或跳过失败断言。
- jsdom 的 canvas getContext 提示和构建 chunk-size 警告仍存在，不将其当成真实数字人/物理屏幕验证。

## Isolation / Remaining Risks

- 原 A 与 I0 校验：1320 个受保护路径（原目录及恢复目录均校验）、1331 个备份产物，SHA-256 差异 0；原 HEAD/index/status 不变。见外部证据 `original-after.json`。
- 不修改后端契约、数据库或迁移；不连接正式数据库、不启动正式服务、不做正式浏览器验收；未 commit/push/merge。
- 本轮未执行完整后端 E2E，也未新增隔离 HTTP 用例；复跑冻结后端纯身份校验，前端网络响应采用真实 DTO 形状的测试替身。不能将这些测试宣称为端到端真实设备成功。
- 实际浏览器的解码器、自动播放限制、网络乱序及物理显示仍待隔离联调。没有独立设备接收 ACK，delivery 仍应为 unknown。
- 频繁进度事件的现有去抖策略和被 busy 跳过的样本不保证每一帧上传；本批只保证来源不串线，不增加可靠投递队列。
- allowedActions、语音阶段控制、作品成功文案和移动端 TTL 等既有问题未处理。

## Next Batch

仅建议 I-2-3：前端 allowedActions 消费与后端 Operation Policy 对齐，明确提示与服务端执行校验的边界。本批完成即停止，不自动实施。

## 核心验收回答

同一资源连续展示两次时，第一次的迟到播放反馈不会归属第二次。第一次仍属于第一次的 command/revision 与本地播放世代；前端会丢弃已过期回调或跳过上报，已经在途的旧反馈仍携带原身份并由后端匹配规则处理，绝不改标成第二次。
