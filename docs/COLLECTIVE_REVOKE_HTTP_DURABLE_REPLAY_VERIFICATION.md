# 集体奖励撤销 HTTP 持久回执重放验证

## Findings

现有正式领域HTTP入口支持本批验证，**未发现业务实现缺陷**。本批只新增测试和本报告，不新增CommandBus操作/API/schema，不修改业务实现。承接A-04，但不把HTTP重放冒充不存在的Processing/Success命令恢复。

## Evidence：真实链路与契约

```text
POST /classroom-runs/:runId/collective-rewards/:rewardId/revoke
AuthGuard + RevokeRewardDto
  requestId：必填，既有RequestIdDto约束
  reason：必填1..200字符，领域trim后安全校验
  version：可选Run并发版本
→ StudentRewardService.revokeCollectiveReward
→ writeReward(operation=collective_reward.revoke, payload={recordId,reason})
→ transactionRequired(manager)
  → 教师、Run、班级访问权限复核
  → actor/run/requestId定位严格持久回执并校验digest
     命中：return首次receipt.result，不进入业务修改分支
  → 首次执行active/version/phase检查
  → Run CAS
  → 原ClassCollectiveRewardRecord标记撤销
  → 正式成长目标重算
  → 正式投影、Event receipt、required Snapshot
→ COMMIT → HTTP 200，含原记录字段及committedRunVersion
```

回执为ClassroomEvent中的严格kind=classroom_business_receipt、contractVersion=1、normalizationVersion=1、operation=collective_reward.revoke；payloadDigest包含run、operation、目标recordId和规范化reason，不把可选version当业务payload。校验权限在读取首次结果之前；重放早于active/版本及业务修改分支。

成功重放仍进入现有短事务/队列做授权和回执读取，不宣称“零数据库事务”；它不重新执行撤销业务、不重算成长、不执行save/update或required Snapshot。这一差异通过调用监测和数据库前后内容同时证明。

## 隔离夹具与数据核验

每项独立mkdtemp SQLite、合成教师/班级/学生/Run，正式HTTP创建一个成长目标（20分）和两条集体奖励（3分、5分）。原目标8分、Run version=3，撤销3分奖励后目标5分、Run version=4。

|项目|首次撤销前|首次撤销提交后|同请求重放/应用重建后|
|---|---|---|---|
|ClassCollectiveRewardRecord|2条，目标未撤销|仍2条，目标revokedAt/teacher/requestId/reason已保存|所有行逐字段相同|
|ClassGrowthGoal|currentPoints=8|currentPoints=5|所有行逐字段相同，无重复目标更新|
|业务Event|2条原发奖回执|新增唯一撤销回执，原两条完全不改|不新增、不修改|
|Snapshot|起始夹具及两次发奖快照|新增一次required Snapshot；collectiveRewardState仅保留5分奖励|不新增、不修改|
|Run version|3|4|不再次递增|

对20张关键表比较完整行、数量和SHA256，包括legacy事实表、正式表、成长目标、Event、Snapshot、Run；不以只看record数替代内容一致性。

### 新增4个专项场景

1. **response-loss-reopen**：真实HTTP成功，保存返回体作为测试oracle，但客户端成功缓存设为空；同ID重试返回与首次完全相同的200结果。随后关闭应用，新应用/DataSource复用同一文件，关闭synchronize/migration，原HTTP再次返回首次结果。
2. **late-event**：调用真实receipt写入后抛错，第一次500；正式撤销、目标、Event、Snapshot、Run所有行回滚。恢复测试注入后同ID重试是真正首次成功执行，返回200；之后只读重放。没有回执的失败请求不能误报已提交。
3. **late-snapshot**：required Snapshot实际保存后抛错，同样验证完整SQLite事务回滚及后续首次成功/只读重放，不用纯mock替代回滚证明。
4. **missing-receipt**：成功后只在合成库删除该撤销回执，保持原记录已撤销；用同ID和当前Run版本请求返回409，业务表不变，不从revokedAt反向猜测成功或补回执。随后还原测试Event并核对摘要。

所有场景还验证：

