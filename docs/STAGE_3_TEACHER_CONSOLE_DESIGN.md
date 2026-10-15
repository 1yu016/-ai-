# AI幼儿园智慧课堂阶段三——教师课堂工作台产品与前端架构设计书

日期：2026-10-12。版本：设计评审版 1.0。

本文件中的“阶段三”指本次教师课堂工作台体验设计阶段，区别于原十阶段任务分配中的“阶段三 AI备课”。本轮只新增设计资料及独立评审原型，不修改正式业务代码、不创建迁移、不提交或推送。

## 1. Executive Summary

建议采用 Layout B（Presentation + Control），保留 C 的可折叠教学主线。教师打开课堂后，中央首先展示“已确认的学生呈现”；右侧保留资源、随机点名、奖励、AI伙伴四项高频操作；完整教案、资源查找、AI草稿均放在教师专属抽屉。

现有 LessonPlan、ClassroomRun、Snapshot、Resource、Reward、DeviceSession、MobileSession 等领域能力保留。主要改动是 LessonClassroomView 的组件组织和前端展示层，不能新增第二个权威 ClassroomRun Store。大屏与教师预览共用只读展示组件，但只有正式大屏负责媒体声音、实际播放与运行回执。

需要提前解决的两个契约缺口：当前没有通用“切换到数字人/荣誉展示”的正式呈现命令；服务端接受命令不等于大屏已实际渲染。本阶段先利用现有快照和命令完成资源/点名/奖励闭环，再以最小扩展补上呈现模式和播放回执。未经确认，不把“预览”称为已同步的实时镜像。

## 2. Phase 3 Goals

老师扫一眼能回答：孩子看到什么、课堂进行到哪里、下一步是什么、我可以临时做什么。打开教案/资源抽屉不会改变孩子画面。点名一次点击发命令，奖励优先选择最近互动幼儿，语音复用同一套命令确认和执行机制。结束、离开、暂停、课间分别有明确行为。

成功指标是任务完成速度和状态一致性，不是新页面或组件数量。首轮关注 1440×900、1366×768 和 1024px 笔记本。

## 3. Preserve Domain, Refactor Experience Principle

本方案没有 REPLACE/REMOVE 决策。KEEP 保护领域规则；REUSE 复用已有行为；REFACTOR 调整 UI 或修复具体调用缺口。教师工具的布局变化不得改变班级权限、奖励事务、设备身份、命令幂等、课堂恢复及数字人绑定优先级。

若后续提出替换，必须另写 ADR，列出现状、实证问题、局部修复为何不足、调用方、数据/API兼容、测试、阶段一二资产损失和收益，审核后才执行。

## 4. Stage 1 / Stage 2 Asset Reuse Matrix

这里列入当前项目已有的全部相关资产，包含后续阶段已经实现的能力，不把它们误标为阶段一二新增内容。

| Existing Asset | Current Responsibility / Evidence | Status | Phase 3 Decision | Reason | Risk |
|---|---|---|---|---|---|
| LessonPlan | `backend/src/lesson-plans`，课前设计与版本 | 已存在 | KEEP | 已有保存/冲突/资源引用规则 | 课堂期间读取实时原稿会污染快照 |
| LessonStep | 教案步骤、资源与动作 | 已存在 | KEEP | 课前设计源 | 不应成为强制教学脚本 |
| ClassroomRun | `classroom-run.service.ts`，一次课堂、权限/版本/设备 | 已存在 | KEEP | 单一课堂事实 | 导航误触不能结束 Run |
| ClassroomRunStepSnapshot | `entities/classroom-run-step-snapshot.entity.ts` | 已存在 | KEEP | 步骤冻结、原步骤 ID、提示、资源 | 目标说明尚有实时读原教案路径 |
| Resource Library | `api/resources.ts`、`stores/library.ts` | 已存在 | REUSE | 鉴权、审核、搜索、分片上传 | picker 不能展示未审核资源 |
| ResourcePlayer | `components/ResourcePlayer.vue` | 已存在 | REFACTOR | 保留鉴权加载/格式适配，增加嵌入只读展示模式 | 同页两个实例可能互抢播放器 |
| Random Roll Call | 后端 `classroom-command.service.ts` | 已存在 | REUSE | 权威公平点名、考勤过滤、幂等与记录 | 当前 UI composable 仍本地随机 |
| Reward | `student-reward.service.ts`、reward command | 已存在 | REUSE | 权威奖励和撤销 | 历史直连奖励入口是否触发展示需验证 |
| Classroom Screen | `ClassroomScreenView.vue` | 已存在 | REFACTOR | 保留设备/实时/恢复；提取共用展示 | page 仍含步骤文案关键词推断 |
| Mobile Remote | `ClassroomMobileRemoteView.vue` | 已存在 | REUSE | 会话、心跳和命令复用 | 服务端确认和大屏执行需区分 |
| Avatar | `avatars`、`DigitalHumanStage`、`ClassroomAvatar` | 已存在 | REUSE | 保留模型加载、降级和绑定 | 教师2D伙伴与实际3D角色应明确标注 |
| DeviceSession | `device-session`、`stores/deviceSession.ts` | 已存在 | KEEP | 设备身份与心跳 | 在线不等于媒体已经开始 |
| Summary | `classroom-record.service.ts`、summary view | 已存在 | REUSE | 事实聚合+教师确认 | 学生庆祝总结与教师复盘不同 |
| Classroom Records | `ClassroomHistoryView`、`ClassroomRecordView` | 已存在 | REUSE | 按班级列表和事实时间线 | 不混入后台敏感信息到大屏 |
| Voice / ASR | `services/voiceCommand.ts`、`recordingAudio.ts` | 已存在 | REUSE | 录音、ASR、确认与失败处理 | 当前主要为点击录音，不能宣传持续监听 |
| Command Bus | `services/classroomCommandBus.ts` | 已存在 | KEEP | requestId/expectedVersion/source | 不新建平行总线 |
| lessonRun Store | `stores/lessonRun.ts` | 已存在 | KEEP | 本地缓存后端课堂状态 | selector 对象不能成为另一个 Run |
| resourcePlayer Store | `stores/resourcePlayer.ts` | 已存在 | REFACTOR | 屏端运行状态与教师只读预览分开 | claim event 会相互抢占 |
| digitalHuman Store | `stores/digitalHuman.ts` | 已存在 | REUSE | 动作表现和模型运行 | 前端动作不是后端课堂状态 |
| classroomCommand Store | `stores/classroomCommand.ts` | 已存在 | REFACTOR | 保留识别，统一执行出口 | 候选意图不代表已经执行 |
| classroomAssistant / Director | 相应 Stores、AI草稿/确认 | 已存在 | REUSE | 儿童内容人工确认 | 不能自动播放未确认回答 |
| LessonClassroomView | 当前教师课堂编排 View | 已存在 | REFACTOR | 页面中心从文本换为学生呈现 | 需渐进改造保留事件绑定 |
| ClassroomPartnerPanel | 2D伙伴卡、全屏入口、DEV调试 | 已存在 | REFACTOR | 缩为伙伴状态入口，保留模型能力 | 当前 enter-avatar 只本机全屏 |

