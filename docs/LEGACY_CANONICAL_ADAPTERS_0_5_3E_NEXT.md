# 0.5-3E 下一小批：无损子集适配（不代表 3E 全部完成）

## 实现范围

保留现有 dirty worktree 和 3E-1 封堵；不新增表/字段，不执行迁移，不修改前端、
canonical 三服务、Snapshot、CommandBus、A1、课堂生命周期、DeviceSession 或 Online Policy。
不进入 0.5-4，不重启正式服务，不 commit/push。

本批只修改两个 legacy 服务、一个隔离 E2E 测试文件及本说明。

## Adapter Matrix

| 旧入口 | 本批行为 | 唯一新事实/事务入口 |
|---|---|---|
| participation 单人考勤 | 传递学生、状态、备注、原 requestId，mode=single/source=manual | AttendanceService.apply |
| participation 批量考勤 | 不去重/覆盖学生；全批交给正式校验，mode=batch/source=batch | AttendanceService.apply |
| participation 指定点名 | 只接受 teacher_specified + 明确学生 ID，无额外范围/group 字段；传递 cooldownCount | ClassroomRollCallService.execute(specified) |
| participation all/range/group 随机点名 | 409 LEGACY_SEMANTICS_UNSUPPORTED | 不调用写服务 |
| engagement 直接个人奖励 | 明确类别；0–20 积分、0–5 花数至少一项非零；原因最多200字；不折算 | StudentRewardService.createReward |
| engagement ruleId/badgeDefinitionId/独立成长值 | 409；不展开规则、不猜 badgeCode、不把成长当积分 | 无写入 |
| engagement 旧数字 ID 撤销 | 409；需使用正式、明确来源的 canonical 撤销入口 | 旧 ID 不自动关联 |
| growth/honor 等未批准语义 | 继续 409 | 无写入 |
| participation 语音 confirm | 继续 409；无原子持久 token 消费契约 | 无写入 |
| ai voice reward/call_student execute | 保持 3E-1 的拒绝，识别/候选不变 | 不创建事实、不调用 checkpointControl |

积分单独奖励不提交 stars，也不启用 Flower form；canonical normalize 得到花数0。
花数单独奖励明确传 points=0，避免隐式补积分。类别必须显式给出，不能补成 progress。
考勤备注沿用 3C 契约，持久保留在不可变业务回执的 result.updates/digest 中；
不向没有 note 字段的 AttendanceRecord 或旧表补写备注，不扩展 schema。

## 为什么随机/分组点名仍然拒绝

检查当前源码及旧实现后确认：二者虽然都叫 fair-v1，但算法并不相同。
旧实现先冷却后最少次数，再按 requestId 哈希选取；canonical 先最少次数再冷却，
事务内随机选择。旧响应还包含完整 candidateSnapshot，正式记录不持久化这套候选审计。
不能静默替换算法、伪造候选历史，或恢复旧 RollCallRecord。

指定点名只有一个明确目标，冷却后回退仍为该目标，因此选择语义可映射。
新请求仍在 canonical 事务内重新验证学生 active/班级/正式考勤。
groupId 的正式校验能力继续由既有 canonical group_random 提供，3D 全量回归覆盖；
本批不重新开放旧 group 随机语义，也不重构 Group/Member。

## 为什么旧语音仍然拒绝

旧 AI 参数契约只有 studentId/studentName 等，没有持久的奖励类别/花数/积分/原因。
识别器还可能给无明确学生的 call_student 预选 ID，执行记录不足以证明该 ID 的确认来源。
现有 token 的消费不在 canonical 事务内；不能先标 used 再调用业务，亦不能不消费而允许
同 token 换 requestId 重复执行。不存在本批已批准的无损、原子映射，因此继续拒绝。
不新增 token schema，不增加默认奖励，不把识别当执行。未来需独立评审确认来源和消费契约。

## 事务、幂等与历史请求

