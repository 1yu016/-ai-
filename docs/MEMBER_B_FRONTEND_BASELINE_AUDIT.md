# 成员 B 前端差异核查与文件边界冻结

## 1. 核查范围与基线

- 项目：Vue3 + Vite + Pinia + NestJS + SQLite 幼儿园数字人课堂系统
- 角色：成员 B，负责教师端、课堂驾驶舱、学生大屏、数字人、浏览器媒体、手机控制端、前端测试和操作文档
- 当前分支：`codex/member-a-next`
- 当前 HEAD：`7471e33 feat(frontend): finalize joint acceptance and mobile recovery`
- 上游：`origin/codex/member-a-next`
- 远端同步：HEAD 与上游一致（0 ahead / 0 behind）
- 工作区未跟踪目录：`B013_video/`、`_handoff_read/`。两者与本次核查无关，未修改、未加入提交。
- 本次核查不修改业务代码、不修改后端、不新增迁移。

核查过的入口包括 README、frontend/package.json、前端路由、API、service、Store、view、component、classroom/avatar 代码、前端测试、后端 Controller 路由和课堂/手机/数字人/验收文档。仓库根目录没有适用于本项目的 AGENTS.md；仅发现 backend/node_modules 下的第三方包说明，不作为项目规则。

## 2. 总体差异矩阵

状态含义：已完成=代码和自动化证据基本具备；部分完成=已有主流程但仍有接口或真实环境缺口；只有页面/只有接口=另一侧尚未形成闭环；接口阻塞=当前代码和后端都没有可调用契约；待真实设备验证=代码级已有，但需要现场硬件或网络。

| 模块 | 状态 | 当前证据 | 主要缺口 |
| --- | --- | --- | --- |
| 2C-1 参考课堂和证据包 | 接口阻塞、尚未开发 | 未找到参考课堂、证据包 API、页面、Store 或测试 | 需要 A 提供列表、证据包、加入参考、来源和权限接口 |
| 课堂经验优化 | 接口阻塞、尚未开发 | 未找到 baseVersion、candidateId、sourceReferences 等实现 | 需要 A 冻结候选接口和 409 契约 |
| 教师课堂驾驶舱 | 部分完成 | `LessonClassroomView`、`lessonRun`、课堂 Header、步骤侧栏、ResourcePlayer、轮询和课堂控制已存在 | 缺少独立的成员 A 投影契约；临场调整仍依赖现有课堂命令能力 |
| 数字人 | 已完成，待真实设备验证 | VRM/GLB/2D/程序化降级、动作白名单、资源释放测试和数字人组件已存在 | 真实 GPU、低配置机器和长时间运行需现场验证 |
| 录音、ASR、TTS | 部分完成，待真实设备验证 | `recordingAudio`、`browserSpeech`、`voiceCommand`、`/ai/asr`、`/ai/tts` 和语音测试已存在 | 真实麦克风、ASR、TTS 延迟和设备权限需现场验证 |
| 考勤、点名、奖励、课间 | 已完成，待真实设备验证 | `ClassroomOperationsView`、AttendancePanel、RewardPanel、BreakModePanel、点名接口和大量测试 | 真实课堂动画、授权头像、音响和网络恢复需现场验证 |
| 复盘、问题地图、绘画评价 | 部分完成，待真实设备验证 | `ClassroomRecordView`、`classroomRecords`、`ClassQuestionHistoryView`、`classroomQuestions`、`ArtworkReviewPanel`、`studentArtwork` 和测试 | 真实摄像头、视觉模型、现场隐私验证需完成 |
| 手机控制、实时连接、弱网 | 部分完成、接口阻塞、待真实设备验证 | `ClassroomMobileRemoteView`、`classroomMobile`、SSE、心跳、重连、TTL、状态恢复和测试 | 后端尚未完整提供 commandId/executionStatus/expiresAt/resumeCursor 契约；真实手机和局域网需验证 |
| 教师手册和浏览器验收 | 已完成代码级交付 | 已有 `TEACHER_QUICK_GUIDE`、`LESSON_OPERATION`、`FINAL_DEPLOYMENT`、成员 B 交付及现场验收文档 | 真实园所现场记录尚未填写 |

