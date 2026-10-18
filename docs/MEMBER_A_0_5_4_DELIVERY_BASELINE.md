# 0.5-4 后端交付基线报告

> 基线采集日：2026-10-18，Asia/Singapore（+08:00）。项目：D:\trae_project\new1\-ai-。
> 本批只读审计并新增本文件，不重新执行测试、构建、联网模型、服务或数据库操作。此前本会话与磁盘证据不等于本轮重新验收。
> 本文件不是 Git 提交、可部署发布包或正式验收签字；不自动开始下一阶段。

## Workspace Inventory

- 分支：`feature/member-a`。
- HEAD：`09b99a81d909df6001aa0b204b3efca8eba3bba1`。
- 当前本地跟踪引用：origin/feature/member-a；branch -vv 显示没有本地领先/落后提示，但未 fetch，**不能据此判断 GitHub 最新状态**。
- 远程配置：`https://github.com/1yu016/-ai-`；本轮仅读取配置。
- 暂存区：`git diff --cached --name-status` 无输出，未暂存任何改动。
- index 文件 SHA256：`C4DE028658171EDF148C5B629E5809B69F9575BFDFC7931C526A63978572ABF0`。
- 报告创建前：28 个 tracked 修改，48 个展开后的 untracked 文件，共 76 个。untracked helpers 目录按具体文件列出。
- 对 `git ls-files --cached --others --exclude-standard` 中实际存在的 787 个文件采集 SHA256，最后再次逐个比较；本轮只允许新增本报告，其余文件不得变化。
- 该集合不包含 ignored 产物：dist、node_modules、.tmp、数据库等。没有连接数据库或核对正式进程，不声称这些运行状态被验收。Jest证据另行只读摘要如下。
- git diff 显示部分文件 LF/CRLF 提示；未做自动格式化、换行转换或修正。
- 报告新增后 untracked 文件数应增加 1；本文件不可能包含自己的最终内容哈希，最终核对结果由交付消息报告。

### 完整 dirty 文件清单（创建报告前的状态与内容哈希）

状态符号来自 porcelain；所有 SHA 为当前文件内容，不是对应批次起点的内容。没有以 git checkout/reset/stash/clean 等方式操作。

