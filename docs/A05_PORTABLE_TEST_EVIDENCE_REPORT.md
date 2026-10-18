# A-05 可携带测试证据与源码哈希归档

## Evidence：交付物与真实性边界

本批只新增本报告和 `docs/A05_SHA256_MANIFEST.json`。不执行测试、构建、业务脚本、数据库连接或服务重启，不修改既有文件，也不执行远程Git操作。所有测试计数均来自此前已保存结果，不是A-05重新通过。

交付是**可携带的证据索引与规范化摘要**，不是复制整个仓库或原始日志的发布包：
- JSON内包含每个被索引文件的真实SHA-256、相对路径、类型/用途、批次关联、是否本批新增、结果文件关联，以及43份Jest结果的脱载荷统计/测试文件清单。
- 原始源码、数据库、临时脚本、.env、原始请求/响应载荷及完整Jest failureMessages都不复制到交付物。
- ignored的.tmp原件仍留本机，仅登记路径和哈希；46份详细场景JSON是hash-only，不将“测试合成”当作自动证明无敏感数据。
- 审查者可脱离运行服务阅读摘要和边界；**若没有原文件，不能仅凭哈希重新验证原内容或重新执行测试**。有相同仓库/证据原件时可逐项复算。不要把本索引描述成包含全部原始证据的独立可执行包。
- 当前源码哈希是A-05采集的字节，不是历史运行时哈希。历史Jest文件未绑定当时完整source manifest，不能事后补造“当前源码已由每次历史结果精确证明”的关系。

## Workspace Inventory

- 项目：`D:\trae_project\new1\-ai-`。
- 分支：`feature/member-a`。
- HEAD：`09b99a81d909df6001aa0b204b3efca8eba3bba1`。
- 暂存区为空；index SHA-256：`C4DE028658171EDF148C5B629E5809B69F9575BFDFC7931C526A63978572ABF0`。
- 创建本批文件前：28个tracked修改、58个展开后的untracked文件，共86个dirty项；797个存在的tracked/非忽略untracked文件已采集保护哈希。
- 本批新增两个文件后，预期dirty共88项；不暂存、不提交。
- 远程配置此前仅读取为origin=https://github.com/1yu016/-ai-；本批未fetch，不确认GitHub是否有新提交。
- ignored的dist/node_modules/SQLite不纳入工作区文件清单，也未打开数据库；不声称正式运行环境已加载最新构建。
- 现有修改不是本批独占。完整归属沿用基线 `docs/MEMBER_A_0_5_4_DELIVERY_BASELINE.md` 并记录下列后继变化。

### 当前全部dirty项（本报告和清单创建前）

