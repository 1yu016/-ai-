# A-11：unbindTeacher 事务隔离修复

## Evidence / 根因

2026-10-18；项目 `D:\trae_project\new1\-ai-`；分支feature/member-a；HEAD `09b99a81d909df6001aa0b204b3efca8eba3bba1`。A-10原报告和a10-*失败JSON全部保留；不是将旧失败结果覆盖成通过。

真实链路：DELETE `/classes/:classId/teachers/:teacherId` → PlatformController.unbindTeacher → PlatformService.unbindTeacher → 普通TeacherClass Repository.delete → AuditService.write。旧实现没有为删除与审计建立自己的提交边界。目标创建走A-09的Snapshot串行队列及manager.transaction。

当前better-sqlite3驱动的createQueryRunner缓存并返回同一QueryRunner；EntityPersistExecutor看见isTransactionActive后不会独立开/提交事务。这不是请求级AsyncLocalStorage把manager显式传错，而是同DataSource的实际SQLite连接/QueryRunner被两个异步HTTP请求共享。旧撤权DELETE和审计SAVE加入目标创建事务，在真正提交前已返回204；创建回滚则撤权和审计一起消失。A-10真实HTTP证据为DELETE204、POST500、TeacherClass恢复1条、撤权审计0条。

## Transaction Contract / 修复

不增加新的锁系统或数据库结构，只提取并复用已有FIFO协调机制：

1. Snapshot原私有FIFO按DataSource提取到`serializeDatabaseWrite`。Snapshot各capture/transactionRequired/ScreenLifecycle写能力仍调用原入口，只把内部排队函数委托给共享队列，原manager/required Snapshot/生命周期语义不改。
2. unbindTeacher保留原管理员及班级权限快速检查，在同DataSource队列中等待目标事务结束后才开自己的事务。若发现已有未协调的活动事务，409拒绝，不静默嵌套到它里面。
3. 事务内再次执行原管理员/班级授权规则；TeacherClass删除、AuditService.write使用同一个manager。没删到关系仍404。
4. 必须等待dataSource.transaction完成COMMIT，才释放队列并让Controller返回204。删除、审计或提交失败传播异常，关系/审计回滚，不返回204。
5. 成功撤权之后创建目标仍由A-09权限条件决定。未改createGoal源码、课后配置语义、A-07保护或canonical奖励/考勤/点名契约。

开事务前取得队列，事务中不重新取得同队列；没有新增网络/AI/ACK等待。平台模块不反向依赖ClassroomRunModule，避免为复用队列引入循环依赖。

## Changed：逐文件

|文件|本批改动|
|---|---|
|backend/src/platform/database-write-coordinator.ts|新增：从原Snapshot提取同等FIFO，WeakMap按DataSource共享，finally释放|
|backend/src/classroom-runs/classroom-snapshot.service.ts|仅原串行队列实现委托至协调器；不改Snapshot模型、captureRequired或生命周期逻辑|
|backend/src/platform/platform.service.ts|只修改unbindTeacher：队列→独立事务→授权复核→删除+审计→提交后返回；未协调活动事务409|
|backend/src/platform/platform-access.service.ts|requireClassAccess增加可选manager；提供时从该manager读班级/关系并写拒绝审计；不传时保留原行为|
|backend/src/platform/audit.service.ts|write增加可选manager，使撤权审计与删除同事务；其他调用保持默认仓储行为|
|backend/test/legacy-goal-admin-http.e2e-spec.ts|优先扩展A-10真实HTTP用例，调整同步点避免“持有队列却等待后续撤权返回”的测试自锁；新增删除/审计/提交故障等|
|backend/src/platform/database-write-coordinator.spec.ts|新增3个纯FIFO单测：同源串行、异常释放、不同DataSource独立；不拿单测充当数据库回滚证据|
|backend/src/classroom-runs/classroom-snapshot.service.spec.ts|mock manager补DataSource身份字段，适配真实manager.connection契约，原断言保留|
|backend/test/growth-goal-transactional-guard.e2e-spec.ts、legacy-goal-authorization.e2e-spec.ts|只增加可选测试证据文件前缀，默认不变；用新前缀重跑A-07/A-09而不覆盖历史JSON|
|docs/A11_UNBIND_TEACHER_TRANSACTION_ISOLATION.md|本报告|

未改A1/authoring、createGrowthGoal/createGoal、奖励/考勤/点名、CommandBus、Operation Policy、前端、Run状态、DeviceSession/Online Policy；没有schema/migration。

## Tests：本次实际运行

所有HTTP/事务测试均为独立临时SQLite或:memory:及合成身份，管理员通过真实/auth/admin/login获取token。测试App只在进程内init，无正式服务启动、重启、数据库访问或模型调用。仅空测试库初始化表，不运行migration。

### 1. HTTP专项

初版扩展11项：

`npm run test:e2e -- --runInBand --runTestsByPath test/legacy-goal-admin-http.e2e-spec.ts --json --outputFile=.tmp/a11-http-goal-jest.json`

11 passed / 0 failed / 0 skipped，12.333s。随后增加404兼容和未协调事务保护两项，换新文件前缀保留初版证据。

最终：同命令，结果文件`.tmp/a11-http-goal-jest-v2.json`；**13 passed / 0 failed / 0 skipped，12.174s，exit=0。**

