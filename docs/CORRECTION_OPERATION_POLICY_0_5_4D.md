# 0.5-4D 特殊纠正操作阶段政策

## 依据与范围

原 canonical AttendanceService.apply 将全部已有 AttendanceRecord 的请求识别为纠正；StudentRewardService 对个人/集体撤销定位原正式记录。原逻辑已允许非终态纠正，且 durable receipt 在终态检查之前重放。原 policy 对 correction 返回 product_semantics_unresolved，而 assertRunOperation 显式跳过，所以此前并未禁止 opening/paused 纠正。本批将已有权利显式化，不新增课后纠错能力。

## 矩阵（首次执行）

|阶段|已有考勤纠正|个人奖励撤销|集体奖励撤销|
|---|---|---|---|
|IDLE/READY|禁止|禁止|禁止|
|OPENING|允许，仍受领域守卫|允许，定位原记录|允许，定位原记录|
|TEACHING|允许|允许|允许|
|PAUSED|允许|允许|允许|
|课间叠加层|保留上述纠正能力|保留上述纠正能力|保留上述纠正能力|
|SUMMARY/completed/cancelled/failed|首次执行禁止|首次执行禁止|首次执行禁止|
|recovery/旧 prepared|保留原领域安全守卫，不宣称统一政策已解决|同左|同左|

成功重放不属于首次执行：必须先授权并校验持久回执和 digest，然后只读返回首次结果；不增加 Run version、Event、Snapshot 或正式事实。同 ID 不同 payload 仍然 409。真正课后首次纠错没有批准，也未新增 URL 或开关。

纠正不能创建新学生考勤：单人或批量只要含任意未登记对象，整体仍按 attendance_new；不能借 opening/paused 纠正权限写新事实。撤销不能发奖，不重建旧流水，不通过旧数字 ID 猜测 canonical 记录。

## 实际接入

- shared policy 明确 attendance_correction、reward_revoke、collective_reward_revoke。
- StudentRewardService.writeReward 在原事务中区分个人/集体撤销；其余 Run/授权/CAS/幂等/正式投影/required Snapshot 不变。
- AttendanceService.apply 已在事务中根据正式记录分类并调用 shared policy，复用不重复实现。
- HTTP revoke、CommandBus revoke/attendance、participation attendance adapter 继续 delegate 到上述服务。CommandBus post-commit recovery 不改。
- engagement 旧数字 ID 撤销、旧 AI/语音及其他不支持语义保持原 409，不扩大 legacy 支持范围。
- allowedActions 只反映阶段层能力，不代表指定 record/student、版本或权限校验已经通过；新增 collective_reward_revoke 名称供后续 B 对接。recovery/prepared 不广告这些未明确能力。

## 测试证据

纯 policy 参数化测试先执行。新增 correction-operation-policy.e2e-spec.ts 使用每个场景独立临时 SQLite 文件（非正式数据库），覆盖 opening/teaching/paused/break/summary/completed/cancelled/failed。

对允许阶段三类操作分别验证：越权拒绝、CAS 返回 affected=0 无写入、真实 receipt Event insert 后异常完整回滚、真实 required Snapshot 保存后异常完整回滚、成功重试不重复写、改变 payload 409；比较正式表、Event、Snapshot、Run、成长目标及 legacy 表全行内容和 SHA256。

验证课堂在请求排队期间结束，事务内重新读取后拒绝；终态成功回执仍可重放且其他教师不能读取；HTTP revoke/collective revoke、participation attendance 与 direct canonical 重放一致；CommandBus 考勤纠正及重放不重复产生事实。每个 SQLite 检查 integrity_check 和 foreign_key_check 后关闭并移除该测试文件。

既有 reward/attendance 故障注入、事务、生命周期、3E、A1、CommandBus recovery 回归本次重新执行；准确数量见交付报告及 backend/.tmp/correction-*.json，不把历史结果计入本次结果。

## 未解决与下一批边界

recovery/旧 prepared 的特殊纠正规则保持原守卫，未擅自统一；真正课后首次纠错保持拒绝。正式浏览器验收、B 联调仍延期。

建议 0.5-4E 只做政策入口覆盖核对与交接封版：核对可达写入口、allowedActions、refreshRequired、播放器 command/revision 契约，补充实际缺失的后端回归并形成 B 对接清单。没有明确证据不扩展 schema、生命周期、手机、语音或 AI 功能；产品语义未定项继续单列。本批不执行 4E。

无数据库结构、前端、A1、authoring、DeviceSession、Online Policy 变更；不重启正式服务、不操作正式数据库、不 commit/push。
