# I-2-3A 教师课堂 allowedActions 契约适配

## 结论与边界

实现及本轮自动化已完成；未进入 I-2-3B。后端冻结政策、数据库结构、播放器事件身份、作品评价及本地语音继续播放均未修改。

**原 A 目录保护核验发现一项不一致，不能声明原目录零差异。** 本批未对原 A 目录执行写入，未覆盖差异文件；原因待确认。详见 Remaining。本报告不代表浏览器验收或生产封版。

集成分支 `integration/i1-ab`，HEAD 保持 `368cf69844776e06ffba2a13973141e9dfb266f0`。保留 I-2-1、I-2-2 既有未提交修改；未 commit、push、fetch、pull 或 merge。

## 1. Before / After

### 实际接口核对

- `backend/src/classroom-runs/classroom-operation-policy.ts`：`policyAllowedActions` 是正式动作提示来源；`commandPolicyOperation` 给出命令对应的政策动作。
- `classroom-operation-context.ts/readOperationContext`：从 Run、BreakRun、有效 Snapshot、screenLifecycle 与设备绑定推导上下文；不是只看 running/paused。
- `classroom-run.service.ts/get`：普通完整 Run GET **不含 allowedActions**；CommandBus 正常 `classroomState` 使用该 GET，同样不能假设有能力列表。
- 同 service 的 `restore` 返回 `allowedActions`；screen-state 的空闲/准备/总结能力是顶层字段，不等同于任意 Run 的能力。
- 已实现的 `GET /classroom-runs/:id/cockpit`，`schemaVersion=1`，提供 `capabilities.allowedActions`、`versions.runVersion/snapshotVersion`、`run.id/deviceId`。本批复用该接口，没有新增后端接口。
- recovery 信封中的 `currentClassroomState` 不是完整 Run，仍由 I-2-1 的完整 Run 查询恢复；没有从首次业务 result 推断当前许可。

### 修改前

教师按钮多依据 paused、running、busy 等本地条件；Store 适配时丢弃能力列表。OPENING、课间或 recovery 下可能显示可执行的教学入口。

### 修改后

- Store 独立保存能力及 Run ID、设备、Run version、Snapshot version、接收时间。能力不是授权令牌。
- 普通 Run GET 没有能力时，教师页面复用 cockpit 查询；版本不一致、缺失或失败均不推断写许可，提供刷新提示。
- 能力最长缓存 6 秒，并用定时器使过期状态响应式失效；教师现有轮询应用状态时按需补查，不新增心跳或课堂状态机。
- 较旧同 Run 版本不能经 adoptRun 覆盖新状态；普通 load、I-2-1 轮询/恢复刷新、capability 查询均有相应版本/epoch/请求世代保护。
- 主要教学按钮、互动、资源队列及教师运营控制消费能力；只读奖励历史、榜单及资源搜索不作为写操作禁用。
- PAUSED 不整页禁用：恢复、现有考勤纠正及安全媒体停止按服务端许可保留。新奖励/点名/资源启动不因 status 仍为 running 而被推断允许。
- 403/409 不提示写入成功，保留后端 message，必要时查询完整状态及能力；不自动重发写命令。
- 已确认提交的 recovery 结果仍独立保留；刷新失败显示状态未同步，后续恢复走查询，不经过首次写操作能力门禁。

## 2. Action Mapping

生产映射在 `frontend/src/services/classroomCapabilities.ts`，只做标识映射，不复制后端阶段矩阵。

| 界面/请求 | 实际服务端政策动作 | 来源 |
| --- | --- | --- |
| previous_step / next_step / switch_step | change_step | commandPolicyOperation |
| open_resource / play_resource / resume_media / set_presentation | resource_start | commandPolicyOperation 的资源分支 |
| pause_media / stop_media / mute | safe_stop | commandPolicyOperation |
| previous_page / next_page / zoom / set_volume | media_control | commandPolicyOperation |
| speak_text | tts | commandPolicyOperation |
| pause_class / resume_class | pause / resume | commandPolicyOperation |
| complete_class / cancel_class | complete / cancel | commandPolicyOperation |
| update_presentation_queue | queue_edit | commandPolicyOperation |
| start_break / end_break | start_break / end_break | commandPolicyOperation |
| random / specified / group roll call | roll_call | canonical ClassroomRollCallService |
| 个人/集体新奖励 | reward | canonical StudentRewardService |
| revoke_reward | reward_revoke | canonical StudentRewardService |
| 完成/跳过开场 HTTP | complete_opening / skip_opening | ScreenLifecycle 及 Operation Policy |
| 单人/批量考勤 | attendance_new 或 attendance_correction | AttendanceService 事务内 allExisting 判断 |

