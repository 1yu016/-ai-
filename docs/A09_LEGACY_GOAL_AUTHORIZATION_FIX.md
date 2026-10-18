# A-09：旧 createGoal 班级授权竞争修复

## Evidence / Root Cause

2026-10-18；feature/member-a；HEAD `09b99a81d909df6001aa0b204b3efca8eba3bba1`。A-08原始失败测试、报告及a08-*证据保留，不重跑以覆盖历史结果。

真实链路：POST `/classes/:classId/collective-goals` → ClassroomEngagementController.createGoal → ClassroomEngagementService.createGoal → requireTeacher → PlatformAccessService.requireClassAccess → 原先单独goals.save。

班级授权撤销链路：DELETE `/classes/:classId/teachers/:teacherId` → PlatformService.unbindTeacher → requireAdministrator/requireClassAccess → teacherClasses.delete → audit。撤销并不使用Snapshot串行队列。因此仅将创建排队或增加事务外查询不足以保证授权与写入一致。

既有语义：独立班级配置collective_goal，无Run，不是class_growth_goal；只允许teacher类型账户进入，teacher且role=admin可不依赖TeacherClass，但仍受已有schoolId校验；administrator账户类型原先就不满足requireTeacher。课后配置允许，旧目标不自动归档。

## Changed / 最小事务方案

只修改 `backend/src/classroom-engagement/classroom-engagement.service.ts:createGoal`：

1. 保留原快速教师/班级授权检查及其原有拒绝审计行为。
2. 复用已有 snapshots.transactionRequired，在实际事务manager内重读class及TeacherClass，复核班级存在、原园所规则和原管理员豁免。
3. 使用参数化 **INSERT ... SELECT ... WHERE授权条件 RETURNING id**，将相同班级/园所/关系条件附在真正插入语句上；不依赖事务内先前读到的授权对象。兼容原schoolId为空时的既有规则。
4. 通过同manager读取新实体，保持HTTP201实体响应形状和数据库默认时间戳，不引入新的归属、归档或Run限制。
5. SQLite跨连接写锁/过期读快照升级返回SQLITE_BUSY家族时，整个事务回滚并返回409，提示刷新后重试；不自动重试、不假装成功。无权限仍403，班级不存在仍404；其他异常继续抛出。

没有新锁机制、表、字段、migration。SQL值全部参数绑定，无客户端拼接标识符。沿用SQLite已有事务/写锁/读快照规则，不将进程内队列描述成跨连接锁。没有改变撤销权限服务或共享权限模块。

## Tests：本次实际执行

新增 `backend/test/legacy-goal-authorization.e2e-spec.ts`。新建临时SQLite与合成数据；ignoreEnvFile，migrationsRun=false，只在新空测试库初始化结构。没有正式端口、正式数据库或真实幼儿数据。每场景先创建一个旧目标，验证拒绝或失败不会修改这个已提交目标。

### 第一轮测试基线问题（保留）

命令：

`npm run test:e2e -- --runInBand --runTestsByPath test/legacy-goal-authorization.e2e-spec.ts --json --outputFile=.tmp/a09-goal-jest.json`

结果 **9 passed / 3 failed / 0 skipped，11.363s，exit=1**。

- 跨园管理员夹具只改JWT.schoolId，但AuthService.validateAccessPayload会用教师数据库schoolId覆盖，因此实际仍同园，返回201。修正的是合成教师数据库身份/role，不改业务规则。
- 两个WAL案例原先误以为空测试库默认wal；实际驱动只有enableWAL时启用，本夹具默认为delete。修正为只在WAL场景显式设置测试库journal_mode=WAL，并额外增加delete模式争用场景。没有改环境配置或正式库。
- 第一轮JSON与场景证据保留；第二轮使用不同文件前缀a09v2，不覆盖。

### 修正测试夹具后的专项

同一命令，结果文件改为 `.tmp/a09-goal-jest-v2.json`。

**13 passed / 0 failed / 0 skipped，11.092s，exit=0。**

