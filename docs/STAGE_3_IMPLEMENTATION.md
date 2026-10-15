# 阶段三实施记录（增量进行中）

本次以用户 2026-10-12 批准的设计补充为准，不自动提交或推送。

## Step 1 — Baseline
- Changed：只读记录工作树。已有多个前端修改、暂存的 ClassroomPartnerPanel 和未跟踪文档/脚本，均保留。
- Reused：既有分支与阶段一、二业务资产。
- Files：基线覆盖 backend、frontend；不清理用户文件。
- Backend / DB：无基线变更。
- Tests：前端 type-check、后端 build。
- Result：通过。
- Remaining：增量课堂工作台改造。

## Step 2 — Visual Foundation
- Changed：新增课堂组件使用现有 app-bg、app-surface、app-border、app-text、app-muted；主按钮继续使用已有暖橙主题。
- Reused：theme.css、Element Plus、现有数字人组件。
- Files：LivePresentationPreview.vue、PresentationQueuePanel.vue。
- Backend / DB：无。
- Tests：类型检查、生产打包。
- Result：通过；尚未完成真实浏览器视觉验收。
- Remaining：快速操作布局与教师辅助抽屉。

## Step 3 / 5 / 6 — 第一批实现
- Changed：中央增加后端状态预览；完整环节移入抽屉；增加本节课堂资源队列抽屉。
- Reused：Resource API、受保护图片下载、DigitalHumanStage、Run Snapshot、原命令总线及权限/版本/幂等校验。
- Files：LessonClassroomView.vue、lessonRun.ts、usePresentationQueue.ts、新增两组件；classroomCommandBus.ts；后端 classroom-command.types.ts、classroom-command.service.ts、classroom-run.service.ts；ClassroomScreenView.vue。
- Backend：在原命令总线增加 update_presentation_queue 和 set_presentation（当前仅 avatar）。队列写 interactionState.presentationQueues，不写 LessonPlan。每项资源重新验证可访问且已审核。实际播放沿用 open_resource/play_resource。
- DB：无新表、无迁移；现有快照 JSON 与 operation varchar 承载。
- Tests：队列单测 5 项；原全屏/离开保护 14 项，共 19 项通过；前后端构建、前端类型检查通过。
- Result：第一批完成，不代表阶段三整体验收完成。
- Remaining：视频/PPT等完整只读预览；资源试听/替换/上一项下一项；快速点名正式总线整合；榜单学生端切换；屏幕执行回执；真实多端 E2E。

## Screen Sync 第一批修正
大屏以 presentationCommandId 判断新展示指令，而非任意快照版本，避免调整队列时重开播放器。播放器进度快照合并已有展示元数据。显式 avatar/resource 模式优先于环节标题推断。首次恢复保持不自动播放。

预览明确标注是后端课堂状态，不宣称像素镜像或已收到渲染确认。手机命令路径未替换，但完整多端回归尚未执行。

## 尚未完成 / Follow-up
- Stage 3 的 12 步尚未全部完成，尤其实际大屏回执、统一高频操作、完整资源预览和课堂流 E2E。
- 既有 InteractionFullscreen 的点名/奖励路径需继续核对，不能用局部随机代替正式点名记录。
- 新队列后端校验与恢复需补服务端集成测试。
- 视频自动播放受浏览器策略影响，需真实设备验证。
- 现有三维加载包超过 500 KB，构建仅告警；不在本轮顺手改模型打包体系。
- 未提交、未推送；用户原有 dirty 文件保留。

## 2026-10-13 — 恢复开发后的第二批

- Reused：既有 ClassroomCommand 总线、随机点名公平/避重复/考勤筛选和正式记录、Resource API、Run Snapshot、暖橙主题、统一全屏状态；奖励继续复用正式 rewards API。
- Changed：随机点名不再使用前端 Math.random，等待正式命令结果；请求失败不更换选中幼儿，进行中禁用重复提交。队列增加上一项/下一项（跳过隐藏项）、替换内容（只改队列不切屏）、中央播放/暂停控制；展示项 id 写入既有 playerState，区分相同资源的不同队列位置。
- Important fix：集成测试发现 GET /classroom-runs/:id 及命令信封不返回已保存的快照状态，导致教师队列/预览刷新后丢失显示。新增返回最新有效快照的 interactionState、playerRecoverySuggestion、rollCallState、rewardState、attendanceState 与 latestSnapshotVersion；未新增路由或数据表。
- Files：backend classroom-command.service.ts、classroom-run.service.ts、classroom-run.e2e-spec.ts；frontend useClassroomInteraction.ts、usePresentationQueue.ts、lessonRun.ts、PresentationQueuePanel.vue、LivePresentationPreview.vue 及相应队列/互动/全屏测试。
- Backend / DB：仅命令元数据与查询响应补齐，无数据库迁移；没有修改已验收的设备在线规则/心跳/超时/巡检。
- Tests：前端类型检查与构建通过，队列/互动/全屏及已验收设备会话/Preflight 回归共 60 项通过；后端构建与课堂运行集成测试 30 项通过。git diff --check 通过。第一轮新集成测试暴露快照响应缺失，修复后全组通过，不隐藏失败。
- Result：本批队列与正式随机点名代码/组件/服务端验证完成；尚未完成这批真实教师—大屏双页面 E2E，不能把组件/服务端集成结果说成全链路验收。
- Runtime：确认没有运行中课堂后，仅重载非热更新后端加载本批构建；当前环境已登录授权读取既有课堂，GET 响应 200，快照字段存在。没有改数据库状态或设备配置。此项是当前服务冒烟检查，不替代双页面课堂验收。
- Remaining：完整只读媒体预览（视频/PPT等）、资源预览/试听、奖励/榜单学生端呈现、Screen 渲染回执、快速操作布局收敛、手机兼容与真实课堂流 E2E。此前“快速点名正式总线整合”和队列上一项/下一项/替换已在本批完成。

## 已验收边界与非阻塞 Follow-up

- P0 正式大屏 Online 阻塞已由用户验收关闭；不在阶段三中重新改造。
- 所有新增业务在线判断必须复用 backend/src/platform/device-online-policy.ts，不允许仅检查 Device.status === online。
- P1 Legacy teacher heartbeat compatibility endpoint deprecation：正式前端不得调用，接口暂保留；正式部署前先审计旧客户端，再决定限制/废弃/移除。
- Future Device Identity independence：合法 DeviceSession 重签发当前仍需教师授权，保留；长期独立设备运行以后单独设计 provisioning/identity，不在本轮顺手重构。
- 全程不自动暂存、提交或推送；保留原 dirty worktree 和 ClassroomPartnerPanel 的暂存修改。