考勤提示依据当前 Run 的 attendanceState 投影区分“全部已有”与首次/混合请求；没有该投影时不猜已有记录。实际执行仍由 canonical 服务在事务内查询正式记录，前端判断不能放宽后端守卫。未新增 correctionOnly 等请求字段。

### 后端阶段政策概要（非前端重建的状态机）

| 上下文 | 关键允许提示 | 教学限制 |
| --- | --- | --- |
| OPENING | 完成/跳过开场、暂停、结束/中止；既有事实纠正 | 禁止新奖励、点名、步骤推进、资源启动、TTS |
| TEACHING | 正常教学动作及既有纠正 | 继续受设备、目标、版本及权限检查 |
| PAUSED | resume、safe_stop、结束/中止、checkpoint、既有纠正 | 禁止新教学动作；PAUSED 优先于开场 |
| TEACHING + break | end_break、结束/中止、既有纠正 | 不放开新的教学动作 |
| recovery | recover、takeover、safe_stop、结束/中止 | 不广告未批准的纠正语义 |
| completed/cancelled/failed | 查询及合法后续流程 | 不追加本次课堂事实 |

completed Run 的 cockpit 不会被前端猜成大屏正在 SUMMARY。真正 SUMMARY 的 close_summary 能力来自现有屏幕生命周期接口；本批未改总结页面。READY 是已有 preparation，不制造虚假 Run。

## 3. Changed

### 生产代码（仅独立集成目录）

- `frontend/src/services/classroomCapabilities.ts`（新增）：命令到真实政策动作的显式映射。
- `frontend/src/stores/lessonRun.ts`：保留能力字段、独立版本化能力缓存/失效/查询、教师命令包装及拒绝后查询；保持原 command 与 recovery 回执语义。
- `frontend/src/views/LessonClassroomView.vue`：教师状态提示、刷新入口、开场/步骤/资源/结束/互动能力提示及点击检查。
- `frontend/src/views/ClassroomOperationsView.vue`：canonical 命令消费、考勤/奖励/课间/快捷控制能力提示。活动摘要缺少考勤投影时读取完整 Run，不凭摘要猜测纠正资格。
- `frontend/src/composables/usePresentationQueue.ts`：复用 teacherCommand，暴露队列编辑、展示与安全媒体控制能力。
- `frontend/src/components/classroom/ClassroomQuickActions.vue`、`ClassroomStepSidebar.vue`、`LivePresentationPreview.vue`、`PresentationQueuePanel.vue`：具体按钮按相应动作提示。
- `frontend/src/components/classroom/operations/useClassroomInteraction.ts`、`ClassroomInteractionPanel.vue`、`InteractionFullscreenView.vue`：点名与新奖励分别检查，确认 props Run 与 Store Run 的 ID/设备/版本相符。
- 同 operations 目录的 `AttendancePanel.vue`、`RewardPanel.vue`、`RemoteControlPanel.vue`：单人/批量考勤、新集体奖励及快捷控制提示。

### 测试与报告

- 新增 `frontend/tests/unit/classroom-capabilities.spec.ts`。
- `interaction-fullscreen.spec.ts` 增加 OPENING/PAUSED 界面断言，保留 I-2-1 恢复断言。
- 既有教师展示测试夹具补显式能力；暂停、开场夹具分别给出对应能力，未删除旧断言。
- 相关夹具涉及 `ClassRewardDrawer`、`ClassroomInteractionPanel`、`ClassroomOperationsView`、`attendance-panel`、`avatar-three-state`、`components`、`lesson-classroom-{break,complete,fullscreen,leaderboard,rightcol}`、`reward-system` 与 `presentation-queue` 测试。
- 本报告。Git 总差异还包括先前 I-2-1/I-2-2 文件，不能全部记为本批改动。

## 4. Tests — 本轮实际执行

证据目录：`D:\trae_project\new1\integration-I1-evidence`。

| 范围 | 结果 | 证据 |
| --- | --- | --- |
| 能力、恢复、播放器身份及教师互动最终契约专项 | 4 文件，47 通过，0 失败/跳过 | i2-3a-contract-delivery.log |
| 开场、考勤、奖励、运营及能力专项 | 5 文件，40 通过，0 失败/跳过 | i2-3a-targeted-final.log |
| 完整前端 unit/component | 89 文件，696 通过，0 失败/跳过 | i2-3a-full-delivery.log |
| 后端定向 E2E | 6 文件，90 通过，0 失败/跳过 | i2-3a-backend-directed.log |
| typecheck | 退出码 0 | i2-3a-typecheck-delivery.log |
| build | 退出码 0 | i2-3a-build-delivery.log |
| ESLint（不带 --fix） | 退出码 0，无诊断 | 本轮执行回执 |
| diff whitespace check | 退出码 0 | 本轮执行回执 |
| 原 A / I0 保护校验 | **未通过：一个原 A 文件哈希不同** | 见下方原始哈希证据 |

