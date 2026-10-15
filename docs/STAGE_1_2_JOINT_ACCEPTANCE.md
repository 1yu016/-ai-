# 阶段一、二联合验收报告

验收日期：2026-10-12

分支：`codex/member-a-next`

验收基线：`e2f1b22`
范围：后台基础架构、导航与鉴权、班级、学生、学生导入、教室、设备、资源访问、上传、预览、编辑收藏、审核与教案引用闭环。

## 1. 验收结论

| 验收项目 | 结果 | 测试证据 | 问题文件 / 复现步骤 | 修复建议 |
| --- | --- | --- | --- | --- |
| 管理员登录、工作台统计 | 通过 | 前端单元测试与 `auth-lifecycle.spec.ts` | 无 | 保持统计接口真实返回；缺少字段时显示暂无统计接口 |
| 班级新增、编辑、详情 | 通过 | 后端 platform E2E；前端 `ClassesView.spec.ts` | 无 | 无 |
| 学生查看、编辑和隐私授权 | 通过 | 后端 platform E2E；`StudentPrivacy.spec.ts`、`StudentsView.spec.ts` | 无 | 无 |
| 学生表格预览、确认、错误下载 | 通过 | 后端 platform E2E；`StudentImportPanel.spec.ts` | 无 | 现场用真实 Excel 模板再抽测一次 |
| 教室、设备、绑定与解绑 | 通过 | 后端 platform E2E；`device-online-gate.spec.ts` | 无 | 无 |
| 设备在线、离线与停用判断 | 通过 | 设备心跳 E2E，覆盖离线阻断和恢复心跳 | 无 | 无 |
| 资源上传和真实状态回读 | 通过 | 后端 resource E2E；`ResourceUpload.spec.ts` | 无 | 无 |
| 图片、音频、视频、PDF 与 3D 预览适配 | 通过 | `resource-player-media.spec.ts`、资源适配器单测 | 无 | 大文件和低性能设备需现场抽测 |
| 资源编辑、收藏和取消收藏 | 通过 | resource E2E 与前端资源视图测试 | 无 | 无 |
| 提交审核、管理员通过/驳回/归档 | 通过 | resource E2E；`core-flow.spec.ts` | 无 | 无 |
| 已审核资源绑定教案步骤 | 通过 | lesson-plan E2E；`lesson-resource-binding.spec.ts` | 无 | 无 |
| 未审核资源进入课堂的服务端阻断 | 通过 | classroom-run 与 lesson-plan E2E | 无 | 无 |
| 页面逐级返回、直接 URL、刷新、前进后退 | 通过 | `navigation-rules.spec.ts` | 无 | 无 |
| 旧路径兼容跳转与 404 | 通过 | `navigation-rules.spec.ts`、路由单元测试 | 无 | 无 |
| 401、403 和角色菜单隔离 | 通过 | `auth-lifecycle.spec.ts`、`core-flow.spec.ts` | 无 | 无 |
| 教师跨班访问阻断 | 通过 | 后端 platform/resource/lesson E2E | 无 | 无 |
| Token 不进入资源 URL | 通过 | 资源预览通过鉴权请求取得 Blob/Object URL；前端单测覆盖释放 | 无 | 无 |
| 后端错误不展示堆栈 | 通过 | 统一 HTTP 错误适配和错误状态组件测试 | 无 | 无 |
| 假上传、假保存、假审核检查 | 通过 | 所有成功状态以后端响应和刷新回读为准 | 无 | 无 |
| 麦克风、摄像头、音响真机 | 待现场验证 | 自动化环境无真实外设 | 用部署教室的真实设备逐项操作 | 按现场验收清单记录型号、浏览器和结果 |
| 外网断开、局域网继续课堂 | 待现场验证 | 自动化覆盖重连与心跳，未覆盖真实网络切换 | 课堂中断开外网并保留局域网 | 使用固定局域网地址和真实手机、大屏复测 |

## 2. 自动化与构建证据

| 命令 | 结果 |
| --- | --- |
| 后端 `npm run lint` | 通过 |
| 后端 `npm run type-check` | 通过 |
| 后端 `npm run build` | 通过 |
| 后端 `npm run test -- --runInBand` | 15 个套件、121 项通过 |
| 后端 `npm run test:e2e -- --runInBand` | 21 个套件、178 项通过 |
| 前端 `npm run lint` | 通过 |
| 前端 `npm run type-check` | 通过 |
| 前端 `npm run build` | 通过 |
| 前端 `npm run test` | 73 个文件、584 项通过 |
| 前端 `npm run test:e2e` | 22 项通过 |
| 生产构建启动 | 后端 `dist/main.js` 与前端 `vite preview` 均可启动并响应 HTTP |

前端构建仍提示 `GLTFLoader` 相关分包约 630 KB，属于性能提醒，不影响构建和功能。

## 3. 前端路由清单

### 公共和鉴权

