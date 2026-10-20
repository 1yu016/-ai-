# Codex 独立审查与修复：课堂对话 / D-6 语音

2026-10-20，Asia/Singapore。仅操作 `D:\trae_project\new1\integration-I1`。
分支 `integration/i1-ab`，HEAD `368cf69844776e06ffba2a13973141e9dfb266f0`。
用户明确确认 Trae 已暂停。没有执行远程同步、提交、合并、清理或覆盖恢复。

## 结论与功能变化

已有：教师一次开启普通问题回答、冻结教案/当前环节上下文、NDJSON 流式文字、逐句朗读、有界追问、公共麦克风仅分类、课堂阶段/来源失效、Avatar 既有身份与视觉状态。

Trae 新增的是后端 ASR 适配器、后端 TTS 播放适配、真实 TTS 功能开关及对应替身测试；没有发现 D-6 正式交付报告。D-5 报告明确是合成识别/语音事件，不把它当作 D-6 真实语音已验收。

确认的问题已最小修复。当前能证明隔离真实 HTTP、原生浏览器音频元素及课堂联动；不能证明真实儿童语音、外部语音供应商、远场/回声、物理大屏和音箱可用。不是生产封版。

## 问题、原因与处理

| 等级 | 位置 | 根因与证据 | 本轮处理 |
| --- | --- | --- | --- |
| P0 | backend/src/ai/classroom-dialogue.service.ts:13,53 | 明确危险指令/索取电话可通过输出过滤；有标点的 chunk 将下一句未完成尾部一起下发。修复前后端 4 条新增断言失败 | 只发送完整句子，保留尾部；复核累计输出和课堂来源；增加明确危险指令/隐私索取拦截。真实 HTTP 返回安全首句后 error，不发送危险尾部 |
| P0 隐私边界 | frontend/src/components/classroom/ClassroomListeningPanel.vue | env flag 自动改用云端持续 VAD 上传，包括唤醒前音频；没有可靠的课堂授权/外部处理准入证据，且声称云端“不保存录音”没有依据 | 暂时封闭该 UI 持续云端入口，明确提示原因，手动输入继续可用；不发明新的授权 schema。适配器保留，但不能通过该开关打开课堂持续上传 |
| P1 | frontend/src/services/backendAsrRecognition.ts:160 | 第二段 resultIndex=1、results 却只有一项，消费者循环跳过；异步麦克风许可/上传没有会话隔离 | 独立结果 resultIndex=0；单调会话代次；迟到许可立即停止 tracks；局部 recorder/chunks；上传 AbortSignal 与背压；错误显式停止；资源清理 |
| P1 | frontend/src/services/backendTts.ts, browserSpeech.ts | play Promise 被用作 speaking；外部取消通知没传；陈旧句仍先合成；取消未传 HTTP | 实际 playing 驱动说话；传递 onCancel；开始前检查来源；请求/自有音频响应 AbortSignal，清除旧取消处理器；NotAllowed 视为播放不可用而非成功 |
| P1 | frontend/src/composables/useDialogueSpeech.ts | 同回答各句共享 generation，旧句结束可改变新句；失败先使队列失效却仍启动 native fallback；provider reject 未收尾 | 增加句子实例身份；仅当前、尚未开始的句子允许一次 fallback；捕获拒绝；按实例取消，不因旧队列清理停止新所有者 |
| P1 | frontend/src/components/classroom/ClassroomDialoguePanel.vue | 回答已完成但 TTS 待合成时，busy=false、speaking=false 导致停止按钮消失 | 用 voiceOccupied 显示停止按钮与错误；待播放也可打断 |
| P2 测试证据 | backend-tts.spec.ts 等 | 使用 FakeAudio/post 替身，却将用例描述成“real backend/real audio” | 明确替身范围，补实际浏览器 HTMLAudioElement + HTTP 验收，不用返回 started 推断已经发声 |

注意：输出词法规则是额外、保守防线，不是全面内容审核或完整脱敏。可能误拦安全提醒，仍可能漏过改写、其他语言或复杂不适龄内容。真实模型儿童安全质量仍未通过上线级验证。

## 本轮实际修改清单（不等于整个 dirty worktree 清单）

业务/前端：

- backend/src/ai/classroom-dialogue.service.ts
- frontend/src/services/backendAsrRecognition.ts
- frontend/src/services/backendTts.ts
- frontend/src/services/browserSpeech.ts
- frontend/src/composables/useDialogueSpeech.ts
- frontend/src/components/classroom/ClassroomListeningPanel.vue
- frontend/src/components/classroom/ClassroomDialoguePanel.vue

测试与本报告：

