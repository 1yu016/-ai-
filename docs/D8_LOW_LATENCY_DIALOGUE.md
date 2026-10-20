# D-8 低延迟课堂对话：实施与实际验收

日期：2026-10-20。仅独立集成目录，integration/i1-ab，HEAD 368cf69844776e06ffba2a13973141e9dfb266f0。Trae 已确认未操作。本轮没有提交、推送、同步远程、修改 schema、原 A、I-0 或正式数据库；既有 dirty worktree 保留。

## 结论

完成分段观测、消除每 token 驾驶舱投影查询、简短回答引导、整段审核通过后的下一句有界 TTS 预备及取消保护。**真实首播没有显著改善，10 秒目标未达成**。不能通过删审核或先播原始 token 达标。

本轮真实服务只有一次两问题验收：4 次审核、2 次生成、3 次 TTS、0 次 ASR，未追加付费重跑。用户另行明确授权了该范围。下一句预备在定位 TTS 瓶颈后实施，其最终版本用合成 provider + 真实 HTTP/浏览器媒体验证，没有再次收费测量。不能把此合成指标称为最终真实服务性能。

## 性能证据

时间单位毫秒，从提交转写文字开始，不含 ASR。首问只是本次应用首个请求，不是已经证明的供应商冷启动；第二问携带第一问上下文。样本各一，不代表 P50/P95。

| 阶段 | 本轮真实首问 | 本轮真实追问 |
| --- | ---: | ---: |
| 上下文准备 | 10 | 8 |
| 输入/上下文审核 | 4425 | 2881 |
| 生成，含生成前权威复核 | 2990 | 2428 |
| 生成后权威复核 | 4 | 4 |
| 完整输出审核 | 3778 | 4017 |
| 服务端完整已审核回答 | 11219 | 9346 |
| 第一段 TTS 请求至音频准备 | 8116.6 | 7214.8 |
| 提问至实际 HTMLAudioElement playing | 19558.9 | 16619.1 |
| playing 至调用数字人 speaking | 0.4 | 0.3 |
| 全部句子实际播放结束 | 40682.6 | 主动打断，未测完整播放 |

D-7 历史首播 19548.8ms，本轮首播 19558.9ms，不能宣称提速；D-7 没有真实追问延迟可对比。D-7 历史 ASR 数字混合了生成合成问题音频的耗时，不能当成纯 ASR 耗时。本轮 ASR 未执行。浏览器打断实际实例 55.2ms（包含点击/观测开销），不是物理音箱延迟。

主要瓶颈是两次外部审核与 TTS：首问仅这三段已约 16.32 秒；生成另约 3 秒。权威投影本身现在为毫秒级，不能声称数据库优化就解决外部服务瓶颈。

原实现第一句 ended 后才请求下一句，真实测得第二句额外等待约 6.53 秒合成。最终改成：当前句真实 playing 后，最多预备下一句已审核文本；仍等当前句 ended 才播放下一句。最终合成验收记录：第二句请求在 5313.5ms，第一句 ended 在 9770.5ms，第二句 playing 在 9859.9ms，句间约 89.4ms。这只证明实际浏览器中预备重叠与顺序正确，**不是云 TTS 89ms**。

## 优化与安全边界

- 原先每个生成片段都完整读取 cockpit，阻塞上游消费；现在仅在服务端缓冲，生成完成后复核权威状态，审核后/每句下发前仍检查权限、Run 版本、设备、步骤等。100 片段定向测试只需至多 7 次投影读取，仍执行输入和整段输出两次审核。
- 普通问题引导两句、约 60 字内；明确故事保留最多六句，不截断审核内容、不把未完成生成强行播放。SDK 和既有非思考配置复用，无新模型、收费引擎或初始化框架。
- 有界下一句预备只作用于收到严格 whole_reply approval 的文本。最多多准备一句；教师打断时可能已付出这一句的合成成本，不承诺供应商撤销已产生的费用。
- generation/Run/步骤/设备/角色变化、权限关闭、卸载均取消当前音频及预备请求。预备微任务捕获原 AbortSignal，不能在取消后拿新 controller 重新获得资格。
- 预备音频不代表播放成功；speaking 仍由实际 playing 事件驱动，ended 才推进队列；保留原有失败降级，不自动重复 HTTP 写操作。
- 输入规则/语义审核、冻结年龄/步骤/历史上下文、完整输出审核和五字段严格 allow 均未削减。失败、超时、无效仍 fail closed。没有把审核结果缓存为跨上下文许可。
- 无持续云端监听、未新增音频留存、无公共麦克风教师权限；没有课堂生命周期/CommandBus/canonical 改动。
- 等待文案改为“已收到，正在生成并检查回答”，未重做导航或布局。

## 观测来源

服务端 done 可选 performance 数字包含 contextMs/inputReviewMs/generationMs/postGenerationContextMs/outputReviewMs/totalMs，不含模型正文或凭证。原 reply/route/approval 契约不变。性能字段不影响放行与业务状态版本。

