# 5094bf4 Product Integration Audit（产品整合只读审计）

> 审计基线：`HEAD=153c1d1`（先前提及的整合提交）。上游整合基线 `5094bf4`。
> 本轮**只读**：修改代码 = 0、造数据 = 0、手工 heartbeat = 0、commit = 0。
> 课堂设备在线链路已单独立项：`BLOCKED_BY_DEVICE_HEARTBEAT_ARCHITECTURE`，见同桌交付物
> 《Formal Screen Has No Device Heartbeat - Backend/Device Handoff》。

---

## 结论速览（P0 / P1 / P2 / 正常）

| 编号 | 级别 | 项 | 结论 |
| --- | --- | --- | --- |
| P0-1 | P0 | 设备 heartbeat 架构缺口（正式大屏无设备身份心跳） | **Integration Blocker，Backend/Device Owner Required** |
| P0-2 | P0 | Offline start policy 前后端口径不一致 | 前端硬阻断 / 后端允许 start |
| P1-1 | P1 | 普通教师可改 class avatar 绑定（权限过宽） | 需后端收紧 |
| P1-2 | P1 | class binding 与 run snapshot 的 avatar 不一致 | 需后端明确解析优先级 |
| P1-3 | P1 | 角色库正式 UI 命名含测试字样（E2E/GLB/VRM Test） | 需清理/审核 |
| P2-1 | P2 | AI director old/v2 双控制器并存 | 需确认 v1 是否停用/下线 |
| P2-2 | P2 | attendance / reward 存在 legacy 与正式两套实体/路由 | 需确认迁移状态 |
| 正常 | 正常 | 教师端导航、管理员端导航、资源库、preflight 路由守卫 | 结构清晰，无阻断 |

---

## P0-1 设备 heartbeat 架构缺口（Integration Blocker）

**标注：** `BLOCKED_BY_DEVICE_HEARTBEAT_ARCHITECTURE`，**Backend/Device Owner Required**。

详见同桌交付物《Formal Screen Has No Device Heartbeat - Backend/Device Handoff》。

要点：
- `ClassroomScreenView` 不调用 device heartbeat，仅 screen-state 轮询 + screen-events SSE，身份为 teacher JWT。
- `/devices/:id/heartbeat` 强制 teacher JWT 认证 + school/binding/class access/deviceCode 校验。
- 唯一持续心跳源是 `ClassroomScanView`（30s），页面离开即停。
- backend 90s timeout + cron 权威 offline。
- 结论：**正式大屏打开 ≠ 设备保持 online**，preflight 后续无法启动课堂。
- 建议由后端负责人设计 **device session / credential**，设备身份独立于 teacher JWT。

---

## P0-2 Offline start policy 前后端不一致

| 层 | 行为 | 证据 |
| --- | --- | --- |
| Frontend（preflight） | `device.status !== 'online'` → `canEnter=false`，界面警告「所选大屏设备当前离线，无法开始课堂」 | `ClassroomPreflightView.vue` |
| Backend（start） | `requireValidBinding` 只拒绝 `Disabled/Fault`，未检查 offline | `classroom-run.service.ts` L1390 |

影响：同一场景前端提示不可开始，但直接调 start 仍能创建 run —— 口径矛盾。
**请后端/产品负责人统一规则，以后端为最终权威。前端不擅自修改。**

---

## P1-1 普通教师可修改班级 avatar 绑定（权限过宽）

- `avatar-configuration.service.ts`
  - `setClassBinding`（L153）：仅 `requireClassAccess(actor, classId)` —— **非 admin，普通教师即可绑定班级数字人**。
  - `setLessonBinding`（L166）：`requireLessonAccess`。
  - `setSystemBinding`（L177）：`requireAdministrator`（正确）。
- 问题：普通教师可覆盖班级层面的数字人绑定，可能影响其他使用该班的教师/课堂一致性。
- 建议（后端负责人确认）：班级绑定是否应提升为班主任/管理员权限，或加变更审计/回滚限制。

---

## P1-2 class binding 与 ClassroomRun avatar snapshot 不一致

- 数据库证据：
  - `avatar_binding`: id=3 class1(小一班) → char3/ver3（VRM, ready）。
  - 近条 `classroom_run`（40/41/42，已 completed）：`avatar_character_id=2 / avatar_version_id=2`（GLB）。