|用例|HTTP结果 / 数据证据|
|---|---|
|normal|有效班级授权教师创建201；旧目标不变|
|revoke-first|DELETE204提交，POST403；关系0、目标1、撤权审计1|
|unauthorized-teacher / cross-school-admin|DELETE403；关系与目标不变；保留原拒绝审计|
|waiting-revoke|先占队列，管理员撤权先排队，教师创建后排队；撤权等待时不能返回204；释放队列后DELETE204、POST403|
|locked-revoke|目标真实INSERT后保持事务，真实HTTP撤权已通过快速授权但未返回204；目标先提交201，撤权再独立提交204；目标2、关系0、审计1|
|locked-revoke-rollback|目标INSERT后让撤权排队，创建抛错500；撤权随后独立提交204；目标1、关系0、审计1，不再恢复授权|
|revoke-committed-then-goal-failure|先DELETE204；另一位有权的合成teacher/admin创建目标，真实INSERT后故障500；已提交撤权和审计仍在。使用第二个合法创建者，避免原教师已撤权后还假造其能进入INSERT|
|delete-failure|真实DELETE执行后抛错，HTTP500；关系恢复、无撤权审计、目标不变|
|audit-failure|真实DELETE和audit INSERT之后抛错，HTTP500；关系/审计整体回滚|
|commit-failure|真实删除和审计已写，COMMIT前注入失败；500而不是204；关系/审计回滚|
|missing-relation|首次204，再次404；只有一条撤权审计，无重复写入|
|uncoordinated-active|测试开启非共享队列的事务期间发HTTP撤权；409，无关系/审计变化，不加入该事务|

删除/审计故障记录证明使用同一个manager，transactionDepth=1；不是嵌套savepoint。13项均检查integrity_check=ok、foreign_key_check=[]；21张表完整数据/行数/SHA256覆盖目标、授权关系、audit_log、业务Event/Snapshot和Run等。原目标保持原行内容，没有为旧配置编造归档步骤。场景JSON为`backend/.tmp/a11v2-http-goal-<scenario>.json`。

上述为同一应用/DataSource下两个真实HTTP请求，使用测试call-through同步点控制交错；不是mock权限结果，也不是独立进程压力。HTTP响应实际发送顺序可能受调度影响，断言重点为持锁期间不能返回204及最终持久数据；数据库事务提交顺序由同一FIFO保证。

### 2. 单元测试与保留失败

首次只跑Snapshot unit，`.tmp/a11-snapshot-unit-initial.json`：**5 passed / 6 failed / 0 skipped**，0.984s。根因是原mock manager只有transaction，没有connection，WeakMap收到undefined；真实TypeORM EntityManager存在connection。仅给夹具补身份字段，未放宽断言、未在业务实现增加“无DataSource也成功”fallback。

`npm test -- --runInBand --json --outputFile=.tmp/a11-unit-jest.json`

**完整unit：26 suites / 562 passed / 0 failed / 0 skipped，13.508s，exit=0。** 包含Snapshot保护和新增FIFO测试。AI超时等日志为已有mock失败路径，无真实模型调用。

### 3. Regression：A-09及成长目标/课堂事务

设置本进程`GOAL_TEST_EVIDENCE_PREFIX=a11-a09`，执行：

`npm run test:e2e -- --runInBand --runTestsByPath test/legacy-goal-authorization.e2e-spec.ts --json --outputFile=.tmp/a11-a09-regression-jest.json`

**13 passed / 0 failed / 0 skipped，12.418s。** 包括A-09独立SQLite连接WAL/DELETE锁争用、事务内授权、管理员/跨园/课后配置/真实INSERT回滚。

设置本进程前缀`a11-a07`，执行：

`npm run test:e2e -- --runInBand --runTestsByPath test/growth-goal-transactional-guard.e2e-spec.ts test/student-reward.e2e-spec.ts test/classroom-run.e2e-spec.ts test/screen-lifecycle.e2e-spec.ts --json --outputFile=.tmp/a11-goal-core-regression-jest.json`

**4 suites / 144 passed / 0 failed / 0 skipped，25.475s。** A-07专项14、奖励/目标canonical44、Run课堂与核心事务76、screenLifecycle10。涵盖新目标归档/插入晚失败整体回滚、complete竞争、READY/OPENING/SUMMARY等现有断言；未改这些业务实现。

最终专项13 + 回归157 = **170个E2E用例通过**，不是完整后端E2E声明，也不把前一轮重复11项累计冒充新增覆盖。历史失败保留，不记成旧版本通过。

### 4. 构建检查

- npm run build：exit=0，仅生成dist，不部署/启动。
- npm run type-check：exit=0。
- npm run lint：exit=0；清除本次触及测试的未使用变量后再运行，最终6条既有warning（A-06四条、A-08一条、Snapshot既有spread一条）。不为了消警告修改旧证据或断言。

## Remaining / Next Batch

- 没有执行完整后端E2E、浏览器、正式设备/A-B联合验收、断电及多进程HTTP压力。本批独立连接覆盖来自实际重跑A-09，不等于独立进程联调。
- 共享协调器不是全库分布式锁。其他未接入的平台写入口及外部连接仍需各自验证；本批不声称已收口所有平台事务。遇到开始前已存在未协调活动事务，撤权明确409而非加入它；未来其他入口如何协调不在本批扩大实施。
- 外部连接的撤权冲突错误/自动重试及事务COMMIT后响应丢失的持久幂等不是本批新增能力。
- 所有历史证据及既有工作区修改保留；不fetch/pull/merge/commit/push、不操作正式数据库或服务。本批完成后停止。
- **只推荐下一批：只读审查bindTeacher与共享SQLite事务的写入边界，确认是否存在同类跨请求事务加入风险；不预设有缺陷。**
