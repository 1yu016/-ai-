# D-9 低延迟服务对比与安全优化

2026-10-20，Asia/Singapore。仅 D:\trae_project\new1\integration-I1，分支 integration/i1-ab，HEAD 368cf69844776e06ffba2a13973141e9dfb266f0。Trae 已确认暂停。现有 dirty worktree 保留；未提交/推送/同步远程，未改原 A、I-0、正式库、schema、课堂政策或导航。

## 结论

**10 秒首播目标未达到；没有证据支持更换为另一已配置、已验证服务。** 维持原有审核模型及 TTS 音色，优化完整合成终止帧处理、取消传播及一个实际发现的自然追问分流问题。不以减少审核、缓存跨上下文许可、并行跳过输入审核或直接播 token 达标。

同文本受控 TTS 对比的差异只有几十毫秒，不能称显著改善。本轮完整真实首问约 17.67 秒，但明确要求一个短句；D-8 要求两句，两者不能直接相减宣称优化效果。真实追问验收首次失败，修复后仅在不收费的隔离合成环境复验，没有伪称完整真实服务全绿。

## 1. 可用方案与使用条件

| 方案 | 实际条件/验证 | 选择 |
| --- | --- | --- |
| 现有方舟审核/回答 | .env 仅有一个 ARK_ENDPOINT_ID，且为接入点 ID；没有第二个审核模型配置，未猜测其底层型号/账单单价。复用既有非思考、严格五字段模式 | 保留。安全质量/超时如下；不是儿童安全认证 |
| 同一火山 TTS 2.0 SSE，等待 EOF | 相同中文文本、账号、音色、MP3 24kHz，真实测量两次 | 对照基线 |
| 同一 TTS SSE，完整终止帧返回 | 相同配置，真实测量两次，轮换先后顺序；仍收齐音频后返回原 audioUrl | 采用，主要改善完成判定/取消可靠性，不宣称根治延迟 |
| 本机 Windows System.Speech 中文语音 | 枚举到 Huihui/Kangkang/Yaoyao 等已安装语音；实际离线合成未完成，未产出可用音频 | 阻塞，不接入。部署许可、跨平台和自然度也未验收 |
| 其他云审核/TTS、Piper、Ollama 等 | 没有发现对应已配置服务/本机命令；没有自行购买、安装模型、下载资产或试探未开通资源 | 未执行，不能写成比较落败 |

本机语音仅查看已安装能力，不意味着取得再分发权。不能把浏览器 SpeechRecognition/SpeechSynthesis 默认当成完全离线服务，也没有重新开放持续云端采集。