- backend/src/ai/classroom-dialogue.service.spec.ts
- backend/test/artwork-real-browser.e2e-spec.ts：opt-in D6 时注册实际 AiController，注入纯合成 PCM AudioService；不修改生产路由实现。
- frontend/tests/unit/backend-tts.spec.ts
- frontend/tests/unit/d6-review-regression.spec.ts（新增）
- frontend/tests/unit/d6-tts-fallback.spec.ts（新增）
- frontend/tests/component/classroom-dialogue-panel.spec.ts
- frontend/tests/component/classroom-listening-panel.spec.ts
- frontend/tests/acceptance/d4-dialogue-browser.mjs
- frontend/tests/acceptance/d6-review-audio.mjs（新增）
- docs/CODEX_D6_INDEPENDENT_REVIEW_20261020.md（新增）

未修改 canonical 奖励/考勤/点名、CommandBus、Operation Policy、生命周期、身份权限、Avatar 资产/Provider、数据库实体或迁移；原 A/I-0 未写入。此前大量修改/未跟踪文件保持原状。构建产生了隔离项目内的忽略构建产物；不宣称整个工作区无变化。

## 本轮自动化结果

结果目录均为 `D:\trae_project\new1\integration-I1\backend\.tmp`。没有引用历史通过数冒充本次。

| 实际命令（在对应 frontend/backend 下） | 结果 | 结果文件 |
| --- | --- | --- |
| frontend `npm test -- --pool=vmThreads --maxWorkers=1 tests/unit/d6-review-regression.spec.ts --reporter=json --outputFile=../backend/.tmp/codex-d6-red-frontend.json`（修复前） | 0 通过、5 失败；保留复现 | codex-d6-red-frontend.json |
| backend `npm test -- --runInBand --runTestsByPath src/ai/classroom-dialogue.service.spec.ts --json --outputFile=.tmp/codex-d6-red-backend.json`（修复前） | 14 通过、4 失败 | codex-d6-red-backend.json |
| frontend `npm test -- --pool=vmThreads --maxWorkers=1 --reporter=json --outputFile=../backend/.tmp/codex-d6-final-frontend.json` | 105 文件，811 通过、0 失败/跳过 | codex-d6-final-frontend.json |
| backend `npm test -- --runInBand --runTestsByPath src/ai/classroom-dialogue.service.spec.ts src/ai/ai.service.spec.ts src/ai/audio.service.spec.ts --json --outputFile=.tmp/codex-d6-backend-unit.json` | 3 套，50 通过、0 失败/跳过 | codex-d6-backend-unit.json |
| backend `npm run test:e2e -- --runInBand --runTestsByPath test/classroom-cockpit.e2e-spec.ts test/command-postcommit-fault.e2e-spec.ts --json --outputFile=.tmp/codex-d6-backend-regression.json` | 2 套，35 通过、0 失败/跳过 | codex-d6-backend-regression.json |
| backend 带隔离环境变量，`npm run test:e2e -- --runInBand --runTestsByPath test/artwork-real-browser.e2e-spec.ts -t 'D4 contextual' --json --outputFile=.tmp/codex-d6-browser-test-05.json` | 1 通过、0 失败、8 未选择场景跳过 | codex-d6-browser-test-05.json |

前后端 type-check、build（前端 build-only）、lint 本次均执行并最终退出 0；前端 lint 直接运行 `node node_modules/eslint/bin/eslint.js .`，没有使用带 --fix 的项目脚本。保留 jsdom Canvas 未实现、构建大 chunk 提示；后端 lint 有既有 snapshot/growth-goal 测试警告，未顺手清理。

未运行完整后端 unit/E2E。定向恢复回归含奖励、考勤、点名的持久回执故障、安全与重放；不冒充全部后端场景已重验。

早期结果不删除：`codex-d6-green-targeted.json` 27 通过/1 失败，因旧组件替身未实现新增 signal 取消，修正替身后保留原停止/旧回调断言并全量通过。新增测试 tuple 类型、unused 参数曾使静态检查失败，后修正测试声明；没有放宽业务守卫。

## 智能体实际操作 / 隔离环境

最终证据根：`D:\trae_project\new1\integration-I1\backend\.tmp\codex-d6-browser-05`。

- 合成教师登录 `http://127.0.0.1:5189/login`，进入 `/classroom/lesson/1`，勾选自动回答和逐句朗读。
- 后端实际监听 3189，经 environment.json 的 PRAGMA 核实仅连接该根下 acceptance.sqlite。运行时 synchronize=false、migrationsRun=false、ignoreEnvFile；仅夹具初始化全新空测试库的现有实体结构，没有迁移或修改正式库。
- 前端仅本批 Vite 进程设置代理 3189、REAL_TTS=true、LOCAL_LISTENING=true、REAL_ASR=false；没改 .env。注入识别器仅在验收浏览器存在。
- 实际 AiController `/ai/tts`、DTO/HTTP、课堂 Controller/JWT/cockpit/SQLite/CommandBus 为真实；AI provider 和 PCM 合成为测试替身，未连接收费服务。PCM 为程序生成四秒测试音，不是自然语音质量证明。
- 浏览器使用真实 HTMLAudioElement.play，记录 playing/pause/ended/emptied、currentTime/readyState/paused；没有伪造这些音频事件。Recognition 转写明确为合成注入，绝不声称真实麦克风链路通过。