| 路径 | 名称 | 角色 / 说明 |
| --- | --- | --- |
| `/` | home-redirect | 跳转 `/chat` |
| `/chat` | chat | 公共 AI 助教入口 |
| `/login` | login | 公共登录页，支持完整 redirect |
| `/forbidden` | forbidden | 403 页面 |
| `/:pathMatch(.*)*` | not-found | 404 页面 |

### 后台工作台

| 路径 | 名称 | 角色 |
| --- | --- | --- |
| `/admin` | admin-dashboard | 管理员 |
| `/admin/audit` | admin-audit | 管理员 |
| `/admin/teachers` | teachers | 管理员 |
| `/admin/classes` | classes | 管理员 |
| `/admin/classes/:classId` | class-detail | 管理员；教师入口由自己的班级页进入 |
| `/my-classes` | my-classes | 教师 / 管理员 |
| `/admin/students` | student-center | 管理员 |
| `/admin/classes/:classId/students` | students | 有班级权限的教师 / 管理员 |
| `/admin/classes/:classId/students/:studentId` | student-profile | 有班级权限的教师 / 管理员 |
| `/classes/:classId/rewards` | class-rewards | 有班级权限的教师 / 管理员 |
| `/classes/:classId/questions` | class-questions | 有班级权限的教师 / 管理员 |
| `/admin/classrooms` | classrooms | 教师只看有权范围；管理员管理 |
| `/admin/classrooms/:classroomId` | classroom-detail | 教师只看有权范围；管理员管理 |
| `/admin/devices` | devices | 教师只看本班设备；管理员管理 |
| `/admin/devices/:deviceId` | device-detail | 教师只看本班设备；管理员管理 |
| `/avatars` | avatars | 登录用户，后端继续校验角色权限 |

### 资源、备课与课堂

| 路径 | 名称 | 说明 |
| --- | --- | --- |
| `/resources` | resources | 资源列表 |
| `/resources/upload` | resource-upload | 真实上传 |
| `/resources/:id` | resource-detail | 资源详情 |
| `/resources/:id/preview` | resource-preview | 鉴权预览 |
| `/resources/:id/edit` | resource-edit | 元数据编辑 |
| `/resources/:id/review` | resource-review | 管理员审核 |
| `/lesson-plans` | lesson-plans | 阶段三备课中心稳定入口 |
| `/lesson-plans/new` | lesson-plan-new | 新建教案 |
| `/lesson-plans/:id/edit` | lesson-plan-edit | 编辑教案和绑定已审核资源 |
| `/classroom/preflight/:planId` | lesson-classroom-preflight | 上课前设备与资源检查 |
| `/classroom/lesson/:runId` | lesson-classroom | 教师课堂控制 |
| `/classroom/records/:runId` | classroom-record | 课堂记录 |
| `/classroom/lesson/:runId/summary` | lesson-classroom-summary | 课堂总结 |
| `/classroom/scan` | classroom-scan | 设备准备 |
| `/classroom/join` | classroom-join | 手机扫码加入 |
| `/classroom/screen/:deviceId?` | classroom-screen | 独立大屏布局 |
| `/classroom/engagement` | classroom-engagement | 课堂互动 |
| `/classroom/insights` | classroom-insights | 课堂洞察 |
| `/classroom/remote` | classroom-remote | 手机控制布局 |

兼容路径：`/classes`、`/classes/:classId`、`/students`、`/classes/:classId/students`、`/classes/:classId/students/:studentId`、`/students/:studentId`、`/devices`。这些路径会保留查询参数并跳转到对应规范路径。

## 4. 阶段一、二接口清单

### 身份