- reason去除外围空白后重放有效；改变原因或目标recordId而保留ID均409。
- 重放期间监测成长重算、captureBusinessRequired、Repository.save/update，调用均为0；授权只读操作不被mock替代。
- 其他教师重放以及读取正式reward-dashboard均403。没有伪造不存在的“回执查询API”。
- 测试夹具将Run置终态后，已成功请求仍返回首次结果；另一原奖励用新ID作课后首次撤销仍409，不改变数据。
- 每库integrity_check=ok，foreign_key_check为空。

响应丢失采用“已提交成功响应由测试侧保留oracle、客户端不缓存并重试”的确定性模拟，不宣称实际TCP断开、超时或OS进程强杀已验证。没有任何CommandBus/Processing记录参与这些场景。

## Tests：本次执行情况

|执行|suites|通过|失败|跳过|
|---|---:|---:|---:|---:|
|首次专项|1|0|4|0|
|修正测试实体读取后的专项v2|1|4|0|0|
|专项+奖励+特殊纠正定向回归|3|56|0|0|
|补强目标初值与撤销响应后的最终专项|1|4|0|0|
|严格回执契约单测|1|6|0|0|

首轮4项失败发生于测试把snake_case SQL原始行传给只接受ClassroomEvent实体camelCase字段的parse()；改用Repository读取实体后，原严格断言全部保留并通过。不是修改业务parse、放宽校验或删除失败断言。首轮失败JSON保留，v2及最终结果用不同文件，不将失败改写为成功。

56项由本专项4、student-reward44、correction-operation-policy8组成；重复执行不作为独立场景相加。type-check退出0；lint最后退出0，仅原Snapshot spread警告（本批新增unused夹具变量警告已通过仅测试变量命名消除）。没有执行完整unit、完整E2E、build、浏览器或B联调；以前559/350等结果不计作本次通过。

命令（cwd=backend）：

```text
npm run test:e2e -- --runInBand --silent --testPathPatterns=collective-revoke-http-replay --json --outputFile=.tmp/collective-http-target.json
npm run test:e2e -- --runInBand --silent --testPathPatterns=collective-revoke-http-replay --json --outputFile=.tmp/collective-http-target-v2.json
npm run test:e2e -- --runInBand --silent --testPathPatterns='collective-revoke-http-replay|student-reward|correction-operation-policy' --json --outputFile=.tmp/collective-http-regression.json
npm run test:e2e -- --runInBand --silent --testPathPatterns=collective-revoke-http-replay --json --outputFile=.tmp/collective-http-final.json
npm test -- --runInBand --silent --testPathPatterns=classroom-business-receipt.service.spec --json --outputFile=.tmp/collective-http-receipt-unit.json
npm run type-check
npm run lint
```

E2E进程DATABASE_PATH=:memory:、DB_SYNCHRONIZE=true、DB_MIGRATIONS_RUN=false；专项自行明确连接临时文件路径，只同步合成空库既有实体。重建阶段关闭同步/迁移，独立配置ignoreEnvFile，不连接正式库或加载正式服务。测试关闭并精确清理自己创建的库及辅助文件。

## Changed

- 新增 backend/test/collective-revoke-http-replay.e2e-spec.ts。
- 新增本报告。
- 业务源码、既有测试、前端、A1、authoring、Operation Policy、生命周期、DeviceSession/Online Policy、schema不变。不清理/暂存/提交/推送，不fetch/pull/merge，不重启正式服务。

证据：backend/.tmp/collective-http-{target,target-v2,regression,final,receipt-unit}.json；合成请求结果及关键表内容在backend/.tmp/collective-http-replay-{response-loss-reopen,late-event,late-snapshot,missing-receipt}.json。均为本批独立前缀，不覆盖历史其他批次证据；复跑可更新本批合成证据，首轮失败Jest JSON单独保留。

## Remaining

- 真实网络断链、HTTP响应序列化故障、OS强杀、断电、多进程及存储损坏未测。
- 同应用并发压力、超大成长历史、不同成长目标归档组合未穷尽；既有reward回归仅补相关范围，不宣称全部故障时序覆盖。
- 集体撤销仍不经过CommandBus；本批不为其新增命令能力，也不宣称补齐不存在的postcommit命令窗口。
- 正式浏览器和B联调继续延期，自动化结果不替代正式验收。

## Next Batch（建议，未执行）

建议下个独立子项回到交付基线的**证据可携带性**：为已完成验证生成源码/测试哈希与运行结果对应清单，区分失败、成功和未执行边界，不补造旧证据、不开发新业务。本批完成后停止。