## 3. 页面和路由清单

### 公共和鉴权

| 名称 | 路径 | 组件 | 权限/布局 |
| --- | --- | --- | --- |
| home-redirect | `/` | 重定向 | 公共 |
| chat | `/chat` | `ChatView` | 公共、standalone |
| login | `/login` | `LoginView` | 公共、auth |
| forbidden | `/forbidden` | `ForbiddenView` | 公共、standalone |
| not-found | `/:pathMatch(.*)*` | `NotFoundView` | 公共、standalone |

### 后台工作台和班级

| 名称 | 路径 | 组件 | 权限 |
| --- | --- | --- | --- |
| admin-dashboard | `/admin` | `AdminDashboardView` | 管理员 |
| admin-audit | `/admin/audit` | `AdminAuditView` | 管理员 |
| teachers | `/admin/teachers` | `TeacherManagementView` | 管理员 |
| classes | `/admin/classes` | `ClassesView` | 管理员 |
| class-detail | `/admin/classes/:classId` | `ClassDetailView` | 有班级权限；管理员可全部 |
| my-classes | `/my-classes` | `MyClassesView` | 教师/管理员 |
| student-center | `/admin/students` | `StudentCenterView` | 管理员 |
| students | `/admin/classes/:classId/students` | `StudentsView` | 有班级权限 |
| student-profile | `/admin/classes/:classId/students/:studentId` | `StudentProfileView` | 有班级权限 |
| classrooms | `/admin/classrooms` | `ClassroomsView` | 教师看授权范围；管理员管理 |
| classroom-detail | `/admin/classrooms/:classroomId` | `ClassroomDetailView` | 有权限 |
| devices | `/admin/devices` | `DevicesView` | 教师看授权范围；管理员管理 |
| device-detail | `/admin/devices/:deviceId` | `DeviceDetailView` | 有权限 |
| avatars | `/avatars` | `AvatarLibraryView` | 登录用户，后端继续校验 |

旧路径由 `routeDefinitions.ts` 兼容跳转：`/classes`、`/classes/:classId`、`/classes/:classId/students`、`/classes/:classId/students/:studentId`、`/students`、`/students/:studentId`、`/devices`。路由元数据已支持 `requiresAuth`、`roles`、`layout`、`title`、`activeNav`、`breadcrumb` 和 `backRoute`。

### 资源、备课和课堂

| 名称 | 路径 | 组件 | 状态 |
| --- | --- | --- | --- |
| resources | `/resources` | `ResourceLibraryView` | 真实资源列表和筛选 |
| resource-upload | `/resources/upload` | `UploadView` | 普通/分片上传 |
| resource-detail | `/resources/:id` | `ResourceDetailView` | 真实详情和引用 |
| resource-preview | `/resources/:id/preview` | `ResourcePreviewView` | 鉴权预览 |
| resource-edit | `/resources/:id/edit` | `ResourceEditView` | 元数据编辑 |
| resource-review | `/resources/:id/review` | `ResourceReviewView` | 管理员审核 |
| lesson-plans | `/lesson-plans` | `LessonPlanListView` | 阶段三稳定入口 |
| lesson-plan-new | `/lesson-plans/new` | `LessonPlanEditorView` | 教案编辑 |
| lesson-plan-edit | `/lesson-plans/:id/edit` | `LessonPlanEditorView` | 教案编辑和版本 |
| lesson-classroom-preflight | `/classroom/preflight/:planId` | `ClassroomPreflightView` | 课堂准备 |
| lesson-classroom | `/classroom/lesson/:runId` | `LessonClassroomView` | 课堂主页面 |
| classroom-record | `/classroom/records/:runId` | `ClassroomRecordView` | 课堂记录 |
| lesson-classroom-summary | `/classroom/lesson/:runId/summary` | `ClassroomRunSummaryView` | 课堂总结 |

### 大屏、互动和手机

