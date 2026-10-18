# A-15：双应用、独立SQLite连接的授权并发验证

## Scope / baseline

2026-10-18；项目 `D:\trae_project\new1\-ai-`；feature/member-a；HEAD `09b99a81d909df6001aa0b204b3efca8eba3bba1`。只新增专项测试和本报告，不重复修改A-11/A-14业务实现。

未连接正式数据库、启动/重启正式服务、执行生产迁移、同步远程或提交。未清理既有工作区或覆盖历史失败证据。测试仅使用全新临时SQLite和合成教师、管理员、班级、关系/目标，未发送数据给模型。

## Evidence：独立性的实际证明

每个案例都分别调用Test.createTestingModule/compile/createNestApplication/init两次：

- 应用A建立空临时库；应用B连接同一文件，synchronize=false。两者migrationsRun=false，ignoreEnvFile。没有新增表/字段/迁移代码；仅应用A用现有实体初始化全新测试库。
- 断言DataSource A !== B、QueryRunner A !== B、driver.databaseConnection A !== B；记录两个PRAGMA database_list返回的main路径相同，journal_mode均符合该用例。
- 管理员分别在两个应用通过真实POST /auth/admin/login登录；依赖教师授权的目标请求在应用B通过真实教师登录获得token。
- 真实HTTP使用POST /classes/:id/teachers、DELETE /classes/:id/teachers/:teacherId、POST /classes/:id/collective-goals；不是用两个同应用请求冒充双连接，也不是直接SQL代替业务请求。
- 两个应用在**同一个Node进程**，各自持有独立SQLite连接和FIFO。不是两个操作系统进程。其他定向回归命令的进程也不连接这些案例的库，不能据此宣称完成多进程共享数据库测试。

测试设置SQLite timeout=0，使真实写锁冲突立即返回，避免同步驱动busy等待阻塞同一事件循环。WAL和DELETE模式都实际核对PRAGMA，不把一种模式的实测泛化到所有模式或生产超时配置。

## 可控并发与数据取证

QueryRunner call-through hook在真实SQL读取后、写入后或即将写入时发出同步信号。双方到达指定阶段后才释放各自Promise屏障。没有使用随机sleep判断顺序；5秒超时仅用来在同步点无法到达时明确失败。

同时绑定/角色更新：两个事务都先读取同一旧状态，再先放行A提交、后放行B尝试旧快照写入。交错写场景：先让一方真实DML取得数据库锁，再发送另一应用的HTTP请求。锁冲突失败后，先确认观察者连接看到的数据库无失败方副作用，再释放胜出方提交，最后以新的请求验证合法重试。

每份证据包含：独立连接证明、实际HTTP请求/响应、按应用标记的BEGIN/COMMIT/ROLLBACK/DML及错误序列、事务active/depth、21张表前/中/后完整数据、行数、SHA-256，以及两连接各自integrity_check、foreign_key_check。若断言/同步提前失败，另存failure.json保存当时轨迹，不隐藏失败。

初始关系属于直接构造的合成夹具，不冒充已审计的业务请求。正式校验只比较基线之后的HTTP授权操作：每一个201绑定都对应准确relationId的teacher_class.bind审计，每一个204撤权都对应目标class/teacherId的teacher_class.unbind审计；验证失败方没有额外关系、角色、审计或课堂事实。

## Tests：本批实际结果

### 双应用专项

在backend进程设置TEST_EVIDENCE_RUN_PREFIX=a15-first后：

`npm run test:e2e -- --runInBand --runTestsByPath test/teacher-binding-dual-app.e2e-spec.ts --json --outputFile=.tmp/a15-dual-app-jest.json`

**13 passed / 0 failed / 0 skipped；1 suite；12.254s；exit=0。**

补充“早期失败也保留HTTP/SQL证据”的catch后，用a15-final前缀及`.tmp/a15-dual-app-final-jest.json`重跑：

**13 passed / 0 failed / 0 skipped；12.064s；exit=0。** 首轮输出保留，不覆盖，不把两轮重复13项相加当成26个独立用例。

