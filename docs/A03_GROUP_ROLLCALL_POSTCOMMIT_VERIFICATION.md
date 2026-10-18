# A-03 正式分组点名提交后恢复验证

## Findings / 边界

本批未发现真实业务缺陷，只补验证证据，不修改业务代码。这里使用用户指定的 A-03 批次名称，不改写交付基线原有 A-03 配置问题的含义。

对象是 canonical group_roll_call / RollCallMode.GroupRandom，不能与旧 participation 随机/分组入口混同。没有扩展旧兼容语义、Operation Policy、schema 或 CommandBus 操作枚举。

## 实际链路与规范化

POST /classroom-commands → ClassroomCommandService.rollCallPayload/rollCall → ClassroomRollCallService.normalize/execute → 权限/持久receipt → phase/CAS → 事务内班级active学生、范围、StudentGroup/Member、正式考勤和cooldown验证 → 首次随机 → ClassroomRollCallRecord/Event receipt/required Snapshot原子提交。

CommandBus 的 mode 由 operation 推导，不能通过 parameters.mode 自行改写。本批“改变mode”测试改变实际 operation 为 random_roll_call；分组ID、studentIds排序范围、cooldownCount、algorithmVersion、groupKey以及指定学生字段均参与归一化/digest。成功重放先读严格回执，不再次读取成员/考勤或随机源。

非Success命令重试 → replay → recoverCommittedBusiness → readCommandReceipt；只有权限、hash、canonical digest及严格持久回执有效才返回首次结果。Processing本身不是成功证据。

## Changed

- 新增 backend/test/group-rollcall-postcommit.e2e-spec.ts。
- 新增本报告。
- 现有源码、既有测试、前端、A1、authoring、设备会话、在线政策、课堂生命周期、数据库结构和历史报告不改。

复用现有隔离测试模块配置、teaching-phase-fixture、故障seam与关键表摘要核对方式。不是第二套恢复实现。

## Evidence

每个场景使用独立临时SQLite、合成教师/班级/两名学生、真实StudentGroup及两条active StudentGroupMember。首次请求提供groupId及两名学生范围，真实随机源在首次成功事务中调用一次，eligibleCount/selectionPoolCount均为2。重试倒转studentIds顺序验证规范化等价。

|场景|注入窗口|首次HTTP|重试HTTP|原命令记录|正式点名数|Run version|
|---|---|---:|---:|---|---:|---:|
|A-read-run|业务提交后读取Run失败|500|201|failure|1|2|
|B-save-success|业务提交后保存Success失败|500|201|failure|1|2|
|C-reopen-processing|业务提交，Processing保留，关闭后同文件新应用重建|500|201|processing|1|2|
|normal|普通成功/成功缓存重放|201|201|success|1|2|
|uncommitted|Processing已持久化，但领域执行前中断|500|409|processing|0|1|

注入前确认事务已真实提交：Run version=2、正式点名一条、严格业务回执一条。重建时关闭synchronize/migration，核对数据及命令记录前后完全相同。恢复契约只读，不要求把Processing/Failure命令行改写成Success。

### 成功恢复与成员变化

1. 相同requestId和规范化payload返回首次选出的学生、原recordId及完整首次result，和持久receipt逐字段相等。
2. 正式Record、Event、Snapshot、Run及legacy/配置/分组表全部行、数量、SHA256重试前后相同，Run version不再次增加。Snapshot.rollCallState与首次receipt.result.rollCallState完全一致。
3. 监测Repository对Student、StudentGroup、StudentGroupMember、StudentAttendanceRecord的find/findBy/findOneBy调用，重试时为0；真实随机chooseIndex重试调用0。监测不替代业务数据库，只记录实际调用。
4. 同时测试CommandBus重试和canonical service直接重放，不能仅凭缓存响应证明canonical不重新选人。
5. 成功后停用并移除全部分组成员，再用原请求重放；仍返回原学生和recordId，不重新读取候选池、不新增事实。新requestId则因空组409，CAS及所有业务写入回滚。
6. C场景另将Run置为completed，原学生停用改名；首次结果与当前Run状态分离，继续合法只读重放。

### 冲突、权限与不可靠回执