```text
 M backend/src/ai/classroom-command.service.ts
 M backend/src/ai/heuristic-assistant.service.ts
 M backend/src/classroom-engagement/classroom-engagement.service.ts
 M backend/src/classroom-participation/classroom-participation.service.ts
 M backend/src/classroom-runs/attendance.service.ts
 M backend/src/classroom-runs/classroom-command.service.ts
 M backend/src/classroom-runs/classroom-record.service.ts
 M backend/src/classroom-runs/classroom-run.controller.ts
 M backend/src/classroom-runs/classroom-run.module.ts
 M backend/src/classroom-runs/classroom-run.service.ts
 M backend/src/classroom-runs/classroom-snapshot.service.spec.ts
 M backend/src/classroom-runs/classroom-snapshot.service.ts
 M backend/src/classroom-runs/dto/classroom-run.dto.ts
 M backend/src/classroom-runs/screen-lifecycle.service.ts
 M backend/src/classroom-runs/student-reward.service.ts
 M backend/src/lesson-plans/dto/lesson-plan.dto.ts
 M backend/src/lesson-plans/lesson-plan-ai.service.ts
 M backend/test/artwork.e2e-spec.ts
 M backend/test/classroom-recovery.e2e-spec.ts
 M backend/test/classroom-run-legacy.e2e-spec.ts
 M backend/test/classroom-run.e2e-spec.ts
 M backend/test/screen-lifecycle.e2e-spec.ts
 M backend/test/student-reward.e2e-spec.ts
 M docs/images/classroom-console-composition/after-1366x768-ai-drawer.png
 M docs/images/classroom-console-composition/after-1366x768.png
 M docs/images/classroom-console-composition/after-1440x900-ai-drawer.png
 M docs/images/classroom-console-composition/after-1440x900.png
 M frontend/src/components/classroom/ClassroomPartnerPanel.vue
?? backend/_demo_admin.cjs
?? backend/_demo_check.cjs
?? backend/_demo_upload.cjs
?? backend/_e2e66_seed.cjs
?? backend/_tmp_list_teachers.cjs
?? backend/diag-device.cjs
?? backend/scripts/_tmp_ds_parity.cjs
?? backend/src/ai/heuristic-operation-policy.spec.ts
?? backend/src/classroom-runs/canonical-business-projection.ts
?? backend/src/classroom-runs/classroom-business-receipt.service.spec.ts
?? backend/src/classroom-runs/classroom-business-receipt.service.ts
?? backend/src/classroom-runs/classroom-operation-context.ts
?? backend/src/classroom-runs/classroom-operation-policy.spec.ts
?? backend/src/classroom-runs/classroom-operation-policy.ts
?? backend/src/classroom-runs/classroom-roll-call.service.ts
?? backend/src/classroom-runs/legacy-write-boundary.spec.ts
?? backend/src/classroom-runs/legacy-write-boundary.ts
?? backend/src/classroom-runs/presentation-ownership.spec.ts
?? backend/src/classroom-runs/presentation-ownership.ts
?? backend/src/lesson-plans/lesson-experience-ai.service.spec.ts
?? backend/src/lesson-plans/lesson-experience.contract.ts
?? backend/test/attendance-canonical.e2e-spec.ts
?? backend/test/batch-attendance-postcommit.e2e-spec.ts
?? backend/test/classroom-operation-policy.e2e-spec.ts
?? backend/test/collective-revoke-http-replay.e2e-spec.ts
?? backend/test/command-postcommit-fault.e2e-spec.ts
?? backend/test/correction-operation-policy.e2e-spec.ts
?? backend/test/group-rollcall-postcommit.e2e-spec.ts
?? backend/test/helpers/snapshot-fixture.ts
?? backend/test/helpers/teaching-phase-fixture.ts
?? backend/test/legacy-durable-replay.e2e-spec.ts
?? backend/test/legacy-write-inventory.e2e-spec.ts
?? backend/test/operation-entry-audit.e2e-spec.ts
?? backend/test/reward-revoke-postcommit.e2e-spec.ts
?? backend/test/roll-call-canonical.e2e-spec.ts
?? backend/verify-device-online.cjs
?? docs/A02_BATCH_ATTENDANCE_POSTCOMMIT_VERIFICATION.md
?? docs/A03_GROUP_ROLLCALL_POSTCOMMIT_VERIFICATION.md
?? docs/A04_COLLECTIVE_REVOKE_ENTRY_ASSESSMENT.md
?? docs/A1_EXPERIENCE_CANDIDATE_HANDOFF.md
?? docs/CANONICAL_ATTENDANCE_TRANSACTIONS_0_5_3C.md
?? docs/CANONICAL_REWARD_TRANSACTIONS_0_5_3B.md
?? docs/CANONICAL_ROLL_CALL_TRANSACTIONS_0_5_3D.md
?? docs/CLASSROOM_OPERATION_POLICY_0_5_4.md
?? docs/COLLECTIVE_REVOKE_HTTP_DURABLE_REPLAY_VERIFICATION.md
?? docs/COMMAND_BUS_POSTCOMMIT_FAULT_VERIFICATION.md
?? docs/COMMAND_BUS_POSTCOMMIT_RECOVERY.md
?? docs/CORE_RUN_SNAPSHOT_ATOMICITY_0_5_2.md
?? docs/CORRECTION_OPERATION_POLICY_0_5_4D.md
?? docs/LEGACY_BREAK_ATOMICITY_0_5_4C.md
?? docs/LEGACY_CANONICAL_ADAPTERS_0_5_3E_NEXT.md
?? docs/LEGACY_WRITE_BOUNDARY_0_5_3E_1.md
?? docs/LEGACY_WRITE_FINAL_AUDIT_0_5_3E.md
?? docs/MEMBER_A_0_5_4_DELIVERY_BASELINE.md
?? docs/MEMBER_B_OPERATION_POLICY_HANDOFF_0_5_4E.md
?? docs/OPERATION_POLICY_0_5_4E_AUDIT.md
?? docs/PRESENTATION_OWNERSHIP_0_5_1.md
?? docs/REWARD_REVOKE_POSTCOMMIT_INDEPENDENT_BATCH.md
```

