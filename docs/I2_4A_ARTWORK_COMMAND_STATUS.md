# I-2-4A 作品展示与朗读状态准确性

## 1. 所属十大阶段

阶段四：课堂大屏；阶段八：问题地图、课堂记录、绘画评价。本批只校正命令状态、查询和必要的重复点击保护。

## 2. Before / After

原界面凭 `display && speech` 就提示“均已送达大屏”，并把任意 HTTP 错误描述为投递失败。现在分别显示作品展示与评价朗读的“命令已提交 / 服务端返回失败 / 提交结果未知”。始终明确实际展示与朗读未确认，不虚构设备 ACK 或播放完成。

请求发起后投递按钮禁用；教师可以只查询原命令结果，不会重新发送 POST。后续查询失败不会抹去此前已确认的提交结果。

## 3. Changed

- `frontend/src/services/studentArtwork.ts`：校验命令身份并解析两条命令状态；增加有界、只读的命令记录查询和准确提示文本。
- `frontend/src/components/classroom/operations/ArtworkReviewPanel.vue`：保留教师确认，投递前重新读取作品/照片授权；防重复提交；分别展示两条命令结果，提供只读查询按钮；卸载后不再应用结果。
- `frontend/tests/component/artwork-delivery-status.spec.ts`：11 个针对性测试，覆盖部分成功、未知、身份不匹配、重复点击、授权/确认和已确认结果保留。
- `frontend/tests/acceptance/i2-4a-browser.mjs`：独立前端真实浏览器操作与合成 HTTP 取证。
- 本报告。其余既有 dirty 文件保持原样，不属于本批修改。

未修改后端、数据库、原 A/I-0、数字人 Provider、移动控制、Operation Policy 或 I-2-1/I-2-2 契约。

## 4. 展示与朗读状态契约

源码依据：

- `backend/src/artworks/artwork.service.ts:85`：先提交 `${requestId}:display`，取得版本，再提交 `${requestId}:tts`，最后写审计并返回 `{ display, speech }`。不是两条命令及审计的统一事务；后半段失败不证明展示未提交。
- `backend/src/classroom-runs/classroom-command.service.ts:207`：`status=success`、`result`、`classroomState` 为命令结果，不承诺设备接收或实际播放。
- `backend/src/classroom-runs/classroom-command.controller.ts:28` / service `findOne:264`：现有 GET 按 requestId 查询命令记录，校验操作者身份。读取 `recordView` 的 `classroomRunId`，与响应信封的 `runId` 分别兼容。
- `backend/src/classroom-runs/presentation-ownership.ts:4`：播放器 observation 需要 commandId/revision 精确关联。作品投递响应本身不含可据以判断当前播放完成的 observation。

前端必须匹配 requestId 子键、Run、目标设备及 operation，不能因对象非空认定成功。`success` 仅表述为提交；`failure/conflict` 仅表述为服务端返回失败，不断言实际动作绝对未发生；Processing、404、网络异常、身份不匹配或字段缺失均为 unknown。

投递失败或信封不完整时仅并行查询两次 GET，无无限轮询、无写入补偿。后续按钮同样仅 GET。保留首次 requestId，不将 `currentClassroomState` 当成完整恢复 DTO，不调用 `adoptRun(null)`，不修改冻结恢复逻辑。

当前后端顺序执行通常不会在首次请求中出现“展示失败但朗读成功”；本批 C 场景只验证 UI 对两条已有命令记录的独立呈现，不宣称该后端路径已真实复现。未查询到第二条命令不能猜测其失败或未执行。

## 5. 自动化测试（本批实际执行）

证据目录：`D:/trae_project/new1/integration-I1-evidence`。

| 范围/命令 | 结果 | 日志 |
| --- | --- | --- |
| 首次专项：新作品测试 + 原作品组件 + 恢复信封 + 播放器身份，vmThreads 单 worker | 33 通过、9 失败 | `i2-4a-targeted-first.log` |
| 修正夹具后的同一专项 | 4 文件、42 通过、0 失败/跳过 | `i2-4a-targeted-second.log` |
| 首轮完整 `npm test -- --pool=vmThreads --maxWorkers=1` | 91 文件、719 通过 | `i2-4a-full-first.log` |
| 加入只读查询失败不抹去提交结果断言后的最终完整，同上命令 | 91 文件、720 通过、0 失败/跳过 | `i2-4a-full-final.log` |
| `npm run type-check` | exit 0 | `i2-4a-typecheck-final.log` |
| `npm run build-only` | exit 0，大 chunk 提示保留 | `i2-4a-build.log` |
| `node node_modules/eslint/bin/eslint.js .`，不自动修复 | exit 0 | `i2-4a-lint-final.log` |