- 即：**班级绑定为 char3/VRM，但 run 快照为 char2/GLB**。
- 需要后端明确：run start 时 avatar 是从 binding 实时解析，还是用 run 快照？优先级以哪个为准？当前两侧不一致时以何者展示。

---

## P1-3 角色库正式 UI 暴露测试性命名

- `avatar_character` 真实角色名含 **"Avatar E2E Test GLB/VRM"**（id 1/2/3）。
- 这些是测试用角色，若角色库正式列表可见，属于测试资源污染正式 UI，也造成教师误选风险。
- 建议：清理测试角色数据，或给角色增加 `isTest/mark` 过滤，正式列表不展示。

---

## P2-1 AI Director 旧版 / v2 并存

- 后端 `ai.module.ts` 同时注册了两个控制器（L59）：
  - `AiController`（内使用 `ClassroomDirectorService`，即旧版 director）
  - `ClassroomDirectorV2Controller`（v2）
- 实体也双份：`classroom-director-suggestion.entity`（old）与 `classroom-director-v2-suggestion.entity`（v2）。
- 前端课堂实际使用 `ClassroomDirectorPanel.vue` + `useClassroomDirectorStore`。
- 需要确认：前端走的是 v2 吗？旧版 controller/service 是否仍被调用，还是仅作为兼容留存待下线？
- 建议：确认后归档/下线旧版，避免双写双读与数据归属混乱。

---

## P2-2 attendance / reward 存在 legacy 与正式两套

- attendance：
  - `classroom-participation`（legacy）：`attendance-record`、`attendance-change-log`、`roll-call-*`。
  - `classroom-runs`（正式）：`student-attendance-record`、`student-attendance-change`、`classroom-roll-call-record`。
- reward：
  - `classroom-engagement`（正式）：`reward-record`、`engagement-rewards` 路由、`honor-record`、`class-growth-record`、`collective-goal`、`break-run`。
  - `classroom-runs`：`student-reward-record`（Stage 7.3 双层模型之一）。
- 既有 `attendance`、`rewards` 旧路由与正式 `engagement-rewards` 并存。
- 需要确认：前端现使用哪一套？旧表是否仍写入？正式链路是否已完全接管。
- 建议：确认迁移完成度后清理 legacy，或明确只读兼容层。

---

## 正常项（结构清晰，无阻断）

- **教师端导航**：`ManagementLayout` 一级导航齐全（AI助教/我的班级/备课中心/数字人角色库/资源库）；顶栏有「课堂进行中·返回课堂」active-chip。
- **管理员端导航**：数据看板/审计日志/资源审核/角色库/教师/班级/学生/设备等多入口，且对应路由均 `adminOnly` 守卫。
- **路由守卫**：`requiresAuth` → 未登录回 login；`adminOnly` → 非 admin 回 forbidden；教师侧路由判定正确（router/index.ts L119-127）。
- **资源库**：teacher 可浏览；`/resources/:id/review` 与 `/resources/:id` 详情 admin 审核独立，权限分层清晰。
- **preflight 权限链路**：plan/class/classroom/device 前置步骤校验完整，仅 offline 口径（见 P0-2）待统一。

---

## 双套导航/入口冲突记录

存在两套导航可能造成新老入口并存：
- `ManagementLayout`（新工作台：AI助教/我的班级/备课中心/数字人角色库/资源库）。
- `ChatView` 内嵌侧边栏（💬聊天 / 📚课程资源 / ⭐我的收藏 / 🏫我的班级 / 📝备课中心）。

建议后端/产品确认：是否以 `ManagementLayout` 为唯一主框架，`ChatView` 侧边栏是否应收敛为纯聊天视图，避免「我的班级/备课」等重复入口歧义。

---

## 残留风险提示（供后续决策）

- 设备 online 无常驻载体 → 依赖课堂会话心跳思路是否也适用于大屏（见同桌交付物 §3/§4）。
- class binding 与 run snapshot 优先级、普通教师改 class avatar 权限两点需后端统一，可能在角色库整合中一并收口。
- v1/v2 director、legacy/正式 attendance·reward 的最终归属需后端负责人拍板，纳入后续整合收口。