|状态|文件（仓库相对路径）|SHA256|
|---|---|---|
| ` M` | `backend/src/ai/classroom-command.service.ts` | `C4CB9544FB04C5B3FA4F782AB74627CBB08CC25338557C19FE0BB479F7C021BC` |
| ` M` | `backend/src/ai/heuristic-assistant.service.ts` | `00A0F311C54BFF20EBBFFD95B1E30E39B823BC7FDD0277533443EA443E9E679E` |
| ` M` | `backend/src/classroom-engagement/classroom-engagement.service.ts` | `4C0B6915E58093E487D383CF636DBBE92DF22F8E6F5596D7919298DC65423580` |
| ` M` | `backend/src/classroom-participation/classroom-participation.service.ts` | `DC3A1F1BE186F5988EAD796F69D6AA0862F5342F91F6AE28DE680284FFB490D2` |
| ` M` | `backend/src/classroom-runs/attendance.service.ts` | `09E73F33B966701DEF635025A61144222674FB0695A061F87B7F450ED8C81A95` |
| ` M` | `backend/src/classroom-runs/classroom-command.service.ts` | `26394652A34D106463EB946BA7DF772A7DDEC3454A285D5E73BF1C0B2E69516C` |
| ` M` | `backend/src/classroom-runs/classroom-record.service.ts` | `8D9FD291F2BFBCFE98B12C40E85125F9D251D8B5659DADF76AEF74B318BBC327` |
| ` M` | `backend/src/classroom-runs/classroom-run.controller.ts` | `5C968CD95CB9E8B2E25939860D24A3361DA577737A2F9492CD648D12614909B5` |
| ` M` | `backend/src/classroom-runs/classroom-run.module.ts` | `0921E658F1EDE99F2AD4CA90E076DE989E74201F6E6EABBEED3B78E015B70AEA` |
| ` M` | `backend/src/classroom-runs/classroom-run.service.ts` | `88C9188C6BFEFA985A811AF04A2A7985EC63B32E4F9C74CD4C47737759B669EC` |
| ` M` | `backend/src/classroom-runs/classroom-snapshot.service.spec.ts` | `47B1DFC1F9EEFA73309E169AB733AC1C5822E0D6B4321917D488D3EA5BBEC93B` |
| ` M` | `backend/src/classroom-runs/classroom-snapshot.service.ts` | `13CCFF3A484716A735A9758FBDB05F482821F01C0BE62F586E26F52CDA0B7C66` |
| ` M` | `backend/src/classroom-runs/dto/classroom-run.dto.ts` | `4F71F0A8C83BBF9CF53611ED0EB749DC2A9E76323F535948FB44A2C65540A3CD` |
| ` M` | `backend/src/classroom-runs/screen-lifecycle.service.ts` | `ED62A5754DF5DDB73978AEEBEF918CECC03855CCF9F16FEA09CAA6AEFF09C77A` |
| ` M` | `backend/src/classroom-runs/student-reward.service.ts` | `A5628E31F73AA317756252B8D4D53A9EE65DFE13EFCACC6F96842B870E215441` |
| ` M` | `backend/src/lesson-plans/dto/lesson-plan.dto.ts` | `A97F21FBA3F56E2957CA80B5966FFC3944752338EEDACB8202340BE2F686EE31` |
| ` M` | `backend/src/lesson-plans/lesson-plan-ai.service.ts` | `5AD9B02AADBEEE8AC9CD6945B4558E13C652DC9C09D7E3D3A30A693239462C4A` |
| ` M` | `backend/test/artwork.e2e-spec.ts` | `FECA83F66642D9157C94AAD18C9941667C435A2DBEC13BACCA8957136C876EDA` |
| ` M` | `backend/test/classroom-recovery.e2e-spec.ts` | `65BE5637815FE0A5B3E1352047A5822A0D2BBA044B60DA834410B780C95ED908` |
| ` M` | `backend/test/classroom-run-legacy.e2e-spec.ts` | `E7A19C264A788D56C85A214E5DB39E9462BC48D9D429EBF489984A52E0F4D23D` |
| ` M` | `backend/test/classroom-run.e2e-spec.ts` | `7C3E765EA04D88C40020B49F1A28E8D965E3C071A5DDBF0E435AD4A2C1FE12A0` |
| ` M` | `backend/test/screen-lifecycle.e2e-spec.ts` | `CF9F4522385724BCE57A2B09B21CBB08F29DFC2FA6C2DCC34E8E4115AB8F3491` |
| ` M` | `backend/test/student-reward.e2e-spec.ts` | `6A8B168E3A3AB26F311C8FE0DC545A85FFCBE8E96CAED2E30FBA9B0E6D20F618` |
| ` M` | `docs/images/classroom-console-composition/after-1366x768-ai-drawer.png` | `42743CB5B10D99EB2024AE93453ADBD2FAA589B56C2876DFAEBD8F3512C83347` |
| ` M` | `docs/images/classroom-console-composition/after-1366x768.png` | `7C4F444F5D48E485AFB34AF873E1D437F8C1F2AB68ADBE3EC8F4F16E91AB1A20` |
| ` M` | `docs/images/classroom-console-composition/after-1440x900-ai-drawer.png` | `9179ACCDD3C7854D6CA1FC77001543F7E21C5BECB45EFDB9577B59C0EBDEB8B5` |
| ` M` | `docs/images/classroom-console-composition/after-1440x900.png` | `E4AC4EBB2A4ECE06552D76018190C7727EB889831952AA784EDEE98B8E3BB54F` |
| ` M` | `frontend/src/components/classroom/ClassroomPartnerPanel.vue` | `9E68AD494D9AE1D01C98A6EAD1899FEA3D26FB719C74ABC84AC39DDBA6CB82CE` |
| `??` | `backend/_demo_admin.cjs` | `F03F6E5A263D645B3B2B3BD7A8405016978187344B23653DDD0E1E92E2C6BBE4` |
| `??` | `backend/_demo_check.cjs` | `373AC03D1985050276B6398D3DD52836A8E98B2C2C4CCE9846E9BB6101D125F0` |
| `??` | `backend/_demo_upload.cjs` | `1533EF979FBCE321DCADD57B653DFD3229B724CB67C44CBC8EBF63C7F6887C09` |
| `??` | `backend/_e2e66_seed.cjs` | `53DF161BE6B758FA78F07B529DFA8131D3C36EB2138F63F09022443E5AD0A356` |
| `??` | `backend/_tmp_list_teachers.cjs` | `4282FD97549EA9876B6838F30A1CC7F6F291DC8AFA7CBAF874E8CED9DC722DBC` |
| `??` | `backend/diag-device.cjs` | `801251AED1E0F635F6613AA9215820772883F80E2E78972A5E11B3B7388AA4DB` |
| `??` | `backend/scripts/_tmp_ds_parity.cjs` | `BC51FDC54854107147A0B50D44C2CF764F57CB656F09C50608A2C1911B57EEB5` |
| `??` | `backend/src/ai/heuristic-operation-policy.spec.ts` | `31E36533A24A1B77D8F4E4F200F611D2B5104EEFBA4D26EECB4EB1436983FD4A` |
| `??` | `backend/src/classroom-runs/canonical-business-projection.ts` | `8CA648141FE9FD33EA36C32070F46BC9D92E1FE67DF9D28EA8E0E46063AB0F5F` |
| `??` | `backend/src/classroom-runs/classroom-business-receipt.service.spec.ts` | `57E46D47E5D6A53F27B1EB5B223DA5E83FA5ECA27B19E1A23AE4D21954340889` |
| `??` | `backend/src/classroom-runs/classroom-business-receipt.service.ts` | `472D520F162C090CF585F373746245EA36664589D0D186A3CCBEC8112C7E9FF9` |
| `??` | `backend/src/classroom-runs/classroom-operation-context.ts` | `FC17CCDB93F0EE013FA23EB9AF782A35863DE8580F57279AF7B9C3B53D78DF3A` |
| `??` | `backend/src/classroom-runs/classroom-operation-policy.spec.ts` | `278E5818FAA4996CCB1B3534E5D897EE014672CB075B88DD551422D0D6DCC66E` |
| `??` | `backend/src/classroom-runs/classroom-operation-policy.ts` | `72FD27E55EC4CCEC8FBA9EBA880C72E73CBBA8F2F0A0B4C73E7D80FB48F8FE49` |
| `??` | `backend/src/classroom-runs/classroom-roll-call.service.ts` | `0530CE333C6BFC7C83FAA9F4CB9E8DA61A7132FCF4282FBB910D5A8B9C755E92` |
| `??` | `backend/src/classroom-runs/legacy-write-boundary.spec.ts` | `B3D4695527FF568AEFD0F25DA8A9CE2D91CC2205A2625A3C8471C103B8227D61` |
| `??` | `backend/src/classroom-runs/legacy-write-boundary.ts` | `3ACADAEAE379B03A2B025ED63CEDAA410797BA55361DD0354AD51B871EC50F2D` |
| `??` | `backend/src/classroom-runs/presentation-ownership.spec.ts` | `A4FED9B620E2263D9B0FEB9968A8E5E91A6FC6F83B888B8B69C30CF02162D44B` |
| `??` | `backend/src/classroom-runs/presentation-ownership.ts` | `F343D91C6A0892FF895D3D9FCC273FE6F5D801DE6231A38056DE33B908F0EF2B` |
| `??` | `backend/src/lesson-plans/lesson-experience-ai.service.spec.ts` | `DB5F781FD5DAE570D3A83175F4F4C774D1BAC814B1D3834DD77AB0F5A4F97243` |
| `??` | `backend/src/lesson-plans/lesson-experience.contract.ts` | `C91580BA7A610E758BE24E5A7DC77A763461E0C823BB71456FA7D0C62F63DEDB` |
| `??` | `backend/test/attendance-canonical.e2e-spec.ts` | `A6D2221E7CC7D1DABAD7D20C36FFA131A01563977E84DBB3FFF01B7EAC90CCBB` |
| `??` | `backend/test/classroom-operation-policy.e2e-spec.ts` | `0FAE873908462C88A413B9C296A8E9D784D527665F9689234EA5D1F44B475B9C` |
| `??` | `backend/test/command-postcommit-fault.e2e-spec.ts` | `E4F0B1F5659E8330FBB42988C3A75BB4AAE75D7F6859788FC2E6B64246A74949` |
| `??` | `backend/test/correction-operation-policy.e2e-spec.ts` | `2A7A55BE4B26615C15E5C41FCB091A7B8DEE06F30BC842F88F28F28CDF4144C9` |
| `??` | `backend/test/helpers/snapshot-fixture.ts` | `F0AB1D9D88182061479EEE0E7DCC4EADB94A521AC68606B1C1B707747388BB0E` |
| `??` | `backend/test/helpers/teaching-phase-fixture.ts` | `621E15C46BD7CF064AE5EB63AFB86485278DDDDB379D0B906CF6D093AD51547A` |
| `??` | `backend/test/legacy-durable-replay.e2e-spec.ts` | `E39F67CC3A1D061BE40CAEB50E1A7B4BC2168D1C2170F06E7AB4CA2FDE7F5577` |
| `??` | `backend/test/legacy-write-inventory.e2e-spec.ts` | `CED83237FC3729956B8FEF92D4FA65B6ADB0FD3E5F3E4954953F0FA7FF0BAE50` |
| `??` | `backend/test/operation-entry-audit.e2e-spec.ts` | `D7CF4AF5AA8545DABECC561C66084AC9CE9A4F319947D3711637B32364DD6FEB` |
| `??` | `backend/test/roll-call-canonical.e2e-spec.ts` | `C054FF6F9288D3963FF29EFBAD0D3F3B8BAFDAE52046F78088091F7AB0F40AD0` |
| `??` | `backend/verify-device-online.cjs` | `B64196E4E05EEFFBC71064BC947FEC42D672AAB4C58C40C7CF0F8624AD6A3E64` |
| `??` | `docs/A1_EXPERIENCE_CANDIDATE_HANDOFF.md` | `0854E9CD0D57BD131FE4AE73B9584EF773D8909A20E582F5DD371EEC65E714A5` |
| `??` | `docs/CANONICAL_ATTENDANCE_TRANSACTIONS_0_5_3C.md` | `875B2C32E3134A23EC0B521F6AE52D80E9C478A5FE0F9807E3778EB7E8413867` |
| `??` | `docs/CANONICAL_REWARD_TRANSACTIONS_0_5_3B.md` | `288EEF7B43F10210961729C7BEB60D150A3F7D01AE6342980DE6E6DFECB6977D` |
| `??` | `docs/CANONICAL_ROLL_CALL_TRANSACTIONS_0_5_3D.md` | `AAEA59FD34572DDD9EA61F154972A8A93CD766147574901B86C4BAE5A604ED73` |
| `??` | `docs/CLASSROOM_OPERATION_POLICY_0_5_4.md` | `ED050A0AA096525E7FBC2D1CB0B7E4DF79BCFF60191C981293766620A210BA5C` |
| `??` | `docs/COMMAND_BUS_POSTCOMMIT_FAULT_VERIFICATION.md` | `AFC38EB0721A356E6F2E141CC7F582A36BCD362060B226AB150B72AF1A70397F` |
| `??` | `docs/COMMAND_BUS_POSTCOMMIT_RECOVERY.md` | `610461416788BC02E98C007E7C4788F83F9186D5AA39E4D6C4C6AAF6FA3BBD91` |
| `??` | `docs/CORE_RUN_SNAPSHOT_ATOMICITY_0_5_2.md` | `ED5F0268B65AF5273EBA3E85A318EB658D0613235D28A2043D1D5332ED691F5A` |
| `??` | `docs/CORRECTION_OPERATION_POLICY_0_5_4D.md` | `246290C92706FD6A94DF8CEC0A3E79B5956BB1EBFF768A15137D81BD3E227053` |
| `??` | `docs/LEGACY_BREAK_ATOMICITY_0_5_4C.md` | `0EA02AC1BD2425E4C550D6D25547C9589D6D8DA52BE47EA63EEEBE4103B78956` |
| `??` | `docs/LEGACY_CANONICAL_ADAPTERS_0_5_3E_NEXT.md` | `A8B5CB06E914C0D740B11FB0F3C7E56B333599EB4D5AE5A49225FE8074FEB0CB` |
| `??` | `docs/LEGACY_WRITE_BOUNDARY_0_5_3E_1.md` | `777FD35168EB5327AAEC2849009ABB8FFCFB0239EDBD0A20D79C950E86F5AEAB` |
| `??` | `docs/LEGACY_WRITE_FINAL_AUDIT_0_5_3E.md` | `14FF7EF968E895966AD46F9B346E164478A7BD7E2BB9DCB0F3926D2C26B37861` |
| `??` | `docs/MEMBER_B_OPERATION_POLICY_HANDOFF_0_5_4E.md` | `A09120A41E4FEF13446E061CB46A872B52E6F1D9B5735AD2A5891B81AB26590F` |
| `??` | `docs/OPERATION_POLICY_0_5_4E_AUDIT.md` | `071E911A1980738C3B1D8107885AF3101644FF28D0104B366560FE3929D03D08` |
| `??` | `docs/PRESENTATION_OWNERSHIP_0_5_1.md` | `B02419FB97F287F5E83D36E77F99BEA992E6F753C7853F8C75E51D5698856619` |

