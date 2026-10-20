# D-7 儿童内容准入与真实语音联调

2026-10-20，Asia/Singapore。项目仅 `D:\trae_project\new1\integration-I1`；分支 integration/i1-ab，HEAD 368cf69844776e06ffba2a13973141e9dfb266f0。
用户已确认 Trae 未操作，并明确授权少量现有账号真实服务调用。没有提交/推送/拉取/合并/清理，未改原 A、I-0、正式库或用户服务。

## 1. 实际功能变化

- 教师仍只需一次开启普通问题回答；普通低风险提问不逐条审批。保留手动提问和既有课堂控制。
- 新增课堂对话统一安全准入：输入与完整回答按冻结教案年龄、当前教学步骤和有限历史作语义审核，结合既有规则，不仅依赖关键词。
- 不再让“前一句看似安全”先逃过后续含义检查。上游仍流式生成，但整段审核完成后才把已准入句子通过 NDJSON 下发并依次朗读。此安全取舍会增加首句等待，不宣称逐 token 即时播报。
- 不适宜、审核不可用/超时/无效结果返回预置安全提示或转教师，不朗读未检查的模型原文。前端缺少严格安全标识时拒绝交给朗读回调。
- 麦克风权限在启动前/监听中可检测拒绝或撤销；停止采集、清空回调、移除监听，保留手动输入。界面增加本地监听中提示。
- 持续云端监听仍关闭；未新增声纹、唤醒服务、并行课堂状态机、审批 schema 或业务事实。

## 2. 安全链路与契约

`教师 JWT/班级权限/Operation Policy/Run来源 → 既有规则 → 输入语义审核 → 上游流式生成（服务端缓冲） → 完整回答语义审核 → 再核对 Run/步骤/设备/版本 → 已准入句子 → TTS/实际 playing → Avatar speaking → ended/取消回待机`

统一协调器 `ClassroomContentSafetyService`：

- 复用 HeuristicAssistant 已有 privacy/adult/danger/diagnosis/negative-label/bypass/injection/code 规则，只新增只读规则导出，不改变其历史决策/写入逻辑。
- NFKC/零宽字符归一化；显式风险和个人信息不发送到远端审核器。不是完整脱敏，隐私识别仍可能漏报。
- 输入与完整回答的语义审核复用现有 AiService、方舟账号和模型，不引入新的供应商/数据库。审核模型收到年龄、冻结教案、步骤、文本及历史，按数据处理，不执行其中指令。
- 严格要求恰好五个字段：decision=allow，ageAppropriate/privacySafe/noClassroomAction/contextAppropriate 均为布尔 true。缺字段、多字段、字符串 true、截断、异常和超过 5 秒均不放行；取消/超时传递 AbortSignal。
- 语义审核是独立请求，但目前与回答使用同一配置模型，不是经认证专用儿童审核服务，也不是完整内容安全或事实正确性保证。
- 合法富文本教学内容仅提取文本进入上下文，避免把编辑器段落标签误当危险输出；不改原始教案/运行时快照。

