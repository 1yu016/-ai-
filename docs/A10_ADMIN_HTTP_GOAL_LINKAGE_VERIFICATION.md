# A-10：管理员HTTP撤权与旧createGoal联动验证

## Evidence：真实调用链和契约

2026-10-18；项目 `D:\trae_project\new1\-ai-`；feature/member-a；HEAD `09b99a81d909df6001aa0b204b3efca8eba3bba1`。本批仅新增测试与报告，未修改A-07/A-09或其他业务实现。

- `DELETE /classes/:classId/teachers/:teacherId`，无请求体，成功204。PlatformController（根路由，AuthGuard，两个路径参数ParseIntPipe）→ PlatformService.unbindTeacher → requireAdministrator → requireClassAccess → teacherClasses.delete → AuditService.write → 返回。
- `POST /classes/:classId/collective-goals`，CreateCollectiveGoalDto：title、可选description、targetValue；成功201实体。ClassroomEngagementController（根路由、AuthGuard）→ ClassroomEngagementService.createGoal。
- 管理员真实登录 `POST /auth/admin/login`，LoginDto，200；普通教师登录 `POST /auth/login`，200。测试创建真实Administrator实体并使用管理员登录HTTP获得token，不伪造授权成功。
- 管理员账户类型或teacher/admin角色可执行撤权；仍受已有园所隔离。普通teacher非admin不得撤权。AuthService验证账户状态/tokenVersion并从实体补权威schoolId。
- 旧createGoal仅teacher账户类型可创建，班级配置无Run终态要求。A-09在共享Snapshot队列内开事务，以manager重读权限，并用附授权条件的INSERT再次核验；SQLITE_BUSY家族回滚为409。旧配置没有归档步骤；历史目标不应被新创建改变。

源码依据：`backend/src/platform/platform.controller.ts` unbindTeacher；`platform.service.ts:295–312`；`platform-access.service.ts:30–98`；`auth/auth.controller.ts:27–48`及AuthGuard；`classroom-engagement.controller.ts:105`；`classroom-engagement.service.ts:269–307`；A-09报告。本批未根据方法名猜测路由和返回码。

## Tests：本次实际执行

新增 `backend/test/legacy-goal-admin-http.e2e-spec.ts`。每场景创建全新临时SQLite、合成教师/管理员/班级/学生/Run，先创建一个已提交目标。ignoreEnvFile，migrationsRun=false；仅新空测试库初始化结构；无正式端口、正式库、模型调用或业务部署。

真实HTTP覆盖教师/管理员登录、目标创建及每次撤权。同步点仅为测试call-through hook：在真实SQL插入之后暂停目标事务，发起真实管理员DELETE；不mock权限结果或伪造204。Snapshot队列等待场景同样通过真实服务排队后发HTTP撤权。

在backend执行：

`npm run test:e2e -- --runInBand --runTestsByPath test/legacy-goal-admin-http.e2e-spec.ts --json --outputFile=.tmp/a10-http-goal-jest.json`

**6 passed / 1 failed / 0 skipped；1 suite failed；8.931s；exit=1。**

|场景|HTTP结果与最终数据库|结论|
|---|---|---|
|normal|教师创建201；有效TeacherClass保留；目标1→2，原目标不变|通过|
|revoke-first|管理员撤权204完成后创建403；关系1→0，目标仍1|通过，普通顺序测试|
|unauthorized-teacher|普通教师撤权403；关系/目标不变，允许新增拒绝审计|通过|
|cross-school-admin|真实外园管理员撤权403；关系/目标不变，允许新增拒绝审计|通过|
|waiting-revoke|创建通过前置检查并在队列等待；管理员HTTP204，释放前序事务后创建403；最终关系0/目标1|通过最终状态检查；不能据204推断当时已独立提交|
|locked-revoke|创建事务已真实INSERT，管理员HTTP204，然后创建201；最终关系0/目标2/一条撤权审计|通过，但共享事务问题不能据此排除|
|locked-revoke-rollback|创建已INSERT，管理员HTTP204，随后创建故障500；最终关系重新出现，撤权审计消失|失败：已确认新可靠性缺口|