所有适配只做只读授权、语义校验、旧请求冲突检查及调用 canonical service。
不新开外层事务、不重入 Snapshot queue，不在服务返回后补写 Event/checkpoint。
继续复用 Run CAS + 正式记录 + 不可变 durable receipt + required Snapshot 的同一事务。
原 requestId 不加随机后缀，不按来源拆分第二套幂等空间；digest 继续由正式服务计算。

已提交请求授权后重放第一次结果，Run结束/学生停用不重新执行；新请求遵守终态与资格校验。
同 ID 不同状态、备注、批量成员、奖励值/类别/原因、指定学生/冷却值返回409。
批量排序变化视为同一业务请求；重复 studentId 不覆盖而拒绝。

若旧 AttendanceChangeLog / RewardRecord / RollCallRecord 已有该 requestId，
缺少可验证 canonical 回执时明确拒绝，不把旧请求重新执行为新事实，不自动迁移或去重历史。
旧写入口在 3E-1 已封堵，因此这些只读历史检查不会与新的 legacy 写入竞争。

## 响应与读取兼容边界

URL保留。单人考勤保留顶层 id/studentId/status/note/updatedBy，批量保留 items；
直接奖励保留顶层 id/studentId/points/rewardType/flowerCount；均明确标记 canonical identity，
并附正式结果/版本。数字 ID 只属于标记的 source/recordType，不可拿去旧撤销接口。

指定点名返回 canonical recordId/selectedStudent/rollCallState，明确 canonical 身份；
**不返回伪造 candidateSnapshot**，不承诺与旧完整审计响应逐字段兼容。
用于返回的展示信息来自第一次正式回执，不在重放时再查学生/重新随机。

旧 history GET 保持 legacy-only、来源标识与旧历史内容不变。新事实在 canonical 查询/
事务回执中读取，不把新事实合并到旧历史列表，不保证依赖完整旧 DTO 的客户端无需调整。
前端未修改，浏览器联调留待另行批准。

## 测试

隔离 Nest HTTP + SQLite 内存数据；不访问正式数据库或正式后端。
13 个 3E 定向场景包含既有封堵及本批新增5项场景；没有跳过全量回归。

- 单人/批量考勤、直接奖励全部六类别、积分单独/花数单独、指定点名。
- 相同 requestId 重放；不同 payload 409；批量换序重放；重复/无效学生全批拒绝。
- 学生停用后点名成功请求重放不再抽取；终态成功请求只读重放、新请求拒绝。
- 越权、停用、转班检查不写记录；合法 groupId 的旧随机语义仍拒绝。
- Snapshot 故障注入覆盖单人、批量、奖励、指定点名：20张相关表行数/摘要/完整行不变；
  同 requestId 失败后可重试成功，成功后重放不再写。
- legacy 请求ID拒绝；规则/徽章/成长/过大花数积分等不折算；旧语音拒绝时连token行也不变。
- 旧表保持无新事实，非空历史 GET 可读；canonical Snapshot-only保护及三领域主链保持。

最终验证：

- 单元测试：23 suites，167 passed，0 failed。
- 全量 E2E：24 suites，296 passed，0 failed，0 pending（最终运行60.376秒）。
- 13个3E定向场景通过，新增5个场景；完整运行没有跳过测试。
- build、type-check、lint通过；lint仅保留既有Snapshot spread警告。
- git diff --check通过。
- 对照编码前文件哈希：仅两个legacy服务和一个测试文件内容变化，新增本说明；
  其余已跟踪/未跟踪文件保持，HEAD与暂存区保持。439个受保护前端/核心源码逐文件哈希一致。
- 结果文件为被忽略的 backend/.tmp/3e-adapters-e2e.json 与3e-adapters-unit.json。
  首次单测输出报告目录缺失导致报告写入失败；创建测试输出目录后已完整重跑并退出0。

正式服务未重启，不据此宣称正式浏览器验收完成。

## Remaining

随机/范围/分组旧算法、完整 candidate 审计、旧语音原子消费与奖励确认契约、
旧规则/徽章/独立成长及来源明确的撤销适配仍需后续评审。
不扩展 0.5-4，不宣布 3E 全部完成。