|场景|模式|实际HTTP顺序与最终结果|
|---|---|---|
|parallel-bind|WAL|两应用同时读无关系；A绑定201，B旧快照写入500且无副作用；B新请求201。最终只有1条关系、observer角色、2条成功绑定审计|
|parallel-role|WAL|两应用读取同一assistant关系；A改lead201，B改observer首次500不覆盖；重试201后observer。最终1条关系、两条成功更新审计|
|bind-holds-unbind|WAL、DELETE各1项|A先写绑定/角色但未提交，B撤权500无副作用；A提交201后B重试204。最终关系不存在，绑定与撤权审计各1|
|unbind-holds-bind|WAL、DELETE各1项|A先DELETE未提交，B绑定500无副作用；A提交204后B重试201。最终observer关系1条，两类审计各1|
|goal-holds-revoke|WAL、DELETE各1项|B目标真实INSERT持锁，A撤权500无副作用；B201提交后A重试204。目标保留1条、关系撤销、撤权审计1|
|revoke-before-goal-write|WAL|B目标已读取权限但未INSERT；A真实撤权204先提交；B旧读事务写入409无目标，重新请求403。最终关系/目标均0，撤权审计1；403可新增正常拒绝审计|
|audit-bind|WAL|A真实绑定和审计INSERT后注入失败，500；应用B观察关系/审计完整回滚，再绑定201。最终关系1、绑定审计1|
|audit-unbind|WAL|A真实DELETE与审计INSERT后失败500；B观察基线完全恢复，再撤权204。最终无关系、撤权审计1|
|commit-bind|WAL|A在真实COMMIT前失败500，B观察全回滚，再绑定201。无伪造成功|
|commit-unbind|WAL|A在真实COMMIT前失败500，B观察全回滚，再撤权204。无伪造成功|

审计故障是在真实审计INSERT执行之后抛错，关系和审计确实写过并随后由事务回滚，不是只mock返回失败。提交故障是COMMIT前失败，不覆盖“COMMIT已经完成但响应丢失”。

13项中两应用最终观察到的21表数据完全一致，所有integrity_check=ok、foreign_key_check=[]。双连接锁冲突实际出现SQLITE_BUSY / SQLITE_BUSY_SNAPSHOT。被拒绝写入未产生额外Event、Snapshot、Run version或canonical/legacy课堂事实。

### 必要定向回归

前缀a15-regression，执行：

`npm run test:e2e -- --runInBand --runTestsByPath test/bind-teacher-http-fault.e2e-spec.ts test/legacy-goal-admin-http.e2e-spec.ts --json --outputFile=.tmp/a15-target-regression-jest.json`

**2 suites / 26 passed / 0 failed / 0 skipped；23.765s；exit=0。** 覆盖A-14绑定与A-11撤权的真实HTTP事务/权限/role/提交故障及单应用共享连接交错。这些是本轮重跑结果，不引用历史完整测试当作本轮通过。

按本批范围，未运行完整unit/E2E、build或浏览器/正式验收。

## Findings

1. 在本批覆盖的双应用、独立连接、受控HTTP交错中，没有发现虚假201/204、已确认授权变化丢失、无审计的成功变化或失败部分写入；未发现需要优先阻断A2的授权安全/事务一致性缺陷。
2. 不能把“13项通过”解释成双方首次并发请求都成功。当前实际语义是SQLite锁冲突失败，回滚后新请求再执行；上述表格保留首次500/409，不包装成透明重试。
3. 现有绑定/撤权未统一映射SQLite锁错误，竞争时返回500；成长目标A-09路径将同类错误映射为409。属于已观察到的错误分类/可用性限制，不是本批发现的虚假成功或授权数据破坏。本批没有修改错误处理，也没有为追求全绿规定所有冲突都应409。
4. 测试断言关心失败状态不为2xx及事实/审计无副作用，不通过放宽原业务权限、减少事务检查或伪造审计来通过。

## Changed / 证据位置

仅新增：

- `backend/test/teacher-binding-dual-app.e2e-spec.ts`
- `docs/A15_DUAL_APP_AUTHORIZATION_VERIFICATION.md`（本报告）

专项机器结果为`backend/.tmp/a15-dual-app-jest.json`与`a15-dual-app-final-jest.json`；最终13份场景证据为`a15-final-a15-dual-<name>-<journal>.json`。首轮13份与定向回归26份场景输出使用不同前缀，历史证据不覆盖。

未修改任何既有业务源码、测试、配置、数据库结构或历史文档。没有迁移、前端/运行服务变更、commit/push/pull/reset或清理工作区。只关闭并清理本批自建临时测试应用及数据库文件，合成数据JSON证据保留。

## Remaining / 阶段边界

- **已完成**：每个案例两个真实应用、不同DataSource/QueryRunner/底层连接、同一隔离SQLite文件上的真实HTTP验证。
- **未执行**：两个操作系统进程连接同库的验证、断电/强杀、随机压力/吞吐/生产busy_timeout性能、COMMIT后ACK/响应丢失、所有可能的角色/园所/账户权限变化排列。
- 不将独立连接验证当成多进程或生产封版；物理完整性ok也不替代全部业务一致性证明。
- 下一功能阶段仍固定为原计划 **A2：教师课堂驾驶舱后端**。本批未发现上述需优先阻断的授权安全缺陷，但不自动启动A2或其他修复批次；完成后停止。
