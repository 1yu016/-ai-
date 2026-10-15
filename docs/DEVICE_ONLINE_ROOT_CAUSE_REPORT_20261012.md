# Device Online Root Cause Report

日期：2026-10-12。阶段三新功能暂停，本轮只修复设备在线链路。未提交、未推送。

## 1. Root Cause

确认四个问题：

1. 心跳使用教师 http 实例。设备凭证被撤销时的 401 会触发教师令牌续期、重放，随后将仍有效的教师登录清除，跳回登录页；大屏卸载导致心跳停止。
2. startHeartbeat 的首次签发失败或旧凭证失效后，定时器只对“已有内存 token”发送心跳，不再走合法签发路径，页面无法自行恢复。原单测要求再次手动调用 startHeartbeat，因此未覆盖真正的自动重连。
3. 设备列表/绑定摘要按 lastOnlineAt freshness 判断，课堂 start 却只检查持久化 status；在超时到分钟巡检之间，UI 与开课校验可能冲突。
4. 旧 ClassroomScanView 会在选择设备/生成二维码时用教师身份调用兼容 heartbeat，并直接改前端 status=online、定时续报。该页面不是正式大屏，会掩盖真实大屏没有在线。现已移除这些调用及强制标记，只保留正式配对票据 API，并引导在实际大屏打开 ClassroomScreen。

未发现当前 SQLite/Node UTC 序列化错误。独立内存数据库复测原 cron 的 Date 参数正确转换为 `YYYY-MM-DD HH:mm:ss.SSS`，新鲜设备不会误标离线，故没有修改 cron 查询来掩盖未证实问题。

## 2. Reproduction / Runtime Reproduction Report

修改业务代码前，本机 Chrome 访问 localhost:5173，teacher_demo 登录，打开 `/classroom/screen/1`：

- 设备 1：XB-SCREEN-01，教室 1、班级 1，binding 1 active；设备 2 也有 active binding，未重建设备。
- 初始设备 1 offline，last_online_at 为 `2026-10-09 07:27:30.612`，device_session 无记录。
- 干净会话成功签发 201，首次心跳 200，30 秒后再次 200；因此不是后端心跳整体不可用。
- 第二个独立浏览器会话打开同一正式大屏，正常轮换凭证；刷新旧大屏触发心跳 401「设备凭证已失效」，又被教师拦截器重试 401。
- 35 秒后仍未重签发，页面变为 `/login?redirect=/classroom/screen/1&reason=expired`。
- 尚未开始课堂，未结束或中止用户课堂；数据库查询均只读，未人工改状态，未人工 POST heartbeat。

远程浏览器不能访问本机 localhost；这是执行环境边界，不是本地服务关闭的证据。全部正式复现改用本机 Playwright/Chrome。

## 3. DeviceSession Flow

教师登录授权签发 → `POST /devices/:id/device-session` → token 按 deviceId 保存到 localStorage（数据库只存 hash）→ 大屏挂载立即心跳 → 每 30 秒续心跳。

设备心跳使用独立 axios 实例，只发送 x-device-session，不携带教师 JWT、不触发教师续期或退出。401/404/410 清除本地失效凭证，下一周期合法重签发。初次签发失败也在下一周期重试。请求有 15 秒超时，周期内单飞；卸载和设备切换停止旧周期，迟到签发不能再启动旧心跳。

## 4. Heartbeat Evidence

修复前：正式 UI 自动请求 `/devices/1/device-session` 201；`/device-session/heartbeat` 200/401 时同时带 x-device-session 和教师 Authorization。

修复后当前环境：旧凭证心跳 401；页面未退出；下一周期 issue 201；heartbeat 200，响应：

```json
{"deviceId":1,"online":true,"status":"online","lastOnlineAt":"2026-10-12T14:04:50.837Z"}
```

心跳 body 为 null，x-device-session 非空，Authorization 不存在。完整 raw token 不输出。