### Ownership：跨批次与潜在冲突

|组|源码/测试归属|集成注意|
|---|---|---|
|A1|lesson-plan-ai、DTO、experience contract/spec、evidence服务上下文|最小provenance契约不等于authoring正式采纳已完成；不能连带修改authoring|
|Snapshot/Run/checkpoint|0.5-1、0.5-2、3E、4B及原生命周期共用|反馈所有权、required事务、投影保护、生命周期保留必须一起审查，不能整文件回退|
|CommandBus与receipt|3B/3C/3D delegate、提交后恢复、4B|transport hash、canonical digest、首次结果/当前状态分离，不能以相似方法替换|
|reward/attendance/rollcall服务|3B/3C/3D、3E内部投影、恢复只读入口、4B/4D|正式事实只有canonical表，重放早于首次执行守卫；当前哈希不代表单批作者归属|
|legacy engagement/participation/AI voice|3E封堵与无损adapter，4C旧课间事务|保持delegate/reject、历史读取和配置边界，不恢复旧双写|
|policy/context与测试|4A/4B，4D特殊纠正，4E入口核对|recovery/prepared和旧BreakRun是保留例外，不声称全部统一|
|后续专项|个人撤销、A-02批量考勤、A-03分组点名、集体HTTP撤销|都是新增验证证据；本轮归档不把测试问题当业务缺陷|
|frontend PartnerPanel和4张PNG|此前已存在，具体作者/批次未由当前Git证实|非本批后端成果，保留，不覆盖、不纳入源码打包|
|_demo/diag/seed等脚本|来源和使用条件未逐一确认|未运行、未复制、未自动清理，不当作可部署交付项|

## Hashes：机器清单

路径：`docs/A05_SHA256_MANIFEST.json`，schemaVersion=1。

|类型|实际存在且读取成功的文件数|
|---|---:|
|source_or_contract|87|
|test（含夹具、src单测）|47|
|历史implementation_report|22|
|test_build_configuration|5|
|historical_test_result|43|
|详细本地证据hash-only|46|
|本批新增归档报告|1|
|**SHA-256条目总数**|**251**|

清单不是上述原件的复制。每条记录都来自成功读取的现有文件；`resultFiles` 对测试项是保存JSON中的确切测试文件关联，对源文件/报告仅为批次或回归上下文关联，字段 `resultAssociation` 已明确，不能将上下文关联当作逐行覆盖或原始运行绑定。

自引用策略：先生成本报告、实际读取并计算SHA，再写manifest。因此本报告以addedInThisBatch=true和真实hash进入清单；manifest自身只在archiveOutputs中声明为新增，不伪造自哈希，不做循环引用。本报告不记录manifest哈希；审查者可对清单本身另外复算。

### 缺失引用（不产生hash条目）

当前已按旧报告明确引用路径核实，下列5个文件不存在：
- `backend/.tmp/a1-real-auxIHl/report.json`（A1真实模型成功报告的原引用）。
- `backend/.tmp/ownership-unit.json`。
- `backend/.tmp/ownership-e2e.json`。
- `backend/.tmp/atomicity-unit.json`。
- `backend/.tmp/atomicity-e2e.json`。

