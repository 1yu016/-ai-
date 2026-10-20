# D-11 独立审查、修复与验收

审查开始于 2026-10-20。Trae 已明确确认暂停写入。工作区为 `D:\trae_project\new1\integration-I1`，分支 `integration/i1-ab`，HEAD `368cf69844776e06ffba2a13973141e9dfb266f0`。存在大量跨批次未提交修改，本轮保留。未操作原 A、I-0、正式数据库或远程仓库。

## 结论与审查依据

以实际源码、已有 D11 单元／组件测试、`backend/test/acceptance/d11-isolated-server.ts`、`frontend/tests/acceptance/d11-voice-feedback-browser.mjs` 和旧 `backend/.tmp/d11-browser-*` 产物为依据。未找到独立 D11 Markdown 交付报告；不能以用户转述或历史产物替代当前验证。

原实现确有安全准入、丢播及回调竞态问题，已在前端播报层做局部修复。当前自动化与隔离浏览器验收通过，可以提交人工审查；在明确标签页边界的前提下可进入下一阶段，不能据此认定物理设备或生产封版。没有修改后端业务服务、CommandBus 执行语义、权限、课堂生命周期、Avatar Provider、数据库实体或 migration。

## 确认的问题与修复

| 级别 | 原因与证据 | 修复 |
|---|---|---|
| P0 | `ClassroomVoiceFeedback.ts` 自动采用任意 60 字以内 praiseText；后端 teacherConfirmedPraise 与负面词规则并不等于 D7 整段安全批准。合成危险文本直接成为语音候选；修复前用例失败。 | 自动操作反馈只使用固定正向模板；不自动朗读任意奖励原因、自定义表扬。姓名／步骤动态槽位限制长度、格式、控制字符、联系方式与明显不适宜标签。D7 AI 输入／输出安全审核未改动。 |
| P1 | 缺失／非法时间判为新鲜，未来时间也放行；集体累计及撤销 presentation 没有可靠发生时间。 | 缺失／非法／明显未来／超过 45 秒拒播；从现有正式只读接口补齐创建时间、对象和单条积分，排除撤销及跨 Run／班级／legacy 记录。 |
| P1 | `sync` 同轮登记所有 ID 却只返回第一条；后续结果被永久丢弃。最新投影又无法覆盖两次轮询之间的中间记录。 | 正式结果有序队列；复用 timeline、rewards、reward-dashboard 读取投影遗漏的中间正式记录。按发生时间排序，同时间按稳定规则；每条独立去重。媒体／政策失效时清空，队列上限 12，过期丢弃。 |
| P1 | 首轮基线在异步资源恢复后才建立，较早请求可能吞掉新结果；旧 Run 候选未再次核对 key。 | 同步建立首状态 ID 基线，再做异步读取；基线水位过滤历史记录。候选 key 必须属于当前 Run，读取返回后校验页面／设备／步骤／状态／形象身份及当前读取代次。 |
| P1 | 原生语音回退共用一个 generation；失败实例迟到 end 可结束回退实例；终止后 start、重复 start/end 仍可能驱动状态。 | browserSpeech 每次尝试独立 ticket；终结一次；开始一次；只在实际开始前尝试默认音色回退，实际发声后错误不重播整句。保留原音频适配接口。 |
| P1 | 只在媒体 playing 后抢占，等待加载阶段仍可能启动语音；图片也被笼统视为音频；普通播放器观察更新会调用 stopBrowserSpeech。 | 资源准入／自动播放加载阶段提前占用语音通道；按真实可播放音视频判定；暂停恢复的非自动播放加载不误占；播放器进度／音量／观察更新不再顺带停止语音。 |
| P1 | 外部语音取消没有正确复位 D11 的 speaking；break／页面阶段、设备和形象变化保护不足；无回调可留下状态。 | 增加当前播报代次与取消处理，结束／取消／错误由当前实例驱动；阶段、Run、设备、步骤、形象变化清理；原生回调缺失有有界看门狗，失败保留已确认文字，不宣称发声成功。 |
| P2 | 台账持久化裁剪同时删除页面内已消费身份；sessionStorage 被拒绝时 handoff 读取仍可使大屏失败。 | 持久化历史有界，页面内保留已消费身份；handoff 和播报台账均可内存降级，仍复用服务端签发身份。 |
| 测试缺口 | 原断线测试只中断轮询，SSE 仍然送达，并非大屏离线。 | 原生浏览器验收改用大屏标签页 CDP 网络断开，确认恢复页后再由在线教师发命令。没有通过随机延时判定竞态顺序。 |

修复前新增 5 个定向测试全部失败，见 `.tmp/d11-review-first.json`；不是仅依据猜测修改。原测试中“缺少时间仍放行”“同轮其余记录永久消费”“任意自定义表扬自动播报”的断言改为正确契约并增强验证，其余既有断言保留。

## 实际调用链与边界