## Contract Matrix

下表“证实”表示本轮阅读真实源码/已保存测试数据，不表示重新执行了测试。

|契约|当前真实行为|源码/测试依据|边界及交接要求|
|---|---|---|---|
|派生阶段|Run.status + 有效 lifecycle + Snapshot/绑定/当日边界 + break 推导 phase；不新增 Run 状态|classroom-operation-policy.ts:operationPhase/decideOperation；classroom-operation-context.ts:readOperationContext|paused 优先 opening；旧 prepared 是 reserved，不是 READY|
|allowedActions|policyAllowedActions 对首次执行过滤；restore 返回 allowedActions，活动 screen-state 使用 classroomState.allowedActions；IDLE/READY/SUMMARY 在顶层|classroom-run.service.ts:restore/screenState/allowedActions；operation-entry-audit.e2e-spec.ts|阶段提示不是权限令牌；普通 get/命令简化响应不保证有 allowedActions|
|事务内执行|核心控制和 canonical 三领域在授权、receipt 后检查首次执行 phase，再 CAS/正式事实/Event/required Snapshot|Run changeStep/transition/writeCheckpoint；StudentRewardService.writeReward；AttendanceService.apply；ClassroomRollCallService.execute|不能只在 Controller/CommandBus 或前端拦截|
|成功重放|canonical 在领域事务中先授权再读严格持久回执，存在合法回执直接返回首次 result，早于终态/候选池检查|三服务上述方法；classroom-business-receipt.service.ts:parse/read/findCommitted/write|已结束的新请求仍拒绝；普通 Event/Processing 不能当业务成功|
|payload 冲突|稳定归一化 digest 覆盖 run/operation/业务参数；同 key 不同 digest 409；Attendance 排序；随机点名重放不重抽|BusinessReceiptService.digest；Attendance.normalize；RollCall.normalize；canonical E2E|transport hash 与 canonical digest 是不同层；不可声称任意修改 version/请求封装都仍能 CommandBus 重放|
|严格回执|kind=classroom_business_receipt、contractVersion=1、normalizationVersion=1、operation/eventType/operator/run/digest/record IDs 等校验；insert-only|classroom-business-receipt.service.ts:parse/write；对应 spec|Event 是回执/审计，不是第二套正式事实；不可改写首次结果|
|post-commit recovery|命令非 Success 时才尝试严格三领域回执对账；返回首次 result，classroomState=null，currentClassroomState 为普通 Run read，recovery.refreshRequired=true|classroom-command.service.ts:replay/recoverCommittedBusiness；command-postcommit-fault.e2e-spec.ts|不重跑 executeOperation、不补业务 Event/Snapshot；无可靠回执不猜成功；普通 Success 仍可能回放首次缓存状态|
|完整刷新|恢复信号位于 recovery.refreshRequired；获取 restore 或 screen-state/SSE 的完整状态，不能把 currentClassroomState 当完整 Snapshot|同上；Run.restore；classroom-mobile.service.ts:screenStream|SSE 复用同一 screenState；连接错误处理、浏览器状态覆盖尚需 B 验证|
|展示身份|新 presentationCommandId 的控制 patch 由服务端用提交 Run.version 分配 presentationRevision；后续同身份保留 revision|presentation-ownership.ts:applyPresentationControl；Snapshot.captureInternal|反馈导致 Run.version 变化不等于新 presentationRevision；resourceId 不能替代身份|
|普通反馈|HTTP checkpoint 只提取 observation 白名单，匹配事件所属 commandId+revision 才合并；陈旧/缺身份反馈可兼容成功但不合并|Run.checkpoint/writeCheckpoint；presentation-ownership.ts:mergePresentationObservation|事件产生/播放器绑定时冻结身份；不能发送前把旧回调重标成当前身份|
|控制与反馈分权|checkpointControl 仅内部 TS 调用；body checkpointType=command 不改变 public root；三领域 JSON 不能经普通 capture/checkpoint 注入|Run.checkpointControl；Snapshot.capture/captureBusinessRequired；legacy-write-inventory.e2e-spec.ts|best-effort observation 失败可保留 Run/Event，不承诺每次 observation 都有 Snapshot|
|required Snapshot|调用方同 EntityManager；transactionRequired 先进入队列再开事务；captureRequired(manager) 不重入队列|classroom-snapshot.service.ts:transactionRequired/captureRequired/captureBestEffort|事务内不等 AI/TTS/网络；单进程队列不等于多实例一致性保证|
|三领域事实|奖励 StudentRewardRecord/ClassCollectiveRewardRecord；考勤 StudentAttendanceRecord + Change审计；点名 ClassroomRollCallRecord；Snapshot由正式记录重建|canonical-business-projection.ts；三领域服务；3B/3C/3D E2E|禁止 previousSnapshot 累计、legacy双写或从 Snapshot 反向造事实|
|旧 adapter|单人/批量考勤、明确学生指定点名、可无损个人奖励 delegate；旧随机/范围/分组、旧ID撤销、规则/独立成长值等明确拒绝|participation setAttendance/batchAttendance/rollCall；engagement award/reverseReward；legacy-write-boundary.ts|名单/group CRUD、规则和徽章定义等配置保留；历史 source+recordType+recordId 不合并|
|特殊纠正|OPENING/TEACHING/PAUSED/课间可修已有考勤、撤销原个人/集体奖励；终态首次纠正拒绝|policy.decideOperation；Attendance allExisting；reward writeReward；correction-operation-policy.e2e-spec.ts|recovery/prepared 保留 existing_correction_guard，不广告但可能由原领域守卫允许；真正课后纠错未开放|
|旧课间|保留暂停 Run、保存并恢复原状态的 BreakRun 协议；4C同队列、CAS/Event/required Snapshot；不是直接 core break delegate|engagement startBreak/mutateBreak/captureBreakRequired；legacy E2E|旧 running/paused 准入未统一成 core start_break；旧计时没有自动超时结束能力|
|READY/OPENING/SUMMARY|独立 preparation，真实 Run 后 opening，complete原子 summary，仅合法 handoff 访问明确 run；不查询最近 completed 恢复|screen-preparation/screen-lifecycle/screen-handoff；Run.start/screenState/transition；screen-lifecycle E2E|状态不变；同标签复制/进程重启/单实例限制按既有约定，不为交付新增租约|
|旧语音|breakMode→Run.pause，return→resume，前后步骤→changeStep；reward/call reject；部分动作只返回 action/parameters|ai/classroom-command.service.ts:executeWhitelisted/voicePolicyOperation|识别/候选不代表正式执行；未扩展 token 持久消费能力|
|A1经验候选|referenceRunIds 服务端重建 evidence；safeFacts 入模型；结构/安全校验；生成后复核当前版本和 evidence；Draft/最小 provenance 输出|lesson-plan-ai.service.ts:generateCandidateDraft；lesson-experience.contract.ts；lesson-experience-ai.service.spec.ts|provenanceSources 契约已输出不等于 authoring 正式版本已存这些证据字段；无自动采纳/自动执行|
|稳定拒绝|CLASSROOM_OPERATION_FORBIDDEN；LEGACY_SEMANTICS_UNSUPPORTED；BUSINESS_PROJECTION_OWNERSHIP|operation-context、legacy-write-boundary、Snapshot/Run guards|不是所有409都有结构化 code；CAS/receipt冲突可能是 message；不要泛化统一错误格式|

