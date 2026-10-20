# I-2-4B 作品评价真实后端隔离验收

## 1. 所属十大阶段与结论

阶段四：一键上课与课堂大屏；阶段八：问题地图、课堂记录、绘画评价。

**本批未整体验收通过。** I-2-4A 的提交提示、部分结果及只读恢复在真实后端通过；但已确认作品在监护授权撤销后，绕过前端直接投递仍成功，违反本批场景 C 的预期。保留失败断言，未修改冻结权限/CommandBus。

## 2. 教师实际获得的改善

真实登录、作品上传、手动评价确认后，页面分别报告展示/朗读命令提交结果，不声称大屏已收到或朗读完成。响应丢失时先显示未知；点击只读查询可恢复真实持久命令状态，不重复发奖式重发、不产生第二次投递。

本批没有新增业务功能或修改业务源码，仅增加后端测试、浏览器脚本和本报告。

## 3. 环境与隔离证明

- 工作区：`D:/trae_project/new1/integration-I1`，保留既有全部 dirty 修改。
- 前端：5189，Vite PID 21852，启动命令指向该集成目录；`VITE_API_BASE_URL=''`，`VITE_BACKEND_PROXY_TARGET=http://127.0.0.1:3189`，未改 `.env`。
- 后端：3189，最终 Jest PID 40512，源码由 ts-jest 加载，不使用可能陈旧的 dist。采用现有作品 E2E 的真实 Auth/Platform/Resource/LessonPlan/ClassroomRun/Artwork 模块，不替换其 Controller、JWT、授权、持久化或 CommandBus 实现。
- 最终数据库：`D:/trae_project/new1/integration-I1/backend/.tmp/i2-4b-20261019-04/acceptance.sqlite`。
- 上传目录为同目录下 `uploads`；教师、班级、学生、设备、课堂均为本批创建的合成数据，数字 ID 仅在该库有效。
- 最终 `environment.json` 包含实际 DataSource 参数和 `PRAGMA database_list`：main 精确指向上述文件；**不指向** `D:/trae_project/new1/-ai-/backend/data/app.sqlite`。
- 启动环境明确 `DB_SYNCHRONIZE=false`、`DB_MIGRATIONS_RUN=false`；验收应用的实际选项也均为 false。新空库先由独立初始化连接对现有实体执行一次 synchronize 生成测试结构，随后关闭初始化连接；没有 migration、实体结构变更或现有数据库同步。该初始化不能描述为“从未执行任何同步”。
- ConfigModule 忽略 `.env` 和外部模型配置，没有视觉模型密钥；真实视觉接口返回 503，教师手动填写评价，没有付费 AI 请求。
- 浏览器只允许专用前端同源（API 经该代理到 3189）及 data/blob；没有浏览器合成 API 响应。唯一网络注入为 D 场景扣掉真实响应及临时阻断只读查询。
- Run/步骤由既有 E2E 合成夹具创建，开场通过现有 enterTeachingFixture 完成；不是正式建课/设备入场流程验收。
- 原 A/I-0 核验：每根 1320 受保护路径、1331 备份产物，HEAD/index/status 匹配，无新增缺失或备份差异。唯一 I-0 差异仍为先前确认的 PartnerPanel BOM。见外部 `i2-4b-preservation.json`。

早期 01/02/03 的独立数据库及失败证据均保留，不复用、不覆盖。没有打开正式数据库连接。

## 4. 智能体浏览器操作

真实 Chromium 打开 `http://127.0.0.1:5189/login?redirect=/classroom/insights`，输入合成教师账号密码，真实 POST `/auth/login` 返回 200/JWT；进入“问题与作品”，选择合成学生，上传合成 PNG。视觉服务因未配置返回 503 后，填写“我看到圆形和线条，请介绍你的作品。”，点击确认保存，再投递、查看结果及点击只读查询。

没有从 localStorage 注入伪造 JWT，没有用 Playwright fulfill 伪造业务响应。测试日志中账号密码/JWT 网络内容已省略。

## 5. 每个场景的真实请求、响应、最终状态

所有投递 payload 使用对应 Run=1、deviceId=targetDeviceId=1、source=teacher_panel 和当前 expectedVersion。下列 ID 只属于最终独立数据库。