| 名称 | 路径 | 组件 | 状态 |
| --- | --- | --- | --- |
| classroom-scan | `/classroom/scan` | `ClassroomScanView` | 设备准备和二维码 |
| classroom-join | `/classroom/join` | `ClassroomJoinView` | 手机加入课堂 |
| classroom-screen | `/classroom/screen/:deviceId?` | `ClassroomScreenView` | 大屏独立布局 |
| classroom-engagement | `/classroom/engagement` | `ClassroomOperationsView` | 考勤、奖励、课间、问题、作品 |
| classroom-insights | `/classroom/insights` | `ClassroomOperationsView` | 问题和作品入口 |
| classroom-remote | `/classroom/remote` | `ClassroomMobileRemoteView` | 手机控制 |

## 4. API 与页面对应关系

### 认证和平台基础

| 前端页面/Store | 前端 API | 后端真实接口 |
| --- | --- | --- |
| LoginView/user store | auth session | `POST /auth/login`、`POST /auth/admin/login`、`GET /auth/profile`、`POST /auth/logout`、`POST /auth/refresh` |
| ClassesView/ClassDetailView | `platformApi.classes`、`classDetail`、`createClass`、`updateClass` | `GET/POST/PATCH /classes`、`GET/PATCH /classes/:id` |
| StudentsView/StudentProfileView | `students`、`studentDetail`、`createStudent`、`updateStudent`、导入方法 | `GET/POST/PATCH /students`、`GET /students/:id`、`POST /classes/:classId/students/import/preview`、`POST .../confirm` |
| ClassroomsView/DevicesView | `classrooms`、`classroomDetail`、`devices`、`deviceDetail` | `GET/PATCH /classrooms`、`GET/PATCH /classrooms/:id`、`GET/PATCH /devices`、`GET/PATCH /devices/:id` |
| 设备绑定/二维码 | `deviceSession`、platform ticket methods | `POST /device-bindings`、`DELETE /device-bindings/:id`、`POST /classroom-tickets`、`POST /classroom-tickets/consume`、`POST /devices/:id/device-session` |
| AdminDashboard/AdminAudit | platform dashboard/log methods | `GET /admin/dashboard`、`GET /audit-logs`、`GET /ai-call-logs` |

### 资源和备课

| 前端页面/Store | 前端 API | 后端真实接口 |
| --- | --- | --- |
| ResourceLibrary/ResourceDetail | `resourceApi.list/detail/search/categories` | `GET /resources`、`GET /resources/search`、`GET /resources/:id`、`GET /resources/categories` |
| UploadView/ChunkedUploader | `resourceApi.upload/createUploadSession/uploadChunk/complete/cancel` | `POST /resources/upload`、`POST/GET/DELETE /resources/upload-sessions...` |
| ResourcePreview/ResourcePlayer | protected blob/manifest/assets | `GET /resources/:id/download`、`GET /resources/:id/content`、`GET /resources/:id/preview-manifest`、`GET /resources/:id/preview-assets/:assetName` |
| ResourceEdit/Favorite/Review | metadata/favorite/review methods | `PATCH /resources/:id`、`POST/DELETE /resources/:id/favorite`、`POST /resources/:id/submit-review`、`POST /resources/:id/review` |
| LessonPlanEditor/LessonRun | lessonPlan store and direct authoring service | `GET/POST/PATCH/PUT /lesson-plans...`、`POST /lesson-plans/:id/start`、`GET /lesson-runs/:id` |

### 课堂和互动

