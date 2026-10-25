# 当前项目总说明书

> 本文档由一次**只读代码扫描**生成，事实优先级为：**当前 HEAD/工作树代码 > Entity/Controller/Service > Migration > 前端 route/store/api/view > 自动化测试 > 配置文件 > git 历史 > 旧文档**。
> 凡“文档说过但代码没有”的，一律标注为「文档目标，当前代码未确认实现」；凡代码存在但未完成真实环境验收的，标注「代码已存在，尚未完成真实环境验收」。

---

## 0. 文档元信息

- **生成方式**：只读扫描（不修改业务代码 / 不改数据库 / 无 migration / 不 commit / 不 push）。
- **基于**：当前工作树实际代码。
- **Branch**: `feature/member-a`
- **HEAD**: `f66537ef2a21bd24d9fbb183b3dd9c0ba6f81851`（`origin/feature/member-a`）
- **Dirty 工作树**（`git status --short`，未提交）：
  - `M frontend/src/components/classroom/ClassroomPartnerPanel.vue`（BOM 差异，无可行为变化）
  - `M frontend/src/stores/deviceSession.ts`（TS 窄化修复，见 Known Issues）
  - `M frontend/tests/e2e/device-online-gate.spec.ts`（`expect.poll` timeout 传参修复）
  - 未跟踪诊断脚本：`backend/_demo_*.cjs`、`backend/diag-device.cjs`、`backend/verify-device-online.cjs`、`backend/scripts/_tmp_ds_parity.cjs`、`backend/_e2e66_seed.cjs`
- 上述改动**不在本次生成范围内**，保留不改。

---

## 1. 项目定位

系统名：**幼儿园 AI 智慧课堂 / 数字人课堂教学协作系统**（`README.md` 仅以 `# -ai-` 作为仓库名，仓库内以 docs 及代码为准，业务定位为幼儿园课堂协作）。

能力边界按代码区分：

- **核心课堂业务**：My Classes / 备课（LessonPlan） / 课堂运行（ClassroomRun）/ 课堂记录（Record）/ Summary。
- **管理后台**：管理员看板、教师/班级/学生/设备/资源审核管理。
- **AI 能力**：聊天、教案生成、课堂启发性助理、Classroom Director（old/V2，见 §19/§22）、资源检索、TTS、ASR、作品绘画评价、儿童问题回答草稿。
- **大屏**：ClassroomScreenView（展示端 + device heartbeat）。
- **手机端**：ClassroomMobileRemoteView（classroom-mobile）。
- **设备系统**：Device / DeviceBinding / DeviceSession（P0 核心）。

---

## 2. 技术栈

### Frontend（`frontend/package.json`）
| 项 | 值 |
|---|---|
| Framework | Vue `^3.5.42` |
| Router | vue-router `^5.3.1` |
| Store | pinia `^4.0.3` |
| UI library | element-plus `^2.14.6` |
| Build | vite `^8.2.2` + `@vitejs/plugin-vue` `^6.0.8` |
| Type check | vue-tsc `^3.3.11`（`vue-tsc --build`） |
| Test | vitest `^5.0.1` + jsdom；Playwright `^1.63.0`（E2E） |
| HTTP client | axios `^1.20.0` |
| 数字人渲染 | three `^0.186.1`、@pixiv/three-vrm `^3.5.5` |
| 其它 | recordrtc（音频录制）、qrcode（扫码） |

### Backend（`backend/package.json`）
| 项 | 值 |
|---|---|
| Framework | NestJS `^12.0.1`（common/core/platform-express） |
| ORM | typeorm `^1.1.1` + @nestjs/typeorm `^12.0.1` |
| Database | better-sqlite3 `^12.11.1` |
| Auth/JWT | @nestjs/jwt `^12.0.2`、bcrypt `^6.0.0` |
| Validation | class-validator `^0.15.1`、class-transformer `^0.5.1` |
| Scheduling | @nestjs/schedule `^12.0.2` |
| Throttling | @nestjs/throttler `^6.7.0` |
| Config | @nestjs/config `^12.0.0` |
| AI | openai `^7.18.0` |
| Tests | jest `^30.0.0`、ts-jest、supertest（unit/e2e） |
| Lint/Build | oxlint（`oxlint src/ test/`）、nest build |

> 引擎要求：Node `^22.18.0 || >=24.12.0`（前端 engines）。

---

## 3. 目录结构

```
-ai-/
├── .github/            # GitHub Actions 工作流
├── backend/
│   ├── src/
│   │   ├── main.ts                 # 启动入口（ValidationPipe、PORT 默认 3001）
│   │   ├── app.module.ts           # 根模块（配置/Throttle/TypeORM + 全部业务模块）
│   │   ├── auth/                   # 登录/刷新/JWT/守卫
│   │   ├── ai/                     # AI 相关
│   │   ├── data/                   # 数据（如 teaching-resource）
│   │   ├── resources/              # 资源库
│   │   ├── lesson-plans/           # 备课
│   │   ├── platform/               # 教师/班级/学生/教室/设备/绑定/审计/奖励
│   │   ├── classroom-runs/         # 课堂运行（P0/P1 核心）
│   │   ├── classroom-engagement/   # 考勤/课间/互动
│   │   ├── classroom-participation/# 课堂参与
│   │   ├── classroom-mobile/       # 手机端
│   │   ├── device-session/         # 设备会话（P0 核心）
│   │   ├── avatars/                # 数字人
│   │   ├── artworks/               # 幼儿作品
│   │   ├── migrations/             # 29 个 migration
│   │   └── ...
│   ├── test/                       # 后端 e2e（jest-e2e.json）
│   └── scripts/                    # 运维脚本
├── frontend/
│   ├── src/
│   │   ├── api/                    # http 封装 + 各模块 API
│   │   ├── services/               # 扩展服务层
│   │   ├── stores/                 # pinia stores
│   │   ├── router/index.ts         # 路由
│   │   ├── views/                  # 页面（含 resources/ 子目录）
│   │   ├── components/             # 布局/组件（含 digital-human/classroom）
│   │   └── styles/ vendor/ avatar/
│   └── tests/                      # unit + e2e
├── docs/                           # 大量现有文档（API_REFERENCE、DATA_DICTIONARY 等）
├── tools/, deliver-screenshots/, test-resources/
└── README.md
```

---

## 4. 用户角色与权限

角色来源：`backend/src/auth/auth.guard.ts`（AuthGuard/OptionalAuthGuard/RolesGuard）、`auth.types.ts`（`AuthUserType`）、各 Service 的 `PlatformAccessService` `require*` 方法、前端 `router/index.ts` 的 `meta.requiresAuth/adminOnly`。