- `POST /auth/login`
- `POST /auth/admin/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `POST /auth/logout-all`
- `GET /auth/profile`

### 班级、教师和学生

- `POST /classes`、`GET /classes`、`GET /classes/:id`、`PATCH /classes/:id`
- `GET /classes/:classId/classroom-runs`
- `POST /classes/:classId/teachers`、`GET /classes/:classId/teachers`、`DELETE /classes/:classId/teachers/:teacherId`
- `GET /teachers`、`POST /teachers`、`PATCH /teachers/:id`
- `POST /students`、`GET /students`、`GET /students/:id`、`PATCH /students/:id`
- `GET /classes/:classId/students/import/template`
- `POST /classes/:classId/students/import/preview`
- `POST /classes/:classId/students/import/:sessionId/confirm`
- `GET /classes/:classId/students/import/:sessionId/errors`

### 教室、设备和配对

- `POST /classrooms`、`GET /classrooms`、`GET /classrooms/:id`、`PATCH /classrooms/:id`
- `POST /devices`、`GET /devices`、`GET /devices/:id`、`PATCH /devices/:id`
- `POST /devices/:id/heartbeat`
- `POST /device-bindings`、`DELETE /device-bindings/:id`
- `GET /classes/:classId/device-bindings`
- `GET /devices/context/:deviceCode`
- `POST /devices/:id/device-session`、`POST /device-session/heartbeat`
- `POST /classroom-tickets`、`POST /classroom-tickets/consume`

### 资源

- `POST /resources/upload`、`GET /resources`、`GET /resources/search`
- `POST /resources/upload-sessions`
- `GET /resources/upload-sessions/:id/chunks`
- `POST /resources/upload-sessions/:id/chunks/:chunkNo`
- `POST /resources/upload-sessions/:id/complete`
- `DELETE /resources/upload-sessions/:id`
- `GET /resources/:id`、`PATCH /resources/:id`、`DELETE /resources/:id`
- `GET /resources/:id/content`、`GET /resources/:id/download`
- `GET /resources/:id/preview-manifest`、`GET /resources/:id/preview-assets/:assetName`
- `POST /resources/:id/favorite`、`DELETE /resources/:id/favorite`
- `GET /resources/:id/references`、`POST /resources/:id/references`、`DELETE /resources/:id/references`
- `POST /resources/:id/submit-review`、`POST /resources/:id/review`

### 备课与课堂入口

- `POST /lesson-plans`、`GET /lesson-plans`、`GET /lesson-plans/:id`、`PATCH /lesson-plans/:id`、`DELETE /lesson-plans/:id`
- `POST /lesson-plans/:id/copy`
- `PUT /lesson-plans/:id/steps`、`POST /lesson-plans/:id/steps`、`PATCH /lesson-plans/:id/steps/:stepId`、`DELETE /lesson-plans/:id/steps/:stepId`
- `POST /lesson-plans/:id/start`
- `GET /lesson-runs/:id`、`PATCH /lesson-runs/:id/progress`
- `POST /lesson-runs/:id/pause`、`POST /lesson-runs/:id/resume`、`POST /lesson-runs/:id/complete`、`POST /lesson-runs/:id/cancel`

### 管理和审计

- `GET /admin/dashboard`
- `GET /audit-logs`
- `GET /ai-call-logs`

## 5. 权限矩阵

| 能力 | 游客 | 教师 | 管理员 |
| --- | --- | --- | --- |
| 公共 AI 助教 | 可用安全公共入口 | 可用 | 可用 |
| 后台页面 | 不可 | 教师工作台 | 管理员工作台 |
| 班级和学生 | 不可 | 仅负责班级 | 全园管理 |
| 学生照片和声音 | 不可 | 仅授权且有班级权限 | 仅授权且有管理权限 |
| 教室和设备 | 不可 | 查看自己班级绑定 | 创建、编辑、绑定、解绑、停用 |
| 资源列表和预览 | 不可 | 自有、有权共享及已审核资源 | 全部管理范围 |
| 资源上传、编辑、收藏 | 不可 | 有权资源 | 按后端规则 |
| 资源审核 | 不可 | 不可 | 可通过、驳回、归档 |
| 教案资源绑定 | 不可 | 仅有权且已审核资源 | 按后端规则 |
| 课堂控制 | 不可 | 当前课堂和班级教师 | 默认仅审计，不直接控制进行中课堂 |

前端菜单和按钮用于减少误操作；所有身份、角色、班级和资源权限继续由后端校验。

## 6. 部署和启动

### 开发环境

1. 安装 Node.js `22.18+` 或 `24.12+`。
2. 后端复制 `backend/.env.example` 为 `backend/.env`，配置数据库、JWT、管理员密码和需要的第三方服务。
3. 在 `backend` 执行 `npm ci`、`npm run start:dev`。
4. 前端复制 `frontend/.env.example` 为 `frontend/.env`，配置手机可访问的局域网地址。
5. 在 `frontend` 执行 `npm ci`、`npm run dev`。

### 生产环境

1. 后端执行 `npm ci`、`npm run build`、`npm run start:prod`。
2. 明确设置 `PORT`（建议 `3001`）、`DATABASE_PATH`、`JWT_ACCESS_SECRET`；完成迁移验证后设置 `DB_SYNCHRONIZE=false`。
3. 前端执行 `npm ci`、`npm run build`，由 Web 服务器托管 `frontend/dist`，并配置 SPA 回退到 `index.html`。
4. 反向代理 API 到后端；启用 HTTPS；上传目录和 SQLite 数据库放在持久化磁盘并定期备份。
5. 首次管理员创建后，从运行环境移除 `INITIAL_ADMIN_PASSWORD`。

## 7. 阶段三备课中心稳定入口

- 入口：`/lesson-plans`
- 新建：`/lesson-plans/new`
- 编辑：`/lesson-plans/:id/edit`
- 上课准备：`/classroom/preflight/:planId`

教案步骤选择器只展示当前教师有权限且状态为 `approved` 的资源。未审核、已驳回和已归档资源不能进入正式课堂；资源权限和状态在服务端再次校验。

## 8. 已知问题

1. 3D 加载器分包约 630 KB，生产构建有体积警告；后续可按页面懒加载继续拆分。
2. AI 服务使用占位或无效密钥时会进入安全降级，不影响本地课堂按钮；真实模型质量和响应时延需要部署环境验证。
3. PPT 预览依赖服务端已经生成 PDF 或逐页图片；转换服务本身需要按部署环境验证。
4. 麦克风、摄像头、音响、手机与大屏局域网协同需使用目标教室真实设备验收。
5. SQLite 适合单机或小规模园所部署；多实例部署前需要评估数据库迁移和共享存储。