## 5. Current Architecture Audit

审查基于当前工作区源码，包含前两轮未提交改动。没有把历史截图当作当前视觉证据；以下为代码审查发现，不是本轮真实课堂实测结论。

| ID | 代码证据 | 当前行为 | 对教师的影响 | 判断 |
|---|---|---|---|---|
| C01 | `LessonClassroomView.vue` 的 `.step-card/.center-scroll` | 中央堆教案、助教、导演、语音卡片 | 孩子实际画面没有成为视觉中心 | 重组 UI |
| C02 | `useClassroomInteraction.ts::randomRoll()` | `Math.random()` 本地选人并 emit | 不应用后端公平/考勤规则，也未形成权威点名记录 | 复用正式命令修复调用 |
| C03 | `LessonClassroomView` 的 InteractionFullscreenView 事件绑定 | 绑定选中和 rewarded，未绑定 random-roll | 本地点名不等于多端点名 | 加统一 command action |
| C04 | `openFullscreen('avatar')` + Teleport | 只打开教师浏览器全屏 | “进入数字人大屏”易被误解为推送大屏 | 分开“教师放大预览/学生切换” |
| C05 | `ClassroomScreenView::hydratePlayer()` | 恢复快照，并 `openResource(resource,false)` | 命令已接受不能证明音视频已真实播放 | 明确 autoplay policy 与回执 |
| C06 | `classroom-run.service.ts::screenState()` | 通过步骤 title/content 中绘画、奖励等关键词决定 page | 文案会改变画面；课堂临时展示难表达 | 增加显式呈现优先级 |
| C07 | `ResourcePlayer` + `resourcePlayer` Store | 全局单实例状态及 claim event | 共用预览容易关闭另一个播放器或双重发声 | 读模型/运行播放器分离 |
| C08 | `classroom-run.service.ts::readObjectives()` | 仍向当前 LessonPlan 查询 objectives | 开课后原教案目标变化可能影响展示 | 目标冻结的局部契约修复 |
| C09 | `ClassroomPartnerPanel.vue` | DEV 环境展示调试面板 | 实际教师使用 dev 服务时看到技术控件 | 显式调试开关与正常界面分离 |
| C10 | `classroomRealtime.ts` / lessonRun polling | 2s课堂轮询、屏端 SSE + 备用轮询 | 不同端时延和失败状态未统一表达 | 复用通道，新增同步状态 |

保留以上模块。不是以这些局部问题为理由重写整个后端。

## 6. LessonPlan / ClassroomRun Boundary

LessonPlan/LessonStep 是课前版本；ClassroomRun 是真实课堂；ClassroomRunStepSnapshot 是开课时冻结的教学主线。完整教案 Drawer 在运行课堂读取 Run.steps 快照，而非重新拉实时教案。查看原教案只能另开教师侧只读预览并明确“课前原稿，非当前课堂快照”。

当前已冻结 title/content/teacherTip/expectedResponse/resourceId/actionConfig 等步骤字段，应全部复用。`readObjectives()` 的实时原稿查询是已确认缺口：优先把目标说明放入开课初始快照 JSON 的 lessonContext 再回读，评估兼容后决定实现；不新增 V2 Run 表。老课堂若缺目标快照，显示“该历史课堂未保存目标快照”，不得将现在原稿伪称当时目标。

步骤序号表示教师当前位置，不表示所有较早步骤已完成。教学主线允许跳过、返回、临时活动，再回到原步骤；有明确事件才显示完成标记。

## 7. Teacher Console / Classroom Screen Boundary

Teacher Console 是控制台；Screen 是播放终端；Mobile 是遥控器。教师打开 Drawer、预览资源、修改AI草稿、查看设置，均不发课堂呈现命令。只有“展示/播放/切换学生画面/发放奖励”等明确动作才更新 Screen。

“教师放大预览”是本地 UI；“数字人全屏展示”是学生 Presentation 命令。名称和按钮必须区分。预览是共享语义状态的渲染，非像素投屏；需要像素级远程屏幕流是另一产品能力，本阶段不开发。

## 8. Teacher Real Classroom Task Analysis

频率是当前产品假设，不是已有用户研究数据；试点时记录操作频次和完成时间校准。

| 任务 | 教师目标 | 目标动作数 | 是否影响大屏 |
|---|---|---:|---|
| 看孩子当前画面 | 确认实际内容与播放状态 | 0 | 否 |
| 随机点名 | 快速选出可参与幼儿 | 1 | 是，正式结果覆盖 |
| 奖励最近互动幼儿 | 正向鼓励并记录 | 1–2 | 是，正式成功后动画 |
| 翻页 | 延续当前展示 | 1 | 是 |
| 临时放儿歌 | 不改变当前教学环节 | 2–3 | 是，播放时 |
| 看完整教案 | 找教师提示 | 1–2 | 否 |
| AI给提示 | 获得启发式草稿 | 2–3 | 确认后才是 |
| 返回原环节 | 结束临时展示继续教学 | 1 | 是，恢复呈现上下文 |

