# A-08：成长目标同域写入边界审查

## Baseline / scope

2026-10-18；feature/member-a；HEAD `09b99a81d909df6001aa0b204b3efca8eba3bba1`。仅审查、隔离测试和新增报告，不修改业务实现。保留 A-06/A-07 原报告、测试、结果和其他未提交工作。未连接正式数据库、启动正式服务、迁移、Git 同步或提交。

扫描 backend/src 与相关 frontend 调用、两个目标实体及迁移定义、PlatformAccessService、canonical 奖励事务及已有目标故障测试。没有把配置创建与奖励事实混为一谈，也没有将两个表的数字 ID 自动关联。

## Evidence：全部已发现的目标写入口

|入口 / 实际调用链|归属 / 写入|权限、终态和事务|判断|
|---|---|---|---|
|POST /classroom-runs/:id/growth-goals → ClassroomRunController.createGrowthGoal → StudentRewardService.createGrowthGoal|class_growth_goal；班级配置，不绑定Run；自动归档旧active，插入新active|A-07：前置检查，取得共享队列后同manager requireRewardAccess + assertActive；归档与插入同事务；不新增Run CAS/Event/Snapshot|已有修复保留；两请求同进程并发当前只保留一个active|
|POST /classroom-runs/:id/rewards → createReward → writeReward → recalculateCurrentGoal|个人奖励是Run事实；目标进度为班级投影|事务内权限、receipt/digest、首次阶段政策、Run CAS；正式流水/目标/Event/required Snapshot同manager|未发现独立目标写入旁路|
|POST /classroom-runs/:id/rewards/:rewardId/revoke → revokeReward → writeReward → recalculateCurrentGoal|撤销原奖励，重算对应班级目标窗口|同上；成功请求重放先于首次政策，不重新累加目标|无需本批修改|
|POST /classroom-runs/:id/collective-rewards → createCollectiveReward → writeReward → recalculateCurrentGoal|集体奖励为Run事实；可关联新goalId；目标进度更新|同上，事务内校验同班、目标非archived且最新|无需本批修改|
|POST /classroom-runs/:id/collective-rewards/:rewardId/revoke → revokeCollectiveReward → writeReward → recalculateCurrentGoal|集体撤销、目标进度重算|同manager写正式记录/目标/Event/Snapshot|无需本批修改|
|POST /classes/:classId/collective-goals → ClassroomEngagementController.createGoal → ClassroomEngagementService.createGoal|collective_goal；独立班级配置，无Run或studentId|requireTeacher + requireClassAccess 在单独 goals.save 之前；没有调用方事务内权限复核；不检查Run终态|存在可复现的授权检查至写入窗口，见下|
|POST /classes/:classId/growth/adjust → adjustGrowth|旧独立成长值写入|教师/班级权限后 rejectLegacyWrite；不更新目标或旧成长流水|保持3E拒绝，非恢复功能|

补充边界：

- 目标实体没有学生归属。新目标没有独立 UPDATE/PATCH/DELETE/归档HTTP；旧目标同样未发现编辑、删除、归档入口。新目标归档仅发生于创建替换；进度/status/completedAt 更新仅见 recalculateCurrentGoal。
- CommandBus 正式奖励和保留的legacy奖励adapter最终进入上述 canonical 服务，不另建目标写链。旧 engagement 独立成长值、规则/徽章等未支持语义仍拒绝，未发现旧 collective_goal 进度继续被这些路径更新。
- 两套目标不是同一对象：旧配置可多条active且不自动归档，代码/约束没有声明它只许一个当前目标；不能将这个现象直接判为重复缺陷。legacy历史读取 classGrowth 输出 legacy_engagement/goal 身份；新版 rewardDashboard 读取 class_growth_goal，未自动合并。
- 源码依据：classroom-engagement.service.ts:269–308；classroom-engagement.controller.ts:105；dto CreateCollectiveGoalDto；entities/collective-goal.entity.ts；student-reward.service.ts:175–210,282–292,350–421,521–546；classroom-run.controller.ts:190–249。

## Findings：确认缺陷

**旧 createGoal 班级授权 TOCTOU，非终态政策缺陷。**

真实路径：requireClassAccess读取班级/园所与TeacherClass，返回后 → goals.save 新配置。测试只包装真实 requireClassAccess：先执行原始成功检查，随后在隔离库提交删除该教师TeacherClass，再返回原结果。createGoal 随后真实HTTP 201、collective_goal 0→1；数据库确认TeacherClass为0。期望现有授权边界为403、不得写配置；失败断言保留。没有mock授权为成功，也没有修改生产服务行为。

这是确定性测试调度的权限撤销交错，**不是双进程或两个真实浏览器请求竞速**。撤销使用测试夹具数据库写入，而不是未经检查的新权限管理API。它证明创建服务没有写入时复核授权；不声称已测试所有管理角色/跨园所并发。

19张核对业务表仅 collective_goal 有变化；无新 canonical/legacy奖励、考勤、点名事实、Event或Snapshot。TeacherClass是测试主动撤销，不混称为请求业务副作用。常规越权请求可能写审计日志，audit_log不在这19表中，因此“不变”只指已列出的业务表，不宣称所有数据库表完全不变。

