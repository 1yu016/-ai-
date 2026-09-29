# 阶段四：前端课堂切换到 `/classroom-runs` 新接口

## Context（为什么改）

成员A 新增了后端 `classroom-runs` 课堂运行状态机模块（独立 `/classroom-runs/*` 路由），比旧的 `/lesson-runs/*` 更完整：幂等 `requestId`、`version` 乐观锁、`Prepared/Running/Paused/Failed` 状态、"设备-教室-班级绑定"校验。用户已确认前端对接新接口，避免两套课堂运行逻辑并存。

旧 `/lesson-runs/*` 接口保留但前端不再使用，课堂流程全面切换到 `/classroom-runs/*`。

## 契约映射（旧 → 新）

| 维度 | 旧 `/lesson-runs` | 新 `/classroom-runs` |
|---|---|---|
| 当前步骤 | `run.currentStepOrder`（1-based） | `run.currentStepIndex`（0-based） |
| 步骤节点 | `step.sortOrder` / `step.stepType` / `step.instruction` | `step.stepIndex` / `step.type` / `step.content` |
| 预期回答/教师提示 | `step.expectedResponse` / `step.teacherTip` | **无此字段**（快照不保存，课堂页需降级） |
| 关联资源 | `step.resource`（完整对象） | `step.resourceId`（仅 id，按需解析） |
| 状态 | running/paused/completed/cancelled | **prepared**/running/paused/completed/cancelled/**failed** |
| 拉取课堂 | `GET /lesson-runs/:id` | `GET /classroom-runs/:id` |
| 切换步骤 | `PATCH /lesson-runs/:id/progress` | `POST /classroom-runs/:id/steps/:stepIndex`（body `{version,requestId}`，index 0-based） |
| 暂停/恢复/完成/中止 | `POST /lesson-runs/:id/{pause,resume,complete,cancel}`（无 body） | 同上路径但 body 需 `{version,requestId}` |
| 开始课堂 | `POST /lesson-plans/:id/start` → `{runId}` | `POST /classroom-runs/start`，body `{lessonPlanId,classId,classroomId,deviceId,requestId}` → 返回含 steps 的 run 对象 |

关键契约细节：
- `requestId`：`/^[A-Za-z0-9._:-]+$/`、8~100 字符，每个操作独立（前端用 `crypto.randomUUID()`）。
- `version`：乐观锁，操作 body 传当前 `run.version`，成功响应返回 `version+1`，前端用响应覆盖本地。
- 快照 `content = step.content ?? step.instruction`；`type = step.stepType`；`starting` 内部 `Prepared→Running` 后响应为 running。

## 前端改动

### 1. `frontend/src/api/platform.ts`
新增教师可用列表方法（已有 `students`/`bindDevice`/`createTicket`），供检查页下拉：
- `listClasses(query)` → `GET /classes`
- `listClassrooms()` → `GET /classrooms`
- `listDevices()` → `GET /devices`

### 2. `frontend/src/stores/lessonRun.ts`（核心）
- 类型：`LessonRunStatus` 加 `'prepared' | 'failed'`；`RunStep` 改为快照形状 `{ stepIndex; type; content; durationSeconds; resourceId; actionConfig; recoveryPointConfig }`。
- `load(id)`：`GET /classroom-runs/${id}`。
- 新增 `version`/`requestId` 处理：`currentStep = steps.find(s => s.stepIndex === currentStepIndex)`；`progress = currentStepIndex / steps.length`。
- `move(index)`：改为 `POST /classroom-runs/${id}/steps/${index}`，body `{version: run.version, requestId: uuid()}`，成功用响应覆盖 `run`（含新 version）。
- `previous/next`：基于 `currentStepIndex±1` 调 `move`，保留 `status==='running'` 守卫。
- `action(pause/resume/complete/cancel)`：URL `/classroom-runs/${id}/${name}`，body `{version, requestId}`，保留现有状态守卫。
- `currentResource`：由 `step.resource`（旧对象）改为按 `step.resourceId` 从现有资源 store 解析（新增查找逻辑；解析不到则返回 null，课堂页显示"资源已失效"）。

### 3. `frontend/src/router/index.ts`
- 移除旧 `POST /lesson-plans/:id/start` 起课路径依赖；新增（或改造）检查页路由为**携带 planId、不依赖 runId**：例如 `{ path: '/classroom/preflight/:planId', name:'lesson-classroom-preflight', meta:{requiresAuth:true}, component: ClassroomPreflightView }`，放在 `/classroom/lesson/:runId` 之前。`/classroom/lesson/:runId/check` 旧路由删除。

### 4. `frontend/src/views/LessonPlanListView.vue`
`start(id)` 改造：不再先 `POST /lesson-plans/:id/start`，改为 `router.push('/classroom/preflight/${id}')`（进入检查页选上下文后真正 start）。

### 5. `frontend/src/views/ClassroomPreflightView.vue`
- `onMounted`：用 `route.params.planId` 触发 `lessonPlan` store 的 `load`（`GET /lesson-plans/:id`，复用以获取 steps 数量做课前检查；`buildChecks` 的 `hasSteps` 改为基于 plan.steps）。
- 新增"班级/教室/设备"三个 `ElSelect`（数据来自 `platform.listClasses/listClassrooms/listDevices`；默认不选）。"进入课堂"按钮在**必选三项且满足必要检查**后才可用。
- `enterClassroom()`：`POST /classroom-runs/start`，body `{lessonPlanId, classId, classroomId, deviceId, requestId: uuid()}` → 拿到 `run`（`run.id`）→ `router.push('/classroom/lesson/${run.id}')`。绑定无效时后端抛 Conflict，`ElMessage.error` 提示重选。
- 步骤时长汇总从 `run.steps` 改为 `plan.steps`。

### 6. `frontend/src/views/LessonClassroomView.vue`
- 步骤节点/当前步骤字段：`run.currentStepOrder` → `run.currentStepIndex`；`step.sortOrder` → `step.stepIndex`；`currentStep.stepType` → `currentStep.type`。
- 步骤内容展示：`currentStep.instruction` → `currentStep.content`。
- **降级**：移除/仅在有值时显示 `currentStep.expectedResponse`、`currentStep.teacherTip` 两个板块（新快照无此字段）。建议用 `v-if="currentStep.expectedResponse"` 保留兼容，数据缺失时不渲染。
- 资源：`currentResource` 解析逻辑在 store 收敛，模板 `currentResource?.title` 等保持不变即可。
- 只读页文案：`status==='completed' ? '已完成' : '已中止'` 保持；`failed` 会落入 else，可接受（提示"已中止"），可选加 `failed` 分支文案"课堂异常/已中止"。

### 7. 测试（先补后改，遵循先红后绿）
- `frontend/tests/unit/lesson-stores.spec.ts`：mock 路径 `/classroom-runs/9`、`/classroom-runs/9/steps/1`、`/classroom-runs/9/pause|resume|complete|cancel`；返回结构改为 `{currentStepIndex, steps:[{stepIndex,type,content,...}], version, status}`；断言 action body 含 `version`+`requestId`。
- 新增：准备状态/`failed` 只读；版本号随响应递增；前/下一步基于 index。
- `frontend/tests/component/components.spec.ts`："开始上课"断言改为跳 `/classroom/preflight/3`；课堂组件字段改用 `currentStepIndex`；新增检查页"选班级/教室/设备→进入课堂→`/classroom/lesson/:id`"完整用例（mock `platform.listClasses/listClassrooms/listDevices` 与 `POST /classroom-runs/start`）。
- 新增/修正 `plan store start` 相关：`lessonPlan.start` 若保留则改为返回 plan 供跳转，或改为纯跳转由页面负责 start。

## 关键复用
- `crypto.randomUUID()`：浏览器原生，用于 `requestId`。
- `api/http.ts`：Bearer token、错误转中文（`apiErrorMessage`）已具备，迁移只需换 url/body。
- `lessonPlan` store 的 `GET /lesson-plans/:id` 用于检查页加载步骤数。
- `platform.ts` 现有结构作为新增列表方法模板。

## 边界与注意
- `prepared/failed` 为新增状态：前端主要遇到的仍是 running/paused/completed，`isActive`（beforeunload/离开保护）保持 `running||paused`。
- 不新增任何后端接口；只用成员A已提供的 `/classroom-runs/*` 与既有 `/classes,/classrooms,/devices,/lesson-plans/:id`。`GET /classroom-runs/active` 本次可不接（非阻塞）。
- 旧 `/lesson-runs` 前端调用全部移除；后端保留不影响。
- 快照缺 `expectedResponse/teacherTip`：课堂页这两块降级不影响主流程。

## 验证
1. `npm run type-check`（frontend）通过。
2. `npx vitest run tests/unit/lesson-stores.spec.ts tests/component/components.spec.ts` 全绿；再跑 `npx vitest run` 全量回归。
3. 无真实后端绑定数据时可先用 mock 验证契约；有绑定数据后浏览器走：教案列表 → 检查页选班级/教室/设备 → 进入课堂 → 下一步/暂停/恢复/结束，确认每步请求 `version` 正确递增、`requestId` 幂等。
4. 人工核对 network 面板：所有课堂请求为 `/classroom-runs/*`，旧 `/lesson-runs` 无请求。