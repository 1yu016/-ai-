# 0.5-3E 最终写入边界审计与封版候选报告

## 结论与范围

本轮没有发现需要修改业务源码的新旁路，停止功能扩展。
当前三领域旧业务写请求仅有：无损子集委托 canonical service，或明确拒绝。
没有发现可达的 legacy + canonical 双写、Snapshot-only 三领域写入，或绕开正式服务的正式表写入。
配置、候选识别、审计上传、分组维护、课间运行不被当作奖励/考勤/点名事实。

本轮只新增两个测试文件和本报告。不修改前端、A1、0.5-1/0.5-2、3B/3C/3D、
ClassroomRun生命周期、DeviceSession、Online Policy；不新增表、不迁移、不重启正式服务、不提交/推送。

“明确409”针对通过认证/请求格式校验的受支持URL上的不支持业务语义。
未登录/越权/无效DTO仍可在此前返回401/403/400，不要求绕过安全校验强制返回409。

## 1. 全部旧三领域业务写入口

以下路径全部是 POST。`R=/classroom-runs/:runId`。

| HTTP入口/子语义 | 当前服务方法 | 最终分类 | 事实写入位置 |
|---|---|---|---|
| R/attendance | participation.setAttendance | delegate | AttendanceService.apply：StudentAttendanceRecord/StudentAttendanceChange |
| R/attendance/batch | participation.batchAttendance | delegate；整批原子、重复学生拒绝 | 同上 |
| R/attendance/voice/confirm | participation.confirmVoice | 409 LEGACY_SEMANTICS_UNSUPPORTED | 无 |
| R/roll-calls，teacher_specified且只有明确学生ID | participation.rollCall | delegate；正式考勤、active、班级事务内校验 | ClassroomRollCallService.execute：ClassroomRollCallRecord |
| R/roll-calls，all | participation.rollCall | 409；旧算法不等价 | 无 |
| R/roll-calls，range | participation.rollCall | 409；不能丢弃范围/算法语义 | 无 |
| R/roll-calls，group | participation.rollCall | 409；合法groupId也不能令旧算法变等价 | 无 |
| R/roll-calls，指定模式附带额外范围/group | participation.rollCall | 409；不丢字段后假装成功 | 无 |
| R/engagement-rewards，明确类别和合法直接奖励值 | engagement.award | delegate | StudentRewardService.createReward：StudentRewardRecord |
| R/engagement-rewards，ruleId | engagement.award | 409；不隐式展开规则 | 无 |
| R/engagement-rewards，独立classGrowthValue非零 | engagement.award | 409；不折算积分 | 无 |
| R/engagement-rewards，badgeDefinitionId | engagement.award | 409；不猜badgeCode | 无 |
| R/engagement-rewards，超过正式限制、缺类别、无奖励值、原因过长 | engagement.award | 409；不截断、不默认补齐 | 无 |
| /rewards/:rewardId/reverse | engagement.reverseReward | 409；旧数字ID不映射新ID | 无 |
| /classes/:classId/growth/adjust | engagement.adjustGrowth | 409 | 无 |
| R/honors/suggest | engagement.suggestHonor | 409；不继续生成依赖旧事实的荣誉 | 无 |
| /honors/:honorId/publish | engagement.publishHonor | 409 | 无 |
| /ai/classroom-command/execute，reward | ai ClassroomCommandService.execute | 409，在token消费/command状态写入之前 | 无 |
| /ai/classroom-command/execute，call_student | 同上 | 409；私有executeWhitelisted分支亦拒绝 | 无 |

直接奖励仅允许明确同义类别、0–20积分、0–5花数（至少一项非零）、原因≤200字。
不继承/改变正式服务的归一化、事务、回执和幂等规则。
旧请求已存在历史AttendanceChangeLog/RewardRecord/RollCallRecord但没有正式可验证回执时，
旧adapter拒绝，不把历史重试转成第二份新事实。

## 2. 不属于三领域新事实的旧入口（保持原状）