隔离真实浏览器验收中，14:37:19.983、14:37:20.714、14:37:50.722、14:38:20.715、14:38:50.718 UTC 均有正常自动心跳。

## 5. DB Evidence

隔离验收使用真实 SQLite，而非 mock；以下 device/session 均为同一 deviceId=1、sessionId=1，已脱敏。

| 时点 | persisted device.status | last_online_at (UTC) | last_heartbeat_at (UTC) |
| --- | --- | --- | --- |
| 打开前 | offline | null | 无会话 |
| 首次心跳 | online | 2026-10-12 14:37:19.983 | 2026-10-12 14:37:19.983 |
| 持续心跳最后一次 | online | 2026-10-12 14:38:50.718 | 2026-10-12 14:38:50.718 |
| 超窗、巡检前 | online（缓存） | 保持不变 | 保持不变 |
| 巡检后 | offline | 保持不变 | 保持不变 |
| 重新打开 | online | 2026-10-12 14:41:03.859 | 2026-10-12 14:41:03.859 |

会话 expires_at `2026-10-13 14:37:19.925`，revoked_at null。超窗到巡检期间 API 已返回 offline，start 已拒绝，不再信任滞后的缓存 online。

## 6. Online Policy

统一函数位于 backend/src/platform/device-online-policy.ts：

- disabled/fault 永远不可用。
- 无 lastOnlineAt、无效日期或未来日期为 offline。
- 新鲜度在配置窗口内为 online，否则 offline。
- 默认窗口仍为 90 秒；未调大超时。
- GET /devices、设备详情/绑定摘要、平台在线统计与 ClassroomRun.requireValidBinding 使用同一函数/超时解析。
- Device.status 对 online/offline 是持久化缓存；disabled/fault 是管理阻断状态。
- 每分钟离线巡检保留，负责缓存落库，关键开课校验无需等待巡检。
- 前端只展示后端结果或实际 heartbeat 回应，不自行创建新的 freshness 算法。

## 7. Files Modified / Added

业务修改：

- backend/src/platform/platform.service.ts
- backend/src/classroom-runs/classroom-run.service.ts（保留本轮前已有阶段三展示逻辑）
- frontend/src/api/deviceSession.ts
- frontend/src/stores/deviceSession.ts
- frontend/src/views/ClassroomScreenView.vue（只调整心跳生命周期，保留已有改造）
- frontend/src/views/ClassroomPreflightView.vue（保留此前返回按钮修改）
- frontend/src/views/ClassroomScanView.vue（删除管理页代报心跳，不删除扫码业务）

新增共享规则：backend/src/platform/device-online-policy.ts。

测试文件见第 10 节，新增本报告。没有修改暂存中的 ClassroomPartnerPanel。

## 8. Backend Changes

仅抽取并接入在线规则；既有签发、hash 校验、资源/班级权限、heartbeat persistence 不重造。DeviceSessionService 已正确保存 device.lastOnlineAt、status 和 session.lastHeartbeatAt，本轮以集成测试确认。未新增表、字段或迁移。

## 9. Frontend Changes

设备心跳认证隔离、凭证内容基本校验、自动恢复与单飞、卸载世代保护；大屏先启动独立心跳，再加载课堂状态，避免加载延迟阻塞在线链路。Preflight 每 10 秒重新取后端绑定/设备状态，失败清除旧可用数据，不将未知状态继续当 online。
扫码准备页不再冒充设备；教师身份只负责绑定/签发/生成配对票据。既有兼容教师 heartbeat 后端 API 未删除，避免未经兼容审计破坏旧客户端；当前前端正式流程不再使用它。若要求服务器层彻底拒绝所有旧客户端代报，需另做兼容下线，不能把保留接口说成已完全禁用。

## 10. Tests Added / Modified