| 前端页面/Store | 前端 API | 后端真实接口 |
| --- | --- | --- |
| LessonClassroom/lessonRun | classroom run methods | `POST /classroom-runs/start`、`GET /classroom-runs/active`、`GET /classroom-runs/:id`、`POST /classroom-runs/:id/pause`、`resume`、`complete`、`cancel`、`steps/:stepIndex`、`checkpoints` |
| ClassroomOperations/AttendancePanel | attendance service/direct API | `GET /classroom-runs/:id/attendance`、`POST /classroom-runs/:runId/attendance`、`POST .../attendance/batch`、`POST .../attendance/voice-candidates`、`POST .../attendance/voice/confirm` |
| Roll call | participation service/direct API | `POST/GET /classroom-runs/:runId/roll-calls`、`POST /classroom-runs/:runId/groups/random` |
| Rewards/Leaderboard | checkpoint/reward services | `POST/GET /classroom-runs/:id/rewards`、`POST /classroom-runs/:id/rewards/:rewardId/revoke`、`GET /classes/:classId/rewards`、`GET /classes/:classId/rewards/leaderboard` |
| BreakModePanel | break service/direct API | `POST /classroom-runs/:id/break`、`POST /classroom-runs/:id/break/end`、`POST /classroom-runs/:runId/breaks/start`、`GET /classroom-runs/:runId/breaks/active`、`POST /break-runs/:id/end` |
| ClassroomRecordView | `classroomRecords` | `GET /classroom-runs/:id/timeline`、`POST .../summary/draft`、`GET .../summary`、`POST .../summary/confirm`、`POST .../summary/discard`、`GET .../report` |
| QuestionRecordPanel/QuestionHistory | `classroomQuestions` | `POST/GET /classroom-runs/:runId/questions`、`PATCH .../questions/:questionId`、`GET /classes/:classId/questions`、`GET /classes/:classId/question-map` |
| ArtworkReviewPanel | `studentArtwork` | `POST/GET /classroom-runs/:runId/artworks`、`POST /ai/artwork-review`、`POST /artworks/:artworkId/confirm`、`POST /artworks/:artworkId/deliver`、`GET /artworks/:artworkId/file` |

### 数字人、语音和手机

| 前端页面/Store | 前端 API | 后端真实接口 |
| --- | --- | --- |
| AvatarLibrary/ClassroomAvatar | `avatarApi`、`AvatarLoader` | `/avatars/resolve`、角色/版本/资产接口 |
| ClassroomVoiceControl/voiceCommand | `browserSpeech`、`recordingAudio`、voice services | `POST /ai/asr`、`POST /ai/tts`、`POST /ai/command`、`POST /ai/classroom-command` |
| ClassroomMobileRemoteView | `classroomMobileApi`、`classroomMobile` store | `POST /classroom-mobile/join`、`GET /classroom-mobile/state`、`POST /heartbeat`、`POST /commands`、SSE `/events` |
| ClassroomScreenView | `classroomRealtime`、lessonRun | SSE `/classroom-mobile/screen-events`、课堂状态接口 |

## 5. Store 和 service 清单

### 主要 Store

- `user`：登录、资料、角色、Token 生命周期。
- `lessonPlan`：教案列表、编辑和版本。
- `lessonRun`：课堂运行状态、步骤、资源、轮询和恢复。
- `classroomCommand`：课堂指令候选、确认和执行。
- `classroomDirector`：AI 课堂导演候选、编辑、确认和拒绝。
- `classroomAssistant`：启发式助教草稿和教师确认。
- `classroomMobile`：手机加入、SSE、心跳、状态恢复、命令状态和重连。
- `resourcePlayer`：图片、音频、视频、PDF、PPT 预览和媒体释放。
- `courseResource` / `library`：资源列表、缓存和资源回读。
- `digitalHuman`：数字人角色、动作和播放状态。
- `deviceSession`：设备会话和心跳。
- `favorite`：资源收藏。

### 主要 service/API

- `authSession`、`classroomCheckpoint`、`classroomCommandBus`、`classroomRealtime`。
- `classroomRecords`、`classroomQuestions`、`studentArtwork`。
- `recordingAudio`、`browserSpeech`、`voiceCommand`。
- `rewardLeaderboard`、`rewardSummary`。
- `api/platform.ts`、`api/resources.ts`、`api/classroomMobile.ts`、`api/avatar.ts`、`api/deviceSession.ts`。

## 6. 可复用组件

### 工作台和状态

