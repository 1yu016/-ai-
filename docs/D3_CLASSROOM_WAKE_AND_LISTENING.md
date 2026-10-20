# D-3 数字人语音唤醒与课堂聆听

2026-10-19；工作目录 `D:\trae_project\new1\integration-I1`。阶段五（数字人）/阶段六（课堂语音）。本批停止，不进入 D-4。

## 结论先行

完成了教师互动入口、可取消聆听会话、本地转写匹配唤醒词的原型、保守分流、手动备用和自动化。**真实音频唤醒未通过验收，不能将 D-3 整体标为完成封版。**

当前捆绑测试浏览器 HeadlessChrome/153.0.8010.12：

1. `SpeechRecognition.available({langs:['zh-CN'],processLocally:true})` 导致页面崩溃；登录页独立复现，不需要课堂、麦克风或业务数据库。
2. `getUserMedia` 在默认合成设备及离线 WAV 输入两种配置下均返回 `NotSupportedError`。

为避免未经验证的实验能力中断正常课堂，正式构建默认不探测原生识别。需要 `VITE_CLASSROOM_LOCAL_LISTENING=true` 才会进入本地能力检查；该配置只在本批专用模拟测试 Vite 进程使用，未写任何 `.env`。**当前测试浏览器不能因此获准原生上线**。默认情况下教师获得明确提示及手动输入备用，不打开麦克风。

## Before / After 与使用方式

以前：需要每次点击录音；没有公共麦克风的唤醒及只读分流边界。

现在：教师课堂页右侧有“课堂唤醒与聆听”，可以配置“小星小星”等唤醒词，一键开启/关闭。只有经部署验证且语言包已存在的本地识别实现才可持续识别。唤醒后进入 10 秒聆听窗口，每次有效转写后重新计时；静默超时回到待唤醒。

- 普通问题：只显示“收到问题”，准备到现有教师助教输入，等待教师操作；不自动调用 AI、不自动 TTS。
- 疑似教师命令：只提示老师从已有控制通道操作，不自动执行，不将公共麦克风说话者视为已认证教师。
- 无法理解：请重新表达。
- 隐私/风险/身份冒称等本地规则命中：请教师接手，路由不带原文。
- 暂停、终态、课间、恢复受限状态、Run/步骤/设备/角色来源变化、页面隐藏、组件销毁：关闭并取消旧会话。暂停恢复后需老师重新开启，避免暗中重启麦克风。
- 数字人讲话期间：中止识别，失效旧回调；结束后经过 700ms 保护回到待唤醒，不恢复旧唤醒窗口。只是回声风险缓解，不是可靠远场回声消除。
- 其他现有录音入口开始时关闭公共监听，避免争用；资源音频与 ASR 引擎未重写。
- 切换来源会清空公共问题的本地草稿和显示，避免带入新课堂。

## 本地性与隐私边界

现有 `backend/src/ai/audio.service.ts` 的 `/ai/asr` 使用外部语音服务，本批没有复用它做持续监听，也没有调用任何外部/付费 ASR、AI 或 TTS。

本批 adapter 仅接受标准 API 中明确支持 `processLocally`、并且 `available({processLocally:true}) === 'available'` 的实现。不会使用默认远端识别、prefixed/cloud-only 后备，也不调用语言包 install。

这仍是 **整句本地转写后匹配词的实验原型**，不是专用低功耗唤醒模型。本地“待唤醒”期间仍由浏览器持有麦克风；需要教师主动开启、可随时关闭。没有原始录音保存、上传、localStorage 或服务端转写日志。少量问题文本仅停留在当前页面内存；本地规则不是完整儿童安全或完整脱敏保证。

API 行为依据：

- <https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/processLocally>
- <https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/available_static>

`processLocally=false` 默认不能证明离线；语言包可用性与麦克风权限也不是同一事实。不能把 API 属性存在当成原生识别已经可用。

## 架构与修改文件

只改独立集成前端及必要测试/报告，不改后端源码、数据库结构、班级角色权限、Operation Policy 或 CommandBus。

| 文件 | 用途 |
| --- | --- |
| `frontend/src/services/classroomListening.ts` | 纯分流、标准本地识别 adapter、默认关闭的实验开关；无 HTTP/Executor/AI fallback |
| `frontend/src/composables/useClassroomListening.ts` | 可取消麦克风会话、来源代次、真实 onstart、超时、有限重启、回声挂起与清理 |
| `frontend/src/components/classroom/ClassroomListeningPanel.vue` | 教师开关、状态、唤醒词、手动备用、问题/接管提示；不是儿童控制面板 |
| `frontend/src/views/LessonClassroomView.vue` | 现有课堂阶段输入和数字人表现，问题进入待教师处理字段，来源变化清草稿 |
| `frontend/tests/unit/classroom-listening.spec.ts` | 会话及权限/隐私/来源边界，18 项 |
| `frontend/tests/component/classroom-listening-panel.spec.ts` | 手动问题只准备、跨来源清除、禁止阶段不可提交，1 项 |
| `frontend/tests/acceptance/d1-browser.mjs` | 复用既有真实后端夹具的 opt-in D3 浏览器入口和录像，不将 D-1 历史结果冒充本轮 |
| `frontend/tests/acceptance/d3-listening.mjs` | 真实教师页面、明确注入转写、可控时钟、零写入断言、真实暂停/恢复 |
| `frontend/tests/acceptance/d3-native-probe.mjs` | 独立无录音的原生语言包能力崩溃证据 |
| `frontend/tests/acceptance/d3-audio-probe.mjs` | 浏览器捕获 API 的两种合成输入兼容性证据 |