| 入口 | 分类/持久影响 |
|---|---|
| POST R/attendance/voice/recognize | 只返回候选及签名凭证，不记录正式考勤 |
| POST /ai/command | 旧识别/资源候选响应，不执行三领域业务 |
| POST /ai/classroom-command | 识别记录/候选/执行token，不是奖励或点名结果 |
| POST /ai/classroom-command/rules | 指令规则配置，不执行规则 |
| POST /ai/classroom-command/offline-logs | 审计日志；不得回补正式事实；不安全的executed声明被输入校验拒绝 |
| POST R/groups | StudentGroup/StudentGroupMember配置 |
| PATCH/DELETE R/groups/:groupId | 分组配置 |
| POST R/groups/:groupId/members | 分组成员配置 |
| DELETE R/groups/:groupId/members/:studentId | 分组成员配置 |
| POST R/groups/random | 仅分组配置，不生成点名记录 |
| POST /badge-definitions | 徽章定义配置，不授予StudentBadge |
| POST /reward-rules；PATCH /reward-rules/:id | 奖励规则配置，不发奖 |
| POST /classes/:classId/collective-goals | 旧目标配置，不写ClassGrowthRecord，不创建集体奖励 |
| POST /break-configs；PATCH /break-configs/:id | 课间配置 |
| POST R/breaks/start | 原课间Run/BreakRun及非三领域Snapshot行为 |
| POST /break-runs/:id/pause、resume、end | 原课间行为，不写三领域事实/投影 |
| 其它ASR/TTS/voice-chat/助教/导演接口 | 语音、草稿、建议或播放；没有发现三领域事实写入 |

旧GET保留：attendance/legacy、attendance/change-logs、学生attendance-history、roll-calls、
engagement-rewards、学生badges、班级growth、honors及配置/课间查询。
继续使用source/recordType/recordId区分来源，不自动合并、迁移或去重历史。

## 3. 正式入口和下游写入所有权

- POST /classroom-commands 三领域操作分别调用 AttendanceService、ClassroomRollCallService、StudentRewardService。
  成功后没有额外三领域checkpoint/Event补写。
- POST /classroom-mobile/commands → CommandBus → 同一canonical服务；mobile自己只读正式奖励/点名。
- 正式 /classroom-runs/:id/rewards及revoke、collective-rewards及revoke → StudentRewardService。
- 正式attendance查询/voice-candidates不创建事实；CommandBus attendance_update负责调用AttendanceService。
- Platform班级奖励/榜单与ClassroomRecord服务读取正式记录；没有发现它们写正式三领域表。
- ClassroomEvent严格业务回执只做审计与重放，不能补建正式记录。

正式业务表写入所有者：

| 实体 | 唯一业务写服务 |
|---|---|
| StudentRewardRecord / ClassCollectiveRewardRecord | StudentRewardService |
| StudentAttendanceRecord / StudentAttendanceChange | AttendanceService |
| ClassroomRollCallRecord | ClassroomRollCallService |

旧事实表的生产Repository用途为历史读取/旧请求冲突识别；无新写服务。
扫描包含save/insert/update/upsert/delete、manager与getRepository别名、QueryBuilder以及原始SQL。
既有migration的DDL不作为HTTP业务写旁路；本轮不运行migration。

## 4. Snapshot边界

- 普通HTTP checkpoint仅播放器observation；checkpointType=command不授予控制权。
- checkpointControl拒绝rewardState/attendanceState/rollCallState。
- 普通capture/captureRequired拒绝外部三领域JSON，包括伪造内部标记。
- captureBusinessRequired调用者仅canonical三个服务；使用同一manager读取正式记录重建，
  不接受调用方的业务JSON，不重入事务队列，不新增独立事实。
- Snapshot只有SnapshotService写；Avatar/Director对Snapshot的Repository是读取/计数。
- 其它内部checkpointControl仅资源/Presentation Queue/展示模式，没有三领域patch。
- 恢复只读取旧Snapshot，不迁移历史，也不把旧Snapshot反向插入事实表。

