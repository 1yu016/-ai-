# 0.5-4E 后端入口审计与阶段收尾

## 审查范围与结论边界

本批依据当前源码追踪 controller → service → delegate → 事务内守卫，不以 assert 名称命中数衡量覆盖。只增加隔离 E2E 和本审计、B 交接文档；不修改业务实现。源码证明的兼容例外单列，不声明所有 HTTP 写请求都是同一政策或同一幂等协议。

## 可达入口清单

下列文件路径相对 backend/src。

|入口/调用链|实际执行守卫和写入|分类|
|---|---|---|
|classroom-command.controller POST /classroom-commands → classroom-command.service execute/executeOperation|源设备、操作者、版本、active；commandPolicyOperation 初检；核心或 canonical 服务在事务中复核 phase；Processing/failure/success 属传输记录|首次执行/重放|
|CommandBus previous/next/switch_step → Run.changeStep|事务内 assertRunOperation(change_step) → Run CAS/Event/captureRequired|核心执行|
|CommandBus pause/resume/complete/cancel → Run.transition|事务内状态转换、设备/owner、phase、CAS/Event/required Snapshot；complete 同事务 summary lifecycle|核心执行|
|Run controller steps/pause/resume/complete/cancel|同上述 service，不依赖前端或 CommandBus 才能保护|直接入口|
|Run takeover/recover/avatar-binding/cancel|事务内 takeover/recover/avatar_binding；设备、版本和恢复数据额外校验；recover 没有有效快照时只读返回人工恢复提示|核心控制/恢复|
|CommandBus start_break/end_break；Run POST :id/break、:id/break/end|事务内 start_break/end_break、CAS、Event、required Snapshot|核心课间|
|Run.finalizeExpiredBreak/settleExpiredBreaks|同一队列事务重新读 Run；只有 running、到期核心课间可结束；CAS、确定性 Event、required Snapshot|内部时钟派生，不是教师新命令|
|Run POST :id/rewards、:id/collective-rewards；CommandBus reward_student|StudentRewardService.writeReward：授权 → strict durable receipt → active/version → phase(reward) → CAS/正式事实/receipt/正式重建/required Snapshot|canonical 新事实|
|个人/集体 revoke URL；CommandBus revoke_reward（个人）|同一 writeReward；reward_revoke / collective_reward_revoke；定位原 canonical record；不依赖学生目前班级/active 来定位撤销目标|canonical 纠正|
|participation attendance、attendance/batch → AttendanceService.apply；CommandBus attendance_update|事务内正式 AttendanceRecord 决定 allExisting；全部已有→correction，否则整体 attendance_new；权限/receipt/CAS/记录/Change/Event/required Snapshot|canonical 新事实/纠正|
|CommandBus random/specified/group rollcall → ClassroomRollCallService.execute|事务内 receipt 先于候选池；phase(roll_call) 后 CAS、候选池复核、首次随机、正式记录/Event/required Snapshot|canonical 点名|
|participation roll-calls|仅冻结的 teacher_specified + 合法学生参数无损 delegate；其他旧随机/范围/分组语义 reject，不用同名推断为 canonical|旧兼容或拒绝|
|engagement engagement-rewards|award 校验旧字段可无损才 delegate StudentRewardService；ruleId/classGrowthValue/badgeDefinitionId/超限等 reject|旧兼容或拒绝|
|engagement rewards/:id/reverse、growth/adjust、honors suggest/publish；participation voice confirm|稳定 LEGACY_SEMANTICS_UNSUPPORTED，不写三领域旧事实、正式事实或 Snapshot|拒绝|
|CommandBus set_presentation、资源/媒体/TTS、queue edit|内部 Run.checkpointControl → writeCheckpoint(trustedControl=true)，事务内 controlPolicyOperation → phase/CAS/Event/required Snapshot|展示控制|
|Run HTTP :id/checkpoints|只能 writeCheckpoint(trustedControl=false)；事务内 checkpoint phase + Run/Event；事务外 observation best-effort Snapshot；body checkpointType 不产生内部权限|普通反馈|
|Snapshot.captureBusinessRequired|独立内部三领域投影入口，按 canonical 表重建；不是客户端 JSON 写入口|服务端恢复投影|
|Snapshot lifecycle 保护 → ScreenLifecycleService|普通 checkpoint 不得覆盖；complete/skip opening 在 manager 内验证并检查 complete_opening；已完成重复操作只读；summary close 使用已结束 Run/绑定/revision/lifecycle 专用条件|生命周期专用守卫|
|screen-preparation create/cancel/start|共享 preparation exclusive gate，教师/班级/设备在线/绑定/版本/占用/TTL；不创建假 Run；Run.start 真事务创建后消费 preparation|READY 专用协议|
|engagement breaks/start、break-runs pause/resume/end|4C 保留的旧 running/paused、owner/device、BreakRun version/CAS；与核心共享 Snapshot 队列、Event/required Snapshot；不是统一 start_break/end_break 的等价接口|明确兼容例外|
|ai/classroom-command executeWhitelisted|旧 BreakMode→Run.pause，ReturnToClass→Run.resume，前后步骤→Run.changeStep；奖励/点名 reject；其余认可动作只返回 action/parameters，非已投递大屏|旧语音，非完整新执行协议|
|heuristic-assistant.play|TTS 前检查，外部生成后事务内再次检查 tts 和确认草稿，写播放状态；不在数据库事务等待外部网络|另一个已守卫播放入口|
|classroom-director-v2.confirm|有 commandOperation → CommandBus；候选 edit/reject/无命令 confirm 仅候选状态，不等于大屏执行|建议/教师确认执行|
|artwork.deliver|教师确认作品后依次 CommandBus display_artwork/speak_text；两条命令分别受保护，不宣称跨命令原子性|编排而非旁路|
|mobile commands → mobile.requireSession/online → executeFromMobileSession|再进入 CommandBus；外层会话/TTL/设备门槛独立存在|有额外门槛的传输入口|
|participation group CRUD/random grouping；engagement badge definition/reward rule/break config/collective goal|配置、名单维护；不产生奖励/考勤/点名事实，不自动执行课堂展示；保留原授权/active 等守卫|不属于本政策执行动作|
|StudentRewardService.createGrowthGoal|配置正式成长目标，原 active 检查在队列前；没有对应 operation；不应声称获统一阶段保护|记录为配置边界|
|StudentQuestionService.create/update；Artwork upload/draft/confirm；AI draft/suggestion create/edit/reject|只写资料/教师候选，不代表执行；各自权限/内容规则，未统一套课堂阶段政策；问题 create 的 requireRun 是班级访问，不是 Run 生命周期/owner 守卫|资料写入边界，不擅改产品语义|
|history/legacy GET、list、版本查询|保持读取；但 Run.get/restore/screenState 可触发已到期核心课间结算，不能宣称这些 GET 永不写数据库|历史/状态查询|

