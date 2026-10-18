# 0.5-3E-1：旁路封堵与来源身份边界

## 完成范围

仅封堵，不实现 legacy-to-canonical adapter。不进入 3E-2、3E-3 或 Operation Policy。
所有被暂停的旧写 URL 保留，认证/必要授权后返回 HTTP 409：
`code=LEGACY_SEMANTICS_UNSUPPORTED`。不截断参数、不假装成功、不双写。

### 已拒绝的旧业务写入

| 服务/入口 | 行为 |
|---|---|
| participation setAttendance / batchAttendance | 拒绝；不写 attendance_record / attendance_change_log |
| participation voice confirm | 拒绝；不消费/伪装消费 token，不增加 token schema |
| participation rollCall：all/range/group/teacher_specified | 全部拒绝；不写旧结果/候选快照 |
| engagement award：direct/rule | 全部拒绝，包括本可映射子集，留待 3E-2 |
| engagement reverseReward | 拒绝；不按旧数字 ID 查找 canonical 记录 |
| engagement adjustGrowth | 拒绝正负调整；不转换成 points 或集体奖励 |
| engagement suggestHonor / publishHonor | 拒绝新建议/发布；保留历史 GET |
| ai classroom-command execute：reward / call_student | 在 token 使用及 command 状态修改前拒绝；私有执行分支亦拒绝 |

旧事实写入辅助实现（attendance persistence、roll-call result persistence、reward/growth/reversal persistence）
从上述服务移除，旧实体/表/模块/历史读取保留。

## Snapshot 写入边界

1. checkpointControl 拒绝 rewardState / attendanceState / rollCallState，错误码
   BUSINESS_PROJECTION_OWNERSHIP，校验发生在 Run/Event/Snapshot 写入之前。
2. 普通 HTTP checkpoint 仍仅使用 playerObservation；checkpointType=command 不获得控制权限。
3. 普通 capture / captureRequired 同样拒绝三类业务状态补丁，包括原型继承的属性。
4. canonical 三个服务在原事务中调用 captureBusinessRequired：只传领域标识及非业务状态元数据，
   由 Snapshot 内部用同一 EntityManager 读取正式表重建投影，再复用 captureRequired。
   无新增事务，无 Snapshot queue 自等待，无网络/AI/TTS/ACK 等待。
5. 服务端生成的投影用临时 WeakSet 标记，普通 JSON/DTO 不能伪造。调用方不能提交业务状态 JSON。
6. Reward/Attendance/RollCall 的正式记录、回执、Run CAS、幂等及随机算法契约保持。
   Event 不生成事实，Snapshot 不反向补建事实。
7. 历史 Snapshot 不修改/迁移/清洗。恢复时继续继承当前有效 Snapshot 的业务投影，
   不再把它们作为任意 patch 重提交；原恢复行为和生命周期经回归验证。

## 来源身份

读 DTO 附加：

```text
recordIdentity = { source, recordType, recordId }
identity = source/recordType/recordId
recordSource = source
```

来源为 canonical / legacy_participation / legacy_engagement。原数字 id 保留。
原有审计 source=manual/batch/voice_confirmed 等字段不覆盖，用 recordIdentity.source 区分数据来源。
同数字 ID 不跨表关联；不按学生、时间或 requestId 自动合并。

覆盖 legacy attendance/history/change-logs/roll-calls/rewards/badges/growth/goals/honors，
以及 canonical reward/attendance 读取和 collective reward dashboard。持久业务回执结果不回写补字段。
只增加读 DTO 元数据，不修改数据库行或历史累计。

## 保留的能力与剩余写入口

- 历史 GET 与原权限规则保留，包含非空旧奖励、考勤、点名、徽章、成长及荣誉测试夹具。
- Group CRUD、成员维护、随机分组仍只写 Group/Member；不产生点名/奖励/考勤事实。
- RewardRule、BadgeDefinition、旧 CollectiveGoal 等纯配置继续保存，不推动旧成长事实。
- 旧课间配置/课间运行仍保持原行为，本批不改生命周期。
- AI command 识别、候选、非业务执行、规则及离线安全日志能力保留。
- 未完成 adapter 的旧 reward/attendance/roll-call 执行本批全部拒绝，不偷偷开放子集。