## 9. Current UX Problems

教案文字抢占中心；高频点名奖励藏在“课堂互动”全屏；数字人卡常驻占右栏而工具拥挤；播放器是独立覆盖层，难保持整体控制；识别状态、AI草稿和执行反馈分散。当前画面与实际学生呈现存在语义差异，不能只通过 CSS 排列解决。

## 10. Current Navigation Problems

前两轮已经补齐角色布局、返回、403/404、课堂记录列表和教师首页，本阶段不重复建设。剩余：登录无 redirect 时默认仍是我的班级；教师首页为新增入口；教案没有独立正式只读预览页；课堂中本地全屏按钮命名易与实际 Screen 混淆；页面重用切换 runId 时的恢复及未保存状态需测试；步骤/资源/课间退出优先级尚需统一。

## 11. Target Information Architecture

教师日常工作围绕班级、备课、资源与复盘；进入正式课堂后导航改为课堂操作，不出现后台侧栏。临时资源、AI、奖励都是课堂内部操作，不跳学生管理页。

## 12. Target Page Tree

```text
Teacher Workspace
├─ Teacher Home / My Classes
├─ Class Detail / Student List / Student Detail
├─ Lesson Preparation
│  ├─ Lesson List
│  ├─ Lesson Editor
│  └─ Lesson Preview（先 Drawer，复杂阅读再升级 Route）
├─ Preflight
├─ Teacher Classroom Console
├─ Summary
└─ Classroom History / Classroom Record

独立：ClassroomScreen、MobileJoin/Remote
```

## 13. Target Route Architecture

保留 `/teacher/home`、`/my-classes`、`/lesson-plans`、`/lesson-plans/new`、`/lesson-plans/:id/edit`、`/classroom/preflight/:planId`、`/classroom/lesson/:runId`、`/classroom/lesson/:runId/summary`、`/classroom/history`、`/classroom/records/:runId`、`/classroom/screen/:deviceId?`、`/classroom/remote`。

不为每个工具新建 Route，不为了路径整齐迁移已有二维码。TeacherHome 推荐成为教师无 redirect 的登录首页，实施时统一 authNavigation、403/404、品牌入口并更新测试；原 `/my-classes` 继续可用。

## 14. Navigation & Back Strategy

业务上级优先，显式安全来源保留列表筛选；浏览器历史仅辅助；Direct URL 用命名路由兜底。标题名称用实体 API 或 Run 快照，班级ID不依赖第一页列表查找。

| Page / Current Route | Entry | Primary Back | Next | Refresh | Direct URL | Special / Layout |
|---|---|---|---|---|---|---|
| Teacher Home `/teacher/home` | 登录/品牌 | Chat或工作台首页 | 班级/备课/继续课堂 | 重读负责班级和active run | 登录守卫 | TeacherLayout |
| My Classes `/my-classes` | 首页/侧栏 | 教师首页 | 班级详情 | 恢复分页筛选 | 后端班级范围 | TeacherLayout |
| Lesson List `/lesson-plans` | 班级/备课 | 当前班级详情或首页 | 编辑/预览/Preflight | 保留classId及筛选 | 无班级仍可备课 | TeacherLayout |
| Editor `/lesson-plans/:id/edit` | 列表/预览 | 原备课列表 | 保存后保持编辑或显式开始课堂 | id重新加载 | 403/404有出口 | 未保存确认；TeacherLayout |
| Preflight `/classroom/preflight/:planId` | 教案 | 原教案列表/预览 | 开始课堂 | 校验绑定和在线，重读资源 | 不自动开课 | 独立准备布局 |
| Console `/classroom/lesson/:runId` | Preflight/继续 | 教师首页 | 结束→Summary | restore(runId,deviceId) | 授权和终态检查 | 离开≠结束；RuntimeLayout |
| Summary `/classroom/lesson/:runId/summary` | 正式结束 | 课堂记录详情 | 班级/记录 | 重读run/rewards | 终态检查 | 无再次结束按钮 |
| Record `/classroom/records/:runId` | History/Summary | 原记录列表或History | 导出/修改总结 | 重读时间线和确认结果 | 权限检查 | 未保存保护；TeacherLayout |

## 15. Classroom Exit Policy

| 动作 | 教师体验 | 对 ClassroomRun | 大屏 | 处理 |
|---|---|---|---|---|
| Browser Back / 返回 / Home | 运行/暂停时确认 | 不变 | 当前内容继续 | 路由离开守卫 |
| Refresh | 浏览器提醒，重进恢复 | 不变 | 不依赖教师页面寿命 | 丢弃临时Drawer，回读快照 |
| Close Tab | 浏览器允许的提醒 | 不变 | 当前内容继续 | 不在 unload 发结束命令 |
| Logout | 提示失去控制需重登录 | 不变 | 当前设备继续 | 撤销教师会话；设备独立会话行为真机验收 |
| Pause | 明确暂停课堂 | paused | 视频/音频是否暂停按已有后端语义，界面明确 | 正式 pause_class |
| End Classroom | 二次确认 | completed | 课堂总结 | complete_class 成功后再导航 |
| Cancel Classroom | 二次确认、说明中止 | cancelled | 安全终态 | cancel_class |
| 临时关Drawer | 立即关闭 | 不变 | 不变 | Escape/关闭按钮 |

当前代码已存在离开/刷新保护，应复用而非叠加第二套弹窗。

## 16. Teacher Console Information Hierarchy

第一层：学生当前呈现，内容标题、模式、页码、实际播放状态、同步可信度。第二层：当前环节与下一环节、暂停/结束。第三层：高频工具。第四层：完整教案、AI草稿、榜单、记录、设置。

