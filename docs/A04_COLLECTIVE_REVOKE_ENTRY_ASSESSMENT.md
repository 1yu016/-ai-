# A-04 集体奖励撤销：入口核对与停止结论

## Findings

**正式领域入口存在，持久回执与原子事务存在，但集体撤销不经过 CommandBus。** 当前链路没有“提交后再读取Run → 保存命令Success → Processing”的命令结果持久化阶段。因此用户列出的三个CommandBus故障窗口不适用于该入口，按本批停止条件停止测试实施，不新增能力或伪造包装层。

本结论是源码审查结果，不是新数据库验收通过，也不是业务恢复缺陷。

## Evidence：真实调用链

```text
POST /classroom-runs/:id/collective-rewards/:rewardId/revoke
  ClassroomRunController.revokeCollectiveReward
    StudentRewardService.revokeCollectiveReward
      trim + 安全文本校验 reason
      writeReward(operation=collective_reward.revoke, payload={recordId, reason})
        transactionRequired(manager)
          requireRewardAccess：教师/Run/班级授权
          receipts.read：严格持久回执 + digest
            已成功 → 直接返回首次 receipt.result（不再执行撤销）
          首次：active + expectedVersion + phase(collective_reward_revoke)
          Run CAS version +1
          查找本Run的原 ClassCollectiveRewardRecord
          标记 revokedAt/revokedByTeacherId/revokeRequestId/revokeReason
          recalculateCurrentGoal(manager)
          rewardProjection(manager)
          receipts.write(manager)：Event严格业务回执，insert-only
          captureBusinessRequired(manager)：从正式记录生成恢复投影
        COMMIT
      返回首次结果及 committedRunVersion
  Controller直接返回HTTP 200
```

没有在Controller/service提交后额外读取Run并保存ClassroomCommandRecord；HTTP响应序列化/传输也不是CommandBus的Success持久化。

### 六项确认

|问题|当前源码证据|结论|
|---|---|---|
|可达正式入口|backend/src/classroom-runs/classroom-run.controller.ts:239–247，AuthGuard下的POST|存在，Controller直接delegate领域服务|
|持久业务回执|student-reward.service.ts:168–210 writeReward；classroom-business-receipt.service.ts:RewardOperation/parse/read/write|collective_reward.revoke是受支持回执operation，不是CommandBus operation|
|事务范围|writeReward传同manager给work、recalculateCurrentGoal、receipts.write、captureBusinessRequired|Run CAS、原记录撤销、成长目标、Event和required Snapshot在同一事务|
|撤销与成长字段|entities/class-collective-reward-record.entity.ts；StudentRewardService.revokeCollectiveReward/recalculateCurrentGoal|原记录保留；正式目标由canonical个人/集体流水重建，不靠Snapshot累计|
|CommandBus支持|classroom-command.types.ts:ClassroomCommandOperation；classroom-command.service.ts:executeOperation/revokeReward/recoverCommittedBusiness；dto/classroom-command.dto.ts:IsEnum|无集体撤销操作；revoke_reward仅调用个人revokeReward/readRevokeCommandReceipt|
|成功重放|writeReward在active/CAS/work之前读取授权后的严格回执，命中直接return replay.result|恢复首次结果，不重新撤销、不重新算成长目标或写快照；本轮仅源码确认|

这里 policy 的 collective_reward_revoke、回执的 collective_reward.revoke 和 CommandBus 枚举是三种不同命名空间。前两者存在不能推导第三者已实现。个人奖励ID与集体奖励ID可重复，禁止把集体数字ID交给个人revoke_reward“模拟”操作。

## 故障适用性与停止边界

|用户场景|当前可否按要求验证|原因/本批处理|
|---|---|---|
|提交后读取Run失败|无对应CommandBus调用点|直接领域入口事务完成即返回，无此后置Run查询；不伪造|
|保存CommandBus Success失败|不适用|没有该集体撤销命令记录写入；不新增命令|
|Processing持久化后重建应用|不适用|该领域HTTP入口不创建Processing；不手工造未支持操作|
|同ID同规范化payload重放|领域接口具备现有契约|可单独测试HTTP响应丢失/服务重建后的领域回执；不等同前三个窗口|
|同ID改变目标/原因409|领域digest包含recordId与trim后reason|源码支持；本批停止新测试，不报为本次实测|
|无回执不猜成功|普通Event不被read认定；已撤销记录无可验证回执时work拒绝|源码支持；不反向补回执|
|越权重放/查询|领域授权先于回执读取；CommandBus结果查询没有这项命令记录|领域历史/仪表盘权限与命令查询不是同一协议|
|不重复成长更新|receipt命中早于work/recalculateCurrentGoal|源码支持；需单独领域重放测试取得新的数据库证据|

## 现有测试证据（仅阅读，非本次执行）

- backend/test/student-reward.e2e-spec.ts:741起的故障矩阵包含collective-revoke，注入正式记录、成长目标、Event和Snapshot晚失败并核对回滚。
- 同文件863起验证一条班级事实、撤销清除presentation、正式目标归零、同ID重放、改原因冲突。
- backend/test/correction-operation-policy.e2e-spec.ts覆盖集体撤销的阶段、授权、CAS/回滚、终态成功重放等。
- 现有command-postcommit/reward-revoke-postcommit测试验证个人撤销，不是集体撤销；不能套用其测试计数宣称本批集体命令故障通过。

## Tests：本批执行情况

- 本批测试命令：**无**。
- 本批实际执行用例：0；通过0、失败0、跳过0。上面的“不适用/未执行”是场景评估，不是假造Jest skip结果。
- 未运行unit、E2E、build、typecheck、lint或浏览器。没有创建/连接测试或正式数据库，没有数据库前后差异实测；事务边界结论来自真实源码。
- 只使用只读Git/文件搜索检查入口及现有测试，不fetch/pull/merge，不启动服务。

## Changed

仅新增本报告。不修改业务源码、测试文件、schema、API、CommandBus、Operation Policy、前端、A1、authoring、DeviceSession或Online Policy。

报告写入前已记录HEAD、分支、index及全部tracked/非忽略untracked文件哈希，另记录现存顶层JSON证据哈希；交付前核对，确保旧工作和失败证据完整保留。没有暂存、commit、push、清理或覆盖恢复。

## Remaining

- 集体奖励撤销的HTTP响应丢失、领域回执跨应用重建的独立验证尚未新增；不能与不存在的CommandBus故障场景混为一谈。
- CommandBus集体撤销能力未实现，但本批不得将缺少该能力定性为已确认bug或顺手实现。
- 未验证断电、多进程、存储损坏或正式环境，既有浏览器及B联调延期不变。

## Next Batch（建议，本批不执行）

下个独立子项可限定为**现有领域HTTP入口的集体奖励撤销持久重放**：真实请求提交后丢弃客户端收到的结果，同ID重试并关闭/重建同一隔离库应用；核对首次结果、成长目标、Record/Event/Snapshot/Run version无重复变化，另测目标/原因冲突及权限。

只通过现有正式URL，不引入Processing/命令Success、不新增CommandBus操作；该任务属于领域回执重放验证，不宣称补齐本轮不适用的三个命令故障窗口。本批到此停止。
