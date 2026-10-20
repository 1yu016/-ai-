# I-2-3B：课堂暂停与 AI 助教教学语音

## 1. 所属十大阶段

阶段四（一键上课与大屏）、阶段五（数字人）的教学语音联动，主要属于阶段六（AI 课堂导演与语音控制）。只处理教师课堂本地教学输出。

## 2. Before / After

原实现本地继续播放可脱离权威课堂暂停，等待中的 TTS 也缺少完整来源失效保护。现在权威暂停、Run/设备/步骤切换、退出和卸载会取消当前教学语音。恢复课堂不会复活旧实例；教师可以明确发起新的合法播放。正式教学中的本地暂停、继续和取消保留。

## 3. Changed

- `frontend/src/composables/useTeachingSpeech.ts`：新增教学语音所有权、来源身份、异步世代和控制序号。
- `frontend/src/services/browserSpeech.ts`：支持按实例停止/暂停/继续；旧 play Promise 不再影响新实例，过期任务按取消处理。保留其他调用者的无参数接口。
- `frontend/src/views/LessonClassroomView.vue`：接入权威 tts 能力和课堂身份；命令成功后刷新能力再请求 TTS；离开课堂时取消。
- `frontend/src/components/classroom/ClassroomAssistantPanel.vue`：播放/继续受课堂能力约束，提供不可用提示。
- `frontend/tests/unit/teaching-speech.spec.ts`：13 项生命周期及竞态测试。
- `frontend/tests/component/components.spec.ts`：现有助教测试补齐真实 cockpit 响应结构，保留原播放断言。
- `frontend/tests/acceptance/i2-3b-fixture.mjs`、`i2-3b-browser.mjs`：合成接口、真实浏览器原生音频实例操作取证。

未修改后端、ASR 输入、资源媒体逻辑、数据库结构、Provider、原 A 或 I-0。现有其他 dirty 文件不属于本批。

## 4. Voice Lifecycle

来源包含路由 Run、Run ID、设备、步骤、Run 状态、开场阶段、break 和 recovery 标记。同步监听来源及服务端能力变化；来源变化始终取消。自身 speak_text 授权造成的短暂能力缓存失效仅在授权等待期间容忍，授权结束后必须重新验证能力。

每次播放、取消及继续有独立序号。TTS、原生 play Promise 和音频回调必须匹配来源及序号。停止仅清理自身音频，旧作用域释放不能停止新拥有者或覆盖新数字人状态。权威暂停采用取消而非自动续播；加载期间本地暂停也采用取消。资源播放与教师麦克风采集未接入该控制器。

## 5. Tests（本批实际执行）

日志目录：`D:/trae_project/new1/integration-I1-evidence`。

- 专项初次运行：6 文件、64 项通过，`i2-3b-targeted-initial.log`。
- 首次完整：706 通过、1 失败；旧组件夹具未响应新使用的 cockpit 查询，导致原 TTS 断言失败。修正的是测试响应基线，不删除断言。保留 `i2-3b-full.log`。
- 最终完整：`npm test -- --pool=vmThreads --maxWorkers=1`，90 文件、709 通过、0 失败、0 跳过，`i2-3b-full-final-709.log`。含既有恢复信封、播放器来源、能力政策及资源相关回归。
- `npm run type-check`：通过，`i2-3b-typecheck-delivery.log`。
- `node node_modules/eslint/bin/eslint.js .`（不自动修复）：通过，`i2-3b-lint-delivery.log`。
- `npm run build-only`：通过，`i2-3b-build-final.log`。保留大 chunk 提示；测试环境仍有 jsdom canvas 未实现提示，不等同真实 GPU 验收。

## 6. 智能体操作过程

使用独立集成前端 `127.0.0.1:5187`，专用合成 HTTP 夹具 `127.0.0.1:3187`，不是既有 5173/3001。启动检查确认前端源码、API 目标和夹具工作目录；夹具 database=null，不导入数据库或调用真实 AI。浏览器网络仅放行这两个本地来源及 blob/data。

在真实 Chromium 打开 `/classroom/lesson/93001`，以合成教师状态进入课堂，打开“AI教学伙伴→打开助教”，生成问题并教师确认播放；操作本地暂停/继续、课堂暂停、恢复、下一环节和“工作台”退出。额外通过服务端同步点扣住 TTS 响应，暂停再恢复后释放，等待响应与事件循环屏障检查，不依靠随机点击认定竞态通过。

## 7. 操作验收结果

以下“通过”仅限真实前端 + 合成接口浏览器场景，不是完整后端联调。

| 场景 | 结果 | 实际证据 |
| --- | --- | --- |
| A 正式教学播放 | 通过 | 原生 HTMLAudioElement paused=false，currentTime 前进；本地暂停/继续可用 |
| B 课堂暂停 | 通过 | 同一实例 paused=true，src 清除，不仅页面文字变化 |
| C PAUSED 绕过 | 通过 | 播放按钮禁用，旧实例已取消、继续入口移除；处理函数绕过另有单元验证，并非声称点击了不存在按钮 |
| D 课堂恢复 | 通过 | 旧实例保持取消，明确播放才创建新实例 |
| E 切步骤/退出 | 通过 | 已创建实例均暂停且 src 清除 |
| F 迟到 TTS | 通过 | 暂停再恢复后释放旧响应，无音频实例创建 |
| 真实后端与真实 TTS 联调 | 未验证 | 本批没有安全配置的真实后端/TTS 验收环境，使用合成协议夹具 |
| 实体大屏/物理音箱、真实麦克风 | 未验证 | 原生实例状态不能证明物理输出或硬件采集 |

## 8. 截图与证据

最终浏览器目录：`D:/trae_project/new1/integration-I1-evidence/i2-3b-browser/run-1792378271819`。

包含 A/B/C/D/E-step/E-exit/F 七张截图、`results.json`（实例状态、音频事件和限制）、`network.json`（合成请求/响应）、`console.json`。本次浏览器未记录控制台错误。初次定位器与资源“继续播放”重名导致的操作失败另存于上级初次证据目录；改为助教对话框内定位，不改变产品以迁就脚本。

## 9. Remaining

代码和自动化完成；浏览器协议夹具操作通过，不宣称整体验收通过。测试音频为合成音调，不是真实模型教学语音；无头浏览器放宽自动播放限制，不证明普通浏览器自动播放策略或真实音箱。双终端、真实后端持久状态、TTS 网络认证、硬件音频与压力测试尚未验收。不得将这些写为生产封版。

原 A/I-0 的只读复核证据另存 `i2-3b-preservation.json`：每个根目录核验 1320 个路径，备份核验 1331 个产物；无缺失，备份无哈希差异，原 A HEAD/分支/index/status 均匹配。唯一偏离 I-0 的仍是已确认的 ClassroomPartnerPanel BOM 差异，未恢复或覆盖。本批 3187/5187 测试服务已关闭；原有 5173（PID 39000）和 3001（PID 29724）保留，证据 `i2-3b-service-stop.json`。

## 10. Next Batch

仅建议安排隔离真实后端 + TTS 的教学语音联动验收，补齐本批夹具无法证明的端到端边界。不在本批自动执行 I-2-4 或其他修复。
