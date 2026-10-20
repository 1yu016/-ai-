# 数字人课堂对话：逐句朗读与短时追问衔接

2026-10-20，Asia/Singapore。仅 `D:\trae_project\new1\integration-I1`；分支 integration/i1-ab，HEAD 368cf69844776e06ffba2a13973141e9dfb266f0 未变。没有提交、推送或远程同步。

## 功能变化

承接 D4 已完成的课堂上下文流式文字问答，不重做后端，不修改导航。原来等整段回答完成才朗读，现在教师开启“逐句朗读回答”后，完整句子到达即可开始朗读，后续句子有序排队、去重。语音开始事件才驱动既有数字人 tts_start；结束/取消清理并回待机。不是音素级口型或音频流式接口。

增加可选“回答后短时免唤醒追问”：只在已唤醒的本地识别会话中，回答/朗读结束后经过既有 700ms 保护，再开启 10 秒追问窗口。超时回待唤醒；未唤醒的会话不能借此获得提问资格；暂停后不能自动重开。默认关闭，不启用云端持续录音。

暂停、Run/步骤/来源变化、退出、AI 断流、朗读关闭或外部语音接管会失效旧队列。恢复或重新勾选朗读不会补播已取消句子。浏览器接受却不发出开始事件时，8 秒后停止；单句超过 45 秒停止。保留文字和手动操作。

## 本批文件与复用

- 新增 `frontend/src/composables/useDialogueSpeech.ts`：有界句子队列、来源代次、开始/结束、取消/超时；复用 browserSpeech，不新建引擎。
- `frontend/src/services/browserSpeech.ts`：可选 onCancel 通知，防止旧队列超时后清理新语音；已有调用兼容。
- `frontend/src/composables/useClassroomDialogue.ts`：可选流式 partial/start/failure 回调，沿用原请求与取消逻辑。
- `frontend/src/components/classroom/ClassroomDialoguePanel.vue`：接入逐句朗读与短时追问选择；使用既有 Avatar tts 事件。
- `frontend/src/composables/useClassroomListening.ts`、`ClassroomListeningPanel.vue`：显式可选的追问窗口；原 D3 默认仍回待唤醒。
- `frontend/src/services/classroomListening.ts`：将“还有呢”“然后呢”“我发现”等保守追问表达归入问题；教师意图/安全分流优先级不变。
- 新增 `frontend/tests/unit/dialogue-speech.spec.ts`；扩展 `classroom-listening.spec.ts`。没有删除或跳过既有断言。
- 新增 `frontend/tests/acceptance/d5-dialogue-speech.mjs`，扩展既有 D4 浏览器脚本的 opt-in 验收。

未改后端业务源码、接口、Operation Policy、数据库结构、课堂事务/生命周期、Avatar Provider/模型资产或管理员角色权限。

## 本轮真实执行的自动化

外部结果目录：`D:\trae_project\new1\integration-I1-evidence`。

| 命令/范围 | 本次结果 | 文件 |
| --- | --- | --- |
| frontend `npm test -- --pool=vmThreads --maxWorkers=1 --reporter=json --outputFile=../../integration-I1-evidence/d5-full-frontend.json` | 100 文件、790 通过、0 失败/跳过 | d5-full-frontend.json |
| frontend 语音/聆听/组件专项 | 通过；完整回归已包含，不累加计数 | d5-first-tests.json、d5-speech-targeted.json |
| backend `npm test -- --runInBand --runTestsByPath src/ai/ai.service.spec.ts src/ai/classroom-dialogue.service.spec.ts --json --outputFile=D:/trae_project/new1/integration-I1-evidence/d5-backend-unit.json` | 2 套、41 通过、0 失败/跳过 | d5-backend-unit.json |
| backend opt-in `npm run test:e2e -- --runInBand --runTestsByPath test/artwork-real-browser.e2e-spec.ts -t 'D4 contextual' --json --outputFile=D:/trae_project/new1/integration-I1-evidence/d5-http-browser-02.json` | 1 通过、8 非选择场景跳过、0 失败 | d5-http-browser-02.json |

前端 `npm run type-check`、`npm run build-only`、`node node_modules/eslint/bin/eslint.js .` 均本次执行，退出码 0；git diff --check 通过。保留既有 jsdom Canvas 和构建大 chunk 提示。

本轮没有后端实现修改，没有重跑完整后端 unit/E2E 或后端 build/lint；不把 D4 的结果写成本次结果。

新增专项证明：首句先于完整回答朗读；顺序与去重；暂停/关闭/换来源/卸载取消；旧回调失效；其他语音接管后旧清理不干扰新语音；无开始事件超时；换行和尾句；短时免唤醒的有效/超时/未唤醒/暂停边界。