同步状态显示“已同步 14:23:10 / 正在切换 / 已发送待大屏确认 / 大屏离线 / 预览过期”；不展示 version、requestId 或原始JSON。后台诊断入口与儿童画面分离。

## 17. Layout A — Stage First

```text
┌─班级/课题────计时────同步────暂停/结束─┐
│                学生呈现                 │
│              （占据主要面积）           │
├─上页─播放─下页─────────────────────────┤
│当前环节/下一步  点名  奖励  资源  AI     │
└─教师提示───────────────────────────────┘
```

适合简单授课和触屏，工具展开后容易遮挡 Stage，复杂多步骤课堂需要反复切换。

## 18. Layout B — Presentation + Control

```text
┌─班级/课题────计时────同步────暂停/结束─┐
│ 学生呈现                       │ 点名 │
│                                │ 奖励 │
│                                │ 资源 │
├─上页─播放─下页─────────────────┤ AI   │
│ 当前环节 → 下一环节            │ 更多 │
└─教师提示/语音状态/完整教案─────────────┘
```

主界面两列，流程用底部简要信息和可折叠 Rail，笔记本保留足够舞台面积。

## 19. Layout C — Teacher Cockpit

```text
┌─班级/课题────计时────同步────暂停/结束─┐
│教学主线│ 学生呈现                 │工具│
│1 开场  │                          │点名│
│2 观察  ├─翻页/播放────────────────┤奖励│
│3 找一找│ 当前提示/下一环节          │AI  │
└────────┴─────────────────────────┴────┘
```

同时可见信息多，适合熟练用户；1366×768 若三列都常驻，舞台和文本容易拥挤。

## 20. Layout Comparison

| Dimension | A | B | C |
|---|---|---|---|
| 学习成本 | 低 | 低到中 | 中 |
| 操作速度 | 简单课堂快，复杂需展开 | 高频固定位置快 | 熟练用户快 |
| 注意力负担 | 低 | 中低 | 中高 |
| 信息清晰度 | 内容清晰，流程弱 | 内容+工具清晰 | 信息丰富但竞争 |
| 1366×768 | 优 | 优 | 需默认折叠Rail |
| 1440×900 | 优 | 优 | 可用 |
| 后续扩展 | 一般 | 抽屉扩展好 | 容易按钮仓库 |
| 现有复用 | Player/Overlay多 | Player/Tools/Drawer多 | Sidebar复用最多 |
| 改造成本 | 中 | 中 | 视觉低，重排后仍需状态修复 |

## 21. Recommended Layout

推荐 B，提供可展开的 C 风格主线。不要根据屏幕宽度变换四项高频工具顺序。1440×900 可展开 176px Rail；1366×768 默认折叠为“教学主线”按钮；1024px 保留舞台和四项工具，教师提示为一行、更多使用抽屉。

推荐尺寸：顶部64px、底部提示56px、右栏240px、外边距24px、栏间距20px；1440默认舞台可用宽度约1050px，16:9预览最大宽1040px，高585px；1366×768舞台按可用高度收缩，工具固定，页面无横向滚动。均以原型实际尺寸再验收。

## 22. Full Wireframes

完整尺寸线框、12种课堂状态、资源/教案/奖励抽屉见 `prototypes/classroom-console-vnext/WIREFRAMES.md`。独立 HTML 原型支持三套布局与状态切换、教师抽屉和模拟命令反馈；所有人物/时间/资源均为设计示例，不连接正式API，也不证明真实功能已实现。

## 23. Resource Drawer

右侧420px（1024px时居中宽屏Dialog），先当前课堂快照资源，再已审核且有权资源库，再收藏。当前环节资源置顶，不改变正式 Resource 数据模型。列表包含类型、标题和“教师预览/展示或播放”。教师预览只读，不调 playerStore.openResource，不发命令。点击展示才发 open_resource/play_resource。

搜索携带 request cancellation/generation，过期结果不覆盖新搜索；单个不可用资源明确错误，不关闭整个课堂。资源 Drawer 默认不改变当前Step；播放临时儿歌后“返回教学内容”恢复之前的呈现，而不是跳下一步。

## 24. Lesson Drawer

读取当前 Run.steps 快照，显示目标、教师提示、资源、当前环节和下一个环节。浏览、展开和关闭不发命令。点击“跳到这个环节”使用 switch_step 二次确认（如果正在播放临时媒体），执行成功后更新主线。不要把编辑教案入口放进这个 Drawer；课前原稿编辑属于后台流程。

## 25. Random Roll Call

高频按钮直接发 `random_roll_call`。等待服务端时教师看到“正在选择”，大屏保留原内容；成功后渲染服务端 student.displayName/recordId，提供“奖励/再点一个”。失败只显示教师反馈，不先宣布一个本地随机名字。`useClassroomInteraction` 保留选中、奖励反馈和表单，重构 randomRoll 的执行出口，删除本地选择作为正式结果的行为，不替换后端。

头像复用 StudentAvatar 和授权规则；未授权使用默认形象。避免显示学号、缺勤原因或负面信息到大屏。

## 26. Reward

点击奖励优先最近权威点名幼儿，其次教师当前选中幼儿；再显示搜索。默认奖励原因与1朵小红花使用现有规则，可展开原因/徽章。连续双击锁按钮；失败重试使用同一个requestId直到结果明确；用户主动再发一次才生成新requestId。

调用现有 reward_student/PostReward 经统一 adapter，采用正式记录后再动画和更新累计。展示动作与记录事实分别标识：奖励保存成功但大屏离线时不撤销已保存事实，显示“奖励已保存，展示待恢复”。

## 27. Leaderboard

本节：`GET /classroom-runs/:id/rewards`；班级累计：`GET /classes/:classId/rewards/leaderboard`。顶栏标签明确范围。默认教师查看，不推学生端；“向孩子展示荣誉”需要正式呈现命令。儿童端展示轮换、多维度正向荣誉，避免直接大面积展示竞争性总分排序。保留现有两个数据来源，不合并为一份本地总分。

## 28. Digital Human