- 相同ID改变mode、groupId、studentIds范围、cooldownCount、algorithmVersion、groupKey或studentId，全部409，无业务表副作用。mode按实际CommandBus operation改变，而不是测试被服务端忽略的原始参数。
- 其他教师重放/查询403或409，不返回result/responsePayload或businessRecordIds。
- 未提交对照没有点名事实、Event、Snapshot变化；Run仍version1；没有回执不返回成功。
- A场景对合成回执改为普通command、错误digest、错误run以及删除回执，均不接受成功；恢复测试行后核对数据库摘要。正式记录存在不等于可以猜测首次响应。
- 每库integrity_check=ok，foreign_key_check为空；临时库由本测试创建、关闭并精确清理。没有正式数据库操作或服务重启。

## Tests（本次真实执行，包含失败记录）

|运行|通过|失败|跳过|说明|
|---|---:|---:|---:|---|
|初轮新增专项|4|1|0|A场景测试主动变更成员后，回执篡改恢复断言误用成员变更前全库基线|
|修正测试比较基线后的专项v2|5|0|0|不修改业务代码、不删除断言；改为篡改前即时全库基线|
|相关E2E回归，4 suites|35|0|0|group-postcommit5、roll-call-canonical16、classroom-operation-policy6、operation-entry-audit8|
|最终新增Snapshot投影核对后专项|5|0|0|严格比较Snapshot与首次回执投影|
|业务回执契约单测|6|0|0|严格识别和不可变契约|

初轮失败只涉及本测试主动修改的student_group_member.active/removed_at，不属于正式事实恢复缺陷。失败JSON a03-group-target.json保留，不覆盖成绿色结果；后续输出使用v2/regression/final独立文件。不能把这5次运行计数相加称为56个独立业务场景。

type-check/lint本次退出0；lint仅原Snapshot spread警告。没有运行完整unit、完整E2E、build、浏览器或A/B联调，不引用以前的350 E2E/559 unit作为本批结果。

## 命令与产物

执行目录backend，E2E进程显式DATABASE_PATH=:memory:、DB_SYNCHRONIZE=true、DB_MIGRATIONS_RUN=false。专项内部明确连接mkdtemp文件库；同步只初始化隔离空库现有实体，重开应用同步/迁移均关闭，不导入正式.env。

```text
npm run test:e2e -- --runInBand --silent --testPathPatterns=group-rollcall-postcommit --json --outputFile=.tmp/a03-group-target.json
npm run test:e2e -- --runInBand --silent --testPathPatterns=group-rollcall-postcommit --json --outputFile=.tmp/a03-group-target-v2.json
npm run test:e2e -- --runInBand --silent --testPathPatterns='group-rollcall-postcommit|roll-call-canonical|classroom-operation-policy|operation-entry-audit' --json --outputFile=.tmp/a03-group-regression.json
npm run test:e2e -- --runInBand --silent --testPathPatterns=group-rollcall-postcommit --json --outputFile=.tmp/a03-group-final.json
npm test -- --runInBand --silent --testPathPatterns=classroom-business-receipt.service.spec --json --outputFile=.tmp/a03-group-receipt-unit.json
npm run lint
npm run type-check
```

合成业务证据：backend/.tmp/group-rollcall-postcommit-*.json（请求/响应/首次随机次数/冲突结果/各表前后行与摘要）；group-rollcall-membership-*.json（成员主动变化、旧请求重放、新请求409及后续摘要）。同一批复跑会更新本批合成证据，不覆写此前其他前缀的历史报告。失败Jest结果单独保留。

## Remaining

- 未验证OS级强杀、断电、多进程、存储损坏、超大分组性能，不把测试应用重建等同真实断电。
- 当前测试覆盖两名候选、真实分组及明确范围的交集，不穷尽所有组配置；既有canonical定向回归负责其他资格/冷却场景。
- 手机外层session/在线门槛、前端缓存/动画、正式浏览器验收继续延期。
- 集体奖励/撤销是否存在对应CommandBus契约需先核对，不能为了补故障矩阵新增不在本批范围的操作。

## Next Batch（建议，未执行）

建议只审查并验证**集体奖励撤销的持久业务回执重放边界**：先确认当前真实入口；如没有CommandBus操作，仅验证已有canonical入口，不伪造支持，不新增枚举或schema。发现需扩大范围则停止该部分并报告。本批完成后立即停止。
