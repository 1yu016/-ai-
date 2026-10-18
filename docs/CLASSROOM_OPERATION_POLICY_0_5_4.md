# 0.5-4 阶段操作政策实施报告

日期：2026-10-18。分支 feature/member-a，HEAD 09b99a81d909df6001aa0b204b3efca8eba3bba1。

## 结论

4A纯政策及测试完成；4B已接入核心Run、正式三领域、现有delegate、CommandBus展示控制、开场完成及独立启发式TTS路径。
但**不宣称4B所有旧入口已经封版**：旧engagement课间入口保留了事务前后Snapshot写入，其阶段守卫与“拒绝零业务副作用”无法通过单纯插入检查同时保证。该局部按用户停止条件停下，未重构旧课间事务。
浏览器、前后端联调及正式验收统一延期到A/B合并后；3E没有因此标记封版。

## Changed

新增：

- backend/src/classroom-runs/classroom-operation-policy.ts：operation分类、派生phase、纯decision及policyAllowedActions。
- backend/src/classroom-runs/classroom-operation-context.ts：同EntityManager读取既有Run/有效Snapshot/绑定/课间事实；无新事务、无队列、无状态写入。
- backend/src/classroom-runs/classroom-operation-policy.spec.ts：345项参数化单元测试。
- backend/src/ai/heuristic-operation-policy.spec.ts：4项禁止阶段不请求TTS的测试。
- backend/test/classroom-operation-policy.e2e-spec.ts：6组隔离真实数据库测试，包含大量入口断言与事务竞争。
- backend/test/helpers/teaching-phase-fixture.ts：仅为合成测试补足有效恢复快照，使用真实completeOpening进入教学，不mock政策。

增量修改：

- classroom-run.service.ts：事务内守卫、共享allowedActions、CommandBus只读预检查、普通观察反馈与内部控制分类。
- classroom-command.service.ts：仅新增executeOperation阶段预检查；已有post-commit recovery/replay实现不重新设计。
- student-reward.service.ts、attendance.service.ts、classroom-roll-call.service.ts：回执重放之后、CAS之前同事务守卫；正式记录/回执/required Snapshot边界不变。
- screen-lifecycle.service.ts：新完成/跳过开场必须在允许阶段，既有已完成请求的幂等成功仍优先返回。
- ai/heuristic-assistant.service.ts：独立play入口在网络前检查；网络后以短事务重新核对Run版本/当前班级授权/阶段/已确认草稿，再写播放时间。网络/TTS不在事务中。
- ai/classroom-command.service.ts：旧语音执行在token消费前作只读阶段检查；步骤/pause/resume仍delegate到Run事务入口。三领域旧语音reject不变。
- 教学相关E2E夹具：先真实完成OPENING或补足手工合成Run的有效快照，再运行原领域断言；未通过放宽政策来让旧测试通过。恢复快照计数对应新增开场完成快照同步更新。

无新表、字段、migration或Run状态；不改Snapshot结构、DeviceSession、Online Policy、A1、authoring；不改前端，不重启正式服务，不commit/push。

## Policy Matrix

下表仅是阶段许可，不替代授权、设备、资源、版本、学生资格、领域规则及事务守卫。

|派生阶段|阶段许可|禁止的新教学操作|
|---|---|---|
|IDLE|查询、准备、现有合法开始流程|步骤、资源启动、TTS、点名、奖励、新考勤|
|READY|查询、准备、取消准备、确认开始|同上；不创建假Run|
|OPENING|查询、完成/跳过开场、暂停、结束、中止|步骤、资源/数字人展示切换、TTS、点名、奖励、新考勤、队列编辑|
|TEACHING|正常教学、观察反馈、合法核心Run控制|继续受所有现有领域约束|
|PAUSED|查询、继续、结束、中止、安全停止、明确的播放器观察反馈|新步骤、资源启动/恢复、TTS、点名、奖励、新考勤等|
|SUMMARY|查询、关闭总结、合法后续准备/开始|不向已结束Run追加事实|
|terminal|历史查询、合法后续流程|旧Run不能新增课堂事实|
|RECOVERY|查询、现有合法recover/takeover、安全停止、结束/中止|禁止直接继续教学；现有恢复前提仍需满足|
|break约束|查询、结束课间、结束/中止课堂|不启动新教学；现有break对子操作的限制保留|