教师输入 → 原 TeacherInstructionSession／Store → 原 CommandBus／canonical 服务 → 正式记录、回执及 Snapshot → 原大屏 SSE／轮询 → 有效课堂身份 → 正式只读补读 → 固定模板候选 → 当前标签页去重／有序队列 → browserSpeech → 原 Avatar 状态事件。

- 点名姓名取正式选中结果，分组模式仍为正式 group_random；不预测或重新随机。
- 单人奖励使用正式对象和花数／积分。自动语音不读取自由形式原因、排名、负面评价或内部错误。
- 集体奖励使用当前 Run、当前班级、未撤销记录自身的积分及创建时间，累计总分不冒充单次得分。
- 步骤过渡从当前运行时步骤读取，旧步骤异步返回不能启动新语音。
- 所有新增请求均为已有授权 GET；相同投影／普通心跳不再额外补读。读取失败不发业务 POST，不把缺失信息猜成成功。
- 新读适配器没有落库；页面原有心跳、handoff 与合法播放器 observation 仍按已有接口执行，不能将整页称为零写入 GET 页面。
- D11 仍直接使用浏览器 SpeechSynthesis，未擅自切换收费云 TTS。D5—D9 的 AI 回答安全链路和取消适配器保持原接口。
- 教师页面跳转与学生大屏是独立页面，播报来源为后端状态，不由教师路由生成成功状态。

## 去重与 45 秒语义

`runId:kind:recordId` 区分业务类型与课堂；步骤使用课堂和步骤索引。严格区分：

1. 当前页面：消费身份去重；错误／取消／媒体抢占不重播被消费的旧内容。
2. 当前标签页刷新：sessionStorage 延续最近身份，并同步建立首次接管基线，历史记录不补播。
3. 同设备多个独立标签页：各有 sessionStorage 和页面队列，**可能各播一次同一新记录**。没有设备级互斥，不承诺设备级 exactly-once。
4. 不同设备：没有全局播报台账，不承诺全局 exactly-once。
5. 存储不可用：页面内内存降级；整页重载仍建立历史基线，没有持久播报保证。

年龄由正式 createdAt 与服务端 serverNow 计算；排队和异步读取耗时使用 performance.now，客户端系统时间快慢不会扩大有效期。队列在开始下一条前再次检查单调时钟期限。没有时间来源就拒播，优先保留课堂正常教学。

首次打开大屏不补播接管前历史；首次接管之后到达的新记录不应被异步基线吞掉。该设计不承诺重播断电前未实际发声的每条记录，也不是 exactly-once 音频投递协议。

## 本轮测试与证据

- 修复前：`npm run test -- tests/unit/d11-review-regression.spec.ts --reporter=json --outputFile=../backend/.tmp/d11-review-first.json`：0 通过、5 失败，保存原始结果。
- 修复专项 04：正式记录补读、时间、安全、语音回调与大屏组件共 46 通过、0 失败；随后新增存储、客户端时钟和台账裁剪用例，纳入最终全量。
- 前端完整回归首轮：`.tmp/d11-review-frontend-full.json`：887 通过、0 失败、0 跳过。
- 前端最终完整回归：`.tmp/d11-review-frontend-final.json`：890 通过、0 失败、0 跳过。命令为 `npm run test -- --reporter=json --outputFile=../backend/.tmp/d11-review-frontend-final.json`。
- 后端相关 E2E：classroom-run、command-postcommit-fault、student-reward、roll-call-canonical、attendance-canonical、classroom-operation-policy：176 通过、0 失败、0 跳过，`.tmp/d11-review-backend-regression.json`。
- 前端及后端项目 type-check、build、lint 本轮执行。初次前端 type-check 暴露本轮测试类型 `never` 交叉错误，已修正后重验。前端 lint 使用不带 --fix 的 eslint；后端有 6 条既有警告，前端构建有大 chunk 警告。
- 未运行完整后端 unit／全部 E2E，不将定向回归写成全量后端通过。

### 原生语音浏览器验收

最终 `.tmp/d11-review-browser-03/`：真实 Nest／SQLite／HTTP／教师页面／学生大屏；无 Mock 课堂响应。`environment.json` 核实实际数据库为该目录 `acceptance.sqlite`，运行时 synchronize=false、migrationsRun=false。测试夹具仅初始化新临时 SQLite 的已有实体结构，没有修改业务 schema 或迁移正式库。

执行原 Jest opt-in `D11 classroom voice feedback`：1 通过、0 失败，12 个非本轮测试未选中。真正运行了该 opt-in，没有用独立进程验收替代它的结果。

通过：合成教师登录、指定／随机点名、个人奖励对象数量、集体积分、当前步骤过渡、重复投影与刷新、真实测试 WAV 资源抢占、stop_media、课堂暂停取消、拒绝不播成功、大屏全部网络断开后恢复、儿童管理意图零业务 POST。

实际浏览器 SpeechSynthesis 检测到 3 个系统语音，观察到原生语音开始后数字人 speaking=true；没有物理音箱收音测量，不能据此确认实际房间发声或听感。WAV 是测试自制正弦音资源，不是云 TTS。