### 核心响应字段交接

- CommandBus 首次成功：requestId/runId/operation/source/status/result/classroomState。普通 Success 可能按首次缓存返回；不要让旧 classroomState 倒灌更新版本。
- 恢复成功：以上字段加 `currentClassroomState` 与 `recovery: {source,contractVersion,committedRunVersion,refreshRequired}`；`classroomState=null`。当前 Run 读取不是首次响应原貌，也不是完整 restore。
- restore：currentStep、latestSnapshotVersion、attendanceState/rollCallState/rewardState、interactionState、playerRecoverySuggestion、timing、allowedActions、manualInterventionRequired。
- screen-state：page/phase/deviceId/classroomState；按阶段可能带 preparation/lifecycle/handoff/summary/顶层 allowedActions。
- 三领域身份：recordSource/recordType/recordId/recordIdentity/identity；历史 DTO 可能已有 source 原字段，不能仅以 source 或裸数字 ID 推断来源。
- 详尽 B 对接步骤复用 `docs/MEMBER_B_OPERATION_POLICY_HANDOFF_0_5_4E.md`，本批不修改该文件，不宣称前端已实施。

## Test Evidence

### 四类证据严格分开

1. **历史报告声明**：读取以前文档中的计数，可能与当前测试代码不同；下表列出。
2. **当前磁盘保存证据**：本轮解析 Jest JSON，记录通过/失败/跳过、SHA256与时间；不是本轮执行。
3. **当前工作区此前实际执行**：此前本会话 4C/4D/4E 工具输出与对应磁盘结果可相互核对；本轮不重新运行任何 test/build/typecheck/lint。最近 4E 的350 E2E、559 unit是此前执行结果，不能描述成此次重新通过。
4. **未执行验收**：3E正式浏览器、2C-1补充浏览器、A1/B联调、合并后的真实播放器行为/正式部署等保持延期。自动化不替代这些项目。