| 场景 | 原 requestId / HTTP | 持久结果与页面 | 结论 |
| --- | --- | --- | --- |
| A | `a9f0aab9-46f8-49cc-a3df-b394d49c434a`，deliver 200 | display/tts 均 success；页面两条已提交、实际播放未确认；命令 +2，Event +2，Snapshot +2，Run v1→3 | 通过 |
| B | `b8025dd9-ef9f-4780-bdf7-36660ee613cf`，deliver 503 | 测试限定 spy 在真正 SpeakText 执行前抛错，展示正常提交；display 查询 200/success，tts 查询 404；页面展示已提交、朗读未知；命令/Event/Snapshot 各 +1，v3→4 | 通过 |
| D 响应丢失 | `2e3674dc-9869-4a51-bc85-092f1e79ae12`，后端真实 200，客户端断开 | 先阻断两次只读查询，页面两条未知；放开后点击 GET 恢复两条 success；只有一次投递 POST，命令/Event/Snapshot 各 +2，v4→6 | 通过 |
| E 离线 | `5f50c7a7-a453-4fef-a211-fee7b2f7f9dc`，deliver 200 | 真实设备表 lastOnlineAt=1970；当前 teacher_panel 路径仍接受命令，无大屏连接/ACK；页面只报提交成功；命令/Event/Snapshot 各 +2，v6→8 | 通过（仅当前契约） |
| C 前端缺少授权 | 无投递 POST | 授权读取 revoked，上传禁用；命令/Event/Snapshot/Run 不变 | 通过 |
| C 前端未确认 | 无投递 POST | 没有投递按钮；命令/Event/Snapshot/Run 不变。正常上传和登录审计仍产生，不应声称所有表零变化 | 通过 |
| C 越权教师 | deliver 403；命令 GET 403 | 原教师作品与命令不可被其他教师操作/查询；无新增命令 | 通过（真实 HTTP） |
| C 未确认直调 | deliver 409 | 无新增命令 | 通过（真实 HTTP） |
| C 已确认后撤销授权 | `i24b-revoked-consent`，**期望403，实际200** | 新上传正确403，但原已确认作品仍提交 display+tts；命令 +2、Event +2、Snapshot +2、审计 +3，Run v8→10 | **失败，真实权限缺口** |

### 查询不产生副作用的数据库证明

A/B/D/E 手动查询前后，对实际实体表 `classroom_run / classroom_operation_record / classroom_snapshot / classroom_event / audit_log / student_artwork_record` 分别计算行数和内容 SHA-256，四个场景全部完全一致。D 的原 requestId 不变，不重发投递；Run version 未因恢复查询增长。完整 before/after 位于各场景 browser JSON。

命令表实际名是 `classroom_operation_record`，不是按类名猜测的 classroom_command_record；最终脚本从实际 TypeORM metadata 读取表名。第三轮取证脚本的错误表名失败保留，修正的是测试辅助代码，不是数据库结构或业务实现。

最终 `PRAGMA integrity_check=ok`，`foreign_key_check=[]`。实体表的数量/摘要、Run、作品、命令持久记录、审计相关摘要均在 backend-results.json。

### 限制与故障注入边界

B 仅测试进程内通过 jest spy 在朗读调用前失败，不新增生产故障开关、不替代已提交展示或其存储；因此没有朗读持久记录，不能谎称朗读已确定失败。当前顺序路径不能首次产生“展示未提交而朗读已提交”，本批未伪造该组合。

E 使用真实最后在线时间与真实 teacher_panel 契约；并非物理离线/网络拔线测试。教师页面顶部“在线”是教师浏览器网络，不是大屏播放 ACK。

## 6. 截图与日志

最终目录：`D:/trae_project/new1/integration-I1/backend/.tmp/i2-4b-20261019-04`。

- A.png、B.png、D-response-loss-unknown.png、D-response-loss.png、E-offline.png、C-no-consent.png、C-no-confirm.png：实际页面截图。
- 各 `*-browser.json`：真实请求、响应、requestId、Console、只读哈希前后对照；auth 内容省略。
- `backend-http.json`：真实后端 HTTP 完成日志，含方法/路径/状态/requestId，不记录密码或完整 Prompt。
- `backend-results.json`：实际 DataSource、每场景 DB 前后摘要、严格命令记录、授权失败的真实 200 响应、完整性检查。
- `environment.json`：进程、源码运行方式、数据库真实连接及隔离参数。

