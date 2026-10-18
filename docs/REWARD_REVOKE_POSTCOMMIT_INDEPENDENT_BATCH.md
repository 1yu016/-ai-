# 交付基线后独立后端小批：个人奖励撤销提交后恢复证据

## 选题与根因

选择 MEMBER_A_0_5_4_DELIVERY_BASELINE.md 的 A-01（P1）中的一个子项：个人奖励撤销。原 CommandBus 已有 RevokeReward → StudentRewardService.revokeReward → writeReward 与 readRevokeCommandReceipt → recoverCommittedBusiness，但既有 postcommit 故障矩阵只有发奖ID、发奖姓名、单人考勤、随机点名，没有撤销。因此缺口是**测试证据不完整，不是已确认的业务实现缺陷**。

本批不同时补集体/批量/分组，也不把缺失历史 JSON 当业务 bug。补测试后5个场景全部通过，无需修改冻结业务实现。没有制造红色断言或放宽阶段政策来“完成修复”。

## 实际文件

- 新增 backend/test/reward-revoke-postcommit.e2e-spec.ts。
- 新增本报告。
- 业务源码、前端、既有测试、基线及历史报告不修改。

新测试沿用现有隔离 Nest 模块配置、正式 canonical HTTP/CommandBus、teaching-phase-fixture 及数据表摘要方式；未重构共享测试工具以扩大范围。故障只在测试 spy 内，真实业务事务及 SQLite 写入仍执行，没有生产故障开关。

## 测试流程与实际行为

每项新建独立临时 SQLite，合成教师/班级/幼儿/Run。先真实进入教学、正式发奖，Run version=2、正式个人奖励一行、原发奖回执一条。对该原记录执行 revoke_reward。事务成功应变为 version=3，同一正式奖励行标记撤销，新增一次撤销业务回执和 required Snapshot。

|场景|注入时点|首次HTTP|同请求重试HTTP|命令传输记录|Run version|
|---|---|---:|---:|---|---:|
|A-read-run|撤销事务已提交，后续Run查询失败|500|201|failure|3|
|B-save-success|撤销事务已提交，保存命令Success失败|500|201|failure|3|
|C-reopen-processing|业务提交后，Success及失败响应保存都被中断；关闭应用并以同一库重新创建|500|201|processing|3|
|normal|无故障，成功缓存重放|201|201|success|3|
|uncommitted|Processing已保存，但正式撤销尚未执行|500|409|processing|2|

命令行的 processing/failure 是恢复前持久化状态；现有恢复契约是只读对账，不声称重试把传输记录永久改成success。存在原发奖回执也不能被误用为未提交撤销的成功证据。

所有成功撤销/恢复场景均检查：

- 原个人奖励行不重复新增；原花数/积分/发奖requestId保留，撤销关联原recordId。
- 原发奖Event/回执逐字段未变；新增回执具有严格kind/version并关联撤销requestId。
- rewardState从正式记录投影后该学生为0。
- 重试不调用executeOperation；关键表全部行、数量及SHA256与重试前相同。
- 相同requestId改变撤销原因409，其他教师重放/查询403或409且不暴露业务结果。
- 回执伪造、错误digest、错误run及缺失时不推断成功。
- 同一文件重建应用后仍可恢复；随后Run终态、幼儿停用改名，不改变首次撤销结果，读取当前课堂状态与首次提交版本分离。
- 未提交对照：正式记录、业务Event、Snapshot、Run version都与请求前相同。
- legacy事实表无变化；integrity_check=ok，foreign_key_check为空。

数据库为mkdtemp创建，测试后关闭连接并精确移除该测试库文件及辅助文件。初始化只同步测试空库既有实体，重建应用关闭同步/迁移；不导入AppModule或正式.env，不连接正式数据库。

## 本批执行结果（不是历史结果）

1. 首次专项：1 suite / 5 passed / 0 failed / 0 skipped。
2. 补强原回执不可变、撤销投影和原记录保留断言后，重新专项及相关回归：4 suites / 63 passed / 0 failed / 0 skipped。
   - 新撤销postcommit：5。
   - student-reward：44（含真实SQLite晚写失败回滚矩阵）。
   - correction-operation-policy：8。
   - classroom-operation-policy：6。
3. 全部unit：25 suites / 559 passed / 0 failed / 0 skipped。
4. type-check、lint、build均退出0；lint仅原classroom-snapshot.service.ts:353 spread警告。
5. 本轮没有执行完整后端E2E、正式浏览器或A/B联调。此前350 E2E仅为历史基线，不作为本次通过数量。
6. 故障日志中的INJECTED错误是预期注入，不是测试失败；本轮未出现失败用例。

执行目录为backend，相关命令：

```text
npm run test:e2e -- --runInBand --silent --testPathPatterns=reward-revoke-postcommit --json --outputFile=.tmp/revoke-independent-target.json
npm run test:e2e -- --runInBand --silent --testPathPatterns='reward-revoke-postcommit|student-reward|correction-operation-policy|classroom-operation-policy' --json --outputFile=.tmp/revoke-independent-regression.json
npm test -- --runInBand --silent --json --outputFile=.tmp/revoke-independent-unit.json
npm run type-check
npm run lint
npm run build
```

E2E进程设置DATABASE_PATH=:memory:、DB_SYNCHRONIZE=true、DB_MIGRATIONS_RUN=false；本测试自身明确使用独立临时文件数据库，不受正式DATABASE_PATH影响。unit不需要正式库。

## 证据位置

- backend/.tmp/revoke-independent-target.json。
- backend/.tmp/revoke-independent-regression.json。
- backend/.tmp/revoke-independent-unit.json。
- backend/.tmp/reward-revoke-postcommit-{A-read-run,B-save-success,C-reopen-processing,normal,uncommitted}.json：合成请求、首次响应、重试响应、命令状态、Run version、前后各表行及摘要。

采用本批独立文件名前缀，不覆写旧command-postcommit证据。本批第一次新专项输出随后由本批回归更新为补强后的合成场景证据；不是覆盖前一批历史记录。

## 修复前后差异

- 业务行为：无变化，原实现已正确处理本次实测的个人撤销窗口。
- 验证能力：此前该入口只有实现及一般领域测试；现在有真实文件库的专属提交后故障/重建应用/终态重放证据。
- 仍不把五项参数化场景当成所有故障时序已穷尽，不宣称OS强杀/断电/多进程已验证。

## Remaining / 下一批建议（本批不执行）

- A-01尚余集体奖励/撤销、批量考勤、分组点名的独立提交后故障组合；不因本批个人撤销通过便全部关闭A-01。
- 建议下一批只选择**批量考勤提交后结果恢复**，验证排序归一化、完整成员结果、原子批量事实、失败后重试不新增Change/Event/Snapshot。先检查既有证据再补，不改schema或扩大权限。
- A-02证据归档、A-03配置规则、B依赖及正式验收保持原有边界。
- 没有修改A1、authoring、DeviceSession、Online Policy、生命周期、前端或数据库结构；没有正式服务重启、Git远程操作、暂存、commit/push。
- 本批结束即停止，不自动执行下一个问题。