## 扫描结果

- participation 不再有三领域 Snapshot.capture 或旧事实 save 路径。
- engagement 不再写旧 RewardRecord/Reversal/StudentBadge/ClassGrowthRecord；剩余 save 为配置/课间。
- ai/classroom-command.service 不再调用 checkpointControl，不再提交 rewardState/rollCallState。
- 正式 CommandBus 的三领域仍只 delegate canonical，不补业务 checkpoint/Event。
- canonical 事实写服务仍为 StudentRewardService、AttendanceService、ClassroomRollCallService。
- 其它 Snapshot repository 引用（avatar/director）为计数/读取，未发现新的生产直接写旁路。

## 测试与数据比较

定向 8 个真实 Nest HTTP/SQLite 场景，覆盖多个旧写请求和重试。每次 reject 前后比较：
表名、行数、SHA256 摘要与完整行。比较范围包括：

attendance_record / attendance_change_log / roll_call_record / roll_call_candidate_snapshot /
reward_record / reward_reversal / student_badge / class_growth_record / honor_record /
student_reward_record / class_collective_reward_record / student_attendance_record /
student_attendance_change / classroom_roll_call_record / classroom_run / classroom_snapshot /
classroom_event / classroom_command_record / collective_goal / class_growth_goal。

测试明确验证：
- 内部 checkpoint、普通 capture、required capture 不能注入三类状态。
- 内部 canonical 投影入口不接受伪造业务 JSON。
- HTTP command-type checkpoint 不获得控制权。
- AI reward/call execute 重试拒绝，连原 command/token 行也不修改。
- 旧全部写语义拒绝，canonical 仍能连续完成奖励/考勤/指定点名。
- 历史 GET 不改库；同 id 的旧/新奖励 identity 不同。
- 历史审计 source 不变；徽章/成长/荣誉非空记录可读。
- Group/Member、规则/徽章定义配置不产生三领域事实。

旧测试中“成功写旧事实”的断言已改为“明确拒绝且零写入”，没有跳过测试。
故意损坏/历史 Snapshot 由 test/helpers/snapshot-fixture.ts 直接构造隔离夹具，
不能再用生产 capture 伪造。该 helper 不进入 src 或正式构建。

## 未修改及部署边界

无新表/字段/migration，无正式数据修改。未修改前端、A1、Run 状态模型、
READY/OPENING/SUMMARY、DeviceSession 或 Online Policy；保留既有 dirty worktree。
没有正式后端重启、浏览器验收、commit 或 push。当前运行旧进程不会自动获得封堵。
本报告仅代表 3E-1，不能据此宣布 3E 全部完成。

## 最终验证

- 后端 build / type-check 通过，lint 通过（仅保留既有 Snapshot spread 警告）。
- 单元测试：23 suites，167 passed，0 failed。
- 最终完整 E2E：24 suites，291 passed，0 failed，56.974s。
- 3E-1 定向场景：8 passed，覆盖多组 reject、20 张表的 count/digest/row 比较及非空历史读取。
- 0.5-1 / 0.5-2 / 3B / 3C / 3D / A1 / READY-OPENING-TEACHING-PAUSED-SUMMARY 自动化回归通过。
- git diff --check 通过。测试均使用隔离数据；正式进程未加载本批构建。

### 本批文件范围

- 新增 legacy-write-boundary.ts、canonical-business-projection.ts 及身份测试。
- 修改 SnapshotService / RunService 的投影写入保护，canonical 三服务仅切换内部投影写入口及读取身份展示。
- 修改 participation / engagement / ai command 的旧业务写方法及历史读 DTO。
- 更新 Snapshot 单测、legacy HTTP 边界测试及既有故障注入/历史 Snapshot 夹具。
- 新增 test/helpers/snapshot-fixture.ts（仅测试构造历史数据，不进入正式 src/build）。
- 本报告。原先存在的 A1、前端等 dirty changes 保持，未由本批改动。