默认无资源时展示已绑定数字人；图片/PPT/视频资源展示时不强制同屏叠放数字人，符合此前产品要求。数字人本地放大仅教师预览；“切换学生画面到数字人”使用明确呈现命令。保留 GLB/glTF/VRM 加载、动作、表情、2D降级和 Avatar Run Snapshot。

教师2D伙伴卡与大屏3D模型不是天然同一角色，状态栏要依据实际绑定角色；模型缺失显示降级标识给教师，孩子只看到友好备用角色。Teacher preview 静音，不启动第二个TTS。开场当前是本地UI阶段，不能宣称已被大屏同步；正式跨端开场作为呈现模式单独验收。

## 29. Voice UX

待命→用户点击录音→正在录音→正在识别→识别成功（可修改）→执行中→成功/失败/待确认。现有 click-to-record 复用，原型“监听”指用户已启动录音，不是全天持续监听。识别得到“随机请一个小朋友”后归一化为现有命令。

资源多候选或低置信度显示底部轻量候选；结束/中止、跨步骤等高风险操作必须确认。错误不影响课堂Step，支持重录和取消。麦克风权限、噪音、识别延时分别有提示。不在教师端和屏端同时播报同一TTS。

## 30. AI Assistant UX

默认显示“AI教学伙伴·待命”和一个入口，不占中央聊天大框。展开后保留现有草稿、编辑、确认播放、教师自行讲述、弃用。生成并非执行；确认才进入 command。AI导演建议放在教师提示条/抽屉，仍使用 V2草稿和确认接口。故事/出题/小游戏未确认有正式接口的部分在正式UI暂不启用；原型示例不作为已实现承诺。

## 31. Teacher / Student Display Matrix

| Content | Teacher Console | Classroom Screen | Priority |
|---|---|---|---|
| LessonPlan全文 | 快照Drawer | 不显示 | P1 |
| 当前Step | 标题+位置 | 仅适龄活动标题 | P0 |
| 教师提示 | 底部+Drawer | 不显示 | P0 |
| 下一Step | 简短文字 | 不显示 | P1 |
| PPT/图片 | 只读预览+翻页控制 | 实际呈现 | P0 |
| 视频 | 静音预览、实际状态 | 唯一实际播放/声音 | P0 |
| 音频状态 | 播放名/进度/控制 | 配套适龄画面 | P0 |
| Resource Picker | 教师Drawer | 不显示 | P0 |
| Random Roll Call | 控制/结果/奖励入口 | 成功后名字动画 | P0 |
| Reward | 对象/原因/记录 | 成功后正向动画 | P0 |
| Digital Human | 已绑定角色的预览 | 默认独立呈现 | P0 |
| Leaderboard | 本节/班级范围 | 显式确认后正向荣誉 | P1 |
| AI Status | 待命/草稿/执行 | 不显示技术状态 | P1 |
| Voice Status | 录音/识别/候选 | 教师确认的最终内容 | P1 |
| System Settings | 教师低频入口 | 不显示 | P2 |

## 32. Frontend Layer Architecture

Router→各终端Layout→LessonClassroomView编排→Feature Components→既有Store/Composable→Service/API→Backend。高频按钮调 `useClassroomActions`，内部复用 lessonRun.command；组件不写 axios；View 逐步移出ASR/TTS/录音细节，但不改变接口契约。

`presentationSelectors` 从后端快照派生当前画面。它是纯只读模型，不复制/保存Run。主屏与预览共用 `PresentationSurface`；播放器运行控制只有 Screen owner。未完成Screen ack契约前只标记“已发送/基于快照的预览”。

## 33. Component Architecture

```text
LessonClassroomView（编排/route runId/退出）
├─ ClassroomHeader（重构，不另建重复TopBar）
├─ ClassroomStepSidebar（可折叠教学主线）
├─ LivePresentationStage
│  └─ PresentationSurface（只读模式）
├─ ClassroomQuickActions
├─ TeacherHintBar / VoiceStatusIndicator
├─ LessonSnapshotDrawer
├─ ClassroomResourceDrawer
├─ InteractionFullscreenView / RewardPanel（复用）
├─ FullscreenLeaderboard（教师查看）
└─ ClassroomPartnerPanel / Assistant / Director（缩为按需面板）

ClassroomScreenView → PresentationSurface（屏端模式）
ClassroomMobileRemoteView → 原mobile store/command
```

不同时挂载两个会 dispatch claim event 的 ResourcePlayer。先做 presentation-only 图片/PDF，再受控接入视频/音频。

## 34. State Ownership Matrix

| State | Type | Authority | Frontend Owner | Persistence | Refresh | Multi-device |
|---|---|---|---|---|---|---|
| ClassroomRun | Domain | 后端 | lessonRun缓存 | 数据库 | restore | version同步 |
| Current Step | Domain | 后端Run快照 | lessonRun selector | 数据库 | restore | command |
| Presentation | Presentation | 后端呈现快照/屏端回执 | 只读presentation selectors | 现有snapshot JSON | 回读 | SSE+回执 |
| Resource Player | Runtime/Presentation | 后端目标，屏端实际播放 | screen player，教师只读 | checkpoint | 自动播放安全恢复 | 状态回执 |
| Fullscreen Mode | Teacher UI | 本浏览器 | View/ui composable | 不持久化 | 默认关闭 | 不同步 |
| Lesson Drawer | Teacher UI | 本浏览器 | ui composable | 不持久化 | 关闭 | 不同步 |
| Resource Drawer | Teacher UI | 本浏览器 | ui composable | 搜索临时 | 关闭 | 不同步 |
| Roll Call | Domain+Presentation | 后端选人 | lessonRun/interaction selector | 正式记录+快照 | 恢复最后结果，不重放动画 | recordId去重 |
| Reward | Domain+Presentation | 后端记录 | 既有Reward查询缓存 | 数据库 | 重读，动画不重复 | recordId/event去重 |
| Digital Human | Domain绑定/Runtime动作 | Avatar快照/本地动画引擎 | digitalHuman | 绑定后端，渲染本地 | 加载绑定降级 | 语义动作同步 |
| Voice State | Runtime | 麦克风/ASR请求 | voice composable | 不保存录音状态 | 待命 | 不复制麦克风 |
| Mobile Session | Runtime/security | 后端会话 | classroomMobile | 原sessionStorage令牌 | 校验/重连 | 单课堂授权 |