## 隔离浏览器操作和证据

最终根：`D:\trae_project\new1\integration-I1\backend\.tmp\d5-dialogue-20261020-02`。

真实：合成教师登录、当前课堂、HTTP Controller/JWT/权限/cockpit、SQLite、CommandBus 暂停/恢复和 WebGL 数字人渲染。

合成注入：AI provider、SpeechRecognition 构造器/转写、SpeechSynthesis 提交与开始/结束事件。**这不是实际麦克风、真实音箱、真实远场或真实模型质量验收。** 没有调用付费服务，没有保存真实儿童录音。

前端 5189 仅代理隔离后端 3189。应用 synchronize=false、migrationsRun=false，ignoreEnvFile；夹具仅初始化全新空测试库。`environment.json` 保存真实数据库路径/PRAGMA。生产数据库未使用。

| 实际操作 | 结果 |
| --- | --- |
| 登录合成教师，进入课堂，开启自动回答 | 通过：真实后端 |
| 未唤醒输入合成问题 | 通过：无问答请求/语音提交 |
| 唤醒后问题 → 真实流式 HTTP → 逐句合成播放事件 | 通过：受控语音事件；不是实际声音 |
| 朗读提交时尚不显示 speaking；onstart 后 speaking，onend 后待机/下一句 | 通过：实际渲染状态，事件合成 |
| 回答结束后免唤醒说“还有呢” | 通过：新真实 HTTP 使用既有上下文 |
| 普通问答前后 Run、命令、Event、Snapshot 行数及 SHA-256 | 通过：完全相同，无课堂事实副作用 |
| 朗读待播时点真实暂停；注入旧 onstart/onend | 通过：ASR 关闭、队列取消、无重播/说话状态 |
| 真实恢复后不自动开启旧会话 | 通过 |
| AI 上游受控失败后注入旧语音事件 | 通过：不重播，手动文字仍可用 |
| 既有 D4 两轮问题/权限/迟到网络/退出重进回归 | 通过：真实后端，合成 AI |
| 真实原生音频、真实远场/回声、物理口型及音箱 | 未验证；D3 已知原生能力阻塞没有被解除 |

保存文件：

- `d5-speech.json`：逐场景结论、事件时间线、问答前后表摘要。两次识别实例之间明确记录 abort/start；队列播放顺序和迟到事件均有时间点。
- `d4-browser.json`：沿用夹具名称的本轮请求/响应和 Console，不是历史报告。
- `d5-sentence-speaking.png`、`d5-next-sentence.png`、`d5-followup-window.png`、`d5-paused-queue-cancelled.png`、`d5-network-failure-stopped.png`。
- `d4-video/page@adcb72c7660e9c238f24e9e57bfaeb9a.webm`：本轮实际浏览器录像，语音/识别事件合成；不能作为物理声音或音素嘴形证明。
- `backend-http.json`、`backend-results.json`：真实后端请求和数据库完整性，integrity_check=ok，foreign_key_check 无结果。

Console 保留夹具缺失游客迁移/同义词接口 404 与软件 WebGL 提示；无未捕获 pageerror。教师点击的合法暂停/恢复确实写入课堂记录，不能宣称全程零写入。

### 早期失败保留

`d5-dialogue-20261020-01` 与 `d5-http-browser-01.json` 保留：D4 原断言只匹配“识别”，而本轮受控 unavailable 返回“本地中文语言包未就绪”；新增核对 error phase，并匹配真实识别/语言包错误。没有放宽许可、删业务断言或把不可用标为可用。最终轮次以 -02 为准。

## 收尾与限制

- 原 3001 PID 5280、5173 PID 39000 未接管/重启，收尾仍观察到同一 PID。
- 本批测试 Vite PID 54888 在核对命令行后停止；3189 测试后端随夹具关闭，无测试端口监听。证据与合成数据库保留。
- 仅测试 Vite 进程设置 VITE_CLASSROOM_LOCAL_LISTENING=true，且测试浏览器注入识别器；没有写 `.env`，正式构建仍保持未验证原生识别默认关闭。
- 原 A、I-0 备份与恢复目录未写入；所有历史 dirty worktree 保留。
- 免唤醒追问是显式选项和有界本地转写窗口，不是可靠远场唤醒/回声消除；资源自身音频的声学干扰也未验收。
- 数字人复用既有动作/基础嘴部驱动，不新增音素时间轴；真实模型能力差异仍存在。
- 未新增学生大屏跨端字幕/音频同步，不将教师页语音说成学生设备收到/播放。
- 下一步只建议：在指定受支持浏览器与明确授权的模型/语音环境，用合成音频验证真实“提问—回答—逐句发声—追问—暂停”闭环，再决定原生启用范围。本批停止。