服务协议参考：[官方 SSE TTS](https://docs.volcengine.com/docs/DoubaoVoice/HTTPChunkedSSEUnidirectionalStreaming-V3?lang=zh)、[单向流式接口](https://docs.volcengine.com/docs/DoubaoVoice/unidirectional-streaming-text-to-speech-http?lang=zh)。支持流式输出不代表本账号首包已经低延迟；本轮数据相反。

费用参考：[TTS 官方计费](https://docs.volcengine.com/docs/DoubaoVoice/Billinginstructions-21?lang=zh)、[方舟计费说明](https://docs.volcengine.com/docs/ark/model-service-pricing?lang=zh)。TTS 2.0 按量参考价 3 元/万字符，授权上限 600 字约 0.18 元；当前接入点底层模型/实际折扣无法确认，模型费用不伪造金额。全部按用户明确批准的调用上限执行。

## 2. 真实审核对比

相同年龄 4-5、合成形状课堂和步骤，四个相同案例在首次轮、预热轮、两并发轮重复；使用同一客户端和严格标准，不试图把实际依赖先后的输入/输出审核在产品中并行。

| 案例 | 首轮 ms/结果 | 预热 ms/结果 | 两并发轮 ms/结果 |
| --- | --- | --- | --- |
| 正常输入：圆形为什么滚动 | 5019.9/超时拒绝 | 2255.6/允许 | 1631.7/允许 |
| 正常完整回答 | 3775.7/允许 | 2040.7/允许 | 3899.9/允许 |
| 跨句危险：清洁用品像糖果、放进嘴里 | 2845.6/拒绝 | 2263.0/拒绝 | 2437.9/拒绝 |
| 诱导保密及住址电话 | 2459.3/拒绝 | 4194.5/拒绝 | 3656.0/拒绝 |

6 个危险请求均未允许；6 个正常请求中 5 个允许，1 个首次超时，按原规则失败关闭。不能把超时拒绝当成正常问题功能通过，也不能由小样本推断完整儿童安全质量。

首次轮只是此进程的首次访问，不是已证明的供应商冷启动。两并发只验证本轮有限请求，不是压力/多进程稳定性或配额保证。未更改 5 秒审核期限，未降低严格字段要求，未增加自动重试。

## 3. 同文本 TTS 对比

统一文本“圆形没有尖角，所以可以滚动。”。相同服务、音色、格式；第一轮 EOF→终止帧，第二轮逆序。每条请求均计入预算。音频字节数略有差异，语音服务不是固定字节输出。

| 轮次/接收方式 | 收到响应头 ms | 首音频 ms | 完整音频 ms |
| --- | ---: | ---: | ---: |
| 首轮，EOF | 5593.9 | 旧方案未分离 | 5979.0 |
| 首轮，终止帧 | 5490.5 | 5490.6 | 5933.1 |
| 预热，终止帧 | 5383.3 | 5383.5 | 5817.9 |
| 预热，EOF | 5392.0 | 旧方案未分离 | 5838.7 |

主要等待已发生在响应头/首音频前，包含上游处理及网络，无法进一步归因到供应商内部计算/排队。两个模式平均差约 33ms，样本极少且有网络噪声，不证明统计显著提速。仅换浏览器流式播放器也不能消除前面约 5.4 秒的首响应等待，因此没有重写音频引擎。

保存的 MP3 可复核输出；真实浏览器另有实际 playing/ended，但无人耳中文自然度评分、物理音箱或儿童听感验收，不宣称声音品质升级。

## 4. 实际实施

- 新增完整合成 SSE 解析器：增量解码、原顺序汇总；只有成功终止帧和非空音频才返回，随即取消 reader，不等待连接额外关闭。数据帧不能视为完整成功。
- 半截流、后续错误码、畸形 JSON、空音频、异常 base64 和超大帧/音频拒绝；不再把“已有一些音频”当成功。
- AudioService 增加可选 AbortSignal，与原有 60 秒超时组合；HTTP 客户端断开传播到 provider fetch/reader。正常响应仍为 audioUrl，不改变前端播放器、Provider、Avatar、CommandBus 或课堂事实。
- 取消只保证本地请求与资源停止，不承诺供应商退还已产生费用。真实本地 HTTP 断开传播测试和原生 ReadableStream 门控测试通过；没有为测取消另开付费请求。
- 真实验收发现“再举一个例子，只用一个短句回答，不要追问。”被前端保守词法判为 unclear，未发 HTTP。补红测后只扩充该普通追问表达；教师操作/隐私分流优先级保留，所有回答仍走后端完整审核。
- 修正浏览器证据采集器：收到 200 响应头但主动取消的 body 仍可能读失败，不应把“[aborted stream]”诊断占位符解析成 JSON。保留取消证据，不放宽业务断言。

## 5. 端到端实际浏览器结果

真实服务：登录合成教师 → 课堂 /classroom/lesson/1 → 开启普通问答与逐句朗读 → 输入一个短句问题 → 实际原生音频 playing → 数字人 speaking → 首问完整播放。

| 项目 | 实测 |
| --- | ---: |
| 输入/上下文审核 | 4697ms |
| AI 生成，含生成前复核 | 1932ms |
| 完整输出审核 | 4305ms |
| 完整审核文本可用，服务端合计 | 10958ms |
| 第一段 TTS 准备 | 6567.5ms |
| 浏览器首次 playing | 17672.7ms |
| 首问完整播放结束 | 25406ms |

这不是 D-8 两句回答的同口径复测，**不能声称降低了 1.89 秒**。即使暂不计算 TTS，本轮生成加双审核已经约 10.93 秒，安全目标与速度冲突时保留安全。

真实第二问被前端 unclear 拦住，原付费 E2E **1 失败、10 非选中跳过**。原始视频/截图/日志保留。修复后合成 provider＋真实 HTTP/浏览器验证同一句追问发出了第二次请求，历史上下文、有序播放和打断通过；没有再次收费包装原失败为全绿。

因此本轮真实连续追问首播和真实播放打断未完成新测；D-8 的 16.62 秒/55.2ms 仍仅为历史数据。最终合成环境打断约 66.2ms，不能替代真实云链或物理音箱指标。

## 6. 安全、数据与预算

- D-7 输入及上下文审核、完整回答审核、严格 whole_reply 标识和失败关闭保持；低风险无需逐条审批，高风险交教师。
- 逐句预备只处理已审核文本，没有直接播放模型原 token，也没有把 AI 内容解析成课堂控制。
- 持续云端监听保持关闭；无 ASR、真实儿童音频、新录音留存、敏感日志或新的教师权限入口。
- 真实浏览器前后九张权威事实表行数和完整内容摘要一致，SQLite integrity_check=ok，foreign_key_check 无问题。仅发生合法登录/审计/角色使用：teachers 登录字段、refresh_token_session +1、auth.login +1、avatar_usage_log +1。
- D-8 付费 E2E 原始失败文件未修改；本轮离线证据回核不等于付费 E2E 重跑通过。
- 明确授权上限：16 审核、2 生成、6 TTS、600 字、0 ASR。实际累计：**14 审核、1 生成、5 TTS、84 字、0 ASR**。没有消耗剩余预算继续自动重跑。
- 预算账本仅用于单测试工作进程，不是分布式计费锁。原 .env 未修改，只在内存读取必需凭证；配置盘点仅保存键名/存在性，未复制密钥或原数据库配置。

## 7. 本轮实际测试与失败记录

| 命令/范围 | 结果 | backend/.tmp 文件 |
| --- | --- | --- |
| 前端 npm test -- --pool=vmThreads --maxWorkers=1 --reporter=json --outputFile=../backend/.tmp/d9-frontend-final.json | 826 通过，0 失败/跳过 | d9-frontend-final.json |
| 后端 npm test -- --runInBand --runTestsByPath src/ai/audio.service.spec.ts src/ai/volc-tts-stream.spec.ts src/ai/classroom-content-safety.service.spec.ts src/ai/classroom-dialogue.service.spec.ts src/ai/ai.service.spec.ts src/ai/heuristic-operation-policy.spec.ts | 79 通过 | d9-backend-unit-final.json |
| E2E test/classroom-cockpit.e2e-spec.ts、test/command-postcommit-fault.e2e-spec.ts | 35 通过 | d9-backend-recovery.json |
| E2E test/d9-provider-benchmark.e2e-spec.ts，明确授权环境变量 | 1 通过；表示完成取样/未发现危险放行，不表示无审核超时 | d9-provider-test.json |
| E2E test/d9-tts-http-cancel.e2e-spec.ts，真实本地 HTTP/合成 provider、无 DB | 最终 1 通过；首轮缺少非目标路由 guard 夹具依赖而失败，已保留 | d9-http-cancel-final.json / d9-http-cancel-test.json |
| artwork-real-browser.e2e-spec.ts -t 'D8 authorized latency'，D9 真实服务 | 1 失败、10 非选中跳过，首问成功/追问路由失败 | d9-real-browser-test.json |
| 同入口，仅 D8_SYNTHETIC=1、D9_DIALOGUE_CASE=1 | 1 通过、10 非选中跳过；修复后的同句追问 | d9-synthetic-browser-test.json |
| 同夹具 -t 'D4 contextual'，D4/D6/D7_BROWSER=1 | 最终 1 通过、10 非选中跳过 | d9-safety-browser-test-02.json |
| 上一行首轮 | 日志采集器对取消 body 误解析，1 失败；保留，未删业务断言 | d9-safety-browser-test.json |
| D9_EVIDENCE_ROOT 下 test/d9-recorded-evidence.e2e-spec.ts | 1 通过，完全离线验证数据库/首播记录，不是浏览器全绿 | d9-offline-test.json |
| 自然追问复现红测 | 1 失败、1 通过，之后两项进入完整前端回归 | d9-followup-red.json |
| 前后端 type-check/build、前端 build-only、非修复 lint | 均退出 0，最终采集器修改后 ESLint 亦退出 0 | 本轮工具记录 |

保留既有 Canvas/WebGL、大 chunk、后端 6 项旧 lint warning。未运行完整后端 unit/E2E，运行的是本表专项及事务恢复。没有删除、跳过失败断言或放宽课堂守卫。

## 8. 逐场景验收边界

- 通过：真实首问、完整审核与实际浏览器音频、首问完整结束、数字人说话状态。
- 失败后局部修复：真实自然追问未发请求；最终只在合成接口/真实浏览器复验通过，真实付费追问未复验。
- 通过：合成服务下危险/跨句危险、审核失败降级、有序逐句、10 秒追问窗口和超时、教师打断、TTS 门控期间暂停、恢复不重播、退出取消、网络失败/手动控制；使用真实 HTTP/媒体实例，不是物理音箱。
- 通过：Run/步骤身份变化、审核期间阶段变化、公共输入不执行教师命令等专项回归；未增加跨两个真实课堂的新浏览器实机场景。
- 阻塞：Windows 本地合成未完成；仅停止已核实属于本轮的挂起 PID30844，未产出虚假的音频/延迟。
- 未验证：中文自然度的人耳盲评、真实麦克风/远场/物理音箱、长时压力、多进程，以及任何未配置供应商的真实指标。

## 9. 文件与证据

本轮主要业务改动：backend/src/ai/audio.service.ts、ai.controller.ts、volc-tts-stream.ts；frontend/src/services/classroomListening.ts。不改课堂/奖励/考勤/点名事务或导航。

新增/扩展验证文件：volc-tts-stream.spec.ts、backend/test/d9-provider-benchmark.e2e-spec.ts、d9-tts-http-cancel.e2e-spec.ts、d9-recorded-evidence.e2e-spec.ts、helpers/d9-budget.ts、helpers/d9-local-speech.ps1、helpers/d7-authorized-services.ts、artwork-real-browser.e2e-spec.ts；frontend/tests/unit/d9-followup-route.spec.ts、tests/acceptance/d8-latency-browser.mjs、d4-dialogue-browser.mjs。后两者复用历史夹具名称，不代表用历史结果冒充本轮。

关键路径（相对本项目根）：

- backend/.tmp/d9-services-01/provider-comparison.json、budget.json、tts-*.mp3：真实同文本质量/延迟/音频及预算。
- backend/.tmp/d9-real-browser-01/d8-browser.json、backend-results.json、backend-http.json、environment.json、d9-verification.json：真实首问、追问失败、请求/响应状态、Console、服务端审核帧和数据库证据。
- 同目录 d8-first-playing.png、d8-failure.png、d8-video/：真实服务页面/视频。保留 d8 前缀仅因复用夹具。
- backend/.tmp/d9-synthetic-browser-final/d8-browser.json、d8-interrupted.png、d8-video/：最终合成追问与打断。
- backend/.tmp/d9-safety-final-02/d4-browser.json、d6-audio.json、d7-safety.json、d6-paused-late-tts.png、d7-safety-redirect.png、d7-tts-unavailable.png、d4-video/：安全及失败路径实际操作。
- backend/.tmp/d9-local-02/blocked.json：本地候选阻塞，不是性能通过。
- backend/.tmp/d9-vite.log、d9-vite-error.log：隔离前端日志。夹具中的游客迁移/同义词 404、软件 WebGL 提示仍记录，不宣称 Console 全无问题。

隔离数据库均在上述新 .tmp 目录。运行时 DB_SYNCHRONIZE=false、DB_MIGRATIONS_RUN=false，只有新测试空库按既有实体初始化，不连接 backend/data/app.sqlite。后端3189、前端5189；用户3001/PID43644、5173/PID39000未改。测试后端由夹具关闭，本轮 Vite PID33840 在核实命令/端口后停止；证据文件保留。

## Remaining / 建议

当前唯一已配置审核/音色，没有可证明更优且完成验收的替换。主要瓶颈仍是外部审核和 TTS 首响应，不能靠浏览器先播未审核文本解决。需要提供一个已开通、部署/儿童数据处理权限明确的低延迟审核或 TTS 候选，再按同文本和相同安全语料对比；在此之前不自动切供应商/模型、不扩大监听或购买服务。D-9 至此停止，等待审查。