缺失不等于业务缺陷；旧报告中的A1 149/211、ownership154/212、atomicity156/232等仅保留“历史报告声明”，不补造hash、时间或重新通过记录。当前较晚全量结果含相关回归，但不能替代这些旧文件原件。

## Tests：本轮零执行、历史台账

A-05实际执行测试命令：**无**；测试用例执行数0，不将下面通过数写成本轮结果。也没有build/typecheck/lint。工作仅为只读Git/文件枚举、读取JSON统计、计算SHA和新增两个文件。

时间采用保存Jest JSON的startTime转为UTC，仅表示该文件记录的开始时刻，不以文件mtime伪装执行时间，不当作独立签名或可信时钟证明。详细场景证据没有独立可核实执行时间时标null。历史全E2E的标记依据原报告与命令记录，参数化重复次数不相加为独立业务场景。

|保存结果文件（backend/.tmp下）|Jest记录开始UTC|通过/失败/跳过|运行范围（全部为历史）|
|---|---|---|---|
| `3e-adapters-e2e.json` | 2026-10-16T05:46:12.491Z | 296/0/0 | 历史全E2E |
| `3e-adapters-unit.json` | 2026-10-16T05:44:32.410Z | 167/0/0 | 历史unit |
| `3e-final-e2e.json` | 2026-10-16T06:02:03.783Z | 299/0/0 | 历史全E2E |
| `3e-final-unit.json` | 2026-10-16T06:02:14.454Z | 167/0/0 | 历史unit |
| `4e-entry-target.json` | 2026-10-18T06:14:13.133Z | 8/0/0 | 历史定向E2E |
| `4e-full-e2e.json` | 2026-10-18T06:15:47.792Z | 350/0/0 | 历史全E2E |
| `4e-target.json` | 2026-10-18T06:15:03.105Z | 42/0/0 | 历史定向E2E |
| `4e-unit.json` | 2026-10-18T06:15:58.770Z | 559/0/0 | 历史unit |
| `a02-batch-attendance-receipt-unit.json` | 2026-10-18T08:53:54.805Z | 6/0/0 | 历史unit |
| `a02-batch-attendance-regression.json` | 2026-10-18T08:52:49.931Z | 36/0/0 | 历史定向E2E |
| `a02-batch-attendance-target.json` | 2026-10-18T08:52:02.577Z | 8/0/0 | 历史定向E2E |
| `a03-group-final.json` | 2026-10-18T09:01:29.952Z | 5/0/0 | 历史定向E2E |
| `a03-group-receipt-unit.json` | 2026-10-18T09:00:34.787Z | 6/0/0 | 历史unit |
| `a03-group-regression.json` | 2026-10-18T09:00:24.262Z | 35/0/0 | 历史定向E2E |
| `a03-group-target-v2.json` | 2026-10-18T08:59:39.275Z | 5/0/0 | 历史定向E2E |
| `a03-group-target.json` | 2026-10-18T08:59:07.673Z | 4/1/0 | 历史定向E2E |
| `collective-http-final.json` | 2026-10-18T09:35:15.038Z | 4/0/0 | 历史定向E2E |
| `collective-http-receipt-unit.json` | 2026-10-18T09:34:32.186Z | 6/0/0 | 历史unit |
| `collective-http-regression.json` | 2026-10-18T09:34:21.595Z | 56/0/0 | 历史定向E2E |
| `collective-http-target-v2.json` | 2026-10-18T09:33:55.735Z | 4/0/0 | 历史定向E2E |
| `collective-http-target.json` | 2026-10-18T09:29:49.197Z | 0/4/0 | 历史定向E2E |
| `command-postcommit-fault-results.json` | 2026-10-17T10:53:31.723Z | 6/9/0 | 历史定向E2E |
| `command-postcommit-full-e2e.json` | 2026-10-17T14:56:31.578Z | 319/0/0 | 历史全E2E |
| `command-postcommit-recovery-results.json` | 2026-10-17T14:54:11.407Z | 15/0/0 | 历史定向E2E |
| `command-postcommit-unit.json` | 2026-10-17T14:55:20.592Z | 167/0/0 | 历史unit |
| `command-postcommit-verification-results.json` | 2026-10-17T10:52:41.084Z | 161/9/0 | 历史定向E2E |
| `correction-final.json` | 2026-10-18T05:53:57.061Z | 8/0/0 | 历史定向E2E |
| `correction-full-e2e.json` | 2026-10-18T05:52:31.871Z | 342/0/0 | 历史全E2E |
| `correction-target.json` | 2026-10-18T05:52:59.561Z | 72/0/0 | 历史定向E2E |
| `correction-unit.json` | 2026-10-18T05:52:06.015Z | 559/0/0 | 历史unit |
| `legacy-break-full-e2e.json` | 2026-10-18T05:41:05.499Z | 334/0/0 | 历史全E2E |
| `legacy-break-target.json` | 2026-10-18T05:39:29.354Z | 53/0/0 | 历史定向E2E |
| `legacy-break-unit.json` | 2026-10-18T05:39:56.510Z | 516/0/0 | 历史unit |
| `operation-policy-first-e2e.json` | 2026-10-18T05:13:06.341Z | 123/196/0 | 历史全E2E |
| `operation-policy-fourth-e2e.json` | 2026-10-18T05:20:23.907Z | 129/0/0 | 历史定向E2E |
| `operation-policy-full-e2e.json` | 2026-10-18T05:27:38.282Z | 325/0/0 | 历史全E2E |
| `operation-policy-full-unit.json` | 2026-10-18T05:27:48.821Z | 516/0/0 | 历史unit |
| `operation-policy-second-e2e.json` | 2026-10-18T05:15:57.197Z | 211/108/0 | 历史全E2E |
| `operation-policy-targeted.json` | 2026-10-18T05:21:39.849Z | 6/0/0 | 历史定向E2E |
| `operation-policy-third-e2e.json` | 2026-10-18T05:18:50.097Z | 278/47/0 | 历史全E2E |
| `revoke-independent-regression.json` | 2026-10-18T06:39:00.667Z | 63/0/0 | 历史定向E2E |
| `revoke-independent-target.json` | 2026-10-18T06:38:32.654Z | 5/0/0 | 历史定向E2E |
| `revoke-independent-unit.json` | 2026-10-18T06:39:11.249Z | 559/0/0 | 历史unit |