PAUSED优先于opening；设备异常/权限仍由现有外层守卫负责。所有快照失效、日期不安全或快照设备不匹配会进入RECOVERY政策。
历史有效Snapshot没有screenLifecycle时按普通教学兼容，不补开场；过期/换绑/不匹配的生命周期标记不被当成opening，与既有getValid返回null的投影一致。
已有Run.status=prepared是旧行政预留，派生为reserved兼容分支，保留其取消/失败守卫；它不是READY preparation，也不是新增持久状态。

### 纠错语义不擅自冻结

- reward_revoke（含集体撤销）：标记product_semantics_unresolved，本批不改变原canonical纠错、终态及权限规则。
- attendance_correction：仅已有正式AttendanceRecord的全部目标归入已有记录更新；本批不为暂停/开场期间的纠正新定产品政策。混合批次含未登记学生时，整体按attendance_new守卫，保持整批原子。
- unresolved不是已批准许可，也不是本批新增禁止；这些操作未进入通用allowedActions的已冻结许可清单，成员B不能以此替代专门纠错规则。

## Entry Coverage

|入口|当前接入方式|
|---|---|
|CommandBus教学命令|首次执行预检查；真正写入仍在下游事务内复核。既有回执重放优先，不被新政策阻断|
|Run.changeStep/startBreak/endBreak|授权/重复请求检查后，同manager内检查phase再CAS/Event/required Snapshot|
|Run.pause/resume/complete/cancel|既有transition事务内检查；不改变状态枚举与合法迁移|
|Run.takeover/recover/avatar bind/unbind|现有事务内检查；不改变恢复点/绑定结构|
|HTTP checkpoint|只按播放器observation检查；checkpointType不能升级控制权限|
|checkpointControl|内部queue/TTS/media/safe-stop分类，事务内复核；三领域JSON仍由3E-1拒绝|
|StudentRewardService|个人/集体新奖励走reward；成功重放先返回；撤销保留原纠错守卫|
|AttendanceService|统一apply；新考勤及混合批次检查，已有记录纠正单列；无legacy双写|
|ClassroomRollCallService|所有首次模式在事务内检查；重放不读候选池、不重新随机|
|3E participation attendance/specifed rollcall、engagement直接奖励|delegate后自动受到同一canonical事务守卫，不建立第二套政策|
|opening complete/skip|共同检查；PAUSED中第一次完成开场409，先resume再完成；历史已完成幂等重放仍只读成功|
|SUMMARY close、preparation create/cancel/start|复用已冻结绑定/lease/exclusive/active-Run保护；没有第二套持久状态|
|旧语音next/previous/pause/resume|token消费前预检查，真实动作delegate到Run事务入口再次检查|
|旧语音play/翻页等返回动作候选|增加只读阶段检查；没有升级为正式Presentation执行协议，不宣称它具有新命令总线的完整事务/ACK能力|
|启发式助教play|TTS前阻断禁止阶段；TTS后提交播放标记前在短事务重新检查；不把网络放进事务|
|绘画deliver、导演确认（含真实命令）|通过CommandBus受到相同守卫；草稿编辑/确认不是自动课堂执行|
|旧engagement课间start/end|局部停止：尚未纳入新事务政策，详见Remaining|

历史GET只读、普通教案/资源/分组/奖励规则/徽章定义配置、AI候选生成与教师草稿编辑不被误当成正式课堂展示操作。独立无Run的通用TTS接口不是正式大屏投递API，不能将其音频响应直接解释成课堂执行授权。

仍然409 LEGACY_SEMANTICS_UNSUPPORTED：旧语音奖励/点名、voice attendance confirm、不能无损映射的旧随机/范围/分组点名、ruleId/classGrowthValue/badgeDefinitionId及超限旧奖励、旧数字ID撤销、旧成长/荣誉写语义。未扩大3E支持范围。

## Transaction Contract