| 角色 | 身份载体 | 可访问 | 不可访问 | 权限来源 / 关键校验 |
|---|---|---|---|---|
| Visitor（游客） | 无 / 公开 | 公开接口（登录、被限流的公开端点） | 所有 `requiresAuth` 路由/接口 | `ThrottlerGuard`、`publicRateLimit` |
| Teacher（教师） | JWT Access（`Teacher` 主体） | `/my-classes`、`/lesson-plans`、`/classroom/*`、自己绑定班级/教案/学生/资源 | admin-only 管理、改他人班级、改任意设备 | `AuthGuard` + `PlatformAccessService.requireClassAccess`（经 `TeacherClass`）；`classroom-run.service.requireTeacher` |
| Administrator | JWT Access（admin 登录 `POST /auth/admin/login`） | `/admin`、`/teachers`、`/classes`、`/students`、`/devices`、资源审核 `/resources/:id/review` | —（最高权限） | `RolesGuard`、`requireAdministrator`；**是否 school scoped：`actor.schoolId` 存在时按园所过滤**（`listClasses` 等） |
| Device Identity | 仅 `x-device-session` token（**非 JWT**） | `POST /device-session/heartbeat` | 任何 teacher/admin 接口 | `device-session` 签发时 Teacher 授权；heartbeat 仅 `ThrottlerGuard` |

> 明确：**Teacher Identity ≠ Device Identity**。Device token 仅用于设备心跳维护在线，scope 仅限于 heartbeat，无法访问课堂内容接口。

---

## 5. 前端路由与导航

### 5.1 前端路由总表（`frontend/src/router/index.ts`，行 8-90）

| Route | 页面组件 | 登录要求 | 角色 | Layout | 作用 | 状态 |
|---|---|---|---|---|---|---|
| `/` | —（redirect `/chat`） | — | 全部 | — | 入口重定向 | 正式 |
| `/chat` | ChatView | 否 | 全部 | ChatView | 会话/聊天首页 | 正式 |
| `/login` | LoginView | 否 | 全部 | 独立 | 登录（teacher/admin） | 正式 |
| `/classes` | ClassesView | 是 | adminOnly | ManagementLayout | 班级管理 | 正式(admin) |
| `/admin` | AdminDashboardView | 是 | adminOnly | ManagementLayout | 管理员看板 | 正式 |
| `/admin/audit` | AdminAuditView | 是 | adminOnly | ManagementLayout | 审计日志 | 正式 |
| `/teachers` | TeacherManagementView | 是 | adminOnly | ManagementLayout | 教师管理 | 正式 |
| `/my-classes` | MyClassesView | 是 | Teacher | ManagementLayout | 我的班级 | 正式 |
| `/students` | StudentCenterView | 是 | adminOnly | ManagementLayout | 学生中心 | 正式 |
| `/classes/:classId/students` | StudentsView | 是 | Teacher | ManagementLayout | 班级学生 | 正式 |
| `/classes/:classId/rewards` | ClassRewardHistoryView | 是 | Teacher | ManagementLayout | 班级奖励历史 | 正式 |
| `/classes/:classId/questions` | ClassQuestionHistoryView | 是 | Teacher | ManagementLayout | 班级问题历史 | 正式 |
| `/students/:studentId` | StudentProfileView | 是 | adminOnly | ManagementLayout | 学生画像 | 正式(admin) |
| `/devices` | DevicesView | 是 | adminOnly | ManagementLayout | 设备管理 | 正式 |
| `/avatars` | AvatarLibraryView | 是 | Teacher | ManagementLayout | 角色库 | 正式 |
| `/classroom/scan` | ClassroomScanView | 是 | Teacher | 独立 | 扫码/设备准备 | 正式 |
| `/classroom/join` | ClassroomJoinView | 是 | Teacher | 独立 | 加入课堂 | 正式 |
| `/classroom/screen/:deviceId?` | ClassroomScreenView | 是* | Teacher/课堂 | 独立 | **正式大屏** | 正式 |
| `/forbidden` | ForbiddenView | 否 | — | 独立 | 无权限提示 | 正式 |
| `/lesson-plans` | LessonPlanListView | 是 | Teacher | ManagementLayout | 教案列表 | 正式 |
| `/lesson-plans/new` | LessonPlanEditorView | 是 | Teacher | ManagementLayout | 新建教案 | 正式 |
| `/lesson-plans/:id/edit` | LessonPlanEditorView | 是 | Teacher | ManagementLayout | 编辑教案 | 正式 |
| `/classroom/preflight/:planId` | ClassroomPreflightView | 是 | Teacher | 独立 | 上课前准备 | 正式 |
| `/classroom/lesson/:runId` | LessonClassroomView | 是 | Teacher | 独立 | **AI 课堂工作台** | 正式 |
| `/classroom/records/:runId` | ClassroomRecordView | 是 | Teacher | 独立 | 课堂记录 | 正式 |
| `/classroom/lesson/:runId/summary` | ClassroomRunSummaryView | 是 | Teacher | 独立 | 课堂总结 | 正式 |
| `/classroom/engagement` | ClassroomOperationsView | 是 | Teacher | ManagementLayout | 课堂运营（考勤/奖励） | 正式 |
| `/classroom/insights` | ClassroomOperationsView | 是 | Teacher | ManagementLayout | 课堂洞察（复用同一组件） | 正式 |
| `/classroom/remote` | ClassroomMobileRemoteView | 是 | Teacher | 独立 | 手机遥控 | 正式 |
| `/resources` | ResourceLibraryView | 是 | Teacher | ManagementLayout | 资源库 | 正式 |
| `/resources/upload` | UploadView | 是 | Teacher | ManagementLayout | 上传 | 正式 |
| `/resources/:id/preview` | ResourcePreviewView | 是 | Teacher | ManagementLayout | 预览（props） | 正式 |
| `/resources/:id/edit` | ResourceEditView | 是 | Teacher | ManagementLayout | 编辑 | 正式 |
| `/resources/:id/review` | ResourceReviewView | 是 | Teacher+adminOnly | ManagementLayout | 审核 | 正式(admin) |
| `/resources/:id` | ResourceDetailView | 是 | Teacher | ManagementLayout | 详情（props） | 正式 |

守卫逻辑（`router/index.ts` L114-130）：`login` 已登录跳 `/chat`；`requiresAuth && !isLogin` → `/login?redirect=`；`adminOnly && !isAdmin` → `/forbidden`。含动态 chunk 加载失败自动重载保护。

### 5.2 导航结构（IA）

- **ManagementLayout**（`frontend/src/components/ManagementLayout.vue`）：主管理侧边导航，包含大多数管理入口。
  - **发现重复入口**：侧边导航直接提供「课堂设备准备」（`router.push('classroom-scan')`），同时**用户设置菜单**也提供「课堂设备」入口（`goDeviceSetup()` → `classroom-scan`）。→ **重复入口 / IA 待收口**（不改动，仅标记）。