浏览器仅派发临时 classroom-dialogue-performance 事件：submitted（requestId、首次/追问）、首个准入文本、服务端数字、TTS 请求/准备、实际播放、数字人状态调用、完整播放/取消。不上传、不持久保存用户内容、不写数据库。播放器诊断也会覆盖其他复用 backendTts 的本地语音；本轮无重叠语音，时间线可明确关联。未来若允许多实例并发，需要额外句实例关联，不能仅凭相邻时间强行匹配。

ASR 边界增加 audio-input-complete/asr-complete 观测（后者含本地格式转换+上传识别），但持续上传入口保持封闭，本轮无实际 ASR 数值。生成完成不等于音频播放结束；数字人状态调用也不是物理屏幕确认。

## 数据库断言与保留的失败

D-7 的原始两份付费失败 JSON 均保留，没有覆写。九张权威事实表继续逐表比较行数及完整内容摘要：Run、operation、Event、Snapshot、个人/集体奖励、AttendanceRecord、AttendanceChange、RollCallRecord。缺表直接失败。

本轮真实浏览器本身 passed，但外层 d8-real-test-01.json **1 失败、10 非选中跳过**：我新增的非核心表 allowlist 误写 teacher/refresh_token，实际表名是 teachers/refresh_token_session。不是业务事实变化或审核失败，不把该原始 E2E 写成通过。

修正表名后，另做不收费真实 HTTP + 合成 provider 的同一入口验收并通过。只读回核本轮真实 SQLite：九张核心表完全相同，其他变化恰为 teachers 登录信息（无新增教师）、refresh_token_session +1、auth.login 审计 +1、avatar_usage_log +1；其他表不变。PRAGMA integrity_check=ok、foreign_key_check 无问题。离线回核不冒称真实服务 E2E 重跑。

## 本轮实际测试

所有结果均本轮执行；不是引用 D-7 的历史通过数。命令在 frontend/backend 各目录执行。

| 命令/范围 | 实际结果 | backend/.tmp 结果 |
| --- | --- | --- |
| npm test -- --pool=vmThreads --maxWorkers=1 --reporter=json --outputFile=../backend/.tmp/d8-frontend-final.json | 824 通过，0 失败/跳过 | d8-frontend-final.json |
| backend npm test -- --runInBand --runTestsByPath src/ai/classroom-dialogue.service.spec.ts src/ai/classroom-content-safety.service.spec.ts src/ai/ai.service.spec.ts src/ai/audio.service.spec.ts src/ai/heuristic-operation-policy.spec.ts --json --outputFile=.tmp/d8-backend-unit.json | 72 通过 | d8-backend-unit.json |
| E2E --runTestsByPath test/classroom-cockpit.e2e-spec.ts test/command-postcommit-fault.e2e-spec.ts | 35 通过 | d8-backend-regression.json |
| 前端预备/时间线/旧语音专项 | 16 通过（之后已包含于完整前端） | d8-prefetch-unit.json |
| 隔离 E2E artwork-real-browser.e2e-spec.ts -t 'D4 contextual'，D4_BROWSER/D6_BROWSER/D7_BROWSER=1 | 1 通过，10 非选中跳过 | d8-safety-browser.json |
| 同一隔离 E2E -t 'D8 authorized latency'，仅 D8_SYNTHETIC=1 | 两轮各 1 通过，10 非选中跳过；最终含实际播放期间预备断言 | d8-synthetic-browser.json、d8-prefetch-browser-test.json |
| 授权真实服务同一路径 | 1 外层断言失败，浏览器实际 passed，见上 | d8-real-test-01.json |
| D8_RECORDED_ROOT 下 d8-recorded-latency.e2e-spec.ts，离线只读 | 1 通过 | d8-offline-test.json |
| D7_RECORDED_ROOT 下 d7-recorded-real-evidence.e2e-spec.ts，历史证据本轮只读重核 | 1 通过，不是重调用历史服务 | d8-d7-offline-regression.json |
| 前后端 type-check、backend build、frontend build-only、非自动修复 lint | 均退出 0 | 本轮工具执行记录 |

前端首次沙箱启动因 EPERM 受阻，授权必要子进程后执行成功。保留既有 Canvas、WebGL、大 chunk 提示与后端 6 项既有 lint warning；无删断言/跳过失败用例。未执行完整后端 unit/E2E，执行的是上述专项及恢复回归。

## 实际浏览器操作

使用 Playwright Chromium 原生 HTMLAudioElement；后端真实认证/课堂查询/权限，隔离 SQLite 与合成教师 i24b_synthetic。打开 /login 后进入 /classroom/lesson/1，勾选普通问答/逐句朗读，输入问题，观察实际 playing 与数字人，完整播完首问，追问并点击停止。

