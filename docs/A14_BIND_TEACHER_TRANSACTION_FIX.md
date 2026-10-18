# A-14：bindTeacher事务隔离与审计原子性修复

## Baseline / Scope

2026-10-18；项目 `D:\trae_project\new1\-ai-`；feature/member-a；HEAD `09b99a81d909df6001aa0b204b3efca8eba3bba1`。仅修复bindTeacher及必要测试，保留所有原dirty worktree、历史报告与失败证据。不进行正式环境、浏览器或A/B联调。

## Evidence / Root Cause

真实路由仍是POST `/classes/:classId/teachers`，请求teacherId/role，成功返回201实体；新增和更新角色仍共用该入口。

A-13证据确认两个缺陷：

|场景|修复前|本批修复后|
|---|---|---|
|其他请求持有目标事务并随后回滚|绑定先201，关系和审计随别人的ROLLBACK消失|绑定在同DataSource既有FIFO等待；目标500回滚后绑定独立提交201；关系/审计保留|
|绑定审计INSERT失败|绑定500，但关系先单独COMMIT，审计0|绑定500，关系及审计同一ROLLBACK；关系0、审计0|
|正常新增|关系、审计各自COMMIT，共2次提交|关系和审计合为1次COMMIT后201|

根因不是管理员URL或DTO，而是原普通Repository.save与AuditService.write没有统一事务，且当前SQLite驱动共享QueryRunner。存在活动事务时两者可能加入其他请求事务；没有活动事务时又各自提交。

修复只在PlatformService.bindTeacher复用A-11 `serializeDatabaseWrite`：

`原快速管理员/班级守卫 → 取得既有FIFO → 拒绝未协调活动事务 → dataSource.transaction(manager) → 管理员/班级权限复核 → 同manager读取目标教师及园所检查 → 查询/创建或merge role → 同manager保存 → audit.write(..., manager) → COMMIT → 返回实体/201`

已有管理员/园所规则、缺失教师404、跨园所409、角色更新保留原记录ID、无权403均不扩大。未协调活动事务时返回409，不伪造成功。A-11撤权方法和协调器行为没有修改。

审计证据不只是传了一个参数：现有AuditService.write内部在有manager时调用manager.getRepository(AuditLog)。本批测试观察真实Repository.save：AuditLog仓储manager必须等于保存TeacherClass的manager，且实际事务depth=1。

## Changed

### 唯一业务实现修改

`backend/src/platform/platform.service.ts`：只修改bindTeacher，不改unbindTeacher或其他业务方法。所有绑定写入、角色更新与审计在同一独立事务，等待提交后才返回。

### 专项测试

`backend/test/bind-teacher-http-fault.e2e-spec.ts`：复用A-13的两条原失败验收断言，扩充13项专项。跨请求同步改为“真实目标INSERT后启动绑定、确认其已通过快速授权且等待、回滚目标、再等绑定提交”，避免修复后仍在持队列时硬等201导致测试自锁。原A-13失败JSON/报告未改写。

### 仅用于保护历史证据的测试设施

新增 `backend/test/helpers/test-evidence.ts`：可选TEST_EVIDENCE_RUN_PREFIX只重命名本轮写入backend/.tmp的输出；默认仍原行为；写入错误继续抛出，不改变断言或业务数据。

以下11份测试将writeFile导入改为上述helper：

- batch-attendance-postcommit.e2e-spec.ts
- bind-teacher-http-fault.e2e-spec.ts（同时包含专项行为改动）
- collective-revoke-http-replay.e2e-spec.ts
- command-postcommit-fault.e2e-spec.ts
- group-rollcall-postcommit.e2e-spec.ts
- growth-goal-terminal-race.e2e-spec.ts
- growth-goal-transactional-guard.e2e-spec.ts
- growth-goal-write-boundary-audit.e2e-spec.ts
- legacy-goal-admin-http.e2e-spec.ts
- legacy-goal-authorization.e2e-spec.ts
- reward-revoke-postcommit.e2e-spec.ts

除绑定专项外，其余仅更换证据写入导入，不删改业务断言。原因是本批要求完整E2E，而原测试使用固定证据文件名，直接重跑会覆盖历史失败。没有改Jest配置、.env或正式启动配置。

## Tests / 专项证据

全部为新临时SQLite或:memory:及合成身份、班级、目标。真实HTTP管理员登录和绑定/撤权，不mock权限成功。故障点call-through执行真实关系/角色SQL，再在审计SQL派发或COMMIT前失败。21张表记录前后数据、行数、SHA-256，含teacher_class、audit_log、目标、Run、业务Event/Snapshot等。完整性检查全部ok，物理FK检查无错误。