会话状态仅是麦克风协议，不是第二套课堂状态机。阶段来自现有 running/teaching、break/recovery，来源关联包含路由 Run、权威 Run/device/step/AvatarIdentity。每个原生捕获实例还必须与当前实例相同；自然重启后的旧实例回调也不得路由。识别回调不能改变后端阶段或权限。复用 `routeTeacherVoiceCommand` 仅做可能意图识别，不调用其 Executor。

## 本次自动化

- 初始定向（监听 + I-2-3B + D-2）：3 文件、27 通过。
- 完整前端：**97 文件、769 通过、0 失败、0 跳过**。新增 D3 单元/组件 19 项。`d3-frontend-release.json` / `d3-frontend-verified.json` 保存清草稿和路由复核阶段的结果；最终捕获实例级保护以 `D:\trae_project\new1\integration-I1-evidence\d3-frontend-current.json` 为准。
- 中间完整前端 764、767、768 通过的 JSON 均另存，不能把不同轮次相加冒充覆盖数。
- 后端定向：`avatar.e2e-spec.ts classroom-run.e2e-spec.ts classroom-run-legacy.e2e-spec.ts`，3 套、140 通过、0 失败；`D:\trae_project\new1\integration-I1-evidence\d3-backend-targeted.json`。
- 前后端 type-check、build、lint 均执行通过；前端 lint 使用 eslint 无 --fix。
- 前端保留 jsdom canvas 警告、构建大 chunk 提示；后端 lint 退出码 0，保留 6 条既有警告（Snapshot spread 与历史测试未用 import）。不声称无警告。
- 未跑完整后端 unit/E2E。本批没有后端业务修改，运行相关定向回归及静态检查。

覆盖：未唤醒不路由、有效唤醒、连续窗口/超时、问题/教师意图/接管/不理解、权限/网络错误、暂停/终态/Run/设备/步骤/卸载、旧能力查询及识别回调、数字人讲话抑制、有限自然重启、本地语言包与默认关闭边界。同步点/假时钟用于竞态，不靠随机 sleep。

## 浏览器实际操作与范围

使用真实后端 Controller/Service、全新 SQLite、合成管理员/教师/两班级/教案。前端 5189 → 后端 3189。运行应用 `DB_SYNCHRONIZE=false` / `DB_MIGRATIONS_RUN=false`；既有夹具只初始化新空测试库，不执行迁移、不修改正式 schema。PRAGMA database_list 保存实际路径。

最终模拟根：`D:\trae_project\new1\integration-I1\backend\.tmp\d3-browser-20261019-07`。

| 场景 | 结论 |
| --- | --- |
| 真正本地中文识别 | **阻塞**：原生 availability 导致当前测试浏览器页面崩溃，独立登录页复现 |
| 真正浏览器音频输入 | **阻塞**：默认假设备和离线 WAV 均 NotSupportedError；未使用物理麦克风 |
| 真实原生权限拒绝 | **未验证/阻塞**：捕获本身不可用，不能将其他错误包装成权限拒绝 |
| 手动备用输入 | 真实页面通过；只准备问题，无 AI 请求 |
| 开启一次、未唤醒不路由、唤醒后听、连续问题 | **模拟转写通过**；页面真实、后端真实，但识别构造器/转写为合成注入 |
| 奖励、翻页、“我是老师” | 模拟转写只提示教师处理/接管；该阶段 POST 数量不增加 |
| 超时 | 可控时钟通过，回待唤醒，未重新执行旧内容 |
| 数字人讲话与旧回调 | 合成 speaking 事件与旧识别回调验证挂起/失效；不代表真实远场回声处理 |
| 暂停、恢复 | 真实后端 HTTP 通过；关闭监听，恢复不自动开启 |
| 识别网络错误、权限错误 | **模拟识别器错误事件通过**；没有真实云端识别连接 |
| 退出与重新进入 | 真实路由退出后 abort，重新进入保持关闭 |
| 两班级、角色切换、模型失败 | 复用 D1 场景本轮执行通过；来源变化单元测试另证实旧回调不能路由 |