- 新增 backend/src/platform/device-online-policy.spec.ts（fresh、expired、missing、disabled/fault、配置解析）。
- 扩展 backend/test/device-session.e2e-spec.ts（device/session 时间一致、新鲜设备巡检不误离线、真实心跳允许 start、缓存 online 但超窗立即拒绝、巡检落库）。
- 扩展 frontend/tests/unit/device-session.spec.ts（撤销后自动恢复、签发失败自动重试、卸载时迟到签发不再心跳）。
- 扩展 frontend/tests/e2e/device-online-gate.spec.ts（无教师 Authorization、刷新复用、设备页面显示、超窗即时拒绝、cron 真落库、重开、Preflight 自动恢复）。
- 修正 frontend/tests/e2e/gate-run.mjs 的测试账号与 spec 不一致；增加只读 DB 证据路径。
- 新增 frontend/tests/e2e/reproduce-device-online.mjs，用本机正式 UI 复现凭证轮换，未人工 POST heartbeat。
- 新增 frontend/tests/component/classroom-scan-device-identity.spec.ts（选择设备/等待不代报，二维码票据生成仍可用）。

## 11. Tests Run

- frontend npm run type-check
- frontend npm run build-only
- frontend 设备会话、Preflight、课堂全屏相关 Vitest
- backend npm run build
- backend device-online-policy 单测
- backend device-session.e2e-spec.ts
- backend classroom-run.e2e-spec.ts
- frontend node tests/e2e/gate-run.mjs
- 当前环境本机 Chrome 凭证轮换复测
- git diff --check

## 12. Runtime Verification / Test Results

- 类型检查、前后端构建通过。
- 前端相关 31 项通过；后端规则 5 项、设备会话 10 项、课堂运行 29 项通过。
- 最终真实 Chrome 全链路 E2E 1 项通过，约 4.1 分钟。
- 首轮新增重连断言误依赖已在课堂中隐藏的待机圆点，且执行过程中出现很长的时间跳变；该次不算通过。修正为真实 200 心跳、API/DB 状态和页面仍在 screen URL 后重跑，后续两轮通过；最终一轮补齐 Devices UI 与 cron DB 证据。
- 构建仅有既有 3D 资源包大小告警，没有扩展相关优化任务。

## 13. Preflight Verification

真实浏览器选择绑定班级：online 显示已完成并允许进入；关屏超窗后 warning 显示离线；大屏重新打开后无需退出登录或手工改状态，自动刷新到可进入状态。

## 14. Classroom Start Verification

真实心跳 fresh → UI 点击进入课堂成功，跳转 `/classroom/lesson/:runId`。超窗后 POST start 立即 409 且 message 包含离线，不再通过“等 cron 再重试”掩盖两套判断。后端集成同时覆盖缓存在线但心跳过期、disabled、fault。

## 15. Timeout Verification

页面打开超过 90 秒、每约 30 秒心跳，保持 online。关闭页面无新增心跳；超过 90 秒 API/Preflight offline；一分钟巡检将数据库缓存置 offline，lastOnlineAt 和 lastHeartbeatAt 不被伪造更新。

## 16. Reconnect Verification

离线后重新打开同一设备大屏，原有效会话复用、第一次真实 heartbeat 即恢复 online，不重新建 Device/Binding，不重启后端。撤销凭证的异常场景也在当前环境复测：401 → 下一周期合法 issue → heartbeat 200，教师仍登录。

当前用户 3001 后端原为非热更新 start:prod。只读确认无 running/paused 课堂后，重启已核对的同一后端进程加载修复。3001/5173 均返回 200；没有重启其他服务或修改数据库状态。

## 17. git diff Summary

本轮业务范围限定设备 online 链路；新增最小规则函数，替换重复判断，修复认证/生命周期，增加 Preflight 状态刷新与测试。整个工作树还包含之前的阶段三队列/UI/导航修改，不能把全局 diff 都算本轮工作。cron、timeout、start 离线校验均未移除；未人工强制 online。

## 18. git status / Handoff

验收时完整工作树状态（包含本轮之前的改动，不能混为本轮 diff）：