## 35. Store Architecture

保留 lessonRun、resourcePlayer、digitalHuman、classroomCommand、classroomAssistant、classroomDirector、classroomMobile、deviceSession。新增优先是 composable/pure selector，而非大 Store：`useTeacherConsoleUi` 管Drawer；`useClassroomActions` 统一执行；`presentationSelectors` 纯派生；`useScreenPresentation` 管真实渲染回执。服务端 Domain 不进入本地假数据库。

预览资源不能调用共享 resourcePlayer Store。ASR成功文字不直接成为 Presentation，AI草稿不直接进入TTS。错误和离线是 Runtime，不改变Run终态。

## 36. Existing → Target Mapping

| Existing File/Module | Current Role | Target Role | Action |
|---|---|---|---|
| LessonClassroomView | 多功能大View | 课堂编排壳 | REFACTOR |
| ClassroomHeader | 进度与计时 | 班级/课题/同步/安全退出 | REFACTOR |
| ClassroomStepSidebar | 常驻环节列表 | 可折叠主线 | REFACTOR |
| ClassroomControlBar | 步骤和课堂控制 | 保留生命周期，媒体控制分开 | REFACTOR |
| ResourcePlayer | 全屏式统一播放 | 保留加载能力+只读嵌入模式 | REFACTOR |
| useClassroomInteraction | 本地点名+正式奖励 | 调正式点名命令/奖励，保留反馈 | REFACTOR |
| InteractionFullscreenView | 点名奖励全屏 | 可选放大控制/结果 | REUSE |
| ClassRewardDrawer/RewardPanel | 奖励列表/发放 | 快速奖励与最近互动 | REUSE |
| FullscreenLeaderboard | 两类榜单 | 教师查看，范围不混 | REUSE |
| ClassroomPartnerPanel | 常驻数字人卡 | 精简伙伴状态/按需展开 | REFACTOR |
| ClassroomVoiceControl | 指令输入卡 | 语音条/候选确认 | REFACTOR |
| ClassroomAssistantPanel | 大草稿面板 | Copilot Drawer | REFACTOR |
| ClassroomDirectorPanel | 建议卡 | 教师提示与Drawer | REFACTOR |
| ClassroomScreenView | 设备/播放器/展示 | 运行宿主+共享呈现 | REFACTOR |
| ClassroomMobileRemoteView | 移动控制 | 保持会话与高频按钮 | REUSE |
| ClassroomCommandBus | 正式命令 | 唯一执行通道 | KEEP |
| Backend领域模块 | 各领域规则 | 保持边界 | KEEP |

## 37. Backend Impact Analysis

绝大多数布局、Drawer、快捷工具和教案显示：No backend change required。点名改用已有 `random_roll_call`，资源复用 `open_resource/play_resource`，奖励复用 `reward_student`，步骤复用 `switch_step`，生命周期复用现有命令。

三项最小扩展候选，需先做契约测试，不直接开发：

| 缺口/证据 | 为什么前端无法独自解决 | 最小方案 | 模块/授权/DTO | DB/Migration | Tests |
|---|---|---|---|---|---|
| avatar/荣誉/开场没有显式学生呈现命令 | 本地fullscreen不能跨浏览器 | 在现有 `/classroom-commands` 扩展 `set_presentation`，只允许白名单mode和已授权实体ID | ClassroomCommand，沿用owner/class/device/version/requestId；拒绝URL/HTML | 优先 existing snapshot JSON；No Schema Change | 权限、幂等、恢复、终态拒绝 |
| 服务端接受不等于Screen播放 | 浏览器自动播放和加载失败只能屏端观测 | 复用checkpoint写 `appliedCommandId/renderStatus/playbackStatus/lastAppliedAt`；现有DTO不支持时最小扩展，不把回执当新课堂指令循环 | ClassroomRun checkpoint、当前设备和权限，回执可多次更新 | 优先JSON；不新建ack表 | autoplay失败、过期回执、弱网重放 |
| readObjectives实时原教案 | frontend不能构造过去目标 | initial snapshot.lessonContext保存objectives；响应优先读冻结目标，老Run明确缺失 | Run start/restore，保持既有权限 | 优先JSON；若现有schema不允许则另提nullable字段ADR | 开课后修改原教案，Run目标不变 |

呈现schema候选：`{mode:'avatar'|'resource'|'honor'|'opening',resourceId?,returnContext?,revision,lastCommandId}`；只允许当前Run有权资源/已确认荣誉，不传敏感学生资料。Break/terminal/recovery始终高于临时呈现；点名奖励为短暂overlay，结束后回原基础呈现。使用后端已有version而不是建立平行版本。

屏端 autoplay 必须支持教师首次启用音响手势；刷新后音视频按当前产品安全规则暂停待恢复，不强行自动出声。UI明确待手势状态。

## 38. Route Compatibility

新体验继续使用现有命名路由，不更改扫码URL。课堂工具使用 Drawer，刷新后关闭，再依据Run快照恢复。深链runId重新鉴权，错误有返回工作台/记录。保留现有 `/classes` 等 legacy redirect；不在此次视觉改造删除旧AI接口或迁移数据库。

## 39. Responsive Strategy

1440×900：舞台+240px工具，Rail可展开；1366×768：Rail默认收起，四项工具常驻，提示条一行；1024px：工具压至200px，次高频只显示“更多”，Drawer覆盖教师页但不挡儿童端。100%及125%浏览器缩放均验收。小屏不把结束按钮藏进工具Drawer，也不改变主要顺序。

