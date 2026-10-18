# A-13：bindTeacher 隔离HTTP故障验证

## Scope / baseline

2026-10-18；项目 `D:\trae_project\new1\-ai-`；feature/member-a；HEAD `09b99a81d909df6001aa0b204b3efca8eba3bba1`。承接A-12只读审查，本批仅新增隔离测试和本报告，不修改业务实现。

没有连接正式数据库、启动/重启正式服务、执行migration、Git fetch/pull/merge/commit/push或清理既有工作区。

## Evidence：真实入口

- POST `/classes/:classId/teachers`，请求`{ teacherId, role: 'assistant' }`，AuthGuard → PlatformController.bindTeacher → PlatformService.bindTeacher。
- 管理员是实际Administrator实体，通过POST `/auth/admin/login`真实登录获得token。目标教师是同园、尚无该班级关系的合成Teacher；创建目标的教师是另一个拥有原班级关系的合成教师。
- 当前bindTeacher在platform.service.ts:260–294：管理员/班级/目标教师/园所检查；查existing后普通TeacherClass.save；单独AuditService.write；返回实体201。没有共享FIFO、事务manager或独立提交检查。
- 当前目标入口POST `/classes/:classId/collective-goals`走A-09实际manager事务与受保护INSERT；A-11已让该事务使用DataSource共享FIFO，但bindTeacher未加入队列。
- AuditService.write在未传manager时使用注入仓储。BetterSqlite3Driver.createQueryRunner第40–42行缓存相同QueryRunner；EntityPersistExecutor第139、155行只在自身启动事务时才自行提交。

## 隔离测试与可靠时序

新增 `backend/test/bind-teacher-http-fault.e2e-spec.ts`，每场景全新系统临时目录SQLite、合成身份/班级/学生/Run及一个已提交旧目标。ignoreEnvFile，migrationsRun=false；只在全新空测试库初始化表。不调用真实AI或使用真实幼儿信息。

三项均通过真实HTTP绑定接口，不mock授权成功。测试hook只在实际SQL执行位置控制故障：

1. 跨请求场景：真实目标INSERT已执行、事务未提交时，call-through EntityManager.query hook发起真实管理员绑定HTTP；收到绑定响应后读取事务内数据，然后主动抛错使目标事务真实ROLLBACK。不是随机延迟或时间推测。
2. 审计场景：在QueryRunner实际准备派发audit_log INSERT、且参数对应teacher_class.bind时注入异常；TeacherClass INSERT已实际执行并COMMIT。审计的事务随后真实ROLLBACK。故障是SQL派发位置模拟异常，不声称测试了真实磁盘IO故障或数据库损坏。
3. 正常场景：没有注入异常，关系与审计均检查。

SQL追踪记录相关BEGIN/COMMIT/ROLLBACK及关系、审计、目标INSERT的before/after、事务active/depth。每项在失败断言前保存HTTP请求、响应、前/中/后数据和SQL追踪，首次失败结果保留不覆盖。

## Tests：本次实际执行

在backend执行：

`npm run test:e2e -- --runInBand --runTestsByPath test/bind-teacher-http-fault.e2e-spec.ts --json --outputFile=.tmp/a13-bind-http-jest.json`

**1 passed / 2 failed / 0 skipped；1 suite failed；4.469s；exit=1。**

没有为通过修改断言；没有在本批自动修复。未运行完整E2E、回归、unit、build/typecheck/lint，不引用历史通过结果冒充本次通过。

### 正常路径：通过

- HTTP201，返回新关系id=2、teacherId=3、classId=1、role=assistant。
- 原有关系1条，新目标教师关系从0→1，全表teacher_class从1→2；teacher_class.bind审计0→1。
- SQL追踪有2次完成的COMMIT，无ROLLBACK；HTTP返回时无活动事务。即关系与审计分别提交，但成功路径两者均在。
- 21张核对表仅teacher_class和audit_log变化；旧目标保持不变。

### 场景1：跨请求事务污染，确认缺陷

- 目标事务真实INSERT后，管理员绑定HTTP201，返回新关系id=2；该响应时共享QueryRunner仍isTransactionActive=true。
- 事务内证据：teacher_class由1→2，目标教师关系存在；teacher_class.bind审计1条；目标配置临时新增。
- 随后目标抛错，目标HTTP500；SQL追踪0次COMMIT、1次完成的ROLLBACK。
- 最终teacher_class回到1条，目标教师关系消失；绑定审计回到0；旧目标仍在，新目标回滚。
- 21张表最终摘要与请求前全部一致，但客户端已经收到201，说明此次绑定不是独立持久提交。
- 红色断言：成功绑定在无任何解绑请求时应仍有1条目标关系，实际0。

### 场景2：审计写入失败，确认缺陷

- 关系INSERT真实COMMIT后，审计INSERT派发失败；绑定HTTP500，没有错误地返回成功。
- SQL追踪1次完成COMMIT、1次完成ROLLBACK；回滚仅覆盖审计事务。
- 目标教师关系仍有1条（全表由1→2），teacher_class.bind审计0条；仅teacher_class表摘要发生变化。
- 红色断言：失败绑定不应留下无审计的关系，期望目标关系0，实际1。
- 因此缺陷是“HTTP失败但授权已生效且无对应审计”，不是“审计失败仍返回201”。

三个场景均integrity_check=ok、foreign_key_check=[]；完整性正常不能替代业务原子性。没有绑定后的解绑、历史合并或修复数据动作。测试App结束后仅清理本批新建临时数据库；JSON合成数据证据保留。

## Evidence files

- `backend/.tmp/a13-bind-http-jest.json`
- `backend/.tmp/a13-bind-http-normal.json`
- `backend/.tmp/a13-bind-http-audit-insert-failure.json`
- `backend/.tmp/a13-bind-http-cross-request-rollback.json`

每个场景记录21张表完整排序数据、行数、SHA-256；包括TeacherClass、audit_log、两个目标表、Run、业务Event、Snapshot、canonical和legacy奖励/考勤/点名等。授权/审计之外无新增课堂事实。未把账号密码或Bearer token写入证据。

## Findings / Proposed Fix（未实施）

两个真实业务缺陷均已复现，不再只是源码推测；正常路径对照通过。根因分别是共享QueryRunner中跨请求隐式加入事务，以及无外层事务时关系与审计分别提交。

建议下一批仅让bindTeacher复用A-11既有DataSource协调器和未协调活动事务保护，在取得队列后开启自身事务：用同manager复核原管理员/班级/教师/园所条件，查询/新增或更新关系，再通过已有AuditService.write(manager)写审计；全部COMMIT后才返回原201实体。保留已有角色更新、园所权限和缺失对象错误，不新增schema/锁、业务状态或配置功能。

修复后的竞争测试需采用A-11已验证的“启动绑定请求、确认排队、结束/回滚目标事务、再等绑定提交”同步方式。不能在持有目标事务时硬等正确排队后的绑定返回，造成测试自锁。原A-13失败JSON必须继续保留。

## Remaining / Stop

- 本轮是同一测试应用/DataSource上两个真实HTTP请求的确定性交错，不是独立进程/多连接HTTP压力、断电或文件系统故障。
- 未覆盖existing关系的角色更新失败、绑定/解绑并发、重复并发绑定、身份/园所变更竞争或提交后响应丢失；不声称它们已通过或都有缺陷。
- 仅新增测试和本报告及4份JSON；未改bindTeacher、unbindTeacher、A-07/A-09、其他业务模块、数据库结构或配置。保留全部既有修改和历史失败证据。
- 本批停止，等待下一批安排，不自动进入修复。
