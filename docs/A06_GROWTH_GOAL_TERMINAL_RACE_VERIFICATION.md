# A-06：createGrowthGoal 终态竞争窗口核查

## Scope / baseline

- 2026-10-18；项目 `D:\trae_project\new1\-ai-`；分支 feature/member-a；HEAD `09b99a81d909df6001aa0b204b3efca8eba3bba1`。
- 本批只增加专项测试和本报告，未修改业务实现或政策。未操作正式数据库、启动正式服务、执行迁移或 Git 同步/提交。
- 历史 A-05 归档是来源索引，不作为本次重新通过的测试。原有 dirty worktree、未跟踪文件和失败证据保留。

## Evidence：业务性质与真实调用链

`RewardPanel.createGoal → POST /classroom-runs/:id/growth-goals → ClassroomRunController.createGrowthGoal → StudentRewardService.createGrowthGoal → requireTeacher → ownedRun → assertActive → 安全文本检查 → snapshotService.transactionRequired → archive active goal + insert new goal → COMMIT`。

源码依据：

- `backend/src/classroom-runs/classroom-run.controller.ts:221`：真实 HTTP 入口；DTO `dto/classroom-run.dto.ts:123` 继承 requestId，要求 title 和 targetPoints。
- `student-reward.service.ts:328–377`：ownedRun 校验 Run 所属教师；assertActive 拒绝 completed/cancelled/failed；二者都在事务排队前。事务内部没有重新读取 Run。
- `entities/class-growth-goal.entity.ts`：class_growth_goal 只有 classId、教师、目标和进度等字段，没有 runId/studentId。classId/status 索引并非唯一索引。
- `student-reward.service.ts:382–436,501–542`：集体奖励验证目标归属和最新目标；dashboard 按班级读取；canonical 奖励事务确定性重建目标进度。目标替换将旧 active 归档，历史保留。
- `classroom-snapshot.service.ts:121`：transactionRequired 先进入共享队列，再使用同一 manager 开事务；本方法借用事务协调能力，并不调用 captureRequired。
- `classroom-operation-policy.ts` 没有 growth-goal operation。4E 报告将其列为配置边界，并未声明统一阶段保护。

回答业务性质：

1. 它是长期班级成长目标配置及其奖励进度，不是一次 Run 的奖励正式流水。
2. Run 是当前创建入口的授权/可写上下文，目标本身属于班级；会影响后续课堂读取的班级当前目标。
3. 现实现不要求 Run CAS、业务回执 Event 或 Snapshot。不能因本次竞争就擅自将配置升级为课堂事实、增加 Run version 或引入第二套事实源；所需最小保护是事务内复核现有入口守卫。
4. 没有证据证明所有课后班级目标管理都应禁止。但**当前 Run 路径明确拒绝终态创建**，必须一致执行这个既有规则。更广泛课后配置能力仍待产品定义，不能直接归类 C 并忽略当前守卫。

## 隔离复现

新增测试 `backend/test/growth-goal-terminal-race.e2e-spec.ts` 复用已有 HTTP 重放测试的模块/实体和 teaching 夹具方式。每场景创建全新系统临时目录 SQLite、合成教师/班级/学生/Run；ignoreEnvFile；仅在空测试库建立 schema，migrationsRun=false。不连接 backend/data/app.sqlite，不启动监听正式端口或调用模型。

竞争注入只存在于测试：占用真实 Snapshot 串行事务队列；启动真实 HTTP create 请求，call-through spy 在其通过 ownedRun/assertActive、实际进入 transactionRequired 时通知；确认 Run=running；释放前序事务，在其 manager 内提交 Run=completed/version=2；真实创建随后写入。没有生产故障开关。此处是受控终态数据库转换，**不是完整 complete HTTP/生命周期联调**。

|场景|预期|实际|结论|
|---|---|---|---|
|running 正常替换目标|201；归档旧目标、新目标 active|201；只有 goal 表变化|通过|
|其他教师请求|403；数据库不变|403；19 张核对表不变|通过|
|请求到达时已 completed|409；数据库不变|409；19 张核对表不变|通过|
|前置检查后、写入前 completed|409；不得创建/归档目标|201；旧目标 archived，新目标 active|失败：现有终态守卫被竞争绕过|

竞争场景证据：前置 running/version=1 → 受控终态提交 completed/version=2 → HTTP 201，新目标 id=2；goal 行数 1→2，原 id=1 active→archived。19 张表按主键排序比较完整数据及 SHA-256：只有 Run（测试终态转换）和 class_growth_goal 改变；个人/集体奖励、考勤、点名、Event、Snapshot 等未变化。没有第二条奖励事实；一次创建只插入一个目标，只有一个 active；classId/createdByTeacherId 对应合成夹具，不声称数据库无 FK 时 PRAGMA 能证明全部逻辑关联。

四个场景 integrity_check=ok、foreign_key_check=[]。测试结束关闭应用并清理本批新建临时数据库；保留 JSON 数据证据和失败断言。

## Tests（本次实际执行）

在 backend 下执行：

`npm run test:e2e -- --runInBand --runTestsByPath test/growth-goal-terminal-race.e2e-spec.ts --json --outputFile=.tmp/a06-growth-goal-jest.json`

- 4 tests：3 passed / 1 failed / 0 skipped；1 suite failed；45.491s；命令 exit=1。
- 失败是业务边界验收断言 Expected 409 / Received 201，未修改断言包装成通过。
- 本批未运行完整 E2E、历史奖励专项、unit/build/lint，也未声称这些回归已重新通过。发现实际缺口后按要求停止业务改动。
- 机器证据：`backend/.tmp/a06-growth-goal-jest.json`；`backend/.tmp/a06-growth-goal-{normal,unauthorized,terminal-entry,terminal-race}.json`。含真实响应及19表前后数据/摘要，全部为本批合成数据。

## Findings / 最小修复建议（未实施）

分类 **A：当前 Run 创建入口的终态守卫存在真实 TOCTOU 缺口**，不是“已结束课堂新增奖励事实”，也不是证明所有课后配置都非法。根因是 prequeue Run 对象在事务内被继续使用。

建议下一批仅在现有 transactionRequired 内，以同一 manager 重新读取 Run、复核原教师归属和 assertActive，再决定目标归档/创建；不新增阶段政策、不改变 paused/prepared 既有语义、不增加 Event/Snapshot/CAS 或 schema。保留前置校验用于快速拒绝，但不可依赖它保证提交时可写。修复后复跑红色竞争测试并补目标保存中途失败的真实事务回滚证据。多连接并发若需更强条件写/锁，应单独分析，不冒称单进程队列解决所有并发。

## Remaining / Next Batch

- 尚未验证 cancelled/failed 竞争（源码共用同一终态判定）；完整 complete、设备断电、多进程/多连接终态竞争未覆盖。
- 本批没有在目标归档/插入间注入失败；不将配置事务结构审查当作已经验证所有回滚路径。
- requestId 在此方法未用于持久幂等，不据此扩展本批到配置重放改造；课后配置产品语义也未改变。
- 浏览器验收、A/B 合并联调继续延期；不作生产封版结论。
- **仅推荐下一批：修复此入口事务内 Run 权限/终态复核，并补保存晚失败回滚测试。**本批不执行修复。