JSON不包含对应源码完整manifest或原始CLI全记录；当前文件哈希仅从本轮起冻结，不能反向证明每份旧JSON与当前源码字节完全对应。时间戳可变，SHA仅用于本轮存档比对，不当作不可伪造签名。

### 历史报告计数（非本轮运行）

|批次|报告来源|报告中的unit/E2E或定向结果|本轮核对说明|
|---|---|---|---|
|A1|A1_EXPERIENCE_CANDIDATE_HANDOFF.md|149 unit / 211 E2E；真实模型成功曾记录|所指a1-real-auxIHl/report.json当前不存在；不能重新证实真实模型成功产物|
|0.5-1|PRESENTATION_OWNERSHIP_0_5_1.md|154 unit / 212 E2E|ownership-unit/e2e.json当前不存在；仅保留报告和源码/测试证据|
|0.5-2|CORE_RUN_SNAPSHOT_ATOMICITY_0_5_2.md|156 unit / 232 E2E；20定向|atomicity-unit/e2e.json当前不存在；不补造旧证据|
|3B|CANONICAL_REWARD_TRANSACTIONS_0_5_3B.md|160 unit / 257 E2E；44 reward|当前最新全量报告有44 reward测试通过记录，不等同旧运行重放|
|3C|CANONICAL_ATTENDANCE_TRANSACTIONS_0_5_3C.md|161 unit / 272 E2E；14 attendance|当前最新全量报告有14 attendance记录|
|3D|CANONICAL_ROLL_CALL_TRANSACTIONS_0_5_3D.md|162 unit / 289 E2E；16 rollcall|当前最新全量报告有16 rollcall记录|
|3E-1|LEGACY_WRITE_BOUNDARY_0_5_3E_1.md|167 unit / 291 E2E；8边界场景|它“旧语义全部拒绝”的时点被后续无损adapter局部更新，不能当最终行为|
|3E adapter/审计|LEGACY_CANONICAL_ADAPTERS_0_5_3E_NEXT.md；LEGACY_WRITE_FINAL_AUDIT_0_5_3E.md|adapter保存296 E2E；最终167 unit / 299 E2E|对应3e-final JSON目前存在；浏览器仍未封版|
|提交后故障验证|COMMAND_BUS_POSTCOMMIT_FAULT_VERIFICATION.md|15项中6通过9失败；联合161通过9失败|真实红色证据仍在；报告“未实施修复”是当时结论，不是当前状态|
|提交后恢复|COMMAND_BUS_POSTCOMMIT_RECOVERY.md|167 unit / 319 E2E；20 recovery场景|早期recovery-results只有15，不能拿该文件声称20；后续full报告的同文件实际20通过|
|4A/4B|CLASSROOM_OPERATION_POLICY_0_5_4.md|516 unit / 325 E2E；纯policy345|当前4D后policy388；旧break事务未收口是此历史报告的时点描述，已被4C更新|
|4C|LEGACY_BREAK_ATOMICITY_0_5_4C.md及此前交付记录|516 unit / 334 E2E；新增9断言场景|legacy-break-target只53，后续full中legacy套54；不可混用总数|
|4D|CORRECTION_OPERATION_POLICY_0_5_4D.md及此前交付记录|559 unit / 342 E2E；纯policy388；定向72|现存correction系列JSON可核对；未执行正式环境|
|4E|OPERATION_POLICY_0_5_4E_AUDIT.md及此前交付记录|559 unit / 350 E2E；定向42；新增8入口场景|4e JSON存在，最近证据基准；本轮仅解析|

### 当前保存的全部顶层 Jest JSON 台账

文件目录均为 backend/.tmp；本轮扫描现有顶层JSON中具有 numTotalTests 的报告。并非递归穷尽所有任意格式日志；不会读取或导出含业务详情的原始故障载荷/Prompt。

