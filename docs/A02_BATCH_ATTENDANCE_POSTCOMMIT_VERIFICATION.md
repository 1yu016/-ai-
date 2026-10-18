# A-02 批量考勤提交后结果恢复验证

> 本批按用户任务名称 A-02 编号；不改写交付基线中原 A-02“证据可携带性”的含义。实际补齐的是基线 A-01 中批量考勤的故障覆盖子项。

## Findings

本次没有复现业务实现缺陷，仅新增隔离测试和本报告。不修改 AttendanceService、CommandBus、业务回执、Operation Policy 或其他业务源码。现有逻辑已支持本次实测的批量考勤恢复，不为开发而改动冻结契约。

实际调用链：HTTP POST /classroom-commands → ClassroomCommandService.updateAttendance/attendancePayload → AttendanceService.normalize/apply → 同一事务中的正式 Record/Change、严格业务回执、required Snapshot；非 Success 重试走 replay → recoverCommittedBusiness → attendancePayload → AttendanceService.readCommandReceipt → strict read，不重执行业务。

## Changed

- 新增 backend/test/batch-attendance-postcommit.e2e-spec.ts。
- 新增本报告。
- 复用现有 postcommit 测试的独立 Nest 模块配置、临时 SQLite、故障 seam、业务表行及摘要比较方法，以及 teaching-phase-fixture。没有另建恢复机制或生产故障开关。

## Evidence

每个场景建立新的临时文件 SQLite，明确核实连接路径；只使用合成教师、班级和两名幼儿。初始 Run version=1。批量参数为 source=batch、confirmed=true，两名幼儿分别 present/late，备注不同。先发送包含首条备注外围空白的请求，重试时倒转学生顺序并去除备注外围空白，验证同一规范化业务请求。

|场景|故障点|首次HTTP|规范化同请求重试HTTP|正式Record/Change|Run version|
|---|---|---:|---:|---|---:|
|A-read-run|正式事务已提交，后续读取Run失败|500|201|2 / 2|2|
|B-save-success|正式事务已提交，保存命令Success失败|500|201|2 / 2|2|
|C-reopen-processing|业务已提交，命令仍Processing；关闭并以同一库重建应用|500|201|2 / 2|2|
|normal|成功响应及缓存重放|201|201|2 / 2|2|
|uncommitted|Processing持久化后、领域业务尚未执行即中断|500|409|0 / 0|1|
|late-event|两条Record/Change及真实receipt Event已insert后抛错|500|500（缓存失败，不误报成功）|0 / 0|1|
|late-snapshot|真实required Snapshot保存后抛错|500|500（缓存失败，不误报成功）|0 / 0|1|
|invalid-member|第二名幼儿已停用，整批资格检查失败|400|400|0 / 0|1|

恢复成功不会将此前 Processing/Failure 命令行自动改成 Success；这是冻结的只读恢复契约。它返回 status=success 的恢复响应，不能把传输记录状态与正式业务事实混同。

### 每种故障的核验

- 正式 StudentAttendanceRecord 与 StudentAttendanceChange 均为两条或均为零；审计 requestId 与本次批量请求关联。
- 成功只有一条严格 kind=classroom_business_receipt、contractVersion=1 的 attendance.batch 回执，包含两条 businessRecordIds 和首次完整结果；Snapshot新增一次，attendanceState与两名学生状态一致。
- 恢复重试不调用 executeOperation；正式表、Change、Event、Snapshot、Run、legacy事实表及成长目标等关键表的全部行、数量和 SHA256 与重试前相同。
- 顺序重排、备注外围空白归一化不改变业务结果；返回首次持久回执 result，非按当前课堂重新生成。
- 相同requestId分别改变学生、状态、备注、确认标记、成员数量，均409，关键业务表无额外变化。
- 无权限教师的重放及命令查询为403/409，不返回 result/responsePayload/classroomState/业务IDs或备注内容；关键业务表不变。
- 首次错误响应不等于事务失败：A/B/C在注入前断言两条正式记录、两条审计、回执及Run version确实已提交。
- 无回执对照不推断成功；A场景另以伪造类型、错误digest、错误run、删除回执验证不能仅凭 transport hash/正式记录猜测成功。恢复测试篡改仅限合成库，并恢复该测试行后核对完整摘要。
- C场景在新建应用/DataSource后对比前后表内容完全一致，重放仍返回首次结果；之后Run终态、原学生停用改名，成功回执仍可只读重放，不增加正式记录/Event/Snapshot或Run version。
- Event/Snapshot故障注入先调用真实写入再抛错：记录与审计实际进入SQLite事务后全部回滚，不用纯mock替代事务证明。无效成员对照也不产生第一名学生的部分考勤。
- 所有测试库 integrity_check=ok，foreign_key_check为空。