授权 → 已提交回执/digest重放 → 在调用方manager读取阶段 → 首次操作守卫 → Run CAS → 正式事实/Event/required Snapshot → commit。
纯policy不执行授权、不生成回执、不推断成功。execution=committed_replay仅是内部建模输入，不读取客户端同名字段；真实业务重放仍由既有严格回执验证。
readOperationContext不调用screenState、getValid的事务包装、Run.get或Snapshot写队列，避免队列自等待与读触发额外结算。
被拒绝场景不新增正式三领域事实、ClassroomEvent、Snapshot或Run版本；CommandBus原有命令日志/拒绝审计不是业务成功回执，仍可记录拒绝。

## Tests

最终结果以backend/.tmp/operation-policy-full-unit.json和operation-policy-full-e2e.json为准。

- unit：25套，516通过，0失败/跳过；其中纯policy345项、独立TTS政策4项。
- 完整后端E2E：28套，325通过，0失败/跳过。
- 其中policy真实隔离库6组，CommandBus recovery20项，奖励44项、考勤14项、点名16项；包含0.5-1/2、3B/C/D/E、A1及生命周期原有回归。
- 事务竞争测试：请求等待Snapshot事务队列期间创建opening，不改变Run version；新奖励在真正事务执行时拒绝，未产生事实/回执/业务Snapshot，证明不是仅检查入口版本。
- 每个禁止阶段比较19张关键业务表完整行/内容摘要；覆盖direct canonical、legacy delegate、CommandBus、TTS/资源/步骤；校验SQLite integrity_check。
- 完成课堂后的成功请求只读重放仍通过；paused安全停止和观察反馈通过。
- type-check/build/lint退出0；lint保留未改动Snapshot文件:353既有warning。无自动格式化。
- 早期失败是教学夹具未完成OPENING或未提供有效快照，以及缺少必要DTO字段；修正测试准备后再跑全量。未降低禁止断言、未skip失败用例。
- 测试仅新建合成库/内存库，AppModule测试明确DATABASE_PATH=:memory:；不加载正式运行进程，不连接backend/data/app.sqlite。既有migration测试仅作用隔离库，不执行正式迁移。

## Remaining / 明确停止项

1. 旧classroom-engagement.service.ts:startBreak在:419先写Snapshot、:428业务事务、:507再次写Snapshot；endBreak同样在:543事务后:581写Snapshot。若只插入事务内守卫，竞争时已可能有事务外快照；若包进已有Snapshot队列又调用旧capture，会有自等待风险。该局部未改、不声称已经受完整policy保护。需要单独确认无损适配或事务收口，不能为让报告完整而偷偷重构。
2. 旧语音返回动作候选仍是原协议，不新增token持久契约；真正客户端消费与完整大屏执行授权需要A/B合并时核对，不能等同于CommandBus执行成功。
3. 考勤纠正、奖励撤销的阶段产品语义未冻结，维持原守卫并单列；未统一禁止或放开。
4. 周期性快照、课间timeout及已有读触发课间结算是系统维护，不套教师首次操作许可。对“拒绝请求伴随到期维护”的特殊时序，本批没有重构Run.get；不能把定向零副作用断言扩张成所有自动维护竞态均已验证。
5. 跨日/坏快照的recover仍受原前提约束，不新增“确认后改日期继续上课”的业务语义。
6. 3E浏览器、正式运行加载、前后端联合验收保持延期；自动化通过不代表这些通过。

## 成员 B 合并契约

- 活动课堂使用classroomState.allowedActions/restore.allowedActions；无Run的IDLE/READY/SUMMARY在screen-state顶层提供allowedActions。它是阶段许可上限，仍需处理409/权限/版本等错误，不能建立第二套状态机。
- change_step对应步骤控制；resource_start对应资源启动/恢复/展示切换；media_control对应翻页/缩放等；safe_stop对应停止/暂停媒体/静音；checkpoint仅播放器观察反馈，不是任意控制checkpoint。
- PAUSED优先opening，禁用新教学动作；先resume再完成开场。
- post-commit recovery仍按recovery.refreshRequired刷新完整权威状态，result保持首次结果；currentClassroomState不是原始首次响应。
- 播放器反馈携带事件产生时的presentation command/revision，而非发送时从新展示补贴身份；资源ID相同不能替代关联。
- 不因恢复成功而重复展示奖励、随机点名、TTS或自动播放资源。
