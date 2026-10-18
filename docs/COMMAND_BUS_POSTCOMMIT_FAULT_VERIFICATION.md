# CommandBus 提交后故障验证报告

> 历史故障记录：以下失败数字是修复前实测，不是当前测试状态。2026-10-17 后续批次已实现只读回执恢复；当前结果与接口边界见 COMMAND_BUS_POSTCOMMIT_RECOVERY.md。原始失败测试结果文件 command-postcommit-verification-results.json 保留；当前测试运行生成的场景证据反映修复后行为。

日期：2026-10-17。范围仅测试与记录，不修复业务，不进入 0.5-4。

## 环境与修改边界

- 分支 feature/member-a；HEAD 09b99a81d909df6001aa0b204b3efca8eba3bba1。
- 新增 test/command-postcommit-fault.e2e-spec.ts 与本报告；不改已有业务或测试文件。
- 复用 legacy-durable-replay 测试的 Nest 模块、实体集合与合成数据建库方式。
- 每个新场景使用 mkdtemp 创建的 command-postcommit-isolated-*/isolated.sqlite；配置 ignoreEnvFile=true，不导入生产 AppModule。
- 仅对全新空测试库创建既有实体结构；重开 synchronize=false、migrationsRun=false；不运行项目 migration，不接触 backend/data/app.sqlite。
- 使用内存中的 Jest spy 注入故障，finally 恢复；没有永久生产故障开关。
- 合成 Run 由测试夹具直接创建，避免依赖数字人授权；本批不验收开课 UI。
- 所有测试应用关闭；测试自己创建的数据库及 WAL/SHM/journal 精确清理，未递归删除目录。

## 实际链路

ClassroomCommandService.executeSerialized：保存 Processing → executeOperation → canonical 事务提交 → runs.get → commands.update(Success)。
异常路径把命令记录置为 Failure；replay 对 Failure 返回缓存错误，对 Processing 返回 409，不查询业务成功回执以恢复结果。
canonical 回执通过 kind=classroom_business_receipt / contractVersion=1 识别，仍与事实、required Snapshot 原子提交。

## Evidence

以下每个场景都对 reward_student、attendance_update、random_roll_call 执行。

|场景|复现方式|首次 HTTP|命令状态|同请求重试|事实结果|
|---|---|---|---|---|---|
|A|第二次 runs.get 前确认领域已提交，然后抛错|500，课堂指令执行失败|failure|500，相同缓存错误|事实/回执/Snapshot 各1，Run v1→v2|
|B|保存 Success 前确认领域已提交，然后抛错；Failure 保存不阻断|500，课堂指令执行失败|failure|500，相同缓存错误|同上|
|C|阻止 Success 与后续 Failure 结果持久化，保留 Processing；关闭应用，再打开同一 SQLite 文件|500，Internal server error（注入方式产生）|processing|409，该课堂指令正在处理中，请稍后查询结果|同上，重开前后内容一致|
|正常对照|不注入故障|201|success|201，响应与首次相同|只有一份事实|
|未提交对照|executeOperation 之前抛错，同时阻断 Failure 保存；重开应用|500|processing|409，不假定成功|无事实/回执/Snapshot，Run 保持v1|

C 验证的是中断位置的持久化状态及应用重建，不是操作系统 SIGKILL/断电测试。其首次 500 不是对真实断网客户端响应的承诺。

所有场景在最终目标恢复断言之前完成：

- 同请求重试后19张关键业务表的行数、内容与 SHA256 摘要不变；随机点名正式结果不变。
- 修改 payload 返回409；其他合成教师重放和查询均403。
- 旧9张事实/荣誉表保持不变，没有 legacy/canonical 双写。
- 所有新增领域事实归属当前合成 Run；严格回执只有一份，记录 committedRunVersion=2；考勤还有一份正式 Change 审计。
- integrity_check=ok；foreign_key_check 无异常。
- 重开应用前后正式数据与命令记录相同。

证据文件：backend/.tmp/command-postcommit-<reward|attendance|rollcall>-<场景>.json，共15份，包含请求、首次/重试响应、拒绝状态、命令记录及关键表前后数据与摘要。临时数据库清理前先保存证据。

## Tests

- 新增15项：6通过、9失败、0跳过。失败均发生在最终要求恢复201的断言：A/B实际500，C实际409。未把错误行为改成通过标准，也未使用 todo/skip 隐藏。
- 联合运行7套：161通过、9失败、0跳过，共170项。
- 既有6套155项全部通过：classroom-run 76、student-reward 44、roll-call-canonical 16、attendance-canonical 14、classroom-recovery 4、legacy-durable-replay 1。
- 补充重开前后逐项一致性断言后，再次单独运行新增15项，结果仍为6通过/9失败；详细见 command-postcommit-fault-results.json。
- 联合结果：backend/.tmp/command-postcommit-verification-results.json。此联合运行早于最后新增的重开一致性断言，未声称为最后文件的全套重跑。
- 新测试保留未解决目标的红色断言，会使包含该文件的普通E2E运行失败；这是待审核缺口，不是已通过封版结果。

## Failure Window

已确认三个领域均存在：领域提交成功，但命令层无法恢复成功响应。
没有观察到重试重复产生事实。既有正常成功缓存重放、业务持久回执重放与事务故障回滚回归通过。
Processing 本身不能作为成功证据；未提交对照仍拒绝，不能用“超时即成功”修复。

## Proposed Fix（未实施）

优先仅对三领域已有严格持久回执设计 CommandBus 结果对账：

1. 保持操作者/当前权限校验与 transport hash 检查；同ID不同payload仍409。
2. 对 Processing 或领域提交后的 Failure，通过对应 canonical 内部只读入口校验 actor/run/requestId/operation/digest 并读取首次已提交回执，不重跑业务。
3. 无严格业务回执不能推断成功；不要只因命令长时间 Processing 就重执行业务。
4. 不修改首次业务回执，不重建事实，不补写 Event/Snapshot，不重新随机。
5. 恢复的首次业务结果与当前 classroomState 分开定义；不能声称事后读到的状态是首次响应原貌。
6. 最小影响范围预计为 classroom-command.service.ts、必要的内部回执读取接口和相关测试；无新增表的默认需求。API响应兼容和命令结果更新并发策略先评审。

## Remaining

- 未实施修复；等待成员A审核。
- 未覆盖集体奖励/撤销、媒体命令、手机会话及每一种异常时序。
- 未验证操作系统级强杀、断电、多进程竞争或SQLite存储损坏。
- 未做全量仓库回归、浏览器验收或正式部署；3E浏览器验收仍延期。
- 不修改A1、authoring、生命周期、DeviceSession、Online Policy，不进入0.5-4，不commit/push。
