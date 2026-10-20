# I-2-4C 儿童作品授权并发安全修复

阶段四课堂大屏 / 阶段八儿童作品评价。仅实施本批，不进入其他功能。

教师体验：授权撤销后，已确认作品也不能新增展示或朗读。若展示已提交、朗读前发生撤销，页面保留展示结果，并提示授权撤销；不会跳走丢失结果或自动重发。命令提交仍不代表设备送达或播放完成。撤销不倒改既有命令，也不自动清除已提交的历史画面。

## Root Cause

原 `ArtworkService.deliver` 仅检查归属、确认和设备；当前 GuardianConsent 只在上传时检查。CommandBus 原先先保存 Processing，再执行业务；普通的事务外检查无法封住竞争，事务内拒绝又会留下 Processing。授权更新原先使用全局 repository，未加入共享写入协调。

前一份 `I2_4C_AUTHORIZATION_BOUNDARY_BLOCKER.md` 是获得本次明确授权前的历史记录，不代表本次修复仍未执行。I-2-4B 原始失败日志、数据库与报告均保留，未改成通过。

## Changed

- `backend/src/classroom-runs/classroom-command.service.ts`：仅 `display_artwork` 和携带 artworkId 的 `speak_text` 进入作品专用原子分支。原 canonical 奖励/考勤/点名、普通 TTS 和其他命令继续使用原执行分支。
- `backend/src/classroom-runs/classroom-run.service.ts`：内部 checkpointControl 可复用调用者活动 manager；增加无计时器、无恢复写入、无队列重入的内部状态投影。普通 HTTP checkpoint 不获得内部权限，原外层调用仍走原事务。
- `backend/src/platform/platform.service.ts`：upsertConsent 复用既有 DataSource FIFO，权限复核、授权变更和审计同事务。
- `frontend/src/api/http.ts`：仅作品 deliver 的稳定 `ARTWORK_CONSENT_REQUIRED` 403 保留页面，供既有命令只读核对；其他403仍保留原拒绝导航，不放宽后端权限。
- `frontend/src/components/classroom/operations/ArtworkReviewPanel.vue`：显示上述授权撤销原因，同时保留展示/朗读各自状态、requestId和只读查询；其原有 I-2-4A 修改不算本批新增。
- `backend/test/artwork-real-browser.e2e-spec.ts`：保留原403失败断言，增加并发、回放、digest冲突、当前权限撤销和实际DB回滚验证。浏览器专项需 I24B_ROOT 显式 opt-in；全套标准E2E不暗启浏览器服务。
- `frontend/tests/acceptance/i2-4b-browser.mjs`：增加确认后撤销、真实HTTP拒绝和两命令之间撤销的实际操作。
- `frontend/tests/unit/http.spec.ts`、`frontend/tests/component/artwork-delivery-status.spec.ts`：窄范围403处理、授权原因和部分提交结果保留。
- 本报告；没有修改 schema、迁移、共享协调器实现、原 A/I-0 或远程分支。

## Transaction Boundary

作品请求仍先进入已有 per-Run CommandBus 队列，再且仅再取得一次既有 Snapshot/DataSource FIFO：

1. 开启事务；在 Run 上执行不改变值的 UPDATE，先取得 SQLite 写入保留，再读取权限，避免独立连接的读后升级窗口。不是新分布式锁。
2. 校验当前教师/Run归属、班级访问；严格匹配已存在 requestId+payload 的结果可返回原成功记录，不再执行授权或业务。当前访问权限已失效时仍拒绝。
3. 新执行读取当前作品、学生 active/当前班级、确认状态、照片+作品授权、设备、版本与阶段资格。
4. 在同一 manager 内写 Processing、Run CAS、Event、required Snapshot、成功响应和命令审计，整体 commit；失败整体 rollback，包括 Processing。
5. 内部 checkpoint 不再进入外层 Snapshot 队列，不调用可能结算课间的完整 get/restore 流程；响应使用已有 response/运行时步骤/最新快照生成，未发明新状态机或恢复信封。

授权写入以同一 FIFO + SQLite事务完成；先取 guardian_consent 的写入保留，再复核学生和教师班级访问、更新授权、写审计。只有 commit 后返回成功。

