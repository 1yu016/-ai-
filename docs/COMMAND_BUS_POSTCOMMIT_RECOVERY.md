# CommandBus 业务提交后结果恢复

## Changed

本批只修改下列5个业务源码文件、1个测试和文档；保留既有dirty worktree，不commit/push、不启动正式服务、不连接正式数据库。

- backend/src/classroom-runs/classroom-command.service.ts：失败/处理中重试进行只读对账；复用首次奖励参数映射，避免恢复与首次执行默认值分叉。
- backend/src/classroom-runs/classroom-business-receipt.service.ts：抽取严格findCommitted内部读取，原read继续检查canonical digest。
- backend/src/classroom-runs/student-reward.service.ts：增加奖励/撤销的授权、归一化、digest校验只读入口；姓名奖励使用回执冻结的原学生身份，不按现班级重新识别。
- backend/src/classroom-runs/attendance.service.ts：增加只读回执入口，复用同一排序与归一化。
- backend/src/classroom-runs/classroom-roll-call.service.ts：增加只读回执入口，不读取候选池、不执行随机。
- backend/test/command-postcommit-fault.e2e-spec.ts：原故障断言转为恢复回归，并增加姓名奖励、损坏/缺失回执、终态后重放、明确不调用executeOperation断言。

## Reused / 恢复规则

1. 先执行已有当前领域访问守卫及原操作者检查，核对transport requestHash，兼容既有准确请求哈希。
2. 仅支持已有canonical领域操作：reward_student/revoke_reward、attendance_update、random/specified/group roll-call。
3. Processing/Failure/Conflict未缓存成功时，使用actor/run/requestId/operation查找严格kind=classroom_business_receipt、contractVersion=1回执，重新计算并核对canonical payloadDigest。
4. 有严格匹配回执才返回成功；无回执保持原Processing/失败行为；无效回执/digest不匹配拒绝409。普通command Event不能证明成功。
5. 成功缓存重放不改变；不调用canonical写入口、不进入Snapshot队列或事务，不重随机，不修改记录、Event、Snapshot、Run或首次回执。
6. 不把transport expectedVersion重新定义成canonical digest的一部分；历史成功结果在Run推进/结束、学生停用或改名后仍可授权只读重放。

## 响应契约及成员 B 交接

新恢复路径HTTP201（沿用POST控制器默认状态），body.status=success：

- result：严格回执中首次已提交的业务结果，不通过当前正式记录重建。
- classroomState：null；明确表示首次完整HTTP状态丢失，不伪造该状态。
- currentClassroomState：直接只读获取的当前ClassroomRun实体，不是完整restore/屏幕投影DTO，不触发Run.get的课间结算副作用。
- recovery.source=canonical_business_receipt，contractVersion=1，committedRunVersion=首次业务提交版本，refreshRequired=true。

成员B在后续合并接入时，应根据recovery.refreshRequired单独刷新权威完整课堂状态，不能把currentClassroomState当成首次状态，也不能直接当完整恢复DTO。普通既有成功响应保持原shape。

本批采用只读恢复，不修补classroom_operation_record的历史failure/processing状态。GET命令查询仍返回原始传输日志，不代表业务未提交；持久业务回执才证明事实成功。本批未扩展GET为新的对账API，也不对不存在回执的Processing自动超时重执行业务。

## Tests

2026-10-17最终运行：

|检查|结果|
|---|---|
|完整后端E2E|27套，319通过，0失败，0跳过|
|其中提交后恢复测试|20通过：奖励ID/奖励姓名/考勤/随机点名 × A/B/C/正常/未提交|
|其中奖励定向|44通过|
|其中考勤定向|14通过|
|其中点名定向|16通过|
|全量单元测试|23套，167通过，0失败，0跳过|
|type-check|通过|
|build|通过，仅生成本地dist，不加载正式进程|
|lint|退出0；保留classroom-snapshot.service.ts:353既有no-useless-fallback-in-spread警告，未越范围改动|
|git diff --check|通过|

结果文件：backend/.tmp/command-postcommit-full-e2e.json、command-postcommit-unit.json。
场景JSON保存请求/响应、命令记录、关键表数据及摘要；旧故障报告标记为历史记录，不把修复前9失败混同当前结果。

故障场景A/B首次仍500，但重试201；C重开应用后重试201；未提交对照仍409且无事实。完整19张关键表前后摘要证明恢复无写入，Event回执不变，Run版本不增长，Snapshot不新增；正式点名结果不变；其他教师查询/重放403，修改payload409。
另覆盖删除回执不推断成功、普通Event/损坏digest/不匹配run拒绝、完成课堂及停用/改名后保持首次结果、首次提交版本与当前版本分离。
每个测试库均为新建合成SQLite文件或内存库；重开阶段关闭同步/迁移；完整AppModule测试进程明确DATABASE_PATH=:memory:，DB_MIGRATIONS_RUN=false。migration E2E仅在隔离内存库验证既有迁移，不迁移正式库、不改变源码schema。

## Remaining / 下一批建议（未实施）

- 浏览器、前后端联调、正式验收按用户决定延期到A/B合并后；3E不因此标记封版。
- 未执行OS级强杀/断电、多进程压力测试；本次C通过阻断结果持久化并重建应用验证持久状态。
- 撤销只读恢复已接入，但新增提交后故障矩阵未单独覆盖撤销、批量考勤及分组点名；既有领域定向和全量回归通过，不能宣称这些故障组合全部实测。
- 不新增表、不改前端、A1、authoring、生命周期、DeviceSession、Online Policy。
- 若后续需要GET命令状态与恢复响应统一，单独设计传输日志对账，不修改业务回执、不增加第二套事实。
- 建议0.5-4下一小批仅冻结并实现纯服务端operation-policy及参数化测试：复用Run/screenLifecycle/break事实区分首次操作与历史重放，先明确PAUSED/OPENING允许语义，再接具体入口。不要把新policy插在持久成功回执重放之前，不重构整个CommandBus。本轮不实施0.5-4。
