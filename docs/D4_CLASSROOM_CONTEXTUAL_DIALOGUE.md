# D-4 课堂连续流式文字问答节点

日期：2026-10-20（Asia/Singapore）。仅独立集成目录。分支 `integration/i1-ab`，HEAD `368cf69844776e06ffba2a13973141e9dfb266f0` 未变；没有 commit/push/pull/merge。

## 本次产品变化

课堂进入正式教学后，教师在右侧“数字人课堂对话”开启一次“普通问题自动回答”，即可手动连续提问；在经过部署验证的本地识别环境中，也可以沿用 D-3 唤醒/聆听入口。

普通问题不再每轮交给教师确认。回答按句流式显示，保留当前环节最近八条用户/助手消息。教师可选“回答完成后浏览器朗读”，并停止回答与朗读。暂停、换步骤、Run/设备/角色来源变化、页面隐藏与卸载取消旧任务；暂停恢复不自动重新开麦或重播旧回答。

这是**流式文字 + 完整回答后的可选浏览器朗读**，不是流式音频。当前节点不等于可靠远场自然对话已经完成。没有改动导航/工作台/开课布局。

## 权威来源与契约

- 新增 `POST /classroom-runs/:id/dialogue`，教师 JWT + 现有 ThrottlerGuard；输入 requestId、stepIndex、text、有限 history，不接受客户端教案/年龄或课堂操作工具。
- NDJSON v1：meta（request/run/step/version/route）、delta（完整句）、done（完整回答）或 error。HTTP 401/403/409/400 在流打开前拒绝；流中失败返回 DIALOGUE_INTERRUPTED，不把 HTTP 200 误当回答完成。
- 复用 ClassroomCockpitService：教师本人及班级访问、阶段、break、recovery、运行时步骤；不调用可能结算/恢复的完整 get/restore，也不建立新课堂状态机。
- 教案标题/目标来自冻结历史版本，步骤来自 RunStepSnapshot；年龄从该 Run 关联 LessonPlanVersion.snapshotJson 读取。缺失时标 unknown/null，不回退当前最新教案。
- 每次输出句子及结束前复核权威上下文；Run version、设备或版本变化即中断。保守策略：即便其他合法课堂写入引起版本变化，也会要求重新提问，而非继续输出来源不确定的回答。
- 公共问题、疑似教师操作、不理解/需教师接管分开。公共通道没有 Executor、CommandBus 写入、工具执行或奖励/考勤/点名能力。教师操作沿用原有认证控制入口，本批不实现命令补参对话。
- OpenAI-compatible SDK 复用原有 ARK 配置，新增 stream:true 调用、AbortSignal、无 tools；没有更换 Provider、语音引擎或数据库结构。没有记录完整 Prompt 或原始录音。
- history 仅当前页面内存、最多八条；服务端再按 DTO 与额外隐私/意图规则过滤。输入/输出规则只是额外防线，**不是完整脱敏或全面儿童安全审查保证**。生产模型的内容质量与隐私适用性仍需独立验证。
- requestId 是瞬态问答关联，不是新的持久业务回执。断流不会自动重试，也不宣称恢复了未完成的 AI 回答；已冻结 CommandBus 回执与恢复信封不变。
- 朗读使用既有 browserSpeech 独占/取消代次保护，开始/结束驱动现有数字人 tts 事件。不是音素级口型。浏览器声音的本地性/可用性取决于系统语音实现，不能凭此保证完全离线或物理发声。

## 本批修改文件

后端新增：

- `backend/src/ai/dto/classroom-dialogue.dto.ts`：长度、角色、历史数量限制。
- `backend/src/ai/classroom-dialogue.service.ts`：只读课堂上下文、安全分流、逐句输出和中断。
- `backend/src/ai/classroom-dialogue.controller.ts`：鉴权、NDJSON、连接关闭和 45 秒取消。
- `backend/src/ai/classroom-dialogue.service.spec.ts`：上下文、阶段、来源变化、SDK stream/abort、公共意图与历史规则测试。

后端最小接入：`ai.module.ts` 注册；`ai.service.ts` 新增流式方法；`classroom-run.module.ts` 仅导出既有 cockpit service。未修改课堂状态机、Operation Policy、canonical 事务、CommandBus 执行或回执。

前端新增：