- **ChatView sidebar**：聊天视图侧栏，可能承载其它会话入口（以代码为准，是否与 ManagementLayout 承载同一功能需进一步确认）。
- **Classroom navigation**：`LessonClassroomView` 顶部课堂状态区/控制台。

---

## 6. 后端模块

根模块（`backend/src/app.module.ts`）imports 顺序即模块地图（L126-138）：

| Module | Controller | Service | Entity | 主要职责 | 正式/legacy |
|---|---|---|---|---|---|
| Auth | `auth.controller` | `AuthService` | Teacher/refresh-token | 登录(teacher/admin)、refresh、logout、profile、JWT 签发 | 正式 |
| Data | — | — | TeachingResource? | 数据层/教学资源定义 | 正式 |
| Resource | `resource.*` | `ResourceService` | TeachingResource | 资源上传/审核/播放/受保护下载 | 正式 |
| Ai | `ai.*` | — | — | 聊天/教案/Director/ASR/TTS/作品评价 | 混合（见 §19） |
| LessonPlan | `lesson-plan.*` | `LessonPlanService` | LessonPlan/LessonStep | 备课 | 正式 |
| Platform | `platform.*` | `PlatformService`/`PlatformAccessService`/`AuditService` | Teacher/SchoolClass/Student/Classroom/Device/DeviceBinding/ClassroomTicket/AuditLog/AiCallLog | 教师-班级-学生-教室-设备-审计-奖励(P0 大后台) | 正式 |
| ClassroomRun | `classroom-run.*` | `ClassroomRunService` | ClassroomRun/…StepSnapshot/…Event/…DeviceTransfer | 课堂运行/状态/Offline start 守卫 | 正式(P1 核心) |
| Avatar | `avatar.*` | `AvatarService`/`AvatarConfigurationService` | AvatarCharacter/Version/Binding | 数字人角色/绑定 | 正式 |
| ClassroomParticipation | `classroom-participation.*` | — | — | 点名/课堂参与 | 正式 |
| ClassroomEngagement | `classroom-engagement.*` | — | BreakRun/等 | 考勤/课间/互动 | 正式 |
| Artwork | `artwork.*` | — | StudentArtwork… | 幼儿作品 | 正式 |
| ClassroomMobile | `classroom-mobile.*` | — | — | 手机遥控 | 正式 |
| DeviceSession | `device-session.*` | `DeviceSessionService` | DeviceSession | 设备会话签发/心跳 | 正式(P0) |

> legacy 标注见 §34 状态表。凡标注“混合 / 待运行时确认”的，均不得直接当作已建成。

---

## 7. 数据模型（核心 Entity 关系）

> 字段名/表名以代码为准。以下为业务关系，非机械字段清单。

### 7.1 教师-班级-学生
```
Teacher ──1:n──TeacherClass──n:1── SchoolClass ──1:n── Student
  teachers 表           (class_id, teacher_id)     class 表           student 表
```
- `Teacher`（表 `teachers`）：`account` 唯一；`schoolId` 索引。
- `SchoolClass`（表 `class`）：`(name, schoolYear, schoolId)` 唯一。
- `Student`（表 `student`）：`classId` 索引；`(classId, studentNo)` 唯一。
- `TeacherClass`：教师-班级多对多关系（`role`）。

### 7.2 教案-步骤-资源
```
LessonPlan ──1:n── LessonStep ──0..1──> TeachingResource
  lesson_plan           lesson_step(resourceId)
```
- `start()` 校验空教案（`plan.steps.length`）、`validateResources`、`requireApprovedResources`。

### 7.3 教室-设备-绑定
```
Classroom ──1:n── DeviceBinding ──n:1── Device ──1:0..1──> DeviceSession
classroom 1 表          device_binding            device 表            device_session 表
```
- `DeviceBinding`：绑定状态 `BindingStatus`（active 等）。
- `Device.status`：`DeviceStatus` enum = `online | offline | disabled | fault`；`last_online_at`。

### 7.4 课堂运行-快照-关联
```
ClassroomRun ──1:n── ClassroomRunStepSnapshot / ClassroomEvent / ClassroomDeviceTransfer / BreakRun
classroom_run          classroom_run_step_snapshot(originalStepId, run id)
```
- `ClassroomRun`: `lessonPlanId/teacherId/classId/classroomId/deviceId/avatarCharacterId/avatarVersionId/status/startedAt/pausedAt/…`；活跃状态唯一约束（预置/运行/暂停状态下 class_id、device_id 唯一，`UQ_classroom_run_active_class` / `_active_device`）。

### 7.5 奖励 / 作品 / 问题
- `StudentRewardRecord`（表 `student_reward_record`）：成长奖励记录，`revokedAt` 逻辑删除；有专用索引 migration。
- 幼儿作品 `StudentArtwork…`（表见 artwork migration）；儿童问题 `StudentQuestionMap`（`202610060020-StudentQuestionMap`）。

### 7.6 DeviceSession（P0，重点）
表 `device_session`（`device-session.entity.ts`）：
- 主键 `id`；**`tokenHash` 唯一（`UQ_device_session_token`）**；`device_id` 索引（`IDX_device_session_device`）。
- `schoolId / classId / expiresAt / lastHeartbeatAt / revokedAt / revokeReason / createdAt / updatedAt`。
- 只存 token 的 **sha256 哈希**，签发即旋转。

---

## 8. 数据库与 Migration

- 数据库：**SQLite（better-sqlite3）**，默认路径 `./data/app.sqlite`（`DATABASE_PATH`）。
- TypeORM 配置（`app.module.ts` TypeOrmModule.forRootAsync）：
  - `synchronize = DB_SYNCHRONIZE !== 'false'` → **默认 true**（.env.example 亦为 true，注释建议生产迁移验证后设 false）。
  - `migrationsRun = DB_MIGRATIONS_RUN !== 'false'` → **默认 true**。
  - `autoLoadEntities: true`。
- Migration 清单：**29 个**（`app.module.ts` migrations 数组），按序导入到 `migrations/`：
  `StageOnePlatformFoundation…01`、`RefreshSessionTokenVersion…02`、`ClassroomTicketForeignKeys…03`、`ResourceLibrary…04`、`LessonPreparation…05`、`ClassroomRunStateMachine…06`、`ClassroomSnapshot…07`、`AvatarCharacter…08`、`AvatarConfigurationBindings…09`、`ClassroomRunStepSnapshotHints…010`、`StudentRewardRecord…011`、`StudentRewardRecordIndexes…012`、`ClassroomRunBreakFields…013`、`ClassroomDirectorSuggestions…010`、`HeuristicAssistant…011`、`ClassroomCommands…012`、`ClassroomParticipation…013`、`ClassroomEngagement…014`、`ClassroomCommandBus…014`、`FormalAttendanceRollCall…015`、`RewardGrowthHonor…016`、`ClassroomBreakMode…017`、`ClassroomDirector…018`、`TeacherCommandSynonym…019`、`StudentQuestionMap…020`、`ClassroomRecords…021`、`StudentArtworkRecords…022`、`ClassroomMobileRealtime…023`、`DeviceSession…024`（最新）。