展示和朗读仍是独立命令、独立事务；两者间允许授权撤销提交。后一命令必须重新准入。没有把 ArtworkService 的两命令整体包成嵌套事务；整体接口原有末尾 artwork.deliver 审计不被描述成两条命令的统一提交边界。

成功作品命令的结果保存在既有 classroom_operation_record，不冒充 `classroom_business_receipt`。I-2-1 canonical 持久回执与 post-commit recovery 分支未重设计。没有正式命令记录却有历史 checkpoint Event 时，不据此伪造成功。

## Before / After（真实HTTP/SQLite）

| 场景 | 修复前 I-2-4B | 本批修复后 |
| --- | --- | --- |
| 已确认作品撤销授权后新deliver | 200；命令+2、Event+2、Snapshot+2、Run v8→10 | 403；上述增量均0 |
| 当前授权合法且教师确认 | 两命令提交 | 两命令正常提交，实际播放仍unknown |
| revoke先提交 | 未保护 | 新命令403，零半成品Processing/业务副作用 |
| 命令先提交、再revoke | 无对应专项 | 已提交命令保留；同payload回放原结果；新朗读403 |
| 实际deliver在展示后撤销 | 未保护 | 只保留display:success；speech拒绝且无命令记录；只增加一份Event/Snapshot/版本 |
| 审计/Snapshot/commit晚失败 | 未覆盖作品原子边界 | 500；完整实体表行数/摘要回到故障前 |

最终证据数据库：`D:/trae_project/new1/integration-I1/backend/.tmp/i2-4c-20261019-04/acceptance.sqlite`。

## Tests

本轮实际命令/结果，外部日志目录 `D:/trae_project/new1/integration-I1-evidence`：

- `npm run test:e2e -- --runInBand --runTestsByPath test/artwork-real-browser.e2e-spec.ts`：首轮4组通过；最终5组通过、0失败/跳过。最终 `i2-4c-browser-final.log`，包含真实浏览器、原失败断言和并发/回滚断言。中间轮证据不覆盖。
- 既有 `artwork.e2e-spec.ts`：4通过、0失败/跳过，`i2-4c-artwork-regression.log`。
- 完整后端 unit：26套、562通过、0失败/跳过，`i2-4c-backend-unit-final.log`。
- 前端作品/恢复/播放器定向：43通过；最终完整前端：91文件、723通过、0失败/跳过，`i2-4c-frontend-full-delivery.log`。
- 完整后端 E2E 首轮：41套通过、1套失败、1套跳过；462通过、1失败、5跳过。失败为通用 AppModule 启动缺少环境配置；另见 SQLite初始化次生错误及失败清理错误。没有改测试断言、没有改业务代码以掩盖。
- 通用启动测试逐步补齐进程级合成 JWT/ARK/VOLC 占位配置后单独1通过，`i2-4c-app-smoke-all-placeholder.log`；只GET根页面，不调用AI/音频接口。各次缺配置失败日志保留。完整E2E用相同占位配置重跑，最终 **42套通过、1套按需跳过；463通过、0失败、5跳过**，`i2-4c-backend-full-e2e-final.log`。5个需独立浏览器服务的专项另行全部实际执行通过，不能将全套中的跳过隐去不报。
- 前/后端 typecheck、build、非自动修复lint已执行；前端大chunk和jsdom canvas提示、后端6项无关既有lint警告保留。以本批 delivery/final 日志为准，不引用历史结果冒充本轮。

标准全套E2E将需独立浏览器服务的5个测试标为opt-in跳过；它们已在本批独立真实验收中全部执行通过，不是为了隐藏失败而跳过。标准E2E的数据库都是内存或专用临时库；根App空库测试按现有实体初始化，不是正式数据库迁移。浏览器应用则实际 synchronize=false/migrationsRun=false。

## Browser Acceptance

使用独立前端5189 → 后端3189，真实 Controller/JWT/CommandBus/SQLite，不使用合成 API 响应。实际 DataSource 路径与 PRAGMA database_list 均记录于最终 environment.json，明确不是原 A 的 app.sqlite。后端源码由ts-jest载入，不依赖陈旧dist；只配置合成教师/班级/学生/设备，上传合成PNG。

