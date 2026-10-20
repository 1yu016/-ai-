# I-2 最终收尾：作品并发、手机时间、总结编辑

日期：2026-10-19。仅独立集成仓库 `D:\trae_project\new1\integration-I1`。
分支 `integration/i1-ab`，HEAD `368cf69844776e06ffba2a13973141e9dfb266f0` 未改变。
本轮未提交、推送、同步远程、迁移数据库或修改原 A / I-0。

## 1. 所属阶段及教师体验

- 阶段四（课堂大屏、手机控制）：作品撤销授权后不再新投递；手机时间快慢不再导致正常指令被错误判过期。
- 阶段八（儿童作品评价、课堂记录）：作品显示“命令已提交/结果未知，实际播放未确认”，而不是声称送达；总结只有在当前教师、completed Run、有效关联草稿满足条件时可编辑。
- 本批没有开发阶段五数字人功能。

## 2. 本轮实际修改（不把既有 dirty 文件列成本轮开发）

| 文件（相对本仓库） | 本轮内容 |
|---|---|
| frontend/src/stores/classroomMobile.ts | serverNow + performance.now 单调计时；issuedAt、expiresAt、TTL 同基准；未获取服务器采样时不凭手机时钟销毁会话；同步后再判断会话过期 |
| frontend/src/views/ClassroomRecordView.vue | 编辑、确认和放弃共用资格条件；校验教师身份/Run 所属/完成状态/草稿身份/正式总结关联；加载错误或缺失关联时只读；保留分页、分类、未保存提醒及错误提示 |
| frontend/src/services/classroomRecords.ts | 补充实际 timeline 响应已有的 teacherId 类型，不新增后端字段 |
| frontend/tests/unit/classroom-mobile.spec.ts | 时差、TTL 前/边界/后、相同请求重试、首次校时、离线重连 |
| frontend/tests/component/ClassroomRecordView.spec.ts | 外 Run 草稿、非本次教师、已放弃、正式总结缺草稿、403/500 加载失败及原有正常场景 |
| backend/test/artwork-real-browser.e2e-spec.ts | 双应用独立连接、实际 SQL 同步点、审计/提交失败、真实浏览器手机/总结夹具；仅测试代码 |
| frontend/tests/acceptance/i2-final-browser.mjs | 真实登录/手机/记录页面，真实 HTTP、只读 SQLite 摘要、截图及 Console |
| docs/I2_FINAL_WRAP_UP.md | 本报告 |

后端生产实现、CommandBus/Operation Policy、schema 均未在本批修改。

## 3. A：作品授权双应用验证

两个 Nest 应用、两个 DataSource、不同原生 SQLite 连接、同一个全新隔离数据库；比较对象身份及 PRAGMA database_list。均在同一个 Node 进程，不是多进程验证。

通过 QueryRunner 实际 SQL 完成后的 Promise barrier，保持首事务未提交；第二应用真实 HTTP 请求在 timeout=0 下取得 SQLITE_BUSY，返回非成功且不留部分命令。没有随机 sleep 决定先后。

验证结果：

1. 撤销先持有写锁：竞争投递失败；撤销提交后新展示/朗读均 403。命令、Event、Snapshot、Run（含 version）和业务审计没有新增或变化。
2. 合法投递先写入 Processing 并持锁：竞争撤销失败且无部分授权变更；投递提交后撤销可成功；历史 Success 命令保留，新执行被拒绝。
3. 已成功命令在撤销后的合法同 payload 重放保持首次结果，不新增事实。
4. 展示提交后撤销，独立的后续朗读重新检查授权并 403，无新增课堂副作用。
5. 真实提交边界前注入失败，Processing、Run、Event、Snapshot、审计整体回滚，HTTP 500，不返回虚假成功。
6. 第二连接真实授权审计 INSERT 后注入失败，授权与审计整体回滚。

未发现新的授权安全缺陷。SQLITE_BUSY 目前可能返回通用 500，这是失败响应，不是成功或自动重试；未扩大 CommandBus 改造范围。

最终增强证据（含 SQL 顺序和审计比较）：
`D:\trae_project\new1\integration-I1\backend\.tmp\i2-final-dual-20261019-05\backend-results.json`。
应用关闭前 integrity_check=ok，foreign_key_check=[]。