- **DeviceSession migration 存在**：`backend/src/migrations/202610090024-DeviceSession.ts`（建 token_hash 唯一索引 + device_id 索引）。
- 生产建议：`DB_SYNCHRONIZE=false` + `DB_MIGRATIONS_RUN=true` + migration rehearsal。**生产未调试时不建议改 synchronize（见 §40 部署）。**
- 未列入并明显确认缺 migration 的 Entity：本轮扫描未发现（全部实体均有对应 migration 或 synchronize auto 创建，需按 §54 抽查复核）。

---

## 9. Authentication

- 登录：`POST /auth/login`（teacher）、`POST /auth/admin/login`（admin）。
- Token：Access JWT（`JWT_ACCESS_EXPIRES_IN=15m`）+ Refresh（`JWT_REFRESH_EXPIRES_IN=30d`）。
- 静默续期：`POST /auth/refresh`；前端 `api/http.ts` 拦截器捕获 401 → 用 `refreshClient.post('/auth/refresh')` 刷新 → 失败则登出。
- 其它：`POST /auth/logout`、`POST /auth/logout-all`、`GET /auth/profile`。
- AuthGuard（`auth.guard.ts`）：`Bearer` → `JwtService.verifyAsync` → `AuthService.validateAccessPayload`。RolesGuard 处理管理员。

### Device Session 链路（P0）
```
Teacher token
   │  POST /devices/:id/device-session  (AuthGuard, teacher, 签授课确认)
   ▼
device_session 签发；只存 tokenHash(sha256)；返回受限 device token
   │  页面打开期间每 ~30s  POST /device-session/heartbeat  (仅 ThrottlerGuard)
   ▼
device.status=online, lastOnlineAt 更新
```
Device token **当前 scope**：仅 heartbeat / 维护设备在线，**不能**访问课堂内容。Screen-state/SSE 是否仍使用 teacher token → 见 §14/§17（已确认 screen-state 走 authenticated teacher request）。

---

## 10. 教师/班级/学生体系

- 教师 `GET /teachers`（admin）；管理员可管理教师（`TeacherManagementView`）。
- 班级：admin `GET/POST /classes` 等；学生：admin `/students`、teacher `/classes/:classId/students`。
- **TeacherClass 为正式权限边界**：`PlatformAccessService.requireClassAccess` 经 `TeacherClass` 限定教师只能访问自己绑定班级；`listClasses` 非 admin 时 innerJoin `TeacherClass` 按 `tc.teacher_id = actor.sub` 过滤，admin 时按 `schoolId` 过滤。
- 主要页面：`MyClassesView`、`ClassesView`、`StudentsView`、`StudentCenterView`、`TeacherManagementView`。

---

## 11. 资源库

- 上传：分片（`RESOURCE_CHUNK_PATH` 非 Web 根）；正式存储 `RESOURCE_UPLOAD_PATH`。
- 审核：`ResourceReviewStatus`（approved 等）；**仅 approved 的 `GARDEN_SHARED_OWNER_ID` 共享资源对教师可见**。
- 播放：受保护 `download`（不公开静态目录）。
- 类型：TeachingResource 支持多种资源类型。
- `LessonStep.resourceId`：课堂经 `resourceId` 加载资源（`requireApprovedResources` 在 start 事务内校验 plan 步骤引用的资源已审核）。
- **>100 条资源列表 fallback**：是否存在对应实现需要运行时/该 service 确认；本轮未在 data/resources 服务中直接看到达到阈值的分页降级分支 → 标「待确认」。

---

## 12. 备课（LessonPlan）

- `LessonPlan`、`LessonStep`、资源绑定（`step.resourceId`）、AI 辅助生成（编辑器 `LessonPlanEditorView`）、编辑/保存。
- 数据流：**备课 → 课堂 Run Snapshot**：`classroom-run.service.start()` 在事务内把 `plan.steps` 快照为 `ClassroomRunStepSnapshot`（复制 step 字段 + actionConfig + recoveryPointConfig），后续课堂读快照而非原教案 → 教案修改不影响已开 Run（原则 #9）。

---

## 13. Preflight（上课前准备）

- 前端 `ClassroomPreflightView`，路由 `/classroom/preflight/:planId`；从 `MyClasses → LessonPlan → Preflight → 设备/绑定 → Start`。
- Preflight 展示所需绑定/设备信息；`start()` 的权威校验见 §15/§18。

---

## 14. Device / Device Session（P0 核心）

- Device 状态：见 `platform.types.ts` `DeviceStatus` = `online | offline | disabled | fault`，对应 `Device.status` 列、`last_online_at`。
- 签发：`POST /devices/:id/device-session`（`AuthGuard` teacher）→ `DeviceSessionService.issue` 校验设备绑定、班级访问、同园所、非 disabled/fault，生成受限 token 只存 hash。
- 心跳：`POST /device-session/heartbeat`（**仅 `ThrottlerGuard`**，凭 `x-device-session`）→ 更新 `device.lastOnlineAt`、`device.status=online`、session `lastHeartbeatAt`。
- 心跳 interval：前端 ~30s；超时：`DEVICE_HEARTBEAT_TIMEOUT_SECONDS`（默认 90）。
- Cron 离线：`platform.service.ts` `markTimedOutDevicesOffline`（`@Cron(EVERY_MINUTE)`）把超过超时且仍 online 的设备翻为 `offline`。
- **Teacher Identity ≠ Device Identity**：已确认。
- Screen-state/SSE：`GET /classroom-runs/screen-state` 走 authenticated teacher request（§17）。

---

## 15. ClassroomRun

- `ClassroomRunStatus`（`classroom-run.types.ts`）：`prepared | running | paused | completed | cancelled | failed`。
- 状态机（`classroom-run.state-machine.ts`）：`prepared→running`；`running/paused→completed/cancelled/failed`；终端状态不可迁移。
- `start()` 校验顺序（`classroom-run.service.ts` L118-186）：
  1. `requireTeacher`
  2. `findDuplicate(actor, requestId)`（幂等）
  3. `requireClassAccess(actor, classId)` + 班级 active
  4. 空教案校验
  5. `validateResources` → `requireValidBinding(dto)`
  6. avatar 校验（`requireReadyForClassroom` 或 `resolveVersionReference`）
  7. 事务内：重复归还 → 再 `requireValidBinding` → `requireApprovedResources` → `ensureNoActiveConflict` → save run + step snapshots。