外部 `D:/trae_project/new1/integration-I1-evidence`：各轮真实测试日志、构建/typecheck/lint、source-hashes、原工作区完整性和服务停止证据。

Console 不是零错误：真实视觉未配置503；B受控503与tts查询404；D受控断网；最小真实测试模块组合没有 DataModule 的游客迁移接口，登录后的 `/data/migrate-visitor` 返回404并提示“登录成功但历史会话迁移失败”。这属于验收模块范围限制，未证明完整生产 AppModule 的该接口有问题，未扩展修复。未捕获页面运行异常。

## 7. 本次自动化结果

| 实际运行范围 | 结果/证据 |
| --- | --- |
| 首轮真实浏览器组（未增加撤销授权断言） | 1 通过，`i2-4b-real-first.log`；不能据此宣称完整 C 已通过 |
| 第二轮增加撤销授权 | 1 通过、1 失败，`i2-4b-real-consent-check.log` |
| 第三轮补哈希取证 | 2 失败：取证表名错误 + 同一授权缺口，`i2-4b-real-final.log` |
| 最终专项 | **1 通过、1 失败、0 跳过**；一个通过测试包含上述6个真实浏览器流程，失败为授权撤销。`i2-4b-real-final-evidence.log` |
| 既有后端 `artwork.e2e-spec.ts`，独立内存DB/专用上传目录 | 4 通过、0 失败/跳过，`i2-4b-backend-regression.log` |
| 前端作品状态/原作品面板/恢复信封/播放器来源专项 | 4文件43通过、0失败/跳过，`i2-4b-frontend-regression.log` |
| 前/后端 typecheck | 均 exit0，`i2-4b-typecheck.log`、`i2-4b-backend-typecheck.log` |
| 前/后端 build | 均 exit0，前端大 chunk 提示保留 |
| 前端非自动修复 lint、后端 oxlint | 均 exit0；后端保留6项既有无关警告，未修改这些文件 |

没有运行完整 unit/E2E，不以 I-2-4A 的720项历史通过冒充本轮完整回归。失败断言未跳过、未放宽。

## 8. 3001 调查与清理

开始和结束 3001 均为 PID11744：`node --enable-source-maps D:/trae_project/new1/-ai-/backend/dist/main`；原 Nest watch 父进程 PID45868 指向原 A。5173 均为原 A Vite PID39000。未连接这两个服务或修改其配置/数据，没有停止/重启它们。

测试后端 3189 随 app.close/Jest 退出关闭；独立前端5189 PID21852在校验启动命令后单独停止。最终仅见原 3001/5173，见 `i2-4b-service-stop.json`。隔离库和合成上传保留为失败取证资料，不删除或混入源码提交；无待清理运行进程。

原 A、I-0、远程分支未改变；无 commit/push/pull/merge。新增文件仅本后端 E2E、前端浏览器脚本和本报告；另有本批专用临时证据及构建产物，没有业务代码修改。

## 9. 未验证与确认问题

**P1 已证实：授权撤销后仍可投递旧已确认作品。** 源码 `backend/src/artworks/artwork.service.ts` 中 upload 调用 requireGuardianConsents；deliver 只校验作品所有权、教师确认、设备与后续命令。当前展示分派没有相同的授权复核。前端投递前检查不能代替后端权限边界。真实HTTP与DB已证明两条命令提交，不能将其描述为仅缺测试证据。

本批未修改冻结权限。最小修复建议：单独批次确定并接入作品投递及真实 display_artwork 入口的授权复核，在执行边界保证撤销生效，不只增加前端禁用；保留现有事务/命令幂等语义。直接 display_artwork 路径本批只做源码关联，未另行做绕过HTTP复现。

真实模型评价、物理大屏ACK、播放器执行及音箱、真实设备心跳/断网、完整 AppModule、真实课堂启动、其他Run/设备混淆攻击的真实HTTP注入尚未完整验证。前端专项覆盖错误身份判定；本次实际查询均关联原命令，未夸大为所有攻击场景通过。

## 10. 下一批建议

仅建议优先处理已证实的作品授权撤销后投递缺口，并补真实HTTP隔离回归；需要明确批准冻结权限相关修改。本批在记录失败、停止独立服务后结束，不自动修复或进入其他批次。