|场景|结果 / 数据证据|
|---|---|
|normal|合法教师201，新旧目标共两条，原目标不变|
|unauthorized|403，19张业务表不变|
|preflight-revoke|真实前置授权成功后，测试提交撤销关系；事务复核403，目标不变；对应A-08窗口|
|insert-revoke|事务内权限检查后、实际INSERT前同连接撤销关系；INSERT条件不满足，403；目标不变|
|create-before-revoke|HTTP创建提交201后再撤销关系；已提交目标保留|
|late-insert-failure|真实INSERT已执行后抛错；500；事务回滚，19张业务表与前值相同，原目标未变|
|teacher-admin|同园teacher/admin无TeacherClass仍201，保持原管理员语义|
|admin-cross-school|不同园teacher/admin仍403，没有扩大跨园权限|
|administrator-user|直接调用真实领域服务仍拒绝“该操作仅限教师”；此项是服务断言，未伪造administrator HTTP身份|
|after-complete|真实complete HTTP成功后配置创建201；无Run终态限制新增|
|wal-revoke-first|见独立连接证据|
|wal-create-first|见独立连接证据|
|rollback-create-first|见独立连接证据|

13场景integrity_check=ok、foreign_key_check=[]。JSON含请求响应、19张表排序数据/行数/SHA256、关系记录、竞争结果。TeacherClass为测试主动变更，audit_log可能记录拒绝审计，不把“19业务表不变”写成所有数据库表不变。旧配置不存在归档步骤，本批证明原目标不被修改，而不是编造一次不存在的归档操作。

### 真实独立连接争用 vs 顺序/受控测试

独立SQLite连接由Worker线程打开同一临时数据库，不经过应用队列、没有mock数据库锁：

1. **WAL撤销先提交**：主连接已在创建事务读过授权，测试在INSERT前让独立连接DELETE并提交，changes=1。主事务旧快照不能升级写入，HTTP409、goal仍1条。新请求读取当前授权返回403。不存在旧读快照成功插入。
2. **WAL创建先写入**：真实INSERT后、主事务提交前，独立连接DELETE收到SQLITE_BUSY；创建201提交，独立连接再次DELETE成功changes=1。目标由1→2，两条保留，撤销不会追溯删除目标。
3. **DELETE journal创建先写入**：同样真实持有写锁期间独立DELETE收到SQLITE_BUSY，提交后重试撤销成功。覆盖本测试默认journal模式，而不是把WAL行为冒称所有模式实测。

这是两个实际连接、事务重叠期间的数据库争用测试，使用受控插入时点进行调度；不是两个独立进程/浏览器的随机压力测试。关系撤销通过独立连接执行与生产teacherClasses.delete等价的DELETE，不声称测试了真实管理员HTTP撤销全链路。

其余preflight-revoke/insert-revoke是测试hook控制的同应用交错；create-before-revoke是普通顺序测试。这三类证据不混称。

## Regression / 构建检查

专项通过后执行：

`npm run test:e2e -- --runInBand --runTestsByPath test/student-reward.e2e-spec.ts test/classroom-run.e2e-spec.ts test/screen-lifecycle.e2e-spec.ts --json --outputFile=.tmp/a09-regression-jest.json`

**130 passed / 0 failed / 0 skipped；3 suites；14.052s；exit=0。** 范围为奖励/目标事务与进度、现有课堂Run及READY/OPENING/SUMMARY/恢复相关回归、screenLifecycle。没有修改A-07的StudentRewardService；未重跑会覆盖旧JSON的A-07专项。

- `npm run build`：exit=0；生成dist但不启动、重启或部署。
- `npm run type-check`：exit=0。
- `npm run lint`：exit=0；首次7条warning中本批新增测试1条未使用import已清除；再运行lint为6条既有warning（A-06四条、A-08一条、Snapshot一条）。未修改旧证据文件以消警告。
- 首轮3个失败保留，不与后续13+130通过混为一次全绿；本批未执行完整unit或完整后端E2E。

## Remaining / Stop

- 未做独立进程随机压力、断电、真实管理员撤销HTTP联调或浏览器验收；不同SQLite版本/驱动之外的数据库未验证。
- DELETE模式“读事务期间另一连接尝试先提交撤销”的精确交错未单独实测；该模式创建先持锁争用已测，WAL撤销先提交已测。不宣称所有并发排列已经穷尽。
- 当前busy冲突需客户端刷新后重试，未引入自动重试或配置持久幂等。
- 仅新增本专项测试、报告及a09证据；仅改旧createGoal业务方法。A1/authoring、奖励/考勤/点名、CommandBus、前端、生命周期、DeviceSession/Online Policy、数据库结构均未修改。
- 不操作正式数据库、不重启服务，不fetch/pull/merge/commit/push。完成后停止，不进入下一批。