| 场景 | 结果与边界 |
| --- | --- |
| 两轮普通问题、当前环节与上下文回答 | 通过：真实 HTTP，合成模型 |
| 公共麦克风奖励意图 | 通过：只分类，无命令/AI POST，不写课堂事实 |
| AI 上游受控断流 | 通过：错误提示、保留手动方式、不自动重试 |
| ASR 语言包不可用 | 通过：明确错误/手动备用；不代表真实权限拒绝/真实服务网络已验收 |
| 真实 HTTP 危险分片输出 | 通过：只发送安全完整首句，随后 DIALOGUE_INTERRUPTED，无危险尾部/done，业务表摘要不变 |
| 实际音频逐句播放 + Avatar speaking | 通过：playing 才进入说话，ended 后下一句；问答前后 Run/命令/Event/Snapshot 行数和 SHA-256 一致 |
| 教师点击停止 | 通过：实际 audio.paused=true、Avatar 不再 speaking |
| 合成转写唤醒/10 秒追问/超时 | 通过：原生音频播放期间 ASR suspended，结束后窗口开启，免唤醒追问可用，超时回 waiting |
| TTS 响应在可控网络 gate 等待时暂停 | 通过：真实暂停/恢复接口；释放旧响应不创建音频，已有音频保持停止，无自动重发 |
| 恢复、重新提问、离开/重进课堂 | 通过：旧任务不重播，只有新问题播放；等待实际路由离开后音频已清理，重进未自动开启 |
| 换步骤/Run/设备、权限拒绝/网络异常 | 自动化覆盖；本轮浏览器没有真实多 Run/设备或物理麦克风切换验收 |
| 真实儿童录音、外部 ASR/TTS、自然语音质量/首句延迟、物理大屏/音箱、远场/声学回声 | 未验证 |

数据库 integrity_check=ok、foreign_key_check=[]。课堂暂停/恢复确实产生合法命令/Event/Snapshot，不能声称整个验收零写入；零副作用比较针对只读问答片段。

Console 无未捕获 pageerror；保留隔离夹具缺失游客会话迁移/其他非本批端点的 404，以及软件 WebGL ReadPixels 性能提示，不伪称 Console 全无错误。

收尾：测试前端最初 PID 50044、重开为 17368，均在核对命令行后仅停止本批进程；测试后端随 Jest 夹具关闭。最终 3189/5189 无监听。原 3001 PID 43644、5173 PID 39000 前后保持一致，未接管或重启。暂存区无变更，HEAD 不变；git diff --check 通过（保留既有换行转换警告）。没有清理历史证据、测试数据库或用户进程。

### 浏览器失败证据

`codex-d6-browser-01` 至 `-04` 目录及相应 test-01～04.json 全部保留。

- 01：按异步 response body 完成计请求，上一请求晚到误报；改为 request 发送事件取证。
- 02/03：测试假设整个页面恰好一个 speaking 节点不成立；改为验证可见课堂 Avatar，同时仍检查全部音频实例的停止。
- 04：路由点击后立即取样，未等 Vue Router 真正离开；改为等待明确的离开 URL 条件，再检查所有实例停止。没有延迟猜测竞争顺序，也没有删除音频停止断言。
- 最终 -05 完整通过。失败均在新增验收脚本取样/选择器，未据此改动生产课堂生命周期。

### 证据文件

- d4-browser.json：场景、请求/响应（认证信息省略）、Console；TTS 音频仅记长度/哈希，不在日志复制整段音频。
- d6-audio.json：逐场景结论、真实媒体事件时间线和实例最终状态。
- backend-http.json、backend-results.json、environment.json：实际 HTTP、危险输出拦截、数据库路径/完整性/摘要。
- d6-actual-playing.png、d6-followup-window.png、d6-paused-late-tts.png、d6-resumed-new-instance.png。
- d4-video/page@c4b491c1d01df7a2604638e89e959d73.webm：实际操作过程，不作为物理音箱证明。

## 未修复/未验收与下一步

1. 生产儿童内容安全仍需要明确的适龄/不适宜内容审核方案与真实模型评测；本轮规则不是完整审核。生产使用不能据此直接封版。
2. 云端持续监听缺少可靠的课堂录音授权、外部处理与保留方案，因此保持封闭。没有改 schema 或代填授权。
3. 前端会取消 HTTP、禁止陈旧音频启动；现有通用 AudioService 对供应商 TTS 使用既有超时，不能保证浏览器断开已经取消供应商任务。未扩展通用语音 API 契约。
4. 真正本地 ASR、实际设备/音箱、远场与回声、外部服务故障/时延、真实自然语音和具体模型嘴部能力未验收；只有基础 speaking 状态，不是音素同步。
5. 原有教师专用语音命令仍使用确认、认证控制通道和 CommandBus；公共儿童通道没有被接到执行器。未扩大旧语音业务支持。

只建议下一步：明确并落实儿童语音/内容安全准入，再用获准环境和合成音频验收真实 ASR→模型→TTS 闭环；不先开展新功能或将模拟验收当作真实课堂可用。