- `BaseWorkspaceLayout`、`AdminLayout`、`TeacherLayout`、`ManagementLayout`、`ClassWorkspaceLayout`。
- `PageShell`、`PageHeader`、`PageActions`、`BackButton`、`WorkspaceBreadcrumbs`。
- `LoadingState`、`EmptyState`、`ErrorState`、`ForbiddenState`、`WorkspaceState`、`ConfirmDialog`。

### 课堂和媒体

- `ClassroomHeader`、`ClassroomStepSidebar`、`ClassroomControlBar`。
- `ClassroomAssistantPanel`、`ClassroomDirectorPanel`、`ClassroomVoiceControl`。
- `ResourcePlayer`、`ResourcePreview`、`ModelPreviewStage`。
- `ClassroomAvatar`、`ThreeAvatarStage`、`DigitalHumanStage`、`GrokBotAvatar`。
- `AttendancePanel`、`RewardPanel`、`BreakModePanel`、`ClassRewardLeaderboard`、`QuestionRecordPanel`、`ArtworkReviewPanel`、`RemoteControlPanel`。

## 7. 自动化测试清单

当前前端测试包括：

- 鉴权和导航：`auth-lifecycle`、`auth-navigation`、`navigation-rules`、`router-navigation`、`workspace-layout`。
- 工作台和后台：`admin-console`、`ClassesView`、`StudentsView`、`StudentPrivacy`、`StudentImportPanel`、`workspace-foundation`。
- 资源：`ResourceAccessViews`、`ResourceUpload`、`resources-adapter`、`resource-player-media`、`resource-protected-fetch`、`resource-command-e2e`。
- 课堂：`classroom-preflight-device`、`lesson-classroom-*`、`classroom-stores`、`classroom-command`、`classroom-record`、`classroom-mobile`。
- 数字人和媒体：`avatar-lifecycle`、`avatar-resource-disposal`、`avatar-state-machine`、`DigitalHumanStage`、`browser-speech`、`resource-player-media`。
- 互动：`attendance-panel`、`ClassRewardHistoryView`、`ClassRewardLeaderboard`、`BreakModePanel`、`ClassroomInteractionPanel`、`QuestionRecordPanel`、`ArtworkReviewPanel`。

自动化测试当前已覆盖大量代码级流程，但 2C-1、经验优化和真实设备仍没有完整验收证据。

## 8. 直接调用不存在接口和两套实现风险

### 已确认的接口阻塞

1. 没有找到参考课堂和证据包的前后端接口、实体或页面。
2. 没有找到经验优化候选的 `baseVersion`、`candidateId`、`evidenceDigest`、`sourceReferences`、`candidateFields` 接口。
3. 手机后端当前真实命令协议主要是 `requestId`、`expectedVersion`、`operation`、`targetDeviceId`、`issuedAt`、`ttlMs` 和 `deliveryStatus`；尚未形成完整的 `commandId`、`executionStatus`、`expiresAt`、`resumeCursor` 契约。

### 直接调用风险

- `classroomMobile` 和 `classroomRealtime` 为 SSE 使用了底层 `fetch`，不是普通业务接口拼接；后续应由 A/B 共同确认是否纳入统一 HTTP 适配层。
- 多个课堂页面仍直接通过 `http.get/http.post` 调用已有接口，例如 `ClassroomOperationsView`、`LessonClassroomView` 和 `RewardPanel`。这些接口均在后端 Controller 中存在，但长期维护时容易形成重复 DTO 适配。
- 经验优化不能复用资源 AI 建议接口；两者字段、权限、版本语义不同。

### 两套实现风险

- `lesson_run` 历史结构与 `classroom_run` 正式课堂结构并存；新功能必须继续以 `classroom_run` 为权威。
- `classroomRealtime` 的大屏事件通道与 `classroomMobile` 的手机事件通道不同，不能再创建第三套实时协议。
- `courseResource` 和 `library` 都维护资源读取逻辑；新增资源功能应优先统一到 `api/resources.ts`。
- 课堂状态控制同时存在 `lessonRun`、`classroomCommand` 和部分页面直连调用，不能在前端新增第二个状态机。

## 9. 后续阶段允许修改的文件范围

