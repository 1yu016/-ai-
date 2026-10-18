# 0.5-4C 旧课间事务收口

## 调用链与兼容差异

- 旧 HTTP：`POST classroom-runs/:id/breaks/start`、`POST break-runs/:id/{pause,resume,end}` → ClassroomEngagementService → BreakRun。
- 当前前端/手机/语音路由：lessonRun store → CommandBus → ClassroomRunService.startBreak/endBreak。核心 HTTP 开始 URL 是 `POST classroom-runs/:id/break`。
- 旧后端 AI BreakMode/ReturnToClass 是 Run pause/resume，并非旧 BreakRun；本批不扩大它的能力。
- 旧课间将 Run 暂停、保存原 step/status，结束恢复原状态；核心课间保持 Run running，通过 break* 字段控制。旧课间有独立暂停计时，配置、时长范围和返回对象也不同，不能直接替换。

## 修改

只改 engagement service 与原有 legacy E2E 测试，增加本说明；保留既有未提交修改。

旧 start/end/pause/resume 共用 Snapshot transactionRequired 队列，同一 EntityManager 执行授权复核、版本/活动状态检查、CAS、BreakRun、Event 和 captureRequired。start 从事务外两次快照改为事务内一次。pause/resume 保留不增加 Run version 的旧协议，但加入同一队列、Break CAS、审计及恢复快照，避免结束后旧 save 复活课间。

保留 URL、BreakRun 返回形状、原暂停状态恢复、已结束课间只读返回。异常遗留的终态 Run + 活动 BreakRun 仍可结束该 BreakRun，但绝不恢复终态 Run；正常课堂结束已由核心事务将活动 BreakRun 标为 auto_terminated。

## 事务与幂等

- 同一事务：Run CAS（开始/结束）+ BreakRun CAS + Event + required Snapshot。任何后置失败全部回滚。
- 已在事务内只调用 captureRequired(manager)，不重新进入 Snapshot 队列。不等待网络/AI/TTS/大屏 ACK。
- 新 Event 使用独立 `legacy_break_control / contractVersion=1`，不冒充三领域 canonical business receipt。
- actor/requestId + operation + 规范化业务参数 SHA256；版本号作为首次执行并发条件，不参与业务 digest。相同请求只读返回当前 BreakRun；冲突 payload 拒绝。已提交 Event 不改写。
- 历史 BreakRun 缺少 Event 时仅保留原 start requestId 只读查重，不补写历史回执，不声称能校验旧请求完整 payload。
- 新旧课间互斥：旧 start 检查 Run.break* 和活动 BreakRun；核心保留原状态/活动课间检查。不会双建同一有效课间。

## 验证

新增定向测试包含：start/end 的 Event 实际 insert 后抛错、required Snapshot 实际保存后抛错、Run CAS 冲突；比较 Run/BreakRun/Event/Snapshot 全表前后内容一致；同请求失败后重试、成功重放、不同 payload 冲突、并发结束只产生一次 Event/Snapshot、新旧入口互斥、原已暂停课堂恢复仍暂停。故障测试使用独立内存 SQLite 并检查 integrity_check。

现有回归覆盖课间暂停/继续、保存步骤恢复、课堂 complete/cancel 自动终止旧课间，以及核心超时、恢复、生命周期、奖励/考勤/点名、CommandBus recovery 和 A1。最终测试数量以交付报告和 backend/.tmp/legacy-break-*.json 为准。

## 边界

- 不改变旧入口允许 running/paused 开始的阶段语义；不宣称完成整个 legacy 阶段政策统一。
- 旧 BreakRun 没有自动超时结束，原样保留；核心 breakEndsAt 自动结束逻辑不修改。
- 队列是现有单进程协调机制，不新增跨进程锁；CAS/SQLite 原子性保留，不新增多实例部署承诺。
- 未执行真实浏览器、A/B 联调或正式环境验收；无正式数据库写入，无服务重启，无 migration，无前端修改，无 commit/push。