全部场景完成PRAGMA integrity_check=ok、foreign_key_check=[]。21张表记录行数、按id排序完整数据及SHA-256，包含TeacherClass与audit_log，不再遗漏这两个实际受影响对象。业务Event/Snapshot/Run及奖励/考勤/点名等未因配置操作新增；拒绝权限请求的审计属于原契约允许的变化。

发现真实缺陷后未运行额外回归、build/typecheck/lint或完整unit/E2E；没有把A-09的历史通过结果记成本轮通过。

## Findings：可复现的新缺陷

失败请求记录：

1. POST创建目标，真实受保护INSERT在事务中执行，目标行数1→2。
2. 在该事务尚未提交时，实际管理员HTTP DELETE返回204。
3. 事务内取证：TeacherClass已由1→0；audit_log出现一条teacher_class.unbind。
4. 测试在真实INSERT与HTTP撤权均执行后抛异常，创建HTTP返回500。
5. 事务结束后：目标回滚到1条（正确），但TeacherClass由0→1，已返回204的撤权被撤销；teacher_class.unbind审计由1→0。

失败断言 `expect(relations.count).toBe(0)`，实际1，保留不放宽。JSON在断言前保存完整证据。该场景没有第二次授权恢复请求；关系重新出现来自另一请求的事务回滚，不是产品允许的再次绑定。

源码/驱动证据：BetterSqlite3Driver.createQueryRunner缓存并返回同一QueryRunner（当前依赖实现第40–42行）；EntityPersistExecutor在QueryRunner已处于事务中时不会独立开始/提交事务；PlatformService.unbindTeacher在调用方未建立独立事务协调的情况下使用普通repository DELETE和AuditService.save。因此同一DataSource上的并发HTTP撤权加入了目标创建的未提交事务，返回204却没有独立提交；创建回滚同时回滚撤权及其审计。

**这是已验证的同进程、同DataSource、真实HTTP重叠请求故障，不是仅缺测试证据。** A-09跨连接SQLITE_BUSY/授权条件保护没有因此被证明失效；本次暴露的是撤权入口未遵守共享连接的事务协调边界。没有为了验证结果修改A-09实现。

## 最小修复建议（未实施）

仅针对unbinding写入口，复用同一实例现有事务协调队列，使授权复核、DELETE及撤权审计使用同一manager并在自身事务COMMIT后才返回204。它不得在另一个请求的事务中“顺带执行”；队列必须在开事务前获取，禁止事务内重新排队自等待。保留原管理员/园所权限、204及无关系404契约，不新增表、状态或锁系统。

落地前核查AuditService可复用manager的方式及Platform模块依赖，避免为一次撤权重构所有平台写接口。这里仅给建议，不认为当前已有该能力。如果依赖注入或事务接口需要扩范围，下一批先明确最小文件边界。

修复后的同步测试不能继续强制“持有创建事务等待撤权先返回204”，否则正确排队实现会被测试自锁。应让DELETE请求开始并验证其排队，释放/失败创建事务，再等DELETE完成，检查撤权在独立提交后持久存在；保留本批原始失败证据。

## Changed / Remaining / Next Batch

- 仅新增测试、本报告、7份 `backend/.tmp/a10-http-goal-<scenario>.json` 和 `a10-http-goal-jest.json`；未修改既有源码、测试、历史报告或证据。
- 本批使用真实HTTP请求、受控SQL执行时点和同一隔离DataSource；不是多进程压力、两个独立HTTP应用实例或断电测试。独立连接数据库争用属于A-09历史证据，不计为本轮验证。
- 未验证撤权自身审计失败、绑定写入口、其他平台写入共享事务风险，不据此宣称它们也存在缺陷或全部安全。
- 未部署、重启正式服务、操作正式数据库、迁移或Git同步/提交。阶段不能据此宣称全部通过。
- **仅推荐下一批：收口管理员unbindTeacher的事务协调与204提交语义，保证创建失败不会回滚已确认撤权。**本批停止，不自动修复或扩展其他模块。