- 停止设备守卫：`requireValidBinding` L1366-1395（查 DeviceBinding/Classroom/Device，校验教室活跃、设备未停用/故障、`Device.status === DeviceStatus.Online` 否则抛 ConflictException「大屏设备当前离线，无法开始课堂」）。

---

## 16. 课堂生命周期

各状态机**不混为一个**：
- **UI lifecycle**：`opening / teaching / summary`（前端大屏状态见 ClassroomScreenView）。
- **Backend run status**：`prepared/running/paused/completed/cancelled/failed`（§15）。
- **Break substate**：`breakStartedAt / breakEndsAt`（BreakMode migration/migration 字段）。
- **Fullscreen UI**：interaction / leaderboard / avatar 等。
- **AI state**：idle / listening / thinking / speaking（前端数字人/助教状态，如 digitalHuman store）。
- ClassroomScreenView 大屏阶段：`idle/classroom/drawing/reward/break/protection/summary/recovery` 等（该类状态元数据）。

---

## 17. Break / Pause

- `startBreak/endBreak`（classroom-engagement，`BreakRun` 实体，`ACTIVE_BREAK_STATUSES`）。
- `isBreakActive`（classroom-run.types）。Break 与 Pause 语义不同（原则 #6）。
- 课间 UI 是否与 heuristic assistant 完全分开 → 需运行时确认（§27 已确认存在 BreakMode；真实课堂 E2E 未在本词条内复核）。

---

## 18. Classroom Commands

- 命令（classroom-run.types / classroom-command 相关）：`NEXT_STEP / PREVIOUS_STEP / PAUSE_CLASS / RESUME_CLASS / RESET_STEP`；media：`PAUSE_MEDIA / RESUME_MEDIA / STOP_MEDIA / CLOSE_RESOURCE / VOLUME_UP / VOLUME_DOWN`。
- 指令来源：多通道（DeviceSession 演进 / classroom command bus，`202610060014-ClassroomCommandBus`）；入口含聊天/语音（`resource-search` / voice command `stores/voiceCommandPreference.ts`）。
- deterministic parser + AI fallback 是否存在、command bus 的 backend/frontend 权威 → 需按 §43 API 抽查与运行时确认。Candidate 不自动 `candidates[0]`（开发规则 #5）。

---

## 19. AI / Director / ASR / TTS

| 能力 | 端点/入口 | 状态标注（以代码为准，必要时运行时确认） |
|---|---|---|
| Chat | `/ai/*`、`ChatView` | 正式（真实模型，需 teacher 上下文） |
| Lesson planning | `/ai/*`、教案编辑器 | formal |
| Classroom assistant / Heuristic assistant | heuristic drafts migration | 存在（HeuristicAssistantDrafts） |
| Classroom Director old / V2 | `classroomDirector` store / director endpoint | 见 §22，**V2 vs old 以代码确认** |
| Resource search / voice | `/ai/*` resource-search、`/classroom-runs/commands` | 存在（Candidate→teacher confirm） |
| TTS | `VOLC_*`（豆包语音合成 2.0） | 真实密钥端点在代码配置，**调用状态需运行时确认** |
| ASR | `VOLC_*`（火山 ASR 2.0） | 同上 |
| Artwork AI | `/artworks/*` vision model | 未配置视觉模型时接口明确返回能力不可用 |
| Question AI | question-map AI（`QUESTION_MAP_AI_ENABLED`） | programmatic；只发当前有权班级匿名聚合 |

> **禁止将 AI mock 测试通过写成真实模型验收**。以上“真实模型”标注仅在调用真实第三方 SDK 时成立；须结合 Network/运行时最终确认。

---

## 20. AI Director old / V2

- old 与 V2 endpoint 是否存在及前端使用哪个：`frontend/src/stores/classroomDirector.ts` 记录导演调用；若无法从静态扫描确定当前使用的旧版还是新版 → 标「需 Network/运行时确认」。**不删除任何一方**。

---

## 21. Attendance（考勤）

- 正式实现：`ClassroomEngagementModule` 相关（formal attendance/roll call，`FormalAttendanceRollCall…015`）。
- legacy attendance 是否存在：需 §43 抽查确认。若存在并存文档与代码，明确「权威数据源待确认」；**不自行删除 legacy**。

---

## 22. Reward / Growth / Honor

- **正式**：`student_reward_record`（`StudentRewardRecord`，Stage 7.3，`requestId` 幂等写入、`revokedAt` 撤销、班级累计）。
- legacy：`reward_record` / engagement-rewards 是否存在 → 需 §54 抽查；如有，标注 legacy/COMPAT，不删除。
- Growth/Honor/CollectiveGoal：`RewardGrowthHonor…016` migration 存在性已列出 → 需运行时/代码确认正式程度。

---

## 23. Questions（儿童问题 / 问题地图）

- 正式模型：`StudentQuestionMap`（migration 020）+ `classroom.messages` 课堂记录，AI 回答草稿流程（teacher confirm）。
- 旧 localStorage：Stage 7.5 前端已切换至 backend，后端未就绪时显式阻塞、**不回落 localStorage**；是否彻底无 localStorage 残留按 §43 抽查确认。

---

## 24. Artwork（作品 / 绘画评价）

- 上传 → 受保护目录 `ARTWORK_UPLOAD_PATH` → AI 草稿（vision model，缺配置则能力不可用）→ 教师确认 → 保存 → 历史。
- backend handoff 见 `docs/STAGE_7_6_ARTWORK_BACKEND_HANDOFF.md`：**哪些是真实 backend、哪些 blocked/mock 需按该 handoff + 代码确认**。

---

## 25. Mobile Remote（classroom-mobile）

- `POST/GET .../classroom-mobile/*`：join / state / heartbeat / revoke / commands。
- 区分：**device heartbeat**（`/device-session/heartbeat`）vs **mobile session heartbeat**（`CLASSROOM_MOBILE_SESSION_TTL_MS`，默认 8h）。
- 前端 `ClassroomMobileRemoteView` + `stores/classroomMobile.ts` + `api/classroomMobile.ts`。
- LAN 部署地址 `CLASSROOM_LAN_BASE_URL`（手机访问服务端）。

---

## 26. Classroom Screen（正式大屏）

- `ClassroomScreenView`（`/classroom/screen/:deviceId?`）+ device heartbeat。
- `GET /classroom-runs/screen-state`：走 authenticated teacher request（§14/§17）。
- screen-state / SSE 是否仍依赖 teacher auth → **按当前代码：是（screen-state 仍需认证）**。页面本身作为大屏打开时依赖 teacher 登录态来读状态，而 device 在线由 DeviceSession 心跳单独维护——这是当前边界，未处理成“设备 token 读取状态”（标为理解现状，非 Bug，作为潜在演进点）。

---

## 27. Break（课间）

