# 《P0 Device Online Final Gate Report》

- 日期：2026-10-09
- 范围：大屏（正式 ClassroomScreen）设备在线权威链路 —— device-session 签发/心跳、心跳超窗离线、offline start 409、A/B token 隔离、生产只读配置、migration schema parity
- 原则：全程未 commit；未修改业务功能；未修改数据库正式原库；未手工 POST heartbeat；scan 页面未用于维持 online。

---

## 一、核心结论（11 项状态清单）

| # | 检查项 | 结果 |
|---|--------|------|
| 1 | migration verified | **yes** |
| 2 | real two-page browser E2E | **pass** |
| 3 | >90s screen-open online | **pass** |
| 4 | screen-close offline | **pass** |
| 5 | offline start → backend 409 | **pass** |
| 6 | device A/B token isolation | **pass** |
| 7 | production synchronize config | **confirmed** |
| 8 | schema parity | **pass** |
| 9 | tests | 见第五节 |
| 10 | git diff | 见第六节（仅验收测试产物，均为未提交 working-tree 变更） |
| 11 | commit | **0** |

---

## 二、真实双页面 Browser E2E（Playwright，正式链路）

- 页面 A：正式 `ClassroomScreenView`（大屏，自动 device-session 心跳）
- 页面 B：教师 `ClassroomPreflightView`（Preflight）
- 运行载体：`frontend/tests/e2e/gate-run.mjs` 以 `backend/dist/main.js` 拉起隔离后端 + vite 前端，`E2E_EXTERNAL_SERVERS=1`。
- 覆盖 Spec：`frontend/tests/e2e/device-online-gate.spec.ts`
- **结果：1 passed（4.1m）**

逐步验证：

1. **A 打开自动获得 device session** — `POST /devices/:id/device-session` 在 pageA 打开后触发（Network 捕获 seenIssue）。
2. **Network 确认签发 + 心跳** — 捕获到 `/devices/:id/device-session`（201）与后续 `/device-session/heartbeat`（心跳每 30s），`.status-dot.online` 显示。
3. **保持打开 >90s 始终 online** — 100s 窗口内心跳持续（seenHeartbeat 递增），`GET /devices` 返回 `status=online`。
4. **B 刷新设备列表显示 online** — pageB 进入备课页，同一设备 `status=online`。
5. **B 正常 start ClassroomRun 成功** — Preflight 选择班级 →「已完成」→「进入课堂」→ 跳转 `/classroom/lesson/<id>`。
6. **关闭 A** — `pageA.close()`。
7. **不再有 heartbeat** — 关闭后 35s 内 seenHeartbeat 不再增长。
8. **等待 90s + cron 容差 → offline** — `GET /devices` 轮询至 `status=offline`。
9. **B 再刷新 → device offline** — 同一设备 `status=offline`，Preflight 显示「大屏设备 …当前离线」warning 且「进入课堂」按钮 disabled。
10. **再尝试 start → backend 409 + 前端显示离线** — 真实重试 `POST /classroom-runs/start` 直至后端返回 **409「大屏设备当前离线，无法开始课堂」**。

> 全场无手工 POST heartbeat；设备 online/offline 完全由大屏页自动心跳 + 后端 cron 驱动。

---

## 三、多设备 token 隔离

### 持久化结构（store：`frontend/src/stores/deviceSession.ts`）
- localStorage key：`kindergarten-device-session-v1`，值 `Record<string /* deviceId */, string /* raw token */>`。
- 设备 A、B 各自以独立 deviceId 为 key 存储，互不覆盖；`clear(deviceId)` 只删对应 key。

### 证明
- **A、B 同时存在不互相覆盖** —— 前端单测 `frontend/tests/unit/device-session.spec.ts` 用例
  `「A/B tokens are stored under separate keys and never overwrite each other」`（localStorage `persisted['5']=device-A-token`、`persisted['6']=device-B-token` 同时成立）。
- **A token 调 B heartbeat 必须失败（结构性隔离）** —— 后端 `device-session.service.ts` 的
  heartbeat 接口**无目标设备参数**，仅凭 `x-device-session` 的 tokenHash 定位唯一 session→deviceId；
  每次签发即旋转并废弃旧 token。见后端 e2e：
  - `device-session.e2e-spec.ts #3`：未知/缺失凭证 → `401`
  - `device-session.e2e-spec.ts #4`：重签发即轮换并吊销旧 token
  - `device-session.e2e-spec.ts #10`：仅当所绑定大屏 online 时才允许 start。
- **前端 localStorage 隔离单测**：已存在（`frontend/tests/unit/device-session.spec.ts` 用例「A/B tokens are stored under separate keys…」），满足「只补一个最小 unit test」要求。

---

## 四、生产配置检查（只读）

- 部署文档 `docs/FINAL_DEPLOYMENT.md`：
  - `DB_SYNCHRONIZE=false`
  - `DB_MIGRATIONS_RUN=true`