结论：在当前可达代码与测试范围内未发现Snapshot-only三领域写旁路。

## 5. 本轮新增验收

### 路由/源码写入清单守卫

`backend/test/legacy-write-inventory.e2e-spec.ts`：

- 冻结participation的11个、engagement的15个变更路由，以及AI command的4个相关路由。
- 扫描生产源代码：legacy事实Repository不可写；正式事实仅由上述三个服务写；
  Snapshot仅由SnapshotService写；canonical投影入口仅由正式三个服务调用。
- 这是静态回归报警，不宣称可以证明任意动态代码安全；与手工可达性检查、HTTP数据比较共同使用。

### 文件数据库持久重放

`backend/test/legacy-durable-replay.e2e-spec.ts`：

1. 使用独立临时SQLite，测试应用经HTTP完成单人/批量考勤、直接奖励、指定点名和正式撤销。
2. 确认5个strict业务回执，旧事实表无新增。
3. 将隔离夹具Run置为终态、原学生停用，关闭整个测试Nest应用与数据库连接。
4. 建立全新测试应用/DataSource/服务实例，读取同一文件，重新打开时关闭synchronize和migration。
5. 原请求返回首次提交响应；批量换序仍重放；改状态/奖励值/点名学生/撤销原因返回409；新请求终态拒绝。
6. 比较19张表的行数、SHA256摘要和完整行：重开及重放均无新业务记录、Event、Snapshot或Run变化。

这是隔离应用/数据库重建测试，不是对正式3001进程执行重启；不宣称完成正式部署验收。
临时夹具文件由测试创建并精确清理，不触碰正式数据库。

既有13项3E HTTP场景继续验证20张表的数据不变/增量边界、旧语音零事实写入、
同ID幂等、payload冲突、权限/active/班级/终态、故障注入回滚、旧历史读取和主链回归。

## 6. 封版与延期边界

3E的目标是“旧事实写入口收口”，不是让所有旧功能重新可用。
若本轮完整回归通过，当前源码写入边界可提交人工封版验收；不为补功能继续扩展。
正式进程尚未加载本轮/前批代码，本报告不等于正式环境已部署。

继续延期、且保持拒绝的能力：

- 旧随机/范围/分组算法及完整candidate审计兼容；
- 旧语音完整奖励参数、确认来源及原子token消费；
- 旧规则/徽章/独立成长语义和来源明确的撤销适配；
- 旧客户端对canonical响应/读取的后续联调；
- 经另行授权的正式构建加载与浏览器验收。

这些不是隐藏开放的第三条路径，均已明确拒绝或属于不执行业务的配置/读取能力。
0.5-4未开始。

## 7. 最终验证结果

- 单元：23 suites，167 passed，0 failed。
- 全量E2E：26 suites，299 passed，0 failed，0 pending，69.243秒。
- 新增路由/所有权清单守卫2项、文件数据库重开重放1项，均通过。
- 0.5-1/0.5-2、3B/3C/3D、A1、READY/OPENING/TEACHING/PAUSED/SUMMARY全部自动化回归通过。
- type-check、lint、git diff --check通过；lint仅1项已有Snapshot spread警告。
- 全量运行后仅优化测试正则的等价写法以消除新增lint警告，再次单独运行清单守卫2项通过。
- 编码前后768个已有tracked/untracked文件内容哈希全部相同；HEAD与index相同。
  仅新增本报告和两个测试文件；业务代码、既有dirty changes完整保留。
- 机器可读结果：backend/.tmp/3e-final-e2e.json、3e-final-unit.json（被忽略的测试产物）。
- 故障注入测试出现的预期error日志不是用例失败；最终进程退出0。

最终判断：3E当前写入边界在源码和隔离自动化层面满足封版条件，提交人工验收。
正式运行部署/浏览器验收仍需独立授权；本轮没有重启正式服务，也没有宣称新代码已上线。