见 §17。BreakMode migration、BreakRun 实体、startBreak/endBreak、server time、countdown、multi-device sync、allowed/rejected commands → 以 classroom-engagement 代码真实实现为准；若只经 unit test 未做真实课堂 E2E，标「尚未完成真实环境验收」。
课间 UI 已与 heuristic assistant 分开与否 → 运行时确认（见 Known Issues 双导航/助理相关）。

---

## 28. 点名 / 课堂互动

- random roll call / manual select / quick reward（classroom-participation）。
- **随机点名 ≠ attendance**（原则 #7）。
- 普通态入口 + fullscreen 交互（interaction）在代码中是否实现 → 以 ClassroomParticipationModule factory 确认为准。

---

## 29. Avatar / Digital Human（重点）

代码模型（`backend/src/avatars/` Reviewer + `frontend/src/components/digital-human/`）：
- Character / Version / Binding / Identity；class 绑定、lesson 绑定、system 绑定。
- migration：`AvatarCharacterAssets…008`、`AvatarConfigurationBindings…009`、`ClassroomRunStepSnapshotHints…010`。
- 渲染组件：`ClassroomAvatar`、`DigitalHumanStage`、`ThreeAvatarStage`（以 components/digital-human 实际文件为准）。
- 本任务需回答（11 问）——**部分无法仅靠静态扫描判断，标记「待运行时/数据确认」**：
  1. 正式数据模型：Avatar(Character/Version/Binding/Identity)（有 migration 支持）。
  2. 一个班绑定 Avatar：`avatar-configuration`（class 配置绑定）。
  3-5. 谁能修改 class avatar / 普通 teacher 是否还能改 / admin 是否可改：`AvatarConfigurationService` + `setClassroomAvatarBinding`；权限需 `require*` 复核。
  6. Run start 是否 snapshot avatar：`classroom-run.service.start()` 记录 `avatarCharacterId/avatarVersionId`（run 快照角色引用）。
  7-9. Opening/Teaching/Fullscreen 各读哪个 identity：需运行时确认（Opening 开场数字人读取逻辑在课堂组件中）。
  10. 三者一致性：待运行时确认。
  11. local GLB/VRM vs 未来商用 provider 边界：当前 local 资产（GLB/VRM 引擎 `avatar-engine-1`）+ provider 预留 `AVATAR_SUPPORTED_ENGINE_VERSIONS`；以 `avatar.service` provider 抽象为准，**不要把“未来商用 provider”写成现状**。
- 若历史 run snapshot 与当前 class binding 不一致 → 区分「历史快照」vs「新 Run 错误」，不直接标 Bug（原则 #9）。

---

## 30. 角色库（Avatar Library）

- `AvatarLibraryView`（`/avatars`）；角色列表/版本/ready/status；admin 与 teacher 入口。
- **正式资源污染风险**：存在测试专用 avatar（如 “Avatar E2E Test”，见 docs 与 seed），可能暴露到正式 UI；须标为**测试数据污染风险[TEST_ONLY]**。GLB/VRM/asset id 是否暴露到正式 UI → 运行时确认。

---

## 31. 儿童问题 / 作品（历史数据源切换）

- 问题：正式 backend（`StudentQuestionMap`）+ 课堂记录；旧 localStorage 已不再正式使用（§23）——如代码发现残留则标出。
- 作品：正式 backend（artwork）；blocked 项见 §24 handoff。

---

## 32. 手机实时控制

见 §25。

---

## 33. 正式大屏

见 §26。

---

## 34. 课堂结束 / Summary

- complete API、complete 失败行为、`/classroom/lesson/:runId/summary`、刷新恢复、Reward summary、AI summary（`CLASSROOM_SUMMARY_AI_ENABLED`）、classroom record（`/classroom/records/:runId`）。
- Summary `ClassroomRunSummaryView` 为独立视图，不依赖 ManagementLayout。
- `ClassroomRecordService`（classroom-runs）+ `ClassroomRecords…021` migration。

---

## 35. 管理看板 / 审计

- `/admin`（AdminDashboardView）、`/admin/audit`（AdminAuditView）。
- `AuditLog` 实体 + `AuditService.write`：class.create、teacher_class.bind、device 等审计写入。

---

## 36. Reliability（可靠性）

代码有证据的（非未来规划）：
- 刷新恢复：refresh restore（recovery path）。
- 幂等：`findDuplicate(requestId)`、`ensureNoActiveConflict`。
- 离线处理：Device heartbeat/offline cron。
- AI failure / TTS failure / resource error：`AI_REQUEST_TIMEOUT_MS`、artwork 缺视觉模型明确返回不可用；resource 播放错误处理。
- device offline：cron `markTimedOutDevicesOffline`。
- stale request guard：chunk 加载重载保护 / 双向校验（是否覆盖前端异步需运行时确认）。
- retry：存在与否需按代码确认。

---

## 37. Privacy / Child Data（儿童数据）

- guardian authorization、photo/voice permission、class isolation（`requireClassAccess` 按班隔离）、audit、masking、export/delete：**仅 class isolation 与 audit 在代码中有明显证据**；其余如 PRD 有但代码无 → 标「产品要求存在，当前实现未确认」。不虚构已实现。

---

## 38. Testing

- Backend：Jest（unit）+ e2e（`backend/test/jest-e2e.json`，supertest）。命令：`npm test`（jest）、`npm run test:e2e`、`npm run type-check`（`tsc --noEmit`）、`npm run build`（nest build）。
- Frontend：Vitest unit（`tests/unit`）；E2E runner `frontend/tests/e2e/run.mjs`（Playwright）；`vue-tsc --build`；`vite build`。
- migration rehearsal：见 docs（已通过的 Device Online gate 用 temp 库同步）。
- 测试数量：**本次未重新运行全量**。本期已实际跑通：前端 `vue-tsc --build`（通过，0 error）、后端 `nest build`（通过）、`tests/unit/device-session.spec.ts`（7/7）。其余测试文件数请以 `ls` 实测为准，不写历史数字为当前事实。

---

## 39. Environment（启动）

- backend port：`PORT` 默认 **3001**（.env.example）——注意 `main.ts` 亦用 `PORT`。
- frontend port：由 Vite 决定（dev 默认 5173，以前端 `vite.config.ts` 为准）。
- 启动：backend `npm run start:dev` / `start:prod`(node dist/main)；frontend `npm run dev`；build：`nest build` / `vite build`；test：见 §38。
- migration：启动时 `DB_MIGRATIONS_RUN=true` 自动跑；手动 rehearsal 用同步库（见 docs gate）。

---

## 40. Deployment / Migration Checklist

正式升级前建议（依据 .env.example 注释 + docs）：
1. database backup（`backend/data/*.sqlite`，见 .gitignore）。
2. `DB_SYNCHRONIZE=false`（迁移验证完成后）。
3. `DB_MIGRATIONS_RUN=true`。
4. migration rehearsal（临时库验证 schema 一致）。
5. integrity check。
6. start backend。
7. smoke test。