实际登录合成教师，进入 `/classroom/insights`，选择合成学生、上传作品，视觉服务因未配置返回503后手动填写评价并确认。依次操作正常投递、响应丢失后的只读查询、缺授权/未确认、确认后真实撤销再点击投递、直接真实HTTP投递、展示后撤销而朗读拒绝。

| 实际场景 | 结果 |
| --- | --- |
| A 正常授权投递 | 通过；两命令已提交，非播放成功 |
| B 注入朗读前服务故障 | 通过；展示已提交，朗读未知 |
| D 真实响应丢失 | 通过；先未知，放开GET后恢复，只有一次投递POST |
| E 最后在线时间过期 | 通过当前teacher_panel契约；不宣称物理送达 |
| C 无授权或未确认 | 通过；页面不发投递 |
| C 确认后真实撤销 | 通过；页面提示未发送；直接HTTP403；六张关键表前后SHA完全一致 |
| B 两命令间真实撤销 | 通过；403留在页面，展示结果保留、朗读未知，并显示授权已撤销；可继续GET核对，无重发 |

截图、请求、响应、Console、真实后端HTTP日志、完整DB前后摘要在最终目录。`C-revoke-after-confirm.png` 和 `B-revoked-between.png` 为关键截图。Console中的视觉503、受控503/403/404/断网已记录；最小真实测试模块不含游客迁移接口，登录后/data/migrate-visitor的404及警告属于该验收模块范围限制，不冒充正式全量环境通过。

## Concurrency Evidence

没有随机sleep判断顺序。使用真实HTTP、共享同一DataSource：

- 先持有既有FIFO同步点，确认revoke已经入队，再发新作品命令；释放后revoke先提交，命令403且零新增。
- 在真实required Snapshot写入后持有同步点，发起真实revoke并确认排队，再允许作品事务提交；两请求按顺序提交。随后同ID同payload原结果重放、不同payload409、当前班级权限撤销后查询/重放403，新朗读403。
- 实际deliver路径在display事务提交后插入真实revoke HTTP，再继续speech；speech未产生Processing。
- 在真实审计写入后、required Snapshot写入后、commit前分别注入异常；SQL实体表内容摘要恢复，非纯mock断言。
- 授权更新审计写入后失败，授权及审计整体回滚。

详细证据键：backend-results.json 的 revokeFirst、executeFirst、betweenCommands、rollback、consentRollback。只读查询对 Run/命令/Event/Snapshot/审计/作品六表前后摘要一致；数据库 integrity_check=ok、foreign_key_check无错误。

## Remaining Risks

本次证明同一应用/共享DataSource协调域内的顺序，没有将它描述为跨进程锁；独立连接多应用、跨进程压力、BUSY重试策略、断电等未专项验证。未验证物理大屏ACK、音箱或真实模型。本批保护明确携带作品ID的展示/朗读；不按通用TTS文本猜测作品来源，也不改无作品ID命令的冻结语义。

原 A/I-0 本批只读核验，无新增异常；原有BOM差异不恢复。原正式服务不接管、不重启；只关闭本批已核实归属的独立测试服务。隔离库、合成上传和失败证据保留供复核，不提交。

最终浏览器数据库 integrity_check=ok、foreign_key_check=[]；拒绝前后的六表内容摘要相同。`i2-4c-preservation.json`核验每根1320路径和1331备份产物，原HEAD/index/status匹配，唯一I-0偏差为原有PartnerPanel BOM。

收尾：3189随测试app.close退出；仅核验并停止本批5189 Vite PID41612。最终5173仍为原PID39000；3001当前为原 A dist/main PID55040（初始PID11744，中途曾不监听）。本批没有对3001发停止/启动命令，PID变化原因未调查、不归因，也未重启它。见 `i2-4c-service-stop.json`。`i2-4c-source-hashes.json`记录相关源码与测试SHA-256。

## Next Batch

仅建议补作品授权的双应用独立连接竞争验证，复用现有接口和协调机制，不自动扩展其他功能。本批完成后停止。