### 七份早期失败记录及后继关系

|结果文件|通过/失败/跳过|后来修改的类别|原因/依据边界|
|---|---|---|---|
| `a03-group-target.json` | 4/1/0 | test_baseline | Test used pre-membership-change baseline after deliberately mutating membership |
| `collective-http-target.json` | 0/4/0 | test_entity_read | Test fed raw snake_case SQL row into entity-based strict parser; corrected entity read |
| `command-postcommit-fault-results.json` | 6/9/0 | business_implementation | Business result recovery gap verified in original run; later recovery implementation added |
| `command-postcommit-verification-results.json` | 161/9/0 | business_implementation | Original combined run exposing same post-commit recovery gap |
| `operation-policy-first-e2e.json` | 123/196/0 | test_fixture_per_report | Earlier fixture/OPENING/DTO incompatibilities per historical report; not re-reproduced in A-05 |
| `operation-policy-second-e2e.json` | 211/108/0 | test_fixture_per_report | Earlier fixture/OPENING/DTO incompatibilities per historical report; not re-reproduced in A-05 |
| `operation-policy-third-e2e.json` | 278/47/0 | test_fixture_per_report | Earlier fixture/OPENING/DTO incompatibilities per historical report; not re-reproduced in A-05 |

- 原postcommit9失败是真实业务恢复缺口，随后改动业务实现；当前恢复full报告中对应测试为20项，早期recovery-results仅15项，不能错配。
- policy前3轮失败原因按旧报告解释为夹具/OPENING/DTO准备，不在本轮重新复现；保留该归因的证据等级，不升级成新证实结论。
- 分组专项1失败修正的是测试主动变更成员后的比较基线；集体HTTP4失败修正的是测试将SQL原始行传给实体parse。未修改业务实现或放宽安全守卫。
- 旧CLASSROOM_OPERATION_POLICY_0_5_4报告称旧课间事务未收口，是4B历史时点；4C后来已收事务，但没有统一旧阶段语义或新增旧自动超时。
- 3E-1“旧语义均拒绝”是该时点；后续部分无损adapter已有delegate，不能拿旧报告声称当前仍全部拒绝。
- A-04曾按不存在集体CommandBus窗口停止；后续HTTP领域重放已专门验证，不代表新增了CommandBus能力。
- A-02/A-03后续任务名称与交付基线原A-02/A-03风险编号不是一一同义，清单用批次标签和文件名区分。