## 4. B：手机时间契约

保留后端 issuedAt/ttlMs 校验与已有重放规则。前端采用服务器 serverNow 的 epoch 采样，加 performance.now 的经过时间；后续手机墙钟变化不重新解释已发出的身份或截止时间。

- TTL 保持 30000ms。网络重试继续使用相同 requestId、issuedAt 和 payload。
- 前端在 elapsed >= TTL 时保守停止发送；后端原契约是 elapsed > TTL 拒绝，本轮未改变该边界。
- 断线重连先读取完整服务端状态，重新校准；会话清除/变更清除时间锚点。
- 无可信时间采样时不猜测当前手机时间为服务器时间。

真实浏览器分别将手机 Date 偏移 0、±30000、±180000ms。每组通过页面发送暂停/恢复，HTTP 201 + deliveryStatus=confirmed + result.status=success；同 payload 重放仍 201，过期请求 408。读取 SQLite 比较证明重放和过期请求不改变 Run/Command/Event/Snapshot。离线→在线重连后重新同步。

“confirmed”在这里沿用既有后端命令执行回执，不能用来证明物理屏幕或音箱完成展示。

## 5. C：总结编辑

实际后台 confirm 要求 teacher 身份、Run 所属教师、班级访问、存在且未 discarded 的草稿。本轮前端保留 completed 限制，并新增同 Run 草稿和正式 summary.draftId 关联校验，不改变后端产品权限。

正式总结缺少其所需草稿时只读，不自动生成替代草稿。页面加载失败、未结束课堂、非本次课堂教师不提供确认或放弃入口；调用处理函数也校验资格。

真实页面：completed 课堂生成安全规则草稿、教师编辑并保存 HTTP 201；running/paused 课堂输入禁用；越权教师加载和直接确认均 403。缺失对象及 500 等异常另外由组件测试覆盖，不冒充已做真实浏览器故障注入。

## 6. 本轮实际测试台账

证据根目录：`D:\trae_project\new1\integration-I1-evidence`。

| 命令/范围 | 本轮最终结果 | 证据文件 |
|---|---|---|
| frontend npm test -- --pool=vmThreads --maxWorkers=1 | 91 文件，738 通过、0 失败、0 跳过 | i2-final-front-full-final.log |
| backend npm test -- --runInBand | 26 套件，562 通过、0 失败 | i2-final-backend-unit.log |
| backend npm run test:e2e -- --runInBand | 42 套件通过，1 opt-in 套件跳过；463 通过、7 跳过、0 失败 | i2-final-backend-full-e2e.log |
| opt-in artwork-real-browser，I24C_RUN=true / I2_FINAL_BROWSER=true | 7 通过、0 失败、0 跳过；含 16 个真实浏览器场景 | i2-final-browser-fourth.log |
| 最终增强双应用定向 -t 'I2 final: dual' | 1 通过，6 非本次选择项跳过 | i2-final-dual-final.log |
| 前后端 typecheck/build/非修复 lint | 每项退出码均 0 | i2-final-front-static-final.json / i2-final-backend-static-final.json |

完整 E2E 使用专用 `backend/.tmp/i2-final-full-app.sqlite` 与新证据前缀；仅新测试文件初始化既有实体结构。浏览器应用实际连接独立 `.tmp/i2-final-browser-20261019-04/acceptance.sqlite`，运行配置 synchronize=false / migrationsRun=false，源码由 ts-jest 加载。无付费 AI：作品 AI 503 后教师手工确认；总结使用安全规则降级。

### 首次失败及修正分类（均保留，不算最终通过）

- 初始手机专项 5 失败/5 通过、总结专项 2 失败/5 通过：复现所修前端问题；结果已保留于本聊天工具记录，本报告不虚构不存在的首次日志文件。
- i2-final-front-full.log：734 通过/1 失败，原因是新增 jsdom 测试没有 ReadableStream；改为可控 reader 测试夹具，不修改业务逻辑或放宽断言。其后 735 通过，再补 3 个总结异常测试，最终 738 通过。
- i2-final-browser-first.log（5 失败/2 通过）：新测试误认手机响应字段；失败后暂停状态污染后续共享场景。保留原日志与第一份数据库。
- i2-final-mobile-record-second.log（1 失败/6 跳过）：新夹具误建同班第二个活动 Run，被真实唯一约束拒绝；改用独立运行批次现有合成 Run，并将手机/总结场景放在作品场景之后。
- i2-final-browser-third.log（6 通过/1 失败）：测试等待 URL 时误匹配 login 的 redirect 参数，登录未完成就读取 JWT，直接请求 401；修正为 pathname 精确同步点，最终真实 403 断言通过，未放宽权限要求。