首次 9 个失败均因新测试未显式传 `backendReady=true`（Vue 布尔属性缺省为 false），导致进入既有阻塞视图；只修正测试夹具，不删除断言、不修改该既有业务行为。另补充的第 11 个测试已包含在最终 720 项中。jsdom canvas 提示保留，不作为真实硬件验证。

## 6. 智能体实际操作过程

2026-10-19 使用集成项目 Vite 独立端口 5188；启动前确认端口空闲，启动命令精确指向 integration-I1。环境变量仅对进程指定 API 3188，未改 .env。3188 不启动真实后端：Playwright 对该来源逐条拦截合成协议响应，其他非前端来源全部阻止。未连接数据库、真实账户、真实作品或付费 AI。

真实 Chromium 打开 `http://127.0.0.1:5188/classroom/insights`，在“问题与作品”选择合成学生，上传合成 1px PNG，取得合成评价，点击“确认并保存”，再点击“在大屏展示并朗读”。使用显式 Promise 同步点扣住响应，检查提交中按钮禁用后释放；随后点击只读查询按钮核对 POST 数量。E 场景分别检查无授权与未确认状态。

浏览器早期脚本分别因按钮名称错误、学生查询夹具路径错误且尚未选择学生而失败；证据保留，没有修改产品来迁就脚本。截图检查后，将旁侧问题列表的夹具修正为实际约定的空数组；未改问题模块源码。

## 7. 操作验收结果

下表通过均仅指真实浏览器操作 + 合成接口，不能替代真实后端联调。

| 场景 | 结果 | 观察 |
| --- | --- | --- |
| A 展示/朗读均提交成功 | 通过 | 分别显示命令已提交；实际播放未确认；无“已送达/播放完成” |
| B 仅展示提交成功 | 通过 | 展示已提交、朗读服务端返回失败；查询不重发 |
| C 仅朗读提交成功 | 通过（契约夹具） | 两条记录独立显示；不代表当前顺序后端可达性验证 |
| D 大屏未连接/无 ACK，而命令已接受 | 通过（合成条件） | 仍不宣称大屏送达；未验证真实设备心跳离线识别 |
| E 缺少授权 | 通过 | 上传禁用，0 个投递 POST |
| E 未教师确认 | 通过 | 无投递按钮，0 个投递 POST |
| F 两条记录均返回失败 | 通过 | 分别显示服务端返回失败，不推断实际播放事实 |
| G 网络结果未知/查不到记录 | 通过 | 两条未知，无自动重发 |
| 真实后端授权、设备与音频 | 未验证 | 无安全配置的真实后端验收环境，本批不启动既有服务 |

每个已发起投递的场景投递 POST 恰好 1 次；A/D 后续查询各 2 个 GET，B/C/F/G 含自动核对和手动查询各合计 4 个 GET。E 场景为 0。单位测试另验证快速重复点击。

## 8. 截图、网络及日志证据

最终浏览器目录：`D:/trae_project/new1/integration-I1-evidence/i2-4a-browser/run-1792379626645`。

包含 A/B/C/D/E-consent/E-confirm/F-both-failed/G-unknown 八张截图及 `results.json`、`network.json`、`console.json`。`i2-4a-browser-request-counts.json` 保存逐场景请求数量。

Console 有预期故障注入资源错误：B/C/F 的 500，G 的连接错误及 404；没有捕获页面运行异常。不将“有受控网络错误”描述为零控制台错误。前两轮脚本失败和修正前后的截图均保留在同一上级目录。

## 9. Remaining / 保护核验

- 代码、自动化和合成接口浏览器验收完成；真实后端权限、持久命令查询、真实 ACK/屏幕/音箱、浏览器刷新后请求身份恢复仍未验收，不宣称生产封版。
- 查询是有界读取，Processing 或网络不可用可能长期保持未知；教师应核对课堂状态，不能以未知结果触发新写入。
- 作品投递顺序执行及后续审计失败可能留下部分命令提交；本批如实查询呈现，不改变冻结后端事务或设计新恢复协议。
- 当前授权复核复用已有读取及服务端写入守卫；真实后端授权测试未重跑，不能用合成 HTTP 证明服务端安全性。
- `i2-4a-preservation.json`：每个受保护根核验 1320 路径，备份 1331 产物；无缺失、备份无差异，原 A HEAD/index/status 匹配。唯一偏离 I-0 的仍为已确认的 PartnerPanel BOM 差异，未覆盖。
- 本批 5188（PID 45912）已核实归属后关闭。最后仍见 5173（PID 39000）；此前可见的 3001（PID 29724）在结束检查时不再监听，原因未调查。本批唯一 Stop-Process 目标为 45912，未向 3001 发停止命令、未重启或修复。证据 `i2-4a-service-stop.json`。
- 无 commit/push/pull/merge，无迁移或正式数据库访问。

## 10. Next Batch

仅建议在安全隔离的真实后端环境验证作品投递的部分提交和只读命令查询链路，继续明确设备实际播放为 unknown；不自动开展下一批。