截图：`d11-specified-roll-call-screen.png`、`d11-random-roll-call-screen.png`、`d11-student-reward-screen.png`、`d11-collective-reward-screen.png`、`d11-media-priority.png`、`d11-paused-cancelled.png`、`d11-offline.png`、`d11-recovered.png`、`d11-child-no-privilege.png`。录像 `d11-video/`；请求／Console／语音能力 `d11-browser.json`；后端日志 `backend-http.json`；业务前后状态 `backend-results.json`。

数据库核验：正式奖励／点名／集体记录与 Snapshot 引用一致，请求身份唯一；integrity_check=ok，foreign_key_check=[]。浏览器实际新增的是合成课堂的合法业务及既有设备反馈，无第二套奖励／点名事实。

### 可控回调浏览器验收

`.tmp/d11-review-controlled-*` 使用真实后端／SQLite／页面，显式注入 SpeechSynthesis 回调，专门验证开始／结束／取消顺序、两条奖励、TTS 等待媒体抢占、迟到 start/end、暂停恢复与双标签页语义。该组不能当成真实语音或物理音箱通过。

首次 controlled-01 后半段遇到播放器恢复反馈推进版本后的合法 409，前端保持未知且没有冒充成功；controlled-02 的同步点误写单数 checkpoint 路径，已按实际复数 checkpoints 修正。两份失败证据保留；未放宽版本守卫，也未自动重发业务操作。

最终 `.tmp/d11-review-controlled-03/` 的 5 个可控场景均通过；对应 Jest opt-in 1 通过、0 失败、12 未选中。两个独立标签页对同一新奖励各提交一次语音，实测证实当前设计为标签页级。截图 `review-speaking.png`、`review-ordered-rewards.png`、`review-two-tabs.png`；事件时间线、网络与 Console 为 `d11-browser.json`，录像为 `review-video/`。该数据库 integrity_check=ok、foreign_key_check=[]，正式记录引用和积分验证通过。

### 环境异常核查

本轮的 Jest／supertest 与真实 HTTP 专项成功监听和完成，未复现历史 `listen ENOTSOCK`。没有足够原始堆栈证明其历史根因，不将它断言为固定的本机缺陷。最初沙箱内 Vitest 遇到子进程 spawn EPERM，沙箱外重跑可执行；这与 ENOTSOCK 不是同一错误。

浏览器夹具存在 visitor migration／command-synonyms 等不相关路由 404，已保存 Console，不宣称无 Console 错误。原生浏览器本轮没有未处理 pageerror。

测试后端均由 afterAll 关闭，专用 Vite 5189/PID16584 经命令归属核对后停止。原有 3001/PID54980、5173/PID39000 与启动前一致，3189／5189 无监听。未停止用户服务。代码差异检查通过，既有 CRLF 提示保留。

## 修改文件

业务前端：`ClassroomVoiceFeedback.ts`、新增 `ClassroomAnnouncementRecords.ts`、`ClassroomScreenView.vue`、`browserSpeech.ts`。

测试：`classroom-voice-feedback.spec.ts`、`screen-voice-feedback.spec.ts`、新增 `d11-review-regression.spec.ts`、新增 `classroom-announcement-records.spec.ts`、原 `d11-voice-feedback-browser.mjs`、新增 `d11-review-browser.mjs`；后端 `artwork-real-browser.e2e-spec.ts` 仅增加受环境变量控制的本地验收脚本选择，没有修改业务实现或删除旧 opt-in。

## 保留限制与下一步

- 多标签页／跨设备无全局去重，这是一项明确能力限制；若产品要求同设备只能发声一次，应单独设计主播放端归属，不能假称 sessionStorage 已保证。
- 正式补读复用全量历史查询；当前按投影变化触发，普通心跳不增加请求。长课堂的数据量／压力未验证，未来若需增量接口须单独确定契约。
- 页面首接管不补历史、媒体抢占或语音失败丢弃队列、超过 45 秒丢弃，优先保证课堂不被旧声音打断，不承诺每条操作都被物理播出。
- 动态槽位约束是固定业务模板的风险收敛，不是新的通用语义审核服务；管理员不适宜配置仍需要治理。任意 AI 输出继续由 D7 审核，不经 D11 固定模板通道播放。
- 本轮未调用收费云 ASR／AI／TTS，未使用儿童录音，未验证真实麦克风、房间远场、物理音箱、跨进程或压力／断电。
- 离线超过 45 秒、客户端时钟偏差、存储不可用、形象／Run 切换的关键边界由自动化覆盖；没有将这些全部描述为真实设备浏览器场景。正式分组点名未单独做浏览器操作，后端 canonical 分组回归保留通过。
- 下一步仅建议：在真实教室设备上验收系统语音、资源抢占及教师打断，并明确一个设备允许几个播放标签页。没有自动进入 D12。