|证据文件|文件时间（+08:00）|suite数|通过/失败/跳过|本轮SHA256|
|---|---|---:|---|---|
| `3e-adapters-e2e.json` | 2026-10-16T13:47:12.8756637+08:00 | 24 | 296/0/0 | `2D4E0E09CCA443D7A52E91119CAB41BC2B40790445A79830EA52F76560897195` |
| `3e-adapters-unit.json` | 2026-10-16T13:44:45.0226184+08:00 | 23 | 167/0/0 | `87CE2BB1D00D3C866D8B56767E6A1454D232D1F7D7B614CFB0EF34D777BAA5ED` |
| `3e-final-e2e.json` | 2026-10-16T14:03:13.0314558+08:00 | 26 | 299/0/0 | `C3F1660A1DF4BBC04AB7F853C18A240460C22E47FA28C5DB0A3CC5B3C7D76203` |
| `3e-final-unit.json` | 2026-10-16T14:02:27.2793125+08:00 | 23 | 167/0/0 | `90FAF8BA5A8AB94A0112CFE9E36B9359402D7610C2610BFEC0D08EA844CF06FA` |
| `4e-entry-target.json` | 2026-10-18T14:14:20.8751215+08:00 | 1 | 8/0/0 | `3EA54B7CAE820446C3BF8771185CD462D70873F3BF4FA33DEF16855B7B9F9D00` |
| `4e-full-e2e.json` | 2026-10-18T14:17:19.9766009+08:00 | 30 | 350/0/0 | `B43022EA777072304FCFCE47FA7D32828B61A891BC37E10C19896665E954C7BD` |
| `4e-target.json` | 2026-10-18T14:15:40.3869994+08:00 | 4 | 42/0/0 | `36DD331619657925AFF0B71B31F53F27424D3480116816A82D540FBAB6871357` |
| `4e-unit.json` | 2026-10-18T14:16:10.4623238+08:00 | 25 | 559/0/0 | `9ED60418F669CFCC63F4B6841DE29CD2DEE93E3FB78EAB96B8D26130961CFC00` |
| `command-postcommit-fault-results.json` | 2026-10-17T18:53:47.7742769+08:00 | 1 | 6/9/0 | `1C8C8B96FAA14A7DC2D3DE1C4F1F89B151C73654F6EAD1A2C24107E33B6DFCA4` |
| `command-postcommit-full-e2e.json` | 2026-10-17T22:57:35.9933346+08:00 | 27 | 319/0/0 | `67040F067ADD65949391922EB24F4108F4DFBAECDB13AC09BC61DF5BBA7026FB` |
| `command-postcommit-recovery-results.json` | 2026-10-17T22:54:27.6781365+08:00 | 1 | 15/0/0 | `6D09DA90F675280A53AEC3AB5D4C2F303462BA9F100367ADA5F263D71755BA88` |
| `command-postcommit-unit.json` | 2026-10-17T22:55:31.4447312+08:00 | 23 | 167/0/0 | `F54B7AB2E2B7582791B756F2629F04C37FDC50DC49DFACA8237E8DCA10836BD5` |
| `command-postcommit-verification-results.json` | 2026-10-17T18:53:18.7918706+08:00 | 7 | 161/9/0 | `F29974777A2191D7746EE3892C6BCF11F0F91190DBD9CEA09F4612F8C3AACD05` |
| `correction-final.json` | 2026-10-18T13:54:04.1873766+08:00 | 1 | 8/0/0 | `98CB35BFA21043F5736BEF599AC8F75C8BF35AFAB73004E1A2983321F9128238` |
| `correction-full-e2e.json` | 2026-10-18T13:53:47.0156185+08:00 | 29 | 342/0/0 | `E78DF5D832FA886B63B0A1A017878169D0EE40BBE51F5A94A1EFB236C12E39AC` |
| `correction-target.json` | 2026-10-18T13:53:16.8318037+08:00 | 4 | 72/0/0 | `6DFCFEE4306C2831EDFB033E79EC7BB3BE01A45ACEDB6A222D476892E3EE2059` |
| `correction-unit.json` | 2026-10-18T13:52:15.8300622+08:00 | 25 | 559/0/0 | `38D34556E7CC8C7B588A3F384D7B841F5955F846159A499D17E7676E1788A6A4` |
| `legacy-break-full-e2e.json` | 2026-10-18T13:42:14.7553940+08:00 | 28 | 334/0/0 | `B89F328B06F03DCE0A043457751A0CE6A49D4B0ABAD5FFF1EFBA1E8E7FD66FFE` |
| `legacy-break-target.json` | 2026-10-18T13:39:38.9793892+08:00 | 1 | 53/0/0 | `4A060D8F487AFE60D6E1D5CBDF783537BC9A03D96C4D634E423AEE6788DBC970` |
| `legacy-break-unit.json` | 2026-10-18T13:40:06.1293471+08:00 | 25 | 516/0/0 | `41ADF6B4E03B71BF2E4DE4D9383E745E0E37E685A0A5086DFFEF073827280774` |
| `operation-policy-first-e2e.json` | 2026-10-18T13:14:33.5209492+08:00 | 27 | 123/196/0 | `AF61C823F27FC94448487EAC5C70CC95B22C869A06E03F8EC04675B724221F12` |
| `operation-policy-fourth-e2e.json` | 2026-10-18T13:20:43.8536009+08:00 | 4 | 129/0/0 | `E5446EE60DF528E980B8E777E8D297A86460CB3C899FC0993105E253D6801689` |
| `operation-policy-full-e2e.json` | 2026-10-18T13:28:45.4461406+08:00 | 28 | 325/0/0 | `4542501C58572D5883D439737EA49B24D98A995C1D39DB2ADEE70D3771E387A6` |
| `operation-policy-full-unit.json` | 2026-10-18T13:27:58.2412776+08:00 | 25 | 516/0/0 | `A61F7E0C6669681A6C10D7343ED2C583BAC592FBC5719B6BC37B25573E90F11D` |
| `operation-policy-second-e2e.json` | 2026-10-18T13:16:50.8368449+08:00 | 27 | 211/108/0 | `AE42B6D7FABD723DC61D46A180A48FEE4FA70781F2299A87EA643B82ABFFC000` |
| `operation-policy-targeted.json` | 2026-10-18T13:21:46.2643356+08:00 | 1 | 6/0/0 | `7877EC5C3D879C6912ECE58D7CD76506C9344EA905AC2E441F5517E7CEDD72EB` |
| `operation-policy-third-e2e.json` | 2026-10-18T13:19:55.5911949+08:00 | 28 | 278/47/0 | `DB4958284E7951571898C2DCC5F57E538219731917FE064CC90CCB76AD288A9E` |

保留所有失败证据：postcommit早期9失败、policy前3轮196/108/47失败都不能删除或改称通过。历史报告将policy早期失败解释为夹具/DTO/开场准备问题；本轮不重新复现这些旧运行，也不将其解释升级为新证实的根因。

### 最近4E证据的范围核对

- full E2E：30 suites、350通过、0失败/跳过。其中文件分布包括：Run76、legacy54、reward44、attendance14、rollcall16、postcommit20、policy6、correction8、entry-audit8、durable legacy replay1、legacy inventory2、screen lifecycle10；另有A1/教案、资源、鉴权、设备等测试。
- unit：25 suites、559通过、0失败/跳过。不是559种业务场景；包含参数化policy组合，不以数字代替回滚证据。
- .tmp与dist被gitignore；仅交付源码/本报告不会自动携带测试产物。应在后续获准交付证据时单独归档，不本轮擅自复制/提交。
- 本轮没有持续集成远程状态证据，没有源码快照到JSON的旧manifest，没有正式运行构建加载证据。

### 已发生的运行命令与本轮状态

以下是**此前4E执行记录**（由当前会话工具输出及脚本定义对照），不是此次执行命令：

```text
cwd: D:\trae_project\new1\-ai-\backend
专项:
npm run test:e2e -- --runInBand --silent --testPathPatterns='operation-entry-audit|classroom-operation-policy|correction-operation-policy|command-postcommit-fault' --json --outputFile=.tmp/4e-target.json
完整E2E:
npm run test:e2e -- --runInBand --silent --json --outputFile=.tmp/4e-full-e2e.json
完整unit:
npm test -- --runInBand --silent --json --outputFile=.tmp/4e-unit.json
静态/构建:
npm run type-check
npm run lint
npm run build
```