|专项|结果|
|---|---|
|normal|201；关系和审计各1条，只有1次COMMIT|
|audit-insert-failure|500；无新关系/审计，原A-13失败断言通过|
|cross-request-rollback|目标500后，排队绑定独立201；关系/审计各1，原A-13持久性断言通过|
|role-update|201；原关系ID不变，role从assistant变lead，新增正确关系ID审计|
|role-audit-failure|500；原assistant及原审计保持，没有部分role变更|
|commit-failure|COMMIT前失败，500而不是201，关系/审计均回滚|
|unauthorized-teacher|普通教师无管理员权限403，无绑定及成功审计|
|cross-school-admin|实际外园管理员403，无越权绑定|
|target-cross-school|目标教师与班级园所不同409，无绑定|
|bind-first-unbind|两个真实HTTP在同队列按绑定、撤权顺序入队；201/204，最终目标关系不存在，两次操作审计保留|
|unbind-first-bind|先撤权后绑定排队；204/201，最终目标关系存在且角色正确|
|bind-first-goal-failure|绑定先201独立提交，随后另一个目标HTTP真实INSERT后失败500；已提交关系/审计保留|
|uncoordinated-active|存在非协调器事务时绑定409，不加入该事务、不产生绑定事实|

绑定/撤权入队顺序用前置授权完成信号及微任务/事件轮转控制，没有用随机sleep冒充竞争证据。这是同进程、同DataSource上真实HTTP请求重叠；普通先提交再失败案例是顺序验证。A-09的独立连接数据库争用在回归中另行执行，不能据此声称绑定自身的多连接HTTP并发也已测过。

命令均在backend：

### 1. 先专项

`TEST_EVIDENCE_RUN_PREFIX=a14-special`（仅当前进程环境）后：

`npm run test:e2e -- --runInBand --runTestsByPath test/bind-teacher-http-fault.e2e-spec.ts --json --outputFile=.tmp/a14-bind-special-jest.json`

**13通过 / 0失败 / 0跳过；14.878s。**

### 2. 再定向回归

前缀a14-target：

`npm run test:e2e -- --runInBand --runTestsByPath test/platform-stage-one.e2e-spec.ts test/legacy-goal-authorization.e2e-spec.ts test/legacy-goal-admin-http.e2e-spec.ts --json --outputFile=.tmp/a14-target-regression-jest.json`

**3套件 / 47通过 / 0失败 / 0跳过；31.006s。** 平台权限21、A-09 13、A-11 13。包括真实课后目标创建、管理员/跨园守卫、独立SQLite连接争用、撤权删除/审计/提交失败。

### 3. 完整unit

`npm test -- --runInBand --json --outputFile=.tmp/a14-unit-jest.json`

**26套件 / 562通过 / 0失败 / 0跳过；14.376s。**

### 4. 完整后端E2E

进程环境明确设置：TEST_EVIDENCE_RUN_PREFIX=a14-full、DATABASE_PATH=:memory:、DB_SYNCHRONIZE=true、DB_MIGRATIONS_RUN=false、CLASSROOM_SUMMARY_AI_ENABLED=false。

原因：app.e2e-spec会导入AppModule，不能让它使用默认data/app.sqlite。其他用例自行使用:memory:或专用临时库。同步仅为全新空测试库建表，关闭AppModule启动自动迁移；已有migration专项是在内存库测试既有迁移，不是新增/执行正式迁移。不改.env。

`npm run test:e2e -- --runInBand --json --outputFile=.tmp/a14-full-e2e-jest.json`

**40套件 / 435通过 / 0失败 / 0跳过；201.344s；exit=0。** 没有用定向测试冒充完整E2E；无排除测试文件。包含A-07/A-09/A-11、0.5事务/ownership/政策、canonical与legacy、CommandBus恢复、A1/authoring及生命周期等当前测试断言。

日志中的人工SQL/版本约束/超时等注入异常是测试预期失败路径，最终断言全部通过；没有因此删除断言或放宽守卫。

### 5. 构建与最终专项

- npm run build、npm run type-check、npm run lint：均exit=0。
- lint发现绑定专项同步计数变量命名警告，仅重命名该测试局部变量，不改业务、断言或同步顺序；随后重新跑专项，输出`.tmp/a14-bind-final-special-jest.json`及a14-final-special前缀，**13通过 / 0失败 / 0跳过；13.498s**。又执行build/type-check/lint，最终只保留6条既有warning（A-06四条、A-08一条、Snapshot一条）。
- 完整unit/E2E是在同一最终业务实现上运行；之后只改上述局部测试变量名，并重跑最终专项。没有把各轮重复测试数量相加当作新增覆盖。

## Preservation / Remaining / Next Batch

所有历史JSON与既有非本批修改文件按本批前后SHA-256核对，未被覆盖；暂存区不变。A-13原始1通过/2失败结果继续存在，不能将历史报告当作已修正后的结果。

未改共享协调器、A-11撤权契约、AuditService、A1、authoring、奖励/考勤/点名、Operation Policy、CommandBus、前端或生命周期；无新数据库表/字段/migration。build只生成dist，不启动或部署。

尚未验证绑定自身的双应用独立连接HTTP竞争、多进程压力、断电、COMMIT完成但响应丢失、管理员身份/园所变化的全部竞争排列及其他平台写入口。共享进程队列不等于分布式锁。自动化通过不是正式环境或浏览器封版。

**仅推荐下一批：独立连接、双测试应用的绑定/撤权HTTP并发验证。** 本批停止，不进入A-15，不fetch/pull/merge/commit/push，不操作正式数据库或服务。