方舟适配使用非思考 JSON 输出；依据官方 [结构化输出说明](https://docs.volcengine.com/docs/ark/structured-output-beta?lang=zh)。仅新课堂对话/审核方法使用相应选项，未改变旧通用聊天或 CommandBus。

NDJSON meta 新增 `safetyContractVersion=1`；delta 必须包含 `safety={contractVersion:1,status:'approved',scope:'whole_reply'}`。不包含可执行命令。固定安全提示为代码内预审文本，不是模型自拟替代答案。输出不放行时 done.route=handoff，前端不把其存为儿童正常对话历史。

新前端对旧的无审核标识响应失败关闭，因此课堂对话前后端应配套升级。未改变 CommandBus 成功/恢复信封、canonical 事务、Run 生命周期和设备在线判定。

## 3. 授权和数据边界

现有 GuardianConsent 有 Voice 类型，但不足以证明整班持续采集、说话者身份、外部处理和保留政策已获准。未将该记录猜成持续监听许可。

- D6 云端持续采集封堵保持；未启用真实儿童公共麦克风上传。
- 本地 ASR 默认仍需已验证部署开关，本轮浏览器只注入合成识别器；不是实际麦克风或声学回声验收。
- 本次真实 ASR 输入是经授权 TTS 生成的单一合成问题 MP3，保存于测试证据目录，不是真实儿童录音；不会产生产品默认录音留存。
- 生产安全协调器不保存音频/转写/Prompt、不打印模型原文、密钥或儿童资料。真实测试只读取所需语音/模型配置项到内存，不复制 .env 或数据库配置。
- 公共提问通道仅问答/分类，未接入奖励、考勤、点名或执行器；教师命令继续既有认证、确认和 CommandBus 校验。

## 4. 真实服务结果与调用预算

用户授权后执行两轮，均为独立 SQLite 和合成账号。不是新建两套框架；复用隔离 HTTP/浏览器夹具。

| 项目 | 实际证据 |
| --- | --- |
| 真实 ASR | 首轮 `/ai/asr` HTTP 200，准确返回“为什么圆形会滚动？请用两句话回答。”；合成问题生成+ASR 共约 13.227 秒 |
| 真实输入审核 | 复验严格五字段 allow；4529ms |
| 真实流式回答 | 实际 SDK 流式生成两句，无 tools，服务端在整段审核前不发模型原文 |
| 真实输出审核 | 完整两句获严格 allow；3445ms |
| 真实 TTS/播放器 | `/ai/tts` 音频实际进入浏览器 HTMLAudioElement，playing 驱动 Avatar speaking |
| 首句延迟 | 19548.8ms，从浏览器提交转写提问到真实 TTS playing，包含 UI/网络/生成/双审核/TTS；不包含先前 ASR 耗时。远未达到自然即时交流体验 |
| 教师打断 | 本地音频实例约 54.1ms 停止（含自动化点击开销），不是物理音箱延迟测量 |
| 真实追加追问 | 为遵守累计预算未在复验继续收费调用；上下文/10 秒追问在本轮隔离合成浏览器中通过 |
| 完整播放 | 本轮合成 PCM 句子有实际 ended/下一句 playing；真实 TTS 因打断未验证整段完整播完 |

累计真实调用：ASR 1 个任务、回答生成 1 次、安全审核 4 次、TTS 3 次（含合成输入问题和首轮固定安全提示）；无自动重试，没有继续耗费调用预算。第二轮明确复用第一轮实际 ASR 结果，没有冒称新 ASR 调用。

### 真实联调失败，不隐藏

- `d7-real-services-test-01.json`：1 失败、9 跳过。ASR/TTS 真实成功，但输入审核没有放行，生成次数为 0，只朗读了固定安全提示；不能称真实问答成功。首轮未记录完整审核诊断，不能仅凭该轮断定是超时还是格式无效。浏览器按异步 response.body 完成计问答也未得到可用完整 body。
- 随后使用官方非思考 JSON 模式，第二轮两个审核均有完整五字段 allow 和服务端 NDJSON 帧证据，浏览器 `d7-real-browser.json` 为 passed；未降低安全判定。
- `d7-real-services-test-02.json`：原 E2E **仍为 1 失败、9 跳过**。原因是测试把浏览器登录和角色加载的合法写入也纳入“整库完全不变”断言。实际变化为 auth.login 审计、refresh token/teacher 登录信息、Avatar 使用日志；冻结版本行是合成夹具准备。
- 已修正测试代码为严格比较九张权威事实表，未删除其中任何表或放宽业务守卫。未再次执行付费整链 E2E，避免超出累计预算；通过独立只读离线 E2E 验证已保存真实调用、实际 SQLite 以及同一套事实比较函数。**不将离线通过称为付费 E2E 重跑全绿。**
- 实际 `environment.json` 的 modelConfigured=false 是旧合成夹具遗留字段，01/02 未正确随真实模式更新；已修正后续生成器，未覆写这两份原始证据。真实调用来源以明确授权、bounded helper、review trace、NDJSON 帧和音频/HTTP 为证，不靠该错误字段推断。

## 5. 本轮测试命令与结果

全部路径相对项目根，结果在 backend/.tmp；以下均本轮实际运行，不引用 D5/D6 历史通过数。

| 命令/范围 | 本轮结果 | 证据 |
| --- | --- | --- |
| frontend `npm test -- --pool=vmThreads --maxWorkers=1 --reporter=json --outputFile=../backend/.tmp/d7-full-frontend.json` | 106 文件、817 通过，0 失败/跳过 | d7-full-frontend.json |
| backend `npm test -- --runInBand --runTestsByPath src/ai/classroom-content-safety.service.spec.ts src/ai/classroom-dialogue.service.spec.ts src/ai/ai.service.spec.ts src/ai/audio.service.spec.ts src/ai/heuristic-operation-policy.spec.ts --json --outputFile=.tmp/d7-final-backend-unit.json` | 5 套、71 通过，0 失败/跳过 | d7-final-backend-unit.json |
| backend E2E 指定 classroom-cockpit.e2e-spec.ts、command-postcommit-fault.e2e-spec.ts | 35 通过，0 失败/跳过 | d7-backend-regression.json |
| 隔离环境变量下 artwork-real-browser.e2e-spec.ts `-t 'D4 contextual'` | 1 通过、0 失败、9 非选中场景跳过；包含 D6 实际媒体/D7 安全场景 | d7-browser-test-final.json |
| 授权真实服务 `-t 'D7 authorized real services'` | 两轮各 1 失败、9 跳过，原因如上，保留原始证据 | d7-real-services-test-01/02.json |
| 设置 D7_RECORDED_ROOT 后 E2E 指定 d7-recorded-real-evidence.e2e-spec.ts | 1 通过，0 失败/跳过；完全离线只读，无新增真实服务调用 | d7-offline-real-evidence-test.json |
| 前后端 type-check / build（前端 build-only）/ lint | 最终退出 0；前端直接调用 eslint，不带 --fix | 工具执行记录；既有 warning 保留 |

未跑完整后端 E2E/unit。保留 Canvas/WebGL/大 chunk 提示，以及既有 growth-goal/snapshot lint 警告。新增测试先缺模块、后 ESM jest 导入漏项失败，另一次命令误引用不存在的 heuristic-assistant.service.spec.ts；均保留 d7-red-safety.json、d7-safety-unit-01/02.json，最终运行真实存在的专项，不删除失败断言。

关键证据：审核失败/无效/超时、隐含危险和分片上下文、审核期间阶段变化、无审核标识不得进入朗读、合法富文本、麦克风权限拒绝/撤销、旧回调清理。模型输出从不进入课堂命令解析。

## 6. 智能体浏览器操作与证据

真实后端/合成 provider 最终根：`D:\trae_project\new1\integration-I1\backend\.tmp\d7-browser-final`。
真实服务根：`D:\trae_project\new1\integration-I1\backend\.tmp\d7-real-services-01` 和 `...\d7-real-services-02`。

登录合成教师后进入 `/classroom/lesson/1`，开启自动回答和逐句朗读，实际点按/提交：

| 场景 | 结果 |
| --- | --- |
| 正常问题、故事、合成唤醒/免唤醒追问与超时 | 通过：真实 HTTP+浏览器，识别与 provider 合成 |
| 明确危险分片；无危险关键词的跨句隐含危险 | 通过：未经审核的首句和尾句均不下发，只有预置安全提示进入 TTS |
| 审核服务受控故障 | 通过：不生成未经检查内容，固定安全提示/手动入口可用 |
| 公共奖励意图 | 通过：无命令执行/新业务事实 |
| TTS 等待时停止、暂停后释放旧响应 | 通过：同步点 gate，旧音频不启动，不用随机 sleep 推断竞态 |
| 实际播放中打断、暂停/恢复、退出重进 | 通过：实际 audio.paused/playing/ended，失效任务不补播 |
| TTS 网络故障+禁用 native fallback | 通过：错误明确，保留文字和手动控制，无自动 HTTP 重试 |
| 浏览器麦克风拒绝/撤销 | 自动化通过；没有物理麦克风验证，不能将 Permissions 事件注入称为真实撤权设备测试 |
| 获准真实 ASR→转写→真实 AI/双审核→真实 TTS→浏览器播放/打断 | 有限通过，来源与两轮复用关系见上；不代表持续拾音/物理设备 |
| 真实多轮追加、真实整段完整发声、真实多设备切换 | 未验证；本轮相应取消/追问由隔离合成或定向测试覆盖 |

文件：

- d7-browser-final/d7-safety.json：场景、TTS 文本、问答前后摘要和时间线。
- d7-browser-final/d6-audio.json：真实媒体元素的逐句 ended、ASR 合成追问/超时和取消记录。
- d7-browser-final/d4-browser.json：请求/响应与 Console；无未捕获 pageerror。保留夹具缺游客迁移、同义词等 404 和软件 WebGL 提示。
- d7-browser-final/d7-safety-redirect.png、d7-tts-unavailable.png、d6-actual-playing.png、d6-followup-window.png。
- d7-browser-final/d4-video/page@1d5a0e76c37857ffb8cc9fee924a0230.webm。
- d7-real-services-02/d7-real-browser.json：真实首句/打断时间线和浏览器状态；部分 DevTools stream body 是 cancelled，不伪造完整响应。
- d7-real-services-02/backend-results.json 的 realReviewTrace/realDialogueFrames：实际完整 NDJSON 服务端帧和真实审核决策。
- d7-real-services-02/d7-real-speaking.png；real-video/page@f56f129d8edbbea7ec406ebe4e517484.webm。
- 各根的 environment.json、backend-http.json、backend-results.json；real-02/d7-offline-verification.json 保存九表实际哈希、完整性与合法变化说明。

运行数据库路径均为相应根内 acceptance.sqlite，实际 PRAGMA 可核对。运行时 DB_SYNCHRONIZE=false、DB_MIGRATIONS_RUN=false，ignoreEnvFile；仅新测试库由夹具初始化既有实体结构，无生产迁移。.env 未修改，原 app.sqlite 未使用。

收尾已完成：仅停止本批 Vite PID 60684（先核实命令行），测试后端随夹具关闭，3189/5189 无监听。原 3001 PID 43644、5173 PID 39000 前后相同。HEAD 未变、暂存区无变更，git diff --check 通过，既有换行警告保留。全部原始 dirty worktree、失败证据和测试数据库保留，未清理用户资源。

## 7. 修改文件（仅本轮，不代表整个 dirty worktree）

实现：

- backend/src/ai/classroom-content-safety.service.ts（新增）
- backend/src/ai/classroom-dialogue.service.ts
- backend/src/ai/ai.service.ts、ai.module.ts
- backend/src/ai/heuristic-assistant.service.ts（仅共享常量导出）
- frontend/src/services/classroomDialogue.ts
- frontend/src/composables/useClassroomListening.ts
- frontend/src/components/classroom/ClassroomDialoguePanel.vue、ClassroomListeningPanel.vue

测试/报告：

- backend/src/ai/classroom-content-safety.service.spec.ts（新增）、classroom-dialogue.service.spec.ts
- backend/test/artwork-real-browser.e2e-spec.ts
- backend/test/d7-recorded-real-evidence.e2e-spec.ts（新增）
- backend/test/helpers/d7-authorized-services.ts、d7-business-facts.ts（新增）
- frontend/tests/unit/classroom-dialogue.spec.ts、d7-microphone-permission.spec.ts（新增）
- frontend/tests/acceptance/d4-dialogue-browser.mjs、d7-safety-browser.mjs（新增）、d7-real-services-browser.mjs（新增）
- docs/D7_CHILD_SAFETY_AND_REAL_VOICE.md（本报告，新增）

## 8. 剩余问题与下一步

1. 首句真实实测约 19.55 秒，不达到自然交流体验；安全门不能为降低延迟而绕过。下一步优先优化审核/生成/TTS延迟预算，并用语义危险样本验证不降级安全。
2. 当前语义复核不是全面审核/事实核验，可能误报漏报；同一供应商/配置模型存在相关失误风险，尚无足够真实幼儿适龄/危险语料评测、压力/断网实设备证据，不能生产封版。
3. 整班持续监听授权、说话者/监护人关联、外部数据保留规则仍不足，云端持续监听维持关闭。真实麦克风、远场/回声、真实音箱、物理大屏 ACK、音素口型均未验收。
4. 本地取消已阻止旧语音；现有通用 AudioService 仍不能保证浏览器断开就撤销供应商合成任务。未扩大通用语音接口契约。
5. 真实 E2E 已修正整库零写入测试边界，但为守住累计费用预算未重跑；离线证据验证通过，不能据此声称所有真实联调测试全绿。

完成后停止，不继续下一阶段。
