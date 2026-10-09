# Formal Screen Has No Device Heartbeat —— Backend/Device Handoff

> 本交付物为**只读诊断结论**：本轮未修改任何代码、未造数据、未手工心跳、未 commit。
> 标注：课堂正式设备在线链路 `BLOCKED_BY_DEVICE_HEARTBEAT_ARCHITECTURE`。
> 责任人：**Backend / Device Owner**（本交付物不替代后端负责人设计，仅作为交接证据）。

---

## 1. 当前现状

### 1.1 `POST /devices/:id/heartbeat`（后端）

- 路由：`platform.controller.ts` 类级 `@UseGuards(AuthGuard)`，需要**有效 teacher JWT**。
- service（`platform.service.ts`）校验链路：
  1. 比对 `deviceCode`；
  2. `requireSameSchool`（同校校验）；
  3. 非 admin 需存在 active `DeviceBinding` + class access + 设备非 disabled/fault；
  4. 通过后写入 `lastOnlineAt = now`、`status = online`。

### 1.2 `ClassroomScreenView`（正式大屏端）

- **不调用 device heartbeat**（全文件无任何 `platformApi.heartbeat(` 调用，已 grep 证实）。
- 只调用：
  - `GET /classroom-runs/screen-state` —— 轮询课堂状态（`pollTimer` 10s）；
  - SSE `/classroom-mobile/screen-events` —— `connectScreenRealtime`，使用 `userStore.accessToken`（teacher JWT）；
- `requiresAuth`，页面身份仍是**teacher access token**。

### 1.3 `ClassroomScanView`（扫码页）

- **当前唯一确认持续发 device heartbeat 的页面**。
- `sendHeartbeat()` → `platformApi.heartbeat(device.id, device.deviceCode)`。
- `setInterval(..., 30_000)` 约每 30s 上报一次。
- **页面离开/卸载后 `stopHeartbeat()` 停止** → 心跳随页面生命周期终止。

### 1.4 Backend 权威下线

- `heartbeatTimeoutMs`（默认 90s）。
- `markTimedOutDevicesOffline()` `@Cron(EVERY_MINUTE)`：`cutoff = now - timeout`，将 `lastOnlineAt` 早于 cutoff 的设备权威置 `offline`。

### 1.5 补充：另一种会话型心跳（非本缺口，但可参考）

- `classroomMobile.ts` store 维持一个**会话 token 心跳** `POST /classroom-mobile/heartbeat`，由 `/classroom-mobile` 会话驱动（`session.value.token`）。
- 这表明“独立于 teacher JWT 的会话存活机制”在代码库中**已有先例**，可为设备会话设计提供参考。

---

## 2. 当前产品缺口

核心事实：**正式大屏打开 ≠ 设备保持 online**。

- 教师把设备扫码绑定后进入正式大屏 `ClassroomScreenView`，此时 **scan 页已离开 → heartbeat 已停止**。
- 约 90s 后后端 cron 将设备权威置 `offline`。
- 此后再次进入课堂 preflight，前端检查 `device.status === 'online'` → **无法开始课堂**。
- 形成循环：要上课就必须回 scan 页把设备“顶上线”，这违背正式产品预期的“设备是常驻大屏终端”语义。

即：设备在线状态**没有常驻身份的载体**，“谁是这台设备”的举证责任被错误地押到了 teacher JWT / scan 页面生命周期上。

---

## 3. 推荐目标架构

建议区分两类身份，不要用 teacher JWT 长期代表设备身份：

**Teacher Identity（教师身份）**
- 绑定设备、管理设备、控制课堂。
- 保留 teacher JWT 负责 `binding / control / screen-state` 等带权限操作。

**Device Identity（设备身份）**
- 负责 `heartbeat`、设备在线状态、接收课堂事件、显示 Screen（大屏）。
- 建议由 **backend / device owner** 设计 **device session / credential**。

落地建议（由后端负责人设计，此处仅为方向）：
1. 绑定完成时**签发设备会话 / 设备凭证**（独立于 teacher JWT），存设备端。
2. 正式 Screen 端使用**设备身份**发心跳，而非 teacher JWT。
3. 设备凭证据自己的 TTL / 轮换；教师撤销绑定时设备凭证一并失效。

> 注：`classroom-mobile` 的 session-token 心跳可作为“设备/会话身份心跳”的可参考实现范式。

---

## 4. heartbeat 行为建议

（最终以**后端负责人设计**为准，此处为行为基线建议）

| 事件 | 行为 |
| --- | --- |
| 正式设备端启动（Screen 挂载） | 开始发 heartbeat |
| 心跳间隔 | 建议约 **30s** |
| 每次心跳 | 刷新 `lastOnlineAt`（→ online） |
| 超过约 **90s** 无心跳 | backend cron 权威置 `offline` |
| 页面/设备关闭 | 心跳自然停止 → server timeout 下线（无需主动注销） |

约束：
- 心跳间隔 < TTL（30s < 90s），留 2~3 倍余量，避免抖动误下线。
- 间隔与 TTL 均应由后端负责人校准后固化为配置，而非前端硬编码。

---

## 5. Offline start policy（不一致记录，单独立项）

当前前后端对“设备 offline 是否允许 start”**双方口径不一致**：

| 层 | 行为 | 结果 |
| --- | --- | --- |
| **Frontend（preflight）** | `device.status !== 'online'` → 界面警告「所选大屏设备当前离线，无法开始课堂」，`canEnter=false` | 硬阻断进入课堂 |
| **Backend（start）** | `requireValidBinding` 仅拒绝 `Disabled/Fault`，**不拒绝 offline** | start 可成功 |

> 这可能导致：前端提示不可开始，但同一界面其他路径 / 直接调 start 接口仍能创建 run。

**请后端 / 产品负责人决定统一规则**，由后端作为最终权威。当前前端分支**不擅自修改**，等待决策后统一收敛。

---

## 结论与交接

- 本轮课堂 E2E 正式标记：`BLOCKED_BY_DEVICE_HEARTBEAT_ARCHITECTURE`。
- 需要 Backend / Device Owner：
  - 设计设备会话 / 设备凭证心跳（交付物 §3、§4）；
  - 统一 offline start policy（交付物 §5）。
- 前端在收到确定方案前不新增临时心跳、不伪造 online、不改 device.status。