配色沿用米白/暖橙/浅绿，减少大渐变。标题24–28px、工具正文14–16px、提示13–14px，常用按钮≥44px。主按钮暖橙、二级白底、结束危险描边；状态兼有文字。主要区域少卡片、采用稳定边界；不要在教师端堆儿童贴纸。键盘焦点可见，Drawer trap focus、Esc关闭并还原触发按钮焦点，录音需明确状态和停止入口，减少动效遵从 reduced-motion。

## 40. Testing Strategy

Unit：presentation优先级、回执过期、command映射、资源排序、确认规则、返回上下文。Component：打开教师Drawer不发command/不改player，随机按钮使用后端返回，错误不先改画面，预览不播声，不同时挂两个claim player。

Backend只针对新增呈现/回执/目标快照契约：幂等、权限、expectedVersion、终态、老快照兼容。保留原reward/roll-call/device/run测试。

E2E：张老师完整场景；不同资源格式；教师查看教案大屏不变；手机翻页教师预览同步；断线标stale；刷新不重复奖励/点名；running返回Run不结束；结束成功再跳Summary；AI未确认不播放；多候选取消无副作用；1366/1440/1024无横向溢出。真实ASR、音响和局域网另做现场验收，不能以静态原型证明。

## 41. Frontend Modification Matrix

| Priority | Feature/Page | Current | Target | Existing Assets Reused | View | Components | Store | API | Backend |
|---|---|---|---|---|---|---|---|---|---|
| P0 | Live Stage | 中央教案 | 已确认学生呈现 | Screen/Player | LessonClassroom | LiveStage/Surface | lessonRun selector | screen-state/checkpoint | 回执候选 |
| P0 | 点名 | 本地随机 | 后端公平点名 | command/interaction | LessonClassroom | QuickActions/Overlay | lessonRun | classroom-commands | 无 |
| P0 | 奖励 | 全屏/直连 | 最近互动优先 | Reward/StudentAvatar | LessonClassroom | RewardPanel | 既有查询 | reward_student | 无 |
| P0 | 教师抽屉 | 主卡展示 | 打开不改变Screen | lesson snapshots/resources | LessonClassroom | Lesson/ResourceDrawer | UI composable | resources/get | 无 |
| P0 | ResourcePlayer | 共享全屏 | Preview静音、Screen唯一实际播放 | formats/auth loading | Screen/Console | Player嵌入模式 | player+只读selector | open/play/page | 回执候选 |
| P1 | 数字人 | 本机全屏 | 区分教师放大与学生切换 | Avatar runtime | Screen/Console | Partner/Stage | digitalHuman | set_presentation候选 | 最小扩展 |
| P1 | 语音/AI | 大卡/反馈分散 | 状态条+Copilot Drawer | ASR/Director/Assistant | Console | Voice/Assistant | 原Stores | 原AI/command | 无 |
| P1 | 荣誉 | 教师榜单 | 显式展示适龄荣誉 | 双范围查询 | Console/Screen | Leaderboard | 原查询缓存 | 原查询+presentation | 最小扩展 |
| P0 | Navigation | 已有基础 | 来源/刷新/安全退出一致 | 原Router/back | Teacher→Record | 原Layouts | user/lessonRun | restore | 无 |
| P1 | 目标快照 | readObjectives读原稿 | 冻结目标 | 初始Run snapshot | Drawer | LessonDrawer | lessonRun | restore响应 | 局部修复 |

## 42. File Change Plan

本轮以下全部为未来实施清单；正式源码未修改。

KEEP：`backend/src/classroom-runs/classroom-run.state-machine.ts`、Run/Step实体、`student-reward.service.ts`、`device-session`、`auth`、`classroom-mobile`会话、Avatar快照、TeacherClass授权、LessonPlan版本。

REUSE：`api/resources.ts`、`services/classroomCommandBus.ts`、`StudentAvatar.vue`、`ClassRewardDrawer.vue`、`operations/RewardPanel.vue`、`FullscreenLeaderboard.vue`、`services/voiceCommand.ts`、`stores/classroomAssistant.ts`、`stores/classroomDirector.ts`、`ClassroomHistoryView.vue`、`ClassroomRunSummaryView.vue`。

REFACTOR：`LessonClassroomView.vue`、`ClassroomScreenView.vue`、`ClassroomHeader.vue`、`ClassroomStepSidebar.vue`、`ClassroomControlBar.vue`、`ClassroomPartnerPanel.vue`、`ClassroomVoiceControl.vue`、`ClassroomAssistantPanel.vue`、`ResourcePlayer.vue`、`stores/resourcePlayer.ts`、`operations/useClassroomInteraction.ts`。每项只迁出组织/增加展示模式，不删除已验证能力。

ADD候选：`components/classroom/LivePresentationStage.vue`、`PresentationSurface.vue`、`ClassroomQuickActions.vue`、`TeacherHintBar.vue`、`LessonSnapshotDrawer.vue`、`ClassroomResourceDrawer.vue`、`VoiceStatusIndicator.vue`；`classroom/presentation/presentationSelectors.ts`、`classroom/useTeacherConsoleUi.ts`、`classroom/useClassroomActions.ts`。先确认旧组件可拓展再新增，不同时实现两个同义组件。

REPLACE/REMOVE：None。

DO NOT TOUCH：状态机、事务、reward requestId幂等、DeviceSession token、Auth/JWT、TeacherClass、MobileSession、AvatarRunSnapshot。第三十七节确有证据的目标/呈现契约，实施时需单独最小变更和测试，不作为顺手重构授权。

## 43. KEEP / REUSE / REFACTOR / REPLACE Summary

领域全保留；成熟播放/AI/权限/资源能力复用；教师View与呈现宿主重构；本地点名执行出口修复；无模块替换。抽象的判断标准是共享行为或明确状态边界，不是文件数量或“更干净”的目录。

## 44. P0 / P1 / P2

P0：真实学生呈现/预览可信度、权威点名、命令确认与失败、教师Drawer不污染Screen、单一播放器owner、退出/恢复。