| 场景 | 结论与范围 |
| --- | --- |
| 普通问题、整段审核、首句 TTS、数字人 speaking | 通过：真实服务与合成环境均有实际媒体事件；延迟未达标 |
| 首问完整句序、第二问上下文与打断 | 通过：真实服务；第二问主动打断，未验证其全段播完 |
| 下一句预备与顺序、取消微任务/旧回调 | 通过：最终合成 HTTP/原生媒体与控制测试；最终预备版未再收费重测 |
| 10 秒免唤醒追问和超时 | 通过：注入合成识别结果、真实浏览器计时/PCM；不是真实远场 ASR |
| 跨片段危险输出、隐含危险、审核故障 | 通过：合成 provider 经真实安全服务/HTTP，仅固定安全文本可 TTS |
| TTS 响应门控期间暂停、恢复不补播、离页清理 | 通过：可控门控与真实媒体；非随机 sleep 推断 |
| TTS 网络故障、不可用本地回退、手动控制 | 通过：可控网络异常与合成回退不可用条件，无自动重发 |
| 跨 Run/步骤失效、审核期间状态变更 | 通过：专项自动化；未新增跨两个真实课堂浏览器场景 |
| 麦克风拒绝/撤销、公共输入不可执行命令 | 单元/既有专项回归通过；本轮不使用真实麦克风，不声称实机验收 |
| 物理音箱、真实儿童语音、远场回声、供应商压力/冷启动分布 | 未验证 |

隔离后端 3189，前端 5189；启动前两端口空闲。用户 3001/PID43644 与 5173/PID39000 未接管。测试进程仅本轮 Node/Vite PID55884，结束时只清理该已核实进程；测试后端由 Jest 夹具关闭。数据库/日志留存证据，不清理用户资源。原始 .env 未修改，只经既有受限 helper 在内存读取必要服务凭证，不读取其正式库配置。

## 证据路径（相对项目根）

- 真实时间线、请求/响应状态、Console：backend/.tmp/d8-real-01/d8-browser.json。
- 服务端帧、逐段真实审核、DB 前后摘要、完整性：同目录 backend-results.json、backend-http.json、environment.json。
- 数字人实际播放截图：同目录 d8-first-playing.png、d8-interrupted.png；视频 d8-video/。
- 离线真实测量表：同目录 d8-offline-verification.json。
- 最终预备版：backend/.tmp/d8-prefetch-browser-final/d8-browser.json、d8-first-playing.png、d8-video/，合成 provider 明确标注。
- 安全/暂停/追问：backend/.tmp/d8-safety-final/d4-browser.json、d6-audio.json、d7-safety.json、d6-paused-late-tts.png、d7-safety-redirect.png、d7-tts-unavailable.png、d4-video/。
- 环境前端日志：backend/.tmp/d8-vite.log、d8-vite-error.log。夹具缺少游客迁移、指令同义词接口出现已知 404，未将 Console 声称完全无错；无 uncaught pageerror。

## 本批文件

- backend/src/ai/classroom-dialogue.service.ts：缓冲阶段查询去重、只读数字计时。
- backend/src/ai/ai.service.ts：只改课堂回答简短提示，审核/其他调用不放宽。
- backend/src/ai/classroom-dialogue.service.spec.ts：查询上界与整段审核测试。
- backend/test/artwork-real-browser.e2e-spec.ts、helpers/d7-authorized-services.ts：复用夹具、D8 独立授权/调用上限、严格事实/登录边界。
- backend/test/d8-recorded-latency.e2e-spec.ts：真实记录只读回核及测量汇总。
- frontend/src/services/dialoguePerformance.ts、classroomDialogue.ts、backendTts.ts、backendAsrRecognition.ts：无内容观测、已准备音频复用。
- frontend/src/composables/useDialogueSpeech.ts：有界预备与来源取消。
- frontend/src/components/classroom/ClassroomDialoguePanel.vue：等待提示，不改布局。
- frontend/tests/unit/d8-dialogue-performance.spec.ts、d8-speech-prefetch.spec.ts；frontend/tests/acceptance/d8-latency-browser.mjs：观测、取消、原生媒体重叠与实际验收。
- 本报告。以上文件部分在 D8 前就属未跟踪/修改文件，本列表不是把全部文件历史内容算成本轮新增。

## Remaining / 下一项

首句 10 秒目标尚未实现，真实延迟主要由外部审核和 TTS 串行安全链决定。未测真实麦克风/音箱、真实远场、更多样本、最终预备版收费指标及多用户并发性能。现有安全模型仍非经认证的完整儿童审核，隐私授权不足时持续采集继续关闭。

最优先下一项：在相同完整安全标准和明确费用预算下，对当前供应商可用低延迟审核/已审核文本 TTS 方案做受控对比，再决定配置优化；不能默认切模型或把本轮合成结果当达标。D-8 到此停止，不自动实施。