- `frontend/src/services/classroomDialogue.ts`：真实 NDJSON 解析，UTF-8 分片、来源与完成验证；无自动重试。
- `frontend/src/composables/useClassroomDialogue.ts`：请求实例、八条历史、取消与迟到保护。
- `frontend/src/components/classroom/ClassroomDialoguePanel.vue`：一次开启、流式文字、朗读选择、降级反馈。
- `frontend/tests/unit/classroom-dialogue.spec.ts`、`frontend/tests/component/classroom-dialogue-panel.spec.ts`。
- `frontend/tests/acceptance/d4-dialogue-browser.mjs`：真实后端浏览器操作、网络延迟同步点、数据库只读取证。

沿用并局部修改 `ClassroomListeningPanel.vue`（autoAnswer/compact 可选，默认仍保留 D-3 语义）、`classroomListening.ts`（普通故事请求路由）、`LessonClassroomView.vue`（替换右侧入口，沿用来源和阶段输入）。未改学生大屏路由/生命周期。

扩展已有 `backend/test/artwork-real-browser.e2e-spec.ts` 的 opt-in D4 测试，沿用隔离数据库/真实 HTTP 夹具，未覆盖历史测试或失败目录。

## 本次实际执行的自动化

证据目录：`D:\trae_project\new1\integration-I1-evidence`。以下为本轮结果，不是历史通过数，也不将多轮结果相加。

| 范围与实际命令 | 结果 | 结果文件 |
| --- | --- | --- |
| frontend: `npm test -- --pool=vmThreads --maxWorkers=1 --reporter=json --outputFile=../../integration-I1-evidence/d4-full-frontend-final.json` | 99 文件，780 通过，0 失败/跳过 | d4-full-frontend-final.json |
| backend: `npm test -- --runInBand --runTestsByPath src/ai/ai.service.spec.ts src/ai/classroom-dialogue.service.spec.ts --json --outputFile=D:/trae_project/new1/integration-I1-evidence/d4-ai-unit-verified.json` | 2 套，41 通过，0 失败/跳过 | d4-ai-unit-verified.json |
| backend: `npm run test:e2e -- --runInBand --runTestsByPath test/classroom-cockpit.e2e-spec.ts test/classroom-run.e2e-spec.ts test/classroom-run-legacy.e2e-spec.ts --json --outputFile=D:/trae_project/new1/integration-I1-evidence/d4-classroom-regression-final.json` | 3 套，145 通过，0 失败/跳过 | d4-classroom-regression-final.json |
| backend: `npm run test:e2e -- --runInBand --runTestsByPath test/command-postcommit-fault.e2e-spec.ts --json --outputFile=D:/trae_project/new1/integration-I1-evidence/d4-recovery-regression.json` | 20 通过，0 失败/跳过 | d4-recovery-regression.json |
| opt-in 真实 HTTP + 浏览器：`npm run test:e2e -- --runInBand --runTestsByPath test/artwork-real-browser.e2e-spec.ts -t 'D4 contextual' --json --outputFile=D:/trae_project/new1/integration-I1-evidence/d4-http-browser-final.json` | 1 通过，8 非选择场景跳过，0 失败 | d4-http-browser-final.json |

前端实际执行 `npm run type-check`、`npm run build-only`、`node node_modules/eslint/bin/eslint.js .`，退出码均 0。后端实际执行 `npm run type-check`、`npm run build`、`npm run lint`，退出码均 0。`git diff --check` 通过。

保留 jsdom Canvas 提示、前端构建大 chunk 提示、后端六条既有 lint 警告；故障注入中的预期 ERROR 日志不等同测试失败。未运行完整后端 unit/E2E，本轮为相关定向回归。

### 早期失败记录（未删除）

- `d4-first-frontend.json`：测试环境没有 ReadableStream；改测试使用 Node Web Stream，并匹配 DOM 类型，不放宽断流/来源断言。
- 首次后端单元因 ESM 缺少 jest import 失败；还因输出文件目录参数写错，未生成该轮 JSON。错误存在操作记录，不伪造结果文件；后续修正测试 import 和绝对输出路径。
- `.tmp/d4-dialogue-20261020-01` 与 `d4-http-browser-01.json`：测试误用 expectedVersion，真实 DTO 要求 version + deviceId；400 后受控 gate 未释放触发关闭超时。修正测试请求及失败清理，无业务守卫变更。
- `-02` 与 `d4-http-browser-02.json`：暂停已正确清除整个回答区域，测试错误要求不存在的节点含空文本；改为验证节点数量为 0，保留旧回答不得显示的断言。
- `d4-backend-regression.json`：误填不存在的恢复测试文件名；其余三套 145 项通过，但该轮整体失败。后续使用实际 `command-postcommit-fault.e2e-spec.ts` 执行，并单独重跑三套课堂回归。
- `-03` 与 `d4-http-browser-03.json`：流程通过；最终紧凑输入及新增 DTO 断言以 `-04` 和 final 结果为准。

