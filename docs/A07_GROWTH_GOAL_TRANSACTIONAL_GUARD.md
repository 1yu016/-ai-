# A-07：createGrowthGoal 终态竞争修复

## Evidence / Root Cause

2026-10-18，feature/member-a，HEAD `09b99a81d909df6001aa0b204b3efca8eba3bba1`。承接 A-06 已留存的 201/409 竞争失败证据；本批未改写 A-06 测试、报告及 a06-* JSON。

真实调用链：RewardPanel → POST `/classroom-runs/:id/growth-goals` → ClassroomRunController → StudentRewardService.createGrowthGoal。原来的 ownedRun/assertActive 在 transactionRequired 排队前，回调直接使用旧 Run。班级目标配置没有 runId，不是发奖流水，但该 Run 入口既有终态限制必须在提交时执行。

检查 complete 的实际链路：ClassroomRunService.complete → transition → ScreenLifecycleService.transaction → claimScreenLifecycleWriter().transaction → ClassroomSnapshotService.serialSnapshotWrite → manager.transaction。其内部重新读取 Run、检查授权/device/version/转换/policy，再执行 Run CAS、结束 Snapshot/summary lifecycle 和 Event；随后事务外 ensureDraft。目标创建的 transactionRequired 使用**同一服务实例、同一 serialSnapshotWrite 队列**，不是另一条互不关联的队列。

因此本进程真实两条路径具备串行事务边界：complete 先提交则目标回调看到终态拒绝；目标先持有队列则 complete 在目标提交后执行。这没有在检查与写入之间释放队列，不需要新增锁、Run 状态或数据库字段。

## Changed

1. `backend/src/classroom-runs/student-reward.service.ts`：只修改 createGrowthGoal。保留快速前置检查；进入现有 transactionRequired 后使用其 manager 调用既有 requireRewardAccess，重读 Run、检查教师归属、班级存在/TeacherClass/已有 school 范围规则，再 assertActive。目标查询、归档、插入、时间计算一律使用权威 current.classId。
2. 新增 `backend/test/growth-goal-transactional-guard.e2e-spec.ts`：14 个隔离 SQLite HTTP 专项，单独输出 a07-* 证据，未覆盖旧测试文件。
3. 新增本报告。

只复用现有班级授权守卫，未另建权限政策；班级关系已撤销的创建现在事务内 403。未修改 canonical 发奖/撤销、考勤、点名、A1、authoring、CommandBus recovery、生命周期、DeviceSession、Online Policy 或前端。目标仍属于班级，不递增 Run version，不新增业务 Event/Snapshot/回执。不提供新的课后配置入口或持久幂等承诺。

## Tests：本次实际执行

全部使用测试新建临时 SQLite / :memory: 和合成数据。未使用正式库、启动正式服务、执行 migration。测试夹具的 synchronize=true 仅用于全新空测试库，不是正式结构同步。

### 先执行新增专项

在 backend 执行：

`npm run test:e2e -- --runInBand --runTestsByPath test/growth-goal-transactional-guard.e2e-spec.ts --json --outputFile=.tmp/a07-growth-goal-jest.json`

**14 passed / 0 failed / 0 skipped；1 suite；12.761s；exit=0。**

|场景|结果和数据库证据|
|---|---|
|normal|201；旧目标 archived，新目标 active；Run/Event/Snapshot/奖励事实不变|
|unauthorized|403；19 张核对表完全不变|
|completed/cancelled/failed-entry|均409；无归档或新增|
|completed/cancelled/failed-race|前置 running，排队期间受控事务改终态；均409，goal 完整行和摘要不变|
|owner-race|排队期间 Run.teacherId 改变；403，无目标写入|
|class-access-race|排队期间撤销 TeacherClass；403，无目标写入（夹具关系变更不属于目标请求副作用）|
|archive-save-failure|真实 SQLite UPDATE 归档后抛错；500；原目标恢复 active；19 表与请求前完全一致|
|new-goal-save-failure|真实 SQLite INSERT 新目标后抛错；500；插入和旧目标归档都回滚；19 表完全一致|
|complete-first|真实 complete HTTP 先排队，create HTTP 后排队；complete=201，create=409，goal 数1→1；最终 completed/version=2|
|goal-first|真实 create HTTP 先排队，complete HTTP 后排队；两者201，goal 数1→2，只有一个 active；最终 completed/version=2|

真实 complete 的两个场景重放 complete HTTP 后再次比较19表完整数据/摘要，未重复业务写入。无活动设备绑定的合成夹具走真实 complete 的 required Snapshot 分支，未伪造未覆盖的 SUMMARY 绑定场景。

14 场景均执行 integrity_check=ok、foreign_key_check=[]；后者只证明现有物理 FK 检查，不替代全部逻辑关联验证。故障注入 spy 均 call-through，先做真实数据库写入再抛异常，不是只 mock 一个返回失败。

证据：`backend/.tmp/a07-growth-goal-jest.json` 及14份 `a07-growth-goal-<scenario>.json`，包含 HTTP 请求/响应、Run 前置值、19表按主键排序数据和 SHA-256、完整性结果。终态受控转换与真实 complete HTTP 场景在测试分支中明确区分。

### Regression：专项通过后执行

`npm run test:e2e -- --runInBand --runTestsByPath test/student-reward.e2e-spec.ts test/classroom-run.e2e-spec.ts test/screen-lifecycle.e2e-spec.ts --json --outputFile=.tmp/a07-regression-jest.json`

**130 passed / 0 failed / 0 skipped；3 suites；15.492s；exit=0。**

- student-reward：44；目标累积、集体奖励、撤销、canonical 事务晚失败/回执/权限/CAS 等。
- classroom-run：76；包括 authoring/A1 既有定向断言、核心事务故障、READY/OPENING/SUMMARY 等现有生命周期测试。只是执行回归，未修改这些模块。
- screen-lifecycle：10；生命周期归属、revision、兼容和失效等既有测试。
- 测试输出的 late-write / late snapshot / isolated opening-summary failure 为既有故障注入日志；最终断言通过，不是被忽略的失败用例。

### 构建检查

- `npm run build`：exit=0；生成当前后端 dist，未启动或部署该构建。
- `npm run type-check`：exit=0。
- `npm run lint`：exit=0；5条既有 warning（A-06 测试4条 unused import，Snapshot service 1条无必要 spread fallback），本批未为消除警告改写旧证据或无关源码。
- 本次合计144个E2E断言通过，0失败、0跳过；不是完整后端E2E或完整unit通过声明。

## 并发证据边界

实际验证：同一隔离应用/连接下，使用现有队列受控调度的真实 complete HTTP 与真实目标 HTTP 两种排队顺序；排队时状态/权限改变；真实 SQLite 归档/插入后失败回滚。

源码分析：共用队列覆盖目标事务内检查至提交，complete 不能在此期间进入自身事务。跨独立 SQLite 连接的读快照/写锁升级失败语义仅作理论分析，本批没有以多进程、WAL竞写、断电或独立连接测试证明。没有擅自增加锁或宣称分布式串行化。此限定不影响本次已确认的同进程可达 complete 路径修复。

## Remaining / Stop

- 未重跑完整unit/E2E、浏览器、A/B联调、真实设备SUMMARY绑定和断电恢复；这些均未标记验收通过。
- 更广泛课后目标配置规则、requestId 配置幂等及多进程竞争未扩展。
- 保留既有未提交修改和历史失败证据；未 fetch/pull/merge/commit/push，未操作正式数据库或服务。
- 本批完成即停止，不进入 A-08。