## Tests：本次实际执行

|范围|suites|通过|失败|跳过|
|---|---:|---:|---:|---:|
|初次新增批量专项|1|8|0|0|
|补强越权响应不泄露断言后的专项与定向回归|4|36|0|0|
|严格业务回执契约单测|1|6|0|0|

36项包含：新增批量postcommit 8、attendance-canonical 14、correction-operation-policy 8、classroom-operation-policy 6，不把它们与初次8项相加声称44个独立场景。现有考勤定向测试还覆盖Record/Change/Event/Snapshot晚失败、批量重复学生、CAS/终态竞争和原记录重建。

本次 type-check/lint 退出0；lint仅原 Snapshot 文件353行spread警告。没有运行完整unit、完整E2E、build、真实浏览器或A/B联调。以前559 unit、350 E2E属于历史基线，不是本批通过数。注入故障日志中的ERROR是预期测试行为，本轮没有失败用例或跳过项。

命令（cwd=backend）：

```text
npm run test:e2e -- --runInBand --silent --testPathPatterns=batch-attendance-postcommit --json --outputFile=.tmp/a02-batch-attendance-target.json
npm run test:e2e -- --runInBand --silent --testPathPatterns='batch-attendance-postcommit|attendance-canonical|correction-operation-policy|classroom-operation-policy' --json --outputFile=.tmp/a02-batch-attendance-regression.json
npm test -- --runInBand --silent --testPathPatterns=classroom-business-receipt.service.spec --json --outputFile=.tmp/a02-batch-attendance-receipt-unit.json
npm run type-check
npm run lint
```

测试进程明确DATABASE_PATH=:memory:、DB_SYNCHRONIZE=true、DB_MIGRATIONS_RUN=false；新专项自己创建并校验临时文件路径，不连接正式库。同步仅初始化合成空库的现有实体；重建应用阶段 synchronize=false/migrationsRun=false。测试结束关闭应用并只清理自己创建的临时库及辅助文件。不读取正式.env，不重启正式服务。

## 证据产物

- backend/.tmp/a02-batch-attendance-target.json。
- backend/.tmp/a02-batch-attendance-regression.json。
- backend/.tmp/a02-batch-attendance-receipt-unit.json。
- backend/.tmp/batch-attendance-postcommit-{A-read-run,B-save-success,C-reopen-processing,normal,uncommitted,late-event,late-snapshot,invalid-member}.json：合成请求、首次/重试响应、冲突结果、命令状态、before/after表行和摘要、完整性结果。

采用新文件前缀，与此前个人撤销/普通postcommit证据分开。创建本批前对既有非忽略工作文件、HEAD/index、顶层JSON证据采集哈希，交付前核对，确保没有覆盖原有未提交工作或旧证据。

## Remaining

- 未测试OS级强杀、断电、多进程、极端大批量性能或存储损坏。
- 此批验证两名幼儿的提交后恢复及相关原子性，不声称穷尽所有学生数量/状态/备注组合。
- 手机外层会话、设备在线门槛、真实前端重放和缓存处理依旧是独立边界。
- 集体奖励/撤销、正式分组点名的专属提交后故障覆盖仍未补齐。
- 没有业务修复需要，故不修改任何业务实现、Operation Policy、schema、A1、authoring、DeviceSession、Online Policy或前端；不执行远程Git、暂存、commit/push。

## Next Batch（仅建议，本批停止）

建议下一个独立子项为**正式分组点名的提交后恢复验证**：使用真实现有group/member，首次选择在正式事务内，成功后修改组成员再重试仍返回首次结果；新请求资格仍检查，不重随机、不补Snapshot。不顺手适配旧分组语义，不扩展CommandBus操作或数据库结构。