最终 opt-in 浏览器测试执行结果：1 通过、7 非选择跳过。这是**受控模拟分流流程及真实班级 HTTP 流程的测试通过，不是原生语音或 D3 整体验收通过**。

最后跨课堂清草稿的 reset 事件、路由 Run 复核及自然重启捕获实例复核在该轮浏览器之后补齐，有新组件/单元断言及最终完整前端回归；没有声称这些最后保护重新做过浏览器。

## 失败记录与处理

所有轮次独立目录，不覆盖失败证据：`backend/.tmp/d3-browser-20261019-01` 至 `-07`。

- 01：原生检查时浏览器内部断言/进程失败；没有完整监听 JSON，仅有该轮截图、后端记录与数据库。
- 02：原生页面崩溃，`d3-listening.json`、独立 `d3-native-probe.json` 保留。识别 UI 不能通过，故后续只对明确模拟场景注入 unavailable，不修改或伪装原生实现。
- 03：真实 getUserMedia 不支持，早期流程失败；独立 `d3-audio-probe.json` 证实两种合成输入均不可用。
- 04：原生权限拒绝断言得到 NotSupportedError 而失败。后续将缺少音频能力的权限场景标为阻塞，仅能力存在时才执行原 NotAllowedError 断言，不声称通过。
- 05：推进超时时钟也使既有 allowedActions TTL 失效，暂停没有发出。改为先点击现有只读刷新，未放宽政策守卫。
- 06：过宽的“任何 /ai 请求都不得存在”断言命中了既有 **GET /ai/command-synonyms**。保留失败；准确要求是不得新增 ASR/AI/执行 POST，最终断言相应约束 POST，不禁用既有只读配置查询。
- 07：模拟分流/真实班级场景通过，原生阻塞保持不变。没有靠云端回退、改变权限或把阻塞改成通过来完成测试。

## 证据

最终根 `...\backend\.tmp\d3-browser-20261019-07`：

- `d3-listening.json`：9 类结果，其中 6 类受控流程通过，3 类原生/捕获相关阻塞；请求、来源与转写/取消时间线。
- `d3-awake.png`、`d3-not-awake.png`、`d3-teacher-only-no-write.png`、`d3-class-paused.png`、`d3-network-error.png`：实际教师界面，唤醒截图属于模拟转写。
- `d3-video/page@74077999f6a83e9972dd361e12d213b5.webm`：实际浏览器操作录像，含模拟识别，不能证明真实声学唤醒。
- `d1-browser.json`：沿用夹具命名的本次真实 HTTP/Console/WebGL 日志，不是历史 D1 通过报告。
- `backend-http.json`、`backend-results.json`、`environment.json`：后端请求、表摘要、PRAGMA 路径、数据库完整性。
- 原生识别证据在 `-02/d3-native-probe.json`；合成音频捕获证据在 `-03/d3-audio-probe.json`。

最终库 integrity_check=ok、foreign_key_check 无结果。个人/集体奖励、正式考勤、正式点名记录均为 0，空集摘要均为 `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`。公共意图阶段无 POST；之后两条 /classroom-commands POST 是老师实际点击暂停与恢复，不来自公共麦克风。Run/Event/Snapshot 的正常建课、开场、暂停恢复变化不能谎称为全程零写入。

Console 保留夹具缺少的既有 GET/游客迁移等 404、受控模型失败和软件 WebGL 警告；模拟最终流程无未捕获 pageerror。不声称 Console 无任何错误。

## 环境保护与剩余

- `d3-original-final.json`（外部证据目录）preservation 与 D2 相同：original/restore 各 1320 路径、1331 备份产物，HEAD/index/status 等保持。仅已有 ClassroomPartnerPanel BOM 差异，无新源码变化。
- 测试 Vite PID 17532 / 44148 均仅按核实的本批命令停止；各测试后端自动关闭。3189/5189 已释放，证据/临时数据库保留。
- 3001 开始为 PID 21796，收尾为 PID 14780，17:50:09 创建，命令行指向原 A backend/dist/main，父 PID 35184。**本批没有向它发送停止/启动操作；原因未确认，不能声称原服务 PID 从未变化。** 5173 始终观察为 PID 39000。集成 src/dist 非链接，构建 outDir=./dist；没有对原服务作进一步干预。
- 无 commit/push/pull/merge，无 .env/schema/后端业务/正式数据库修改，无收费调用；不使用真实儿童语音。
- 真实本地唤醒、中文识别质量、远场/噪声/回声、物理麦克风/大屏以及长时间识别稳定性未验收。原生能力尚不可作为正式课堂已交付功能。

## D-4 建议（只建议，不实施）

先在指定受支持浏览器/合法本地识别引擎上消除上述阻塞并完成真实合成语音端到端验证，确定数据最小化与中断契约；再接教师可控的流式问题回答。继续将公共问题与教师命令彻底分开，保留请求来源/取消代次、回声挂起和默认不执行。不能在唤醒仍未验收时直接宣称具备可靠自然远场对话。