命令：

```text
frontend: npm test -- --pool=vmThreads --maxWorkers=1 [专项文件...]
frontend: npm test -- --pool=vmThreads --maxWorkers=1
frontend: npm run type-check
frontend: npm run build-only
frontend: node node_modules/eslint/bin/eslint.js .
backend: npm run test:e2e -- --runInBand attendance-canonical.e2e-spec.ts roll-call-canonical.e2e-spec.ts student-reward.e2e-spec.ts classroom-operation-policy.e2e-spec.ts correction-operation-policy.e2e-spec.ts legacy-write-inventory.e2e-spec.ts
```

后端测试使用内存 SQLite 或自行创建的临时隔离 SQLite，ignoreEnvFile；未连接正式数据库。日志中的 late snapshot failure 是既有故障注入用例，不是忽略失败。未运行完整后端 E2E，不冒充全后端回归。

保留中间失败日志：初始专项 9 个失败、首次完整回归 11 个失败，主要暴露缺失能力夹具、开场/暂停夹具、RewardPanel 新 Store 依赖及组件 Boolean props 默认值；随后补明确夹具与 Pinia。另一次 attendance-panel 夹具插入位置错误导致解析失败，已修正，未删除断言或放宽生产权限。最终专项及完整测试均通过。jsdom canvas 提示、Vue Router 测试挂载提示及构建 chunk 警告仍保留。

## 5. Teacher Acceptance（合并后待执行，不代表本轮已验收）

1. 打开教师课堂，先确认能力完成查询。断网或能力过期时，写操作不可用，能看到刷新入口。
2. OPENING：只操作完成/跳过开场、暂停、结束；点名、发奖、步骤推进和资源播放不应显示可执行。
3. TEACHING：尝试步骤、资源队列、点名、奖励与考勤，确认成功才更新结果。
4. PAUSED：恢复可用；新奖励、点名及资源启动不可用。运营页对已有考勤可以纠正，对未记录学生及混合批次不应因纠正能力而放开。
5. 课间仅展示合法结束课间等控制；recovery 不显示正常教学许可；结束课堂后不追加本次事实。
6. 另一端改变阶段或版本后点击旧界面，应看到后端拒绝并刷新，不自动重发写入；对恢复成功但查询失败的奖励/点名，保留首次业务结果，仅重新查询。

## 6. Remaining / 保护异常

### 必须确认：原 A 文件变化

保护脚本全量扫描仅报告以下源目录文件哈希差异；本批未对该文件执行写入，也没有覆盖或回退它：

`D:\trae_project\new1\-ai-\frontend\src\components\classroom\ClassroomPartnerPanel.vue`

- I0 SHA-256：`9E68AD494D9AE1D01C98A6EAD1899FEA3D26FB719C74ABC84AC39DDBA6CB82CE`
- 原 A 当前 SHA-256：`29910BC4C7CD9044C5FCBD4BFA8277F3C11A4F42190C5D8D95A4FDFAC6088B93`
- 原 A 文件 LastWriteTimeUtc：`2026-10-18T18:00:49.3272778Z`
- 独立集成目录与 I0 restore-verification 中同一文件仍等于 I0 哈希。
- 校验脚本未报告其他备份/恢复产物哈希差异；原 HEAD/index/status 比较没有触发元数据异常。但源文件完整性核验整体不能记为通过。

变化原因未确认，不将其归因于具体人员或进程。发现后停止代码修改，只记录取证和已启动测试结果，等待用户确认是否属于并行修改。

### 接口与验证限制

- 普通 Run/CommandBus 完整状态没有能力字段，需要补查既有 cockpit；两个查询版本不一致时保守禁用并提供刷新，不把 cockpit 当完整 Run DTO。
- 能力只代表阶段提示，不代表教师授权、学生 active/班级资格、资源可用、设备匹配或 durable requestId 校验已通过。
- 成长目标属于配置，当前没有该操作的独立 policy action，保留已有后端权限/事务守卫，不擅自映射成 reward。未新增撤销按钮；既有服务端纠正能力未修改。
- 本批没有收口 CommandRuntime/本地语音音频继续播放路径；仍由现有后端守卫兜底，本地继续播放问题专留 I-2-3B。未扩大 3E legacy 语义。
- 未执行浏览器、真实设备或 A/B 联合验收。自动化全绿不等于生产封版。

## 7. Next Batch

仅建议 I-2-3B：在确认原 A 文件变化后，单独检查本地语音继续/恢复播放的入口与异步音频归属；复用已有 allowedActions，防止暂停、开场、恢复或结束后本地音频绕过阶段提示继续播放。不改后端政策、播放器 observation 身份、作品评价或移动端 TTL。本批不实施。