此前全E2E进程明确DATABASE_PATH=:memory:、DB_SYNCHRONIZE=true（仅隔离空库建表）、DB_MIGRATIONS_RUN=false及虚拟模型key；单独文件库测试由测试helper创建临时合成库。既有migration用例也只在隔离库测试，不能据此说正式库迁移执行过。本轮没有运行这些命令，没有创建/修改任何数据库、加载.env或发出模型调用。build/typecheck/lint此前工具退出0，lint为原Snapshot spread警告；Jest JSON不为这三项提供独立机器日志，标为会话记录级证据。

## Ownership

### 实际功能归属（不是提交作者鉴定）

未提交diff无法精确按作者/批次拆分每一行；下列归属根据源码职责、各批次文件范围和报告交叉核对。没有批次起点补丁或提交时，不猜独占归属，不自动拆分/回退。

|文件/组|关联批次与职责|交付/冲突注意|
|---|---|---|
|lesson-plan-ai.service.ts、dto/lesson-plan.dto.ts；新lesson-experience.contract.ts/spec|A1；承接既有2A/2B AI Draft字段|AI草稿/证据契约，不能连同authoring重写；正式版本经验provenance尚需独立接入|
|presentation-ownership.ts/spec；Snapshot与checkpoint DTO|0.5-1|反馈身份需B适配；Snapshot同文件还有2/3E/lifecycle，不能仅取本批文件覆盖|
|classroom-snapshot.service.ts/spec|0.5-1、0.5-2、3E及生命周期保护共同作用|control/observation、screenLifecycle保护、业务投影所有权、队列事务必须一起保留|
|classroom-run.service.ts|0.5-1、0.5-2、3E封堵、4B/4E核对；既有READY/OPENING/SUMMARY|最高冲突风险：checkpoint、transition、restore、screenState在同文件；不可按整文件归属单一批次|
|classroom-command.service.ts|3B/3C/3D delegate、postcommit恢复、4B及既有展示队列|映射、requestHash、receipt恢复和展示控制共同依赖；不能用旧版本整文件替换|
|student-reward.service.ts|3B、3E内部投影、postcommit只读入口、4B/4D|个人/集体回执、成长目标重建、撤销、事务政策共用writeReward|
|attendance.service.ts|3C、3E、postcommit、4B/4D|apply内allExisting/digest/receipt/CAS/phase必须整体审查|
|新classroom-roll-call.service.ts|3D、3E、postcommit、4B|算法/候选池/严格重放一体；不要因untracked把它当临时脚本|
|新classroom-business-receipt.service.ts/spec|3B/3C/3D、postcommit|共享严格契约，ordinary Event不可误判；parse字段扩展需全域复核|
|新canonical-business-projection.ts|3E内部投影封堵和三领域复用|业务正式记录→Snapshot，不反向造事实|
|新legacy-write-boundary.ts/spec|3E-1/adapter/最终审计|拒绝码与source身份共用；不能恢复旧双写|
|classroom-participation.service.ts|3E拒绝/无损考勤/指定点名adapter；原group配置|不要因“旧模块”删除分组/历史GET|
|classroom-engagement.service.ts|3E拒绝/无损奖励adapter、4C旧课间事务|旧reward/reverse与break在同文件，不能整文件回退到4C前|
|ai/classroom-command.service.ts|3E Snapshot-only封堵、4B旧语音政策|保留识别/候选协议；非执行action不能当canonical命令|
|ai/heuristic-assistant.service.ts；新heuristic-operation-policy.spec.ts|4B独立TTS前后政策检查/测试|外部TTS不进事务，回写前再检查；不属于A1备课|
|classroom-record.service.ts|3C正式考勤读取，相关记录聚合|不能回退到legacy attendance表当当前事实|
|classroom-run.controller.ts/module.ts；dto/classroom-run.dto.ts|0.5-1、3B/3C/3D、3E/4B依赖注入与公开入口|controller不是唯一守卫；module metadata漏掉canonical实体会破坏测试/运行|
|screen-lifecycle.service.ts|0.5-2同事务生命周期；4B opening完成政策|不是重新设计生命周期；server-only写入仍保留|
|test/classroom-run.e2e-spec.ts、classroom-run-legacy.e2e-spec.ts|2/3B/3C/3D/3E/4B/4C多批共用|fixture、Snapshot版本和Event数量都曾调整；不能按最后编辑者归为4C独占|
|test/student-reward.e2e-spec.ts|3B故障矩阵、后续夹具/政策回归|真实SQLite晚失败回滚断言是重要证据，不降低断言迁就旧入口|
|test/classroom-recovery/artwork/screen-lifecycle.e2e-spec.ts|既有生命周期、隔离summary配置及4B夹具调整|是回归支持变化，非新增产品功能；与B浏览器断言另分|
|新attendance-canonical/roll-call-canonical.e2e|3C/3D|正式事实、持久重放、资格及事务故障|
|新legacy-write-inventory/legacy-durable-replay.e2e|3E最终审计|静态入口清单不是代替HTTP，durable测试另证重开库只读重放|
|新command-postcommit-fault.e2e|故障验证→恢复回归|目前20项矩阵；旧JSON15项属于历史版本，不替换|
|新helpers/snapshot-fixture.ts、teaching-phase-fixture.ts|3E构造旧Snapshot；4B以后真实进入教学夹具|仅test，不进入生产；新测试不得mock掉政策|
|新classroom-operation-policy/context/spec；classroom-operation-policy.e2e|4A/4B与4D继续扩展|共享phase非新状态机；4D对原4A的345计数和未定纠正规则有后继更新|
|新correction-operation-policy.e2e|4D|原课中纠正与课后重放分离|
|新operation-entry-audit.e2e|4E|只验证，没有业务实现改动|
|docs各A1/0.5/3B～4E报告|阶段证据和契约|保留历史时点；由本基线解释后继关系，不改写旧报告抹掉失败|
|frontend/ClassroomPartnerPanel.vue与4张PNG|不属于本轮后端交付；在此前即已dirty|具体成员/批次无法从当前diff证实，保留待B确认；不覆盖、不自动纳入A后端归属|
|backend/_demo_*.cjs、_e2e66_seed.cjs、_tmp_list_teachers.cjs、diag-device.cjs、scripts/_tmp_ds_parity.cjs、verify-device-online.cjs|临时/诊断文件，来源和安全使用条件未逐一确认|未执行脚本，不认为它们可随包运行或可删除；具体清单见Inventory|