最小修复建议（未实施）：仅让旧配置createGoal在同一个写入事务里，使用该manager重新确认现有班级/园所/TeacherClass及既有管理员语义，再插入。不能用Run守卫替代独立配置权限，也不能照搬canonical服务而丢失原有管理员访问规则。应复用现有事务协调、核实权限撤销路径的并发语义；若跨连接保证需要新锁/结构，单独报告，不在本批引入。

## Tests：本次真实执行

全部合成教师/班级/学生/课堂，新建临时SQLite或:memory:，ignoreEnvFile，无正式端口/模型调用；测试用空库建表，不运行迁移。原有历史JSON不覆盖。

### 1. 新增审查专项

`npm run test:e2e -- --runInBand --runTestsByPath test/growth-goal-write-boundary-audit.e2e-spec.ts --json --outputFile=.tmp/a08-goal-audit-jest.json`

**5 passed / 1 failed / 0 skipped，7.665s，exit=1。**

|场景|实际结果 / 分类|
|---|---|
|legacy-normal|201；只新增旧目标配置；合法行为|
|legacy-after-complete|先调用真实complete HTTP成功，再创建旧班级目标201；不改已结束Run/Event/Snapshot；独立课后配置允许，不能误判终态缺陷|
|legacy-unauthorized|403；无业务表写入；原权限拒绝保留|
|legacy-access-race|预期403，实际201；真实缺陷，红色断言保留|
|legacy-concurrent|两个真实HTTP同时创建不同配置，两条201、两条active；没有丢失请求，不据此推断违反唯一目标规则|
|canonical-concurrent|两个真实HTTP同时创建不同新目标，两条201、两条记录且只有一个active；新目标替换逻辑仍正常；未多递增Run或写业务Event/Snapshot|

6场景完整性ok、物理foreign_key_check=[]。并发验证限同进程应用，不等同跨连接竞争。JSON记录19表按id排序的完整内容、行数、SHA-256、HTTP响应和TeacherClass关系。

### 2. 过滤执行的测试基线失败（保留证据）

`npm run test:e2e -- --runInBand --runTestsByPath test/student-reward.e2e-spec.ts --testNamePattern="共同目标|collective reward is one|prior-goal|failure=goal" --json --outputFile=.tmp/a08-goal-regression-jest.json`

**2 passed / 1 failed / 41 skipped，3.141s，exit=1。**

失败在第14用例合作荣誉断言，不是创建/回滚失败。该用例共享整组夹具，依赖之前个人奖励产生cooperation_star；过滤执行跳过了这些前序数据，其本次集体奖励不在dashboard的个人荣誉候选中。没有修改测试或业务、没有删除断言；以原完整测试文件再次执行以恢复其原有数据上下文。pattern中的failure=goal也未匹配真实命名的late goal failure，不据此声称覆盖故障矩阵。

### 3. 原完整奖励专项回归（非完整后端E2E）

`npm run test:e2e -- --runInBand --runTestsByPath test/student-reward.e2e-spec.ts --json --outputFile=.tmp/a08-goal-regression-full-jest.json`

**44 passed / 0 failed / 0 skipped，4.55s，exit=0。**

包含正常成长目标、个人/集体奖励与撤销的进度重建、历史目标撤销、新目标不受旧目标撤销污染，以及4类操作×4类record/Event/Snapshot/goal晚失败的真实SQLite事务回滚。目标save真实写入后抛错时，正式流水、目标、回执、Run CAS和Snapshot整体回滚。同请求重放和权限断言通过。故障日志中的late snapshot failure为注入预期。

以上三个结果分别报告，不能把过滤失败或已确认权限失败合并抹掉，亦不能把44通过说成全量后端通过。A-07配置归档/创建晚失败14专项属于历史证据，本批未重跑以避免覆盖原a07证据。

## Transaction / constraints review

- 新createGrowthGoal归档/创建不分段，重建进度也用writeReward传入manager，没有新开事务或重新排Snapshot队列；故障回归证据与源码一致。
- 旧createGoal仅插入一条配置，无先归档后创建；Repository.save自身事务不能补救事务外授权读取。这次没有证据证明它存在多步部分归档/删除问题，因为不存在这些调用步骤。
- 新目标classId/status索引不唯一；旧目标只有classId索引。没有以数据库约束冒称跨进程唯一active保护。新目标依赖同进程共享队列与现有SQLite事务；跨进程/连接丢失更新或唯一active风险未复现，列待验证而非确认缺陷。
- terminal限制应按入口区分：新Run入口仍执行原终态限制；独立旧配置不凭Run终态禁止；奖励驱动目标进度受原canonical首次/重放/纠正守卫，不将课后新发奖伪装成配置维护。

## Changed / Remaining / Next Batch

仅新增 `backend/test/growth-goal-write-boundary-audit.e2e-spec.ts`、本报告，以及6份场景JSON、3份Jest JSON证据。业务源码、已有测试/报告/证据不改。未执行build/lint/unit、完整后端E2E、正式浏览器或A/B联调。

未验证：多进程/独立连接、权限管理真实并发请求、断电、DB拒绝legacy单INSERT及跨园所/管理员权限竞争。没有把这些未知项表述为通过或缺陷。

**仅推荐下一批：修复旧createGoal事务内班级授权复核，并补配置插入晚失败回滚和原管理员语义兼容测试。**本批不自动实施，不扩展其他模块。