> 本说明不强求在未具备迁移验证环境时直接改 synchronize；优先保证数据安全。

---

## Current Known Issues / Technical Debt

> 按 §41 要求。以下为**本轮扫描能由代码证实**的项；若无法证实仅列“待确认”，不编造。

### P0
- **Device offline 判定时间窗不一致**（核心发现）
  - 问题：`platform.service.ts` `deviceStatusSummary` 用 `last_online_at` **新鲜度即时推导** offline；而 `classroom-run.service.ts` `requireValidBinding` 读权威持久化 `device.status` 列，离线靠 cron `markTimedOutDevicesOffline`（EVERY_MINUTE）翻转。
  - 影响：GET /devices（UI）可能已显示 offline 而 start() 仍短暂放行（直到 cron 翻转），两处判定不一致。
  - 证据：`platform.service.ts` L660-672（cron）+ L1331-1342（statusSummary）、`classroom-run.service.ts` L1366-1395（requireValidBinding）。
  - Ownership：backend platform + classroom-runs。
  - Blocked：否（业务可改，需 owner 确认）。
  - 推荐下一步：让 `requireValidBinding` 融合 `lastOnlineAt` 新鲜度判定（运行时确认后最小化改动 + 测试）。

### P1
- **前一次异常修复的三处 dirty 未提交**（deviceSession.ts / device-online-gate.spec.ts / ClassroomPartnerPanel.vue BOM）。属 FYI，非缺陷；需 owner 决定是否提交。
- **重复入口**：课堂设备准备同时出现在 ManagementLayout 侧边导航与用户设置菜单（`classroom-scan`）→ IA 待收口。
- **Offline policy 的 frontend preflight 与 backend start 一致性**：preflight 读 summary；backend start 读权威 status；因 P0 项时序差异，可能存在瞬时不一致（合并到 P0 项处理）。

### P2
- **测试专用 Avatar 数据暴露风险**：Avatar E2E Test 角色可能进入正式角色库 UI（`AvatarLibraryView`）。
- **双导航 / Director old 与 V2 是否区分** → 运行时确认。

---

## Active / Legacy / Blocked Matrix

标签定义：**ACTIVE** 生产路径使用；**LEGACY** 旧实现不得新增依赖；**COMPAT** 兼容旧客户端；**BLOCKED** 前端/后端某侧缺失；**PARTIAL** 部分实现；**PLANNED** 仅设计/需求；**TEST_ONLY** 测试用途。

| 功能 | 标签 | 依据 |
|---|---|---|
| 教师-班级-学生-设备 | [ACTIVE] | platform + my-classes 链路 |
| 备课（LessonPlan→Run snapshot） | [ACTIVE] | start() 事务快照 |
| 课堂运行（ClassroomRun 状态机） | [ACTIVE] | state-machine + controller |
| Device Online / DeviceSession | [ACTIVE] | P0 gate 报告 + heartbeat |
| 资源库（上传/审核/播放） | [ACTIVE] | resources |
| 课堂记录/Summary | [ACTIVE] | records migration + views |
| 成长奖励（student_reward_record） | [ACTIVE] | Stage 7.3 |
| 儿童问题/作品 backend | [PARTIAL] | 有模型，需真实联调确认/视觉模型需配置 |
| 旧 reward_record / 旧 attendance | [LEGACY or COMPAT，待确认] | 需 §54 抽查 |
| Classroom Director old/V2 区分 | [需运行时确认] | classroomDirector store |
| 移动遥控（classroom-mobile） | [ACTIVE] | 模块 + views |
| Avatar 商用 provider | [PLANNED] | 仅 ```AVATAR_SUPPORTED_ENGINE_VERSIONS``` 预留 |
| Avatar E2E Test 角色 | [TEST_ONLY] | seed/docs |

---

## 32. API Matrix（核心）

> 依据 `backend/src` 各 Controller 的 `@Controller(prefix)`（已核对 23 处）。`Status` 沿用 §34 标注。

| Method | Path | 模块 | 用途 | 认证/角色 | Status |
|---|---|---|---|---|---|
| POST | `/auth/login` | auth | 教师登录 | public | ACTIVE |
| POST | `/auth/admin/login` | auth | 管理员登录 | public | ACTIVE |
| POST | `/auth/refresh` | auth | 静默续期 | JWT | ACTIVE |
| POST | `/auth/logout` / `/auth/logout-all` | auth | 登出 | JWT | ACTIVE |
| GET | `/auth/profile` | auth | 当前身份 | JWT | ACTIVE |
| POST | `/devices/:id/device-session` | device-session | 签发设备会话 | AuthGuard(teacher) | ACTIVE |
| POST | `/device-session/heartbeat` | device-session | 设备心跳在线 | `x-device-session`(Throttler) | ACTIVE |
| POST | `/classroom-runs/start` | classroom-runs | 开始课堂 | teacher | ACTIVE |
| GET | `/classroom-runs/active` | classroom-runs | 活跃课堂 | teacher | ACTIVE |
| GET | `/classroom-runs/screen-state` | classroom-runs | 大屏状态 | authenticated | ACTIVE |
| POST | `/classroom-runs/*` | classroom-runs | 暂停/恢复/完成 等 | teacher | ACTIVE |
| * | `/classroom-commands` | classroom-runs | 课堂指令 | teacher | ACTIVE |
| * | `/classroom-mobile/*` | classroom-mobile | 手机 join/state/heartbeat/commands | 混合 | ACTIVE |
| * | `/classroom-runs` / `/students` | classroom-participation | 点名/参与 | teacher | ACTIVE |
| * | `/(root)` | classroom-engagement | 考勤/互动作业 | teacher | ACTIVE |
| GET | `/resources` | resources | 资源列表 | teacher | ACTIVE |
| POST | `/resources` | resources | 上传 | teacher | ACTIVE |
| * | `/resources/:id/download` | resources | 受保护下载 | teacher | ACTIVE |
| * | `/avatars` | avatars | 角色/版本/资产/绑定 | teacher/admin | ACTIVE |
| * | `/ai` | ai | 聊天/教案/规划 | teacher | ACTIVE |
| * | `/ai` (classroom-director-v2) | ai | Classroom Director V2 | teacher | 待运行时确认 |
| GET/POST | `/data` / `/emotion` | data | 数据/情绪 | teacher | ACTIVE |
| * | `/(root)` | artwork | 作品上传/评价 | teacher | PARTIAL(需视觉模型) |
| GET | `/(root)` | platform | 教师/班级/学生/设备/审计 | teacher/admin | ACTIVE |

---

## 33. Store Matrix（前端 Store 总表）

> 依据 `frontend/src/stores/` 实际文件（已列出全部 17 个含 `index.ts`）。职责为按文件命名与调用保守归纳。