### 冲突与交接规则建议（仅建议，不执行Git操作）

1. 优先保护共享事务根：Run/Snapshot/CommandBus/canonical服务/receipt/module；后续合并按方法及冻结契约审查，不用整文件覆盖。
2. 区分业务实现、测试夹具、历史报告、前端/截图和临时脚本；不能把所有dirty改动一键当“4E代码”。
3. 配套测试与实现一起评估；新增untracked核心服务遗漏交付将使tracked模块不可运行。
4. 保留早期红色证据及其后继修复记录；文档不同版本数字不做简单求和。
5. 等获准集成再制定分支/提交/证据归档动作；本批不fetch、pull、merge、stash、暂存或提交。

## Remaining Risks

优先级是建议顺序，不等于已获准实施。类别A可由A独立做，B需前端配合，C需隔离验证，D保留限制/产品决定；一项可跨类。

|ID / 类别|证据|影响与依赖|建议顺序|
|---|---|---|---|
|A-01/A+C：补齐缺失故障组合|postcommit当前domains只reward/reward-name/attendance/rollcall × 5；原恢复报告明确撤销/批量/分组未单独全矩阵|不能宣称所有撤销/集体/批量/分组postcommit时序都实测；可复用独立库，不依赖B|P1，优先的独立后端验证批次|
|A-02/A：证据可携带性|.tmp被忽略；A1/ownership/atomicity指定原JSON已缺失；旧JSON无源码manifest|交付源码不等于交付可复核证据；需获准后独立归档/新测试manifest，不伪造旧结果|P1，集成准备前|
|A-03/A+D：配置写入竞争窗口|StudentRewardService.createGrowthGoal在队列前assertActive，事务内未复核Run|只写配置而非三领域事实；若应受终态保护需先界定配置语义，不顺手禁用课后维护|P2，定向设计后再改|
|B-01/B：反馈身份与旧异步回调|presentation-ownership双身份校验，B交接已有说明|播放器事件产生时冻结身份；不能发送前重标当前；前端是否已做本轮未核验|P1，A/B合并后浏览器|
|B-02/B：刷新/缓存状态覆盖|CommandBus.replay普通Success缓存；恢复result与currentClassroomState分离|前端需消费recovery.refreshRequired、完整restore、避免重播效果/倒灌旧状态|P1，合并联调|
|B-03/B：能力入口映射|screen-state活动课堂nested、无Run顶层；recovery/prepared有例外|前端缺字段不得默认放行；不能建立第二套状态机；是否已消费未证实|P1，合并联调|
|C-01/B+C：3E正式浏览器|用户明确延期；独立合成课堂曾有数字人角色权限阻塞|未通过也未封版；需隔离身份/角色/资源齐全后执行，不修改真实课堂|P1，正式A1/B联调前补齐|
|C-02/B+C：2C-1浏览器/A1联调|A1交接Acceptance status明确2C-1浏览器延期|后端证据包/候选自动化不替代教师浏览器流程|P1，联调进入条件|
|C-03/C：正式构建加载|本轮不检查进程/DB；dist ignored，本会话此前仅本地build|不能声称正式后端加载了最新源码；需要另获准安全运行环境批次|部署前，不本轮执行|
|C-04/C+D：真实中断/多进程|postcommit重建应用非OS断电；Snapshot队列单进程|断电/强杀/多实例/存储损坏承诺未验证；需隔离故障和部署边界|P2，部署模型确定后|
|D-01/D：recovery/reserved特殊纠正|policy existing_correction_guard，context保留领域守卫|allowedActions不广告但原接口可能允许；保留安全兼容，不擅扩或收紧|产品规则先定，后续独立批|
|D-02/D：旧课间语义|engagement BreakRun暂停Run，核心break保持running；无旧自动超时|4C只收事务，不能假称统一阶段/自动超时；旧client依赖未知|单独兼容决策，不阻塞现有后端验证|
|D-03/B+C+D：手机重放外层|mobile.requireSession终态撤销会话/online先于CommandBus|核心终态只读重放不覆盖失效手机会话；不要绕鉴权“修复重试”|先定安全查询协议，再隔离/联调|
|D-04/D：旧语音与legacy拒绝|voice reward/call等稳定409；Play部分只返回action参数|不能声称旧语音已完整canonical执行；不新建token schema或猜字段映射|另行批准，不扩大本阶段|
|D-05/A+B+D：经验正式provenance|A1返回最小来源契约，authoring尚未扩展经验证据持久关联|未来采纳必须服务端冻结证据来源，不长期仅draftId；本轮不改authoring|后续AI采纳整合独立批|
|D-06/A+D：资料生命周期|StudentQuestion.requireRun为班级权限；Artwork/AI候选等有独立记录流程|不能把资料创建/编辑等同课堂执行，是否课后可写需产品明确，未断言为已证实越权漏洞|按数据边界独立评审|

## Next Batch

建议下一批仅由A独立完成 **CommandBus post-commit recovery扩展故障矩阵**，本轮不执行：

- 范围：个人奖励撤销、集体奖励/撤销、批量考勤、正式分组点名的已提交后读取Run失败/保存Success失败/重建应用后三类窗口；先核对哪些组合已有证据，避免机械堆测试。
- 只复用现有service与隔离数据库；无新schema、前端、A1、authoring、设备或生命周期变化。首次阶段合法，业务提交后才注入故障。
- 通过标准：授权+digest合法返回首次结果，不重执行业务、不增加事实/Event/Snapshot、不改变首次回执；不同payload/越权拒绝；无严格回执不推断成功；记录Run version和全部关键表摘要。
- 如发现新实现缺口，先提交证据/最小影响范围，不借验证批次大改CommandBus或扩大旧语义。
- 后续另一独立批可整理可携带证据manifest与合并文件归属；B浏览器/正式环境继续留到获准集成阶段。
- 不自动开始任何上述工作；等待用户后续批次安排。

## 基线完整性结论

创建本报告前采集的 787 个存在的tracked/nonignored untracked文件、HEAD及index将于交付前重新比较。预期仅新增本报告；没有删除、清理、覆盖、暂存、提交、推送、fetch/pull/merge，也没有运行测试/服务/数据库。本轮未对ignored运行产物做完整性承诺。最终工具核对结果见交付消息。