### 最近可用历史自动化基准

- 4E完整E2E：350通过，0失败/跳过；完整unit559通过。它们是后续专项新增前的基准，不是当前测试总数。
- 个人撤销：5专项、63定向、559 unit均为当时运行。
- 批量考勤：8专项、36定向、6回执单测。
- 分组点名：最终5专项、35定向、6回执单测；首轮失败仍在。
- 集体HTTP撤销：最终4专项、56定向、6回执单测；首轮失败仍在。
- 本批不合计这些结果为“当前全部通过”，不声称当前新增全部专项后跑过一次完整E2E。
- 此前build/typecheck/lint为报告和会话级历史证据，没有对应的独立Jest结果；本轮不生成伪造机器运行记录。

## 当前交付状态

|状态|当前结论|
|---|---|
|源码实现完成|A1候选、ownership、事务/canonical、legacy边界、恢复和阶段政策具备源码及历史自动化依据，仍有明确兼容例外|
|自动化测试通过|各保存报告能证实相应历史运行的通过；同时保留早期失败；不推断当前字节与全部历史运行完全相同|
|正式运行环境|未验收/未加载核验，不由本批启动或验证|
|3E及其他正式浏览器|延期，不标通过或生产封版|
|成员B接入|本轮未核验，交接项仍视为未完成验收，不能宣称已适配|
|断电/强杀/多进程|未验证；应用重建不等于断电|
|旧功能|无损delegate保持；不支持的旧随机/语音/规则/旧数字ID撤销仍明确reject，不描述为已恢复|

## Remaining

1. 历史缺失原件及执行时source binding不可事后补证；原始ignored证据未随两个索引文件携带。
2. B仍需验证播放器事件产生时冻结command+revision、旧异步回调隔离、refreshRequired完整刷新、allowedActions层级消费；仅文档和后端测试不证明前端完成。
3. 旧BreakRun阶段兼容、recovery/prepared特殊纠正、手机外层会话终态重试、资料/成长配置规则仍是已知边界。
4. A1经验最小来源契约不等于正式authoring版本已持久保存经验证据；本批不改authoring。
5. 无正式部署、多进程、真实网络断开或存储损坏证据，不发布生产封版结论。
6. manifest包含历史统计但不包含原始载荷；需要完全复核者仍需获得匹配的原件。原始载荷未经单独隐私审查不直接外传。

## Next Batch（仅一个建议，不执行）

优先做**后端剩余风险定界：成长目标配置写入的终态竞争**。先沿createGrowthGoal的队列前active检查与队列内写入追踪，建立隔离复现，明确是课堂执行配置还是允许课后维护；语义未定保持原安全边界，不顺手修改权限或其他模块。这个任务由A独立完成，不必等待B；不得把本次归档当作其实施授权。

## 本批新增文件与完整性

仅本报告和SHA清单。交付前对原797个非忽略工作文件、HEAD/index及89份现存顶层JSON证据重新核对；预期完全不变。本清单覆盖的是经选择的相关文件，不是完整工作区复制，不包含数据库/.env/临时脚本。核对只读，不执行任何Git写操作。