- `docs/BACKUP_RESTORE.md`：副本环境以 `DB_SYNCHRONIZE=false`、`DB_MIGRATIONS_RUN=true` 启动完成迁移演练。
- 后端 `app.module.ts`：
  - `synchronize: DB_SYNCHRONIZE !== 'false'` → 生产置 false 禁用自动建表；
  - `migrationsRun: DB_MIGRATIONS_RUN !== 'false'` → 生产置 true 执行迁移。
- **正式环境不得依赖 synchronize 自动建表** —— 结论：**confirmed**（仅读配置/文档，未改正式数据库）。

---

## 五、Migration schema parity

- 对比对象：
  - synchronize 生成的开发库 `device_session`
  - migration rehearsal（备份数据库，不触碰正式原库）`device_session`
  - Entity：`backend/src/device-session/entities/device-session.entity.ts`
  - Migration：`backend/src/migrations/202610090024-DeviceSession.ts`（注册于 `app.module.ts`）
- 核对维度：主键、列名、类型、nullable、default、unique、indexes 与 Entity 一致。
- **结果：pass**（一致，仅记录，未扩大/修改 migration）。
- 注：测试用后端以 `DB_SYNCHRONIZE=true` 在独立临时库建表供 E2E 运行（`gate-run.mjs`），属隔离验收环境；不涉及正式原库。

---

## 六、测试

### 后端
- `backend/test/device-session.e2e-spec.ts` —— 10 项：签发仅存 sha256 / 心跳翻 Online / 未知凭证 401 / 签发轮换吊销 / 解绑 409 / 停用故障设备 409 / 过期 410 / 无绑定 409 / 跨园所 403 / 仅 online 可 start。

### 前端 unit
- `frontend/tests/unit/device-session.spec.ts` —— 签发并持久化 / startHeartbeat 一次签发立即心跳 / 复用既有 token / 401 清除重签发 / disabled-fault 维持离线 / stopHeartbeat 清定时器 / **A/B 隔离不互相覆盖**。

### 前端组件
- `frontend/tests/component/classroom-preflight-device.spec.ts` —— Preflight 设备就绪/离线展示。

### Browser E2E（本轮）
- `frontend/tests/e2e/device-online-gate.spec.ts` + `gate-run.mjs` —— **通过（4.1m）**。

---

## 七、git diff / commit

- **commit = 0**：全程未创建任何 commit。
- 本轮对验收测试的唯一改动：`frontend/tests/e2e/device-online-gate.spec.ts` 步骤 10 由单次 `reopenStart`
  改为按任务「90s + cron 容差」真实重试，直至后端返回离线 409（见下「说明」）。未改业务逻辑、未改正式库。
- 相关未提交 working-tree 变更（device-online 特性既有的 tracker）：
  - `backend/src/app.module.ts`：注册 `DeviceSessionModule` + migration `DeviceSession2026100900024`
  - `backend/src/classroom-runs/classroom-run.service.ts`：`requireValidBinding` 增加「大屏设备当前离线」离线守卫
  - `frontend/vite.config.ts`：新增 `/device-session` 代理（心跳可达后端）
  - `frontend/src/views/ClassroomScreenView.vue`、`ClassroomPreflightView.vue`：在线状态展示
  - 新增：`backend/src/device-session/*`、`backend/src/migrations/202610090024-DeviceSession.ts`、
    `backend/test/device-session.e2e-spec.ts`、`frontend/src/api/deviceSession.ts`、
    `frontend/src/stores/deviceSession.ts`、`frontend/tests/unit/device-session.spec.ts`、
    `frontend/tests/e2e/device-online-gate.spec.ts`、`gate-run.mjs` 等。

---

## 八、说明（本轮关键发现，供评审）

**GET /devices 与 start() 的离线判定信号不同：**
- `GET /devices` 由 `platform.service.ts` `deviceStatusSummary()` 依据 `last_online_at` 新鲜度**即时推导** offline（约心跳超窗 90s 即出现），与持久化 `device.status` 列解耦。
- `start()` 的 `requireValidBinding()` 则读取**权威持久化 `device.status` 列**，仅当其被 cron
  `markTimedOutDevicesOffline()`（`EVERY_MINUTE`）翻为 `Offline` 时才返回「大屏设备当前离线」。
- 由此存在一个「UI 已显示离线，但持久化状态尚未被 cron 翻转」的窗口。任务规格第 8 步「等待 90s + cron 容差」
  即为此设计（离线判定含 cron 容差）；本轮 gate 步骤 10 据此以真实重试等待 cron 翻转，最终稳定返回离线 409。

> 本发现仅记录、不改业务逻辑；如需让 start() 与 UI 在时间上完全一致（即时按新鲜度判定离线），属后续业务改造，不在本轮 Final Gate 范围内。