```text
 M backend/src/classroom-runs/classroom-command.service.ts
 M backend/src/classroom-runs/classroom-command.types.ts
 M backend/src/classroom-runs/classroom-run.service.ts
 M backend/src/platform/platform.service.ts
 M backend/test/device-session.e2e-spec.ts
 M frontend/src/api/deviceSession.ts
 M frontend/src/components/BaseWorkspaceLayout.vue
 M frontend/src/components/CourseResourcesPanel.vue
 M frontend/src/components/TeacherLayout.vue
M  frontend/src/components/classroom/ClassroomPartnerPanel.vue
 M frontend/src/router/navigation.ts
 M frontend/src/router/routeDefinitions.ts
 M frontend/src/services/classroomCommandBus.ts
 M frontend/src/stores/deviceSession.ts
 M frontend/src/stores/lessonRun.ts
 M frontend/src/views/ClassroomMobileRemoteView.vue
 M frontend/src/views/ClassroomPreflightView.vue
 M frontend/src/views/ClassroomRecordView.vue
 M frontend/src/views/ClassroomRunSummaryView.vue
 M frontend/src/views/ClassroomScanView.vue
 M frontend/src/views/ClassroomScreenView.vue
 M frontend/src/views/LessonClassroomView.vue
 M frontend/src/views/LessonPlanEditorView.vue
 M frontend/src/views/LessonPlanListView.vue
 M frontend/tests/component/ClassroomRecordView.spec.ts
 M frontend/tests/e2e/device-online-gate.spec.ts
 M frontend/tests/e2e/gate-run.mjs
 M frontend/tests/e2e/workspace-layout.spec.ts
 M frontend/tests/unit/device-session.spec.ts
 M frontend/tests/unit/router-navigation.spec.ts
?? backend/_demo_admin.cjs
?? backend/_demo_check.cjs
?? backend/_demo_upload.cjs
?? backend/_e2e66_seed.cjs
?? backend/_tmp_list_teachers.cjs
?? backend/diag-device.cjs
?? backend/scripts/_tmp_ds_parity.cjs
?? backend/src/platform/device-online-policy.spec.ts
?? backend/src/platform/device-online-policy.ts
?? backend/verify-device-online.cjs
?? docs/CURRENT_PROJECT_MANUAL.md
?? docs/DEVICE_ONLINE_ROOT_CAUSE_REPORT_20261012.md
?? docs/IA_IMPLEMENTATION_20261012.md
?? docs/STAGE_3_IMPLEMENTATION.md
?? docs/STAGE_3_TEACHER_CONSOLE_DESIGN.md
?? docs/prototypes/
?? frontend/src/components/classroom/LivePresentationPreview.vue
?? frontend/src/components/classroom/PresentationQueuePanel.vue
?? frontend/src/components/resources/ProtectedResourceImage.vue
?? frontend/src/composables/
?? frontend/src/router/classroomExitPolicy.ts
?? frontend/src/views/ClassroomHistoryView.vue
?? frontend/src/views/TeacherHomeView.vue
?? frontend/tests/component/ClassroomHistoryView.spec.ts
?? frontend/tests/component/ProtectedResourceImage.spec.ts
?? frontend/tests/component/classroom-scan-device-identity.spec.ts
?? frontend/tests/e2e/reproduce-device-online.mjs
?? frontend/tests/unit/classroom-exit-policy.spec.ts
?? frontend/tests/unit/presentation-queue.spec.ts
```

工作树保留修改，未 git add、未 commit、未 push。修复开始前的所有 dirty 文件、未跟踪文档/脚本，以及 ClassroomPartnerPanel 暂存修改均保留。

本轮新增/修改的设备规则、API/store、大屏/Preflight 相关代码和测试均待用户验收。阶段三后续功能继续暂停，不自动恢复开发。

注意：只打开教师管理/Preflight 不会维持设备在线。必须打开正式 `/classroom/screen/:deviceId`；关闭大屏后的 offline 是正常行为。失效凭证自动恢复最多等待一个 30 秒周期；合法签发仍需要教师权限，不绕过登录。