| Store | 职责 | 依赖 API | 持久化 | Authoritative? |
|---|---|---|---|---|
| `user` | 登录身份/isLogin/isAdmin/initialize | auth | localStorage(子项) | 是（后端 profile） |
| `lessonRun` | 课堂运行状态（开课/进度/指令） | classroom-runs | — | 是（后端 run） |
| `deviceSession` | 设备在线（token 签发/心跳/timer） | device-session | localStorage(device token hash) | 心跳态 |
| `digitalHuman` | 数字人渲染/说话状态 | avatar | — | 否（UI 态） |
| `classroomDirector` | Classroom Director V2 状态 | /ai director | — | 待运行时确认 |
| `classroomAssistant` | 课堂(启发)助教 | /ai | — | 待运行时确认 |
| `classroomMobile` | 手机遥控 join/heartbeat/命令 | classroom-mobile | localStorage(入口) | 是（后端 session） |
| `voiceCommandPreference` | 语音指令偏好 | classroom-commands | localStorage | 否（偏好） |
| `resourcePlayer` | 资源播放器状态 | resources | — | 否（播放态） |
| `courseResource` | 课程资源(列表/收藏) | resources | — | 是（后端库） |
| `lessonPlan` | 教案编辑 | lesson-plans | — | 是（后端） |
| `library` | 资源库浏览 | resources | — | 是 |
| `favorite` | 收藏 | resources | localStorage/local | 是（后端收藏，若有） |
| `conversation` | 聊天会话 | /ai chat | localStorage | 混合 |
| `classroomCommand` | 课堂指令缓冲 | classroom-commands | — | 是（后端权威） |
| `counter` | 通用计数器（demo/通用） | — | — | 否（样例） |

> 标注「待运行时确认」的 store 仅表示其是否调用真实模型/真实端点未在本词条内最终验证；**不得据此宣称已真实联调**。

---

## Where to Modify What

> 快速定位，替代全项目乱搜。

- **登录/认证/JWT/refresh** → `backend/src/auth/`（auth.module/controller/service/guard），`frontend/src/api/http.ts`、`frontend/src/stores/user.ts`、`frontend/src/views/LoginView.vue`。
- **教师/班级/学生权限** → `backend/src/platform/platform-access.service.ts`（`require*`）、`backend/src/platform/platform.service.ts`、前端 `views/MyClassesView/ClassesView/StudentsView`。
- **班级/学生/教室/设备管理 API** → `frontend/src/api/platform.ts`。
- **资源库** → `backend/src/resources/`、`frontend/src/api/resources.ts`、`views/resources/*`。
- **备课** → `backend/src/lesson-plans/`、`frontend/src/stores/lessonPlan.ts`、`views/LessonPlanEditorView.vue`。
- **课堂运行** → `backend/src/classroom-runs/`（service/state-machine/types）、`frontend/src/stores/lessonRun.ts`、`views/LessonClassroomView.vue`。
- **设备在线** → `backend/src/device-session/`、`backend/src/platform/platform.service.ts`（heartbeat/cron/statusSummary）、`frontend/src/api/deviceSession.ts`、`frontend/src/stores/deviceSession.ts`、`views/ClassroomScreenView.vue`。
- **数字人** → `backend/src/avatars/`、`frontend/src/api/avatar.ts`、`stores/digitalHuman.ts`、`components/digital-human/*`、`views/AvatarLibraryView.vue`。
- **考勤/课间/互动** → `backend/src/classroom-engagement/`、`backend/src/classroom-participation/`、`views/ClassroomOperationsView.vue`。
- **奖励** → `backend/src/platform/`（StudentRewardRecord）、`views/ClassRewardHistoryView.vue`。
- **AI** → `backend/src/ai/`、`frontend/src/api/`、`stores/classroomAssistant/classroomDirector/voiceCommandPreference`。
- **作品** → `backend/src/artworks/`、handoff docs。
- **手机遥控** → `backend/src/classroom-mobile/`、`frontend/src/api/classroomMobile.ts`、`stores/classroomMobile.ts`、`views/ClassroomMobileRemoteView.vue`。
- **审计** → `backend/src/platform/audit.service.ts`、`views/AdminAuditView.vue`。

---

## High-Risk Areas

| 区域 | 为何危险 | 修改前检查 | 修改后必跑 |
|---|---|---|---|
| ClassroomRun | 状态机/快照/幂等 | 别破坏 prepared→running 迁移合法性 | classroom-run tests + start 幂等 e2e |
| Device online | 离线判定两套逻辑 | 对齐 statusSummary 与 requireValidBinding | device-session e2e + offline start 409 |
| Migration | 生产库变更 | 先 rehearsal、确认同步/迁移模式 | migration rehearsal + smoke |
| Reward authority | requestId 幂等 + 权威原子写入 | 不破坏幂等 | reward 幂等测试 |
| Attendance authority | 正式数据源 | 不误删 legacy | attendance e2e |
| Avatar snapshot | class binding 与 run snapshot 一致性 | 区分历史快照/新 Run | avatar + run snapshot 测试 |
| Auth refresh | 静默续期 | 不破坏 silent refresh | refresh e2e（silent-refresh 报告） |
| Resource protected blob | 不公开静态目录 | 不放 Web 根 | protected download e2e |

---

## 开发规则（项目约束）

1. 不允许 mock/localStorage 假装 backend success。
2. Backend authoritative state 不能被 frontend 本地覆盖。
3. 新 Entity 必须 migration。
4. AI child-facing output 默认 teacher confirm。
5. Candidate 不自动 `candidates[0]`。
6. Break ≠ Pause。
7. Roll call ≠ Attendance。
8. Class avatar ≠ Teacher preference。
9. Run snapshot 不因 class config 中途改变。
10. Legacy 未确认前不可删除。
11. 禁止 `eslint --fix` 作为 Final Gate（前端 lint 脚本恰为 `eslint . --fix`——**不以此作为验收**）。
12. 禁止 `git add .` / `git add -A`（逐文件 add + 检查 diff）。
13. 未经要求不 commit。
14. 修改必须输出 diff/status/tests。

> 与仓库现状冲突：前端 `package.json` 的 `lint` 脚本为 `eslint . --fix`（即修复式 lint），按规则 #11 不作为 Final Gate；未发现其它正面冲突。

---

## AI Agent Change Checklist

改代码前必须回答：
1. 本任务属于哪个模块？
2. 当前正式实现是谁？
3. 是否存在 legacy？
4. authoritative state 在哪？
5. 是否涉及 migration？
6. 是否涉及权限？
7. 是否涉及 ClassroomRun snapshot？
8. 允许修改哪些文件？
9. 禁止修改哪些模块？
10. 需要哪些 tests？
11. 是否需要 Browser E2E？
12. 是否允许 commit？