三领域正式新事实仍仅来自 canonical 服务；没有为历史 Snapshot 补事实，没有新增 legacy 双写。旧 AI recognize/confirm 候选或旧语音非执行 action 不能视为正式点名/奖励成功。

## allowedActions 一致性与有意例外

- 纯 policy → readOperationContext → restore.allowedActions；活动 screen-state 返回 classroomState.allowedActions。无 Run 的 IDLE/READY/SUMMARY 返回顶层 allowedActions。普通 Run.get/CommandBus.classroomState 不是完整 restore 合约，不保证带 allowedActions。
- OPENING 禁止新教学展示、点名、奖励、新考勤，允许专用开场完成/跳过、暂停、结束；4D 三类已有事实纠正保留。PAUSED 优先 OPENING，允许 safe_stop 和合法 observation，不允许资源/TTS/新事实。
- TEACHING 正常教学仍需目标权限、资源审核、CAS、设备、canonical 条件。能力提示不是授权令牌，也不是所有合法参数的保证。
- SUMMARY 的学生端投影允许 close_summary；同一个 completed Run 的 restore 返回 terminal 能力是不同视图，不应强行补 summary 候选；无 handoff 新页面不能恢复历史 summary。
- RECOVERY 的恢复/安全停止和终态处置由政策允许；没有可用快照时 recover 是只读提示，不伪装完成恢复。
- 核心 break 是叠加约束，只保留 query/complete/cancel/end_break 和已有事实纠正；checkpoint/新资源/新事实不得写。
- 旧 prepared 对应 reserved 而非 READY；只广告 query/cancel/fail。recovery/reserved 的特殊纠正仍走 existing_correction_guard，未广告却可能由原领域规则允许，属于 4D 明确延期例外，不是本批漏加 guard。
- 旧 BreakRun 将 Run 暂停；不能用核心 end_break 能力去驱动旧 break-runs/:id/end。保留旧协议而不是更改 Run 状态语义。
- media_control 在 CommandBus 和内部 checkpoint 的分类粒度不同，但目前可执行阶段都仅 TEACHING；safe_stop/TTS 已独立分类，没有据此开放 PAUSED 播放。

## 风险与不扩大修复的理由

1. 手机外层 requireSession/在线/时效条件可能先拒绝终态重试，不能将核心 CommandBus/canonical 的终态成功重放保证扩大到已失效手机会话。需要独立的安全查询/重放产品规则，不能绕过会话授权。
2. 旧语音 Play 等返回参数不等于服务端持久展示命令；旧 token 消费也不是三领域 canonical 业务回执。保持旧奖励/点名 reject，不为“功能齐全”扩大本批。
3. createGrowthGoal 队列前 active 检查与队列内写配置之间存在状态变化窗口；问题/作品/候选等记录未统一阶段保护。它们不直接发奖、考勤、点名或投屏；是否允许课后资料维护需要单独定义，记录而不擅自禁用。
4. CommandBus ordinary Success 重放可能携带首次响应的旧 classroomState；post-commit recovery 明确分离首次 result 与当前 Run，前端必须刷新，详见 B 交接。
5. 旧 break、recovery/prepared 纠正、跨进程多实例协调仍是已知边界。不声称后端全入口无差异或系统已正式验收。

## 本次测试

新增 operation-entry-audit.e2e-spec.ts：每个阶段独立临时 SQLite，真实 Nest HTTP checkpoint、内部控制入口、SUMMARY lease 投影、legacy break service；检查被拒绝请求前后正式表/Event/Snapshot/Run 行内容及摘要一致。排队中创建 opening 而 Run version 不变，control、observation、canonical rollcall 均由事务内 phase 以 CLASSROOM_OPERATION_FORBIDDEN 拒绝，不靠 CAS 假装覆盖竞争。每个数据库 integrity_check / foreign_key_check 后关闭并清理测试文件。

本批重新运行 policy/recovery/correction 定向测试、完整 unit/E2E、build/typecheck/lint；最终数量与结果见交付消息及 backend/.tmp/4e-*.json。故障日志只用于隔离测试，不修改正式数据库。

## 收尾状态与下一批

0.5-4E 的入口审计、必要补测、B 交接已交付；上述兼容和产品未决项不伪装成修复完成。正式环境、人工浏览器、A/B 联调继续延期。建议下一批是后端交付基线与合并准备：冻结接口/测试证据、未决项优先级、文件归属和合并清单，不自动开发新功能或执行 Git 合并。