| 阶段 | B 允许修改 | A 必须先提供 |
| --- | --- | --- |
| 2C-1 浏览器验收 | 参考课堂页面、组件、适配层、测试、验收文档 | 参考课堂和证据包真实接口、测试数据、权限 |
| 经验优化数据层 | `frontend/src/api`、`services`、`stores`、数据层测试 | 候选 DTO、来源、版本、过期和 409 契约 |
| 经验优化页面 | 经验优化 view/component、教案编辑适配和组件测试 | 候选列表/详情/处理接口 |
| 驾驶舱只读 | 课堂驾驶舱 view/component、只读 Store 适配、测试 | run 投影字段和实时事件 |
| 当前 Run 控制 | 既有课堂控制组件、命令 Store 适配、测试 | 统一命令入口、权限、幂等、冲突和 TTL |
| 数字人和语音 | `frontend/src/avatar`、digital-human、录音播放组件、测试 | ASR/TTS/候选确认字段和错误码 |
| 课堂互动 | classroom operations 组件、展示 Store、测试 | 正式考勤、点名、奖励、课间接口 |
| 复盘和绘画 | records/questions/artwork view、component、service 适配、测试 | 聚合口径、授权、评价确认和投递接口 |
| 手机和弱网 | `classroomMobile`、手机 view、移动测试 | 完整实时命令协议和 resume 语义 |
| 最终交付 | 前端测试、文档、部署说明、现场记录 | 可运行构建、测试账号、服务版本和回滚方式 |

## 10. 禁止多人同时修改的高冲突文件

- `frontend/src/router/index.ts`
- `frontend/src/router/routeDefinitions.ts`
- `frontend/src/stores/lessonRun.ts`
- `frontend/src/stores/classroomMobile.ts`
- `frontend/src/views/LessonClassroomView.vue`
- `frontend/src/views/ClassroomOperationsView.vue`
- `frontend/src/views/ClassroomScreenView.vue`
- `frontend/src/views/ClassroomMobileRemoteView.vue`
- `frontend/src/api/platform.ts`
- `frontend/src/api/resources.ts`
- `frontend/src/services/classroomCommandBus.ts`
- `frontend/src/services/classroomRealtime.ts`

修改这些文件前必须在交接记录中写明负责人和目标任务，不能两人并行覆盖。

## 11. 成员 B 真实剩余任务表

| 任务 | 状态 | 依赖 | 下一步 |
| --- | --- | --- | --- |
| 2C-1 参考课堂浏览器验收 | 接口阻塞 | A 提供接口和正式数据 | 先完成接口交接，再做浏览器验收 |
| 经验优化数据层 | 接口阻塞 | A 提供候选 DTO 和版本规则 | 冻结契约后实现 API/Store |
| 经验优化对比和处理页面 | 尚未开发 | 阶段数据层 | 数据层测试通过后开始 |
| 驾驶舱只读投影 | 部分完成 | A 提供投影字段 | 统一投影和当前课堂状态 |
| 当前 Run 临场调整 | 部分完成 | A 提供统一命令语义 | 复用现有命令入口，不建状态机 |
| 数字人和浏览器媒体 | 代码级完成 | 真实设备 | 做低配、长时间和真实外设验收 |
| 互动功能 | 代码级完成 | 真实设备和正式课堂 | 做完整课堂回归 |
| 复盘、问题地图、绘画 | 代码级部分完成 | 正式数据和设备 | 验证权限、隐私和摄像头流程 |
| 手机控制和弱网 | 部分完成/协议阻塞 | A 完整实时协议 | 冻结协议后补齐字段适配 |
| 教师手册和最终验收 | 文档已有 | 正式版本和现场设备 | 填写现场验收记录 |

## 12. 本阶段结论

本阶段完成了前端真实基线核查和文件边界冻结，没有实现新业务、没有修改后端、没有新增数据库迁移。当前最先需要成员 A 交接的是 2C-1 参考课堂/证据包接口和经验优化候选接口；在这两个接口冻结前，成员 B 不应继续创建页面或模拟业务成功。

建议下一提交信息：

```text
docs: add member B frontend baseline audit
```