P1：快捷资源与奖励、数字人显式切换、目标快照补齐、Voice/Copilot收敛、适龄荣誉展示。

P2：高级快捷键、动效、教师个性布局、更多活动工具。尚无正式接口的游戏/故事生成不以假按钮冒充可用。

## 45. Implementation Roadmap

| Phase | 目标 | 复用资产 | 修改/新增文件 | 后端 | 风险 | Tests / DoD |
|---|---|---|---|---|---|---|
| 3.0 | 冻结资产和契约 | Run/resource/reward | 资产与调用清单 | 不改 | dirty覆盖 | 清单和基线可追踪 |
| 3.1 | 确认B布局 | 原Teacher/Runtime边界 | 设计/原型 | 不改 | 频次假设 | 1440/1366/1024设计评审 |
| 3.2 | Route/Back | 原Router/meta/back | navigation局部、无破坏路径 | 不改 | deep link | 全Journey/未保存/直接URL |
| 3.3 | 基础Console | Header/Sidebar/ControlBar | View重排、QuickActions | 不改 | 原事件绑定丢失 | 旧功能回归全部保留 |
| 3.4 | Live Stage | Screen/Player/snapshot | Surface/Selectors/Player mode | ack若现有DTO不足最小扩展 | 双播放/假同步 | 静音预览、延时stale、两端资源一致 |
| 3.5 | Quick Actions | command bus | useActions/QuickActions | 不改 | 双击重复 | 正式命令和确认统一 |
| 3.6 | 教案/资源Drawer | Run.steps/resources | Drawer/UI composable | 不改 | 误更新Screen | 打开/关闭零业务命令 |
| 3.7 | 点名/奖励 | 权威command/reward | interaction/UI overlays | 不改 | 本地随机/重复奖励 | 后端选人、幂等、授权头像 |
| 3.8 | AI/Voice | 原ASR/草稿/确认 | VoiceStatus/Panel容器 | 不改 | 未确认播放 | 低置信度/取消/超时安全 |
| 3.9 | Exit/Refresh | 已有guards/restore | Runtime composable | 不改 | 离开=结束 | browserback/refresh/logout/runId变化 |
| 3.10 | Screen/Mobile | 实时/session/avatar | 共用呈现、mobile view adapter | 显式presentation最小扩展 | 旧屏兼容/自动播放 | 跨端确认、旧快照、断线 |
| 3.11 | 完整验收 | 现有E2E | 新场景测试/验收记录 | 不改 | 真机差异 | 张老师场景+两台设备+旧功能回归 |

每阶段保留可回退的独立提交，默认先新增只读Stage，完成资源一致性后再减少旧主卡；旧业务区保留在“完整控制”折叠区直到回归验收。此处提交指后续实施策略，本轮不提交。

## 46. Acceptance Criteria

张老师：登录→教师首页→中一班→《认识数字1》→Preflight→开始→数字人开场→数字1图片。教师预览与Screen同resourceId/pageIndex，屏端收到渲染状态才显示已同步。

语音“随机请一个小朋友”→后端roll call返回王小明→两端显示同一结果；“奖励王小明一朵小红花”→正式记录一次→Screen动画；“播放数字1儿歌”→若多候选教师选择→正式播放→Step仍是认识数字1。打开完整教案Drawer→Screen mode/resource/page/time不变化；关闭Drawer→保留课堂位置。

结束→服务端completed成功→Summary→Record→原History班级筛选。每页知道位置、来源、下一步和返回；刷新重新鉴权回读；运行中离开不结束。教师预览不出声、Screen不可用时不假装执行；已结束课堂拒绝命令；未授权照片不展示；奖励/点名动画刷新不重放。

验收需实际运行，原型只证明布局和交互关系。本轮未执行这一真实课堂场景。

## 47. Risks

最大的风险是把原有本地全屏视作跨设备展示，或把服务端接受命令视为播放成功；其次是两个ResourcePlayer共享Store造成相互抢占。还有目标实时读原稿、语音高风险误执行、调试UI泄漏、轮询与SSE相互覆盖、首屏WebGL加载、教师退出后Screen鉴权和历史快照缺字段。

应以Domain版本过滤过期响应；暂态overlay用event/recordId去重；初始化同步与实时订阅处理竞态；后台重连不重复业务命令。必要的DTO扩展向后兼容，旧Screen遇到未知mode降级，不把数据库结构改版绑到视觉布局。

## 48. Recommended First Coding Task

先做“只读 Live Presentation Stage + 权威点名入口”的小切片：读取现有 Screen state 派生资源/PPT页码与最后点名/奖励；教师预览静音，不修改资源播放Store，不替换Run；随机点名调已有命令。原课堂业务面板保留按需展开。

首个DoD：教师能看到Screen已确认状态/过期提示；点击资源Drawer、教案Drawer不发command；一次点名两端同一权威结果；页面离开不结束Run；旧资源/奖励/语音测试不退化。之后才把全局Player拆出只读模式和新增set_presentation契约。

## 附录：本轮证据和交付边界

重点阅读：`LessonClassroomView.vue`、`ClassroomScreenView.vue`、`ClassroomPartnerPanel.vue`、`ResourcePlayer.vue`、`useClassroomInteraction.ts`、`InteractionFullscreenView.vue`、`stores/lessonRun.ts`、`stores/resourcePlayer.ts`、`stores/classroomDirector.ts`、`services/classroomCommandBus.ts`、`backend/classroom-command.service.ts`、`classroom-run.service.ts`、`classroom-run-step-snapshot.entity.ts`；结合当前已有角色布局、导航、教师首页和记录入口。

已有能力并不代表全部真实终端验收完成。当前代码工作区包含前两轮未提交变更，本轮仅新增 `docs/STAGE_3_TEACHER_CONSOLE_DESIGN.md` 与 `docs/prototypes/classroom-console-vnext/`，不把这些既有变更提交或覆盖。

三套布局和十二种状态先通过独立原型评审；确定布局后再进入正式实施。本轮停止于设计交付。