## 浏览器真实操作与数据库证据

最终隔离根：`D:\trae_project\new1\integration-I1\backend\.tmp\d4-dialogue-20261020-04`。

- 前端 127.0.0.1:5189 → 后端 127.0.0.1:3189；`environment.json` 记录实际 src/ts-jest 后端、PID、PRAGMA database_list 和连接路径。仅合成教师/学生/课堂。
- 实际库 `acceptance.sqlite` 位于该根目录。应用 synchronize=false、migrationsRun=false；夹具仅初始化新空测试库的现有实体，不改正式 schema，不运行迁移，不读取原 `.env`。
- **真实** Controller、JWT、班级权限、cockpit、暂停/恢复、SQLite 与浏览器操作；**合成** AI provider、问题与内容。未调用外部/付费 AI。不能据此宣称真实模型质量已验收。
- 教师通过真实登录页进入课堂、勾选自动回答，输入两轮问题；打开原型麦克风设置检查不可用提示；点击暂停/恢复；离开并重新进入。

| 场景 | 结论 |
| --- | --- |
| 两轮上下文流式回答，普通问题无需再次教师确认 | 通过（真实 HTTP，合成 AI） |
| 普通问答前后 Run、命令、Event、Snapshot 行数和 SHA-256 完全相同 | 通过 |
| 公共奖励意图不调用执行入口、不新增 POST/事实 | 通过 |
| AI 中途失败显示未完成，不自动重试、不朗读残缺回答 | 通过（真实 HTTP，受控上游故障） |
| 未认证/越权/过期步骤/不合法 history role | 通过（401/403/409/400，真实 HTTP） |
| 后端在受控生成 gate 等待时真实暂停，后续句子被拒绝 | 通过（同进程隔离应用/数据库，不是多进程验证） |
| 真实上游 HTTP 响应在浏览器网络边界延迟，暂停后旧回答丢弃 | 通过（不是随机 sleep，不伪造接口结果） |
| 恢复不自动开启，手动重新开启后可再次提问 | 通过 |
| 离开/重新进入不重播旧任务 | 通过 |
| 默认不启用未经验证的原生 ASR，手动问题仍可用 | 通过（不代表真实麦克风通过） |
| 真实远场、原生中文识别、物理音箱、大屏音频、真实模型质量 | 未验证；D-3 原生能力阻塞保持 |

`backend-results.json`：integrity_check=ok，foreign_key_check 无结果。问答本身无课堂写入；老师点击暂停/恢复的正常 Run/Event/Snapshot 变化不能宣称全程零写入。

`d4-browser.json` 保存逐场景结果、真实请求/响应、原 requestId、数据库摘要和 Console；无未捕获 pageerror。保留既有夹具缺失游客迁移/命令同义词接口的 404 和软件 WebGL 警告，不声称 Console 完全无错误。

截图：`d4-answer.png`、`d4-provider-error.png`、`d4-paused.png`、`d4-resumed.png`。

录像：`d4-video/page@26062888c6cbe1dde2b9351f250989db.webm`。只证明浏览器操作和文字状态，不证明物理发声。

`backend-http.json` 保存后端请求日志，`d4-browser-stdout.log` 保存浏览器执行输出。

## 保护与剩余

- 本批 Vite PID 55404，核实其命令确为本项目 5189 后才停止。临时后端在测试结束关闭；3189/5189 无监听。保留证据和测试库，没有清理用户数据。
- 原有 3001 PID 5280、5173 PID 39000 指向原 A 项目，本批未接管/重启，收尾仍观察到相同 PID；未访问正式数据库。
- 原 A/I-0/恢复目录未写入；已有 dirty worktree 与历史报告保留。教师导航/工作台/开课文件仍无本轮差异。
- 真实模型内容安全/适龄性、真正本地唤醒、回声抑制、稳定远场、流式音频、物理设备和多进程/压力没有通过本次验收。
- 对话暂在教师控制端，未增加学生大屏的跨端对话字幕/音频同步；不把本页朗读说成大屏已播放。
- 教师操作仍用原有控制/语音确认入口；公共对话不执行操作，也尚未提供面向教师命令的缺参澄清链。
- 下一项只建议：在明确授权的测试模型和支持的本地语音环境中，用合成音频完成真实提问—回答—朗读—暂停中断验证，再决定流式音频方案。本批停止，不自动实施。