未删除失败断言、未跳过既有失败测试。历史报告中的其他通过数不计入本轮结果。

## 7. 智能体真实浏览器操作及证据

真实 Playwright Chromium，不是 fulfilled 合成 API。前端 127.0.0.1:5189 → 后端 127.0.0.1:3189；每次重新创建测试数据库。

| 页面/操作 | 结果 |
|---|---|
| /login → /classroom/insights，上传合成 PNG、填写评价、确认、展示朗读 | 通过：真实提交状态，不称设备已播放 |
| 仅展示成功、朗读前撤销、离线屏幕、未授权/未确认、响应丢失与 GET-only 恢复 | 8 个作品场景均通过 |
| /classroom/remote，各时差下暂停/恢复、同请求重放、过期请求、断网重连 | 5 组通过 |
| /classroom/records/:runId，合法查看编辑保存、活动课堂只读、越权访问 | 3 个场景通过 |

截图与 HTTP/数据库文件在：
`D:\trae_project\new1\integration-I1\backend\.tmp\i2-final-browser-20261019-04`。

- `C-revoke-after-confirm.png`、`B-revoked-between.png`：撤销后拒绝与部分成功。
- `mobile-clock-0.png`、`mobile-clock--180000.png`、`mobile-clock-180000.png` 等：手机页面。
- `summary-legal-edit.png`、`summary-active-readonly.png`、`summary-forbidden.png`。
- `final-browser.json`：手机/总结操作、真实请求响应、四表前后 count/SHA-256、Console。
- `*-browser.json`：作品各场景的截图关联、真实网络和无副作用比较。
- `backend-http.json`、`backend-results.json`：后端日志、所有实体摘要、前后状态、integrity_check=ok / foreign_key_check=[]。

Console 不是全空：测试应用有意未导入 DataModule，登录后的游客数据迁移请求 404 产生可见警告；作品模型未配置时 503，权限用例预期 403。没有把这些报告成“控制台零错误”，也没有新增付费模型或扩大测试服务模块。jsdom Canvas 警告、后端 6 项既有 lint warning、前端大 chunk warning 保留。

## 8. 保护与清理

原 A/I-0 前后检查：每个 original/restore 根核查 1320 个保护路径，1331 个备份制品；无新增缺失/差异；HEAD/branch/index/status 与 I-0 一致。唯一既知原 A 与 I-0 不同项仍是已确认 BOM-only 的 ClassroomPartnerPanel.vue，本轮不恢复。

证据：`i2-final-original-before.json`、`i2-final-original-after.json`。

本批 Vite PID 33428 的命令行/端口经核验后停止；每个 Nest 测试应用自行 close。最终 3189/5189 均未监听，临时数据库与证据保留供审查，不清理其他用户资源。

开始只读观察到 3001 PID 55040、5173 PID 39000。结束时仍见 5173 PID 39000，3001 未监听；本批仅停止 PID 33428，未停止/接管原服务，不推断 3001 变化原因。服务证据 `i2-final-service-stop.json` / `i2-final-ports-after.json`。

## 9. 结束条件与下一步

本轮指定 A/B/C 的代码、定向证据、完整自动化及隔离真实浏览器验收具备结束条件；不等于生产封版或真实设备验收。

未验证：真正多进程/断电/压力、真实手机操作系统长时间挂起与高延迟校时、物理大屏 ACK、真实音箱、付费视觉模型；缺失/500 总结异常为自动化覆盖，并未全部实际浏览器故障注入。游客迁移提示属于此精简隔离夹具限制。

下一阶段只建议阶段五数字人专项：先核对班级形象绑定、Provider 身份隔离、加载/资源释放、课堂暂停联动和授权资源；不重新设计课堂状态机。本批停止，未开始该阶段。
