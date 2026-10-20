# D-2 数字人视觉表现与动画升级

日期：2026-10-19。仅独立集成仓库 `D:\trae_project\new1\integration-I1`；不进入 D-3。

## 1. 产品变化 / 所属阶段

阶段五：3D 数字人。保留管理员绑定身份，不替换角色、不改班级权限或课堂政策。

- 开场在模型就绪后微笑/挥手，短动作结束回到待机。修复慢模型加载时欢迎动作提前结束的问题。
- 支持 VRM normalized humanoid 的小幅呼吸、倾听姿态、欢迎及鼓励姿态；标准表情能力按模型实际存在情况使用。
- 机器人使用其内置 Idle / Wave / ThumbsUp 等动画，切换采用短淡入淡出；不再随机选择首个不相关动画冒充请求动作。
- 教师教学音频真实播放后进入 talk；暂停、取消、结束回到 idle。Run、设备、步骤和角色身份变化会取消旧语音关联。
- 大屏 SpeechSynthesis 使用真实 onstart/onend/onerror，并保留播放代次保护。提交文本本身不会触发说话表情。
- 课堂暂停清除瞬时表现并停止现有渲染循环；恢复不重播已取消的欢迎/鼓励。保留页面隐藏、低帧率降级及资源释放。

## 2. 模型与许可

未新增或下载模型，未覆盖管理员配置，无外部收费调用。

| 现有资产 | 本批用途 | 能力 / 限制 | 许可证据 |
| --- | --- | --- | --- |
| RobotExpressive.glb | 现有机器人兼容验证、内置动画 | Wave / Idle / ThumbsUp 等；没有独立嘴部、眨眼或微笑 morph，不假称具备这些能力 | three.js 官方模型 README 署名 Tomás Laulhé / Quaternius，修改 Don McCurdy，CC0 1.0 |
| AliciaSolid_vrm-0.51.vrm | 现有 VRM 0.x 测试夹具，隔离兼容验证 | 支持 happy / blink / aa；无内置动作，使用 normalized 骨骼程序化姿态 | 嵌入作者 ©DWANGO、licenseName=Other，并指向专用使用条款；不能仅凭 commercialAllow 推断所有企业使用均获许可 |

机器人来源：<https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/RobotExpressive/README.md>

VRM 嵌入条款指向：<https://3d.nicovideo.jp/alicia/rule.html>。本批未能完整核实该页面的正式使用条件，因此 **不批准将该示例作为新的正式商用角色交付**。正式儿童友好形象仍需要许可清晰且具备眼/嘴/骨骼能力的管理员批准资产；不擅自更换现有身份。

## 3. 实现程度

| 能力 | 实现程度 |
| --- | --- |
| 统一身份 | 复用 D-1 class/run/device/character/version identity；不由模型组件调用课堂命令 |
| 欢迎 / 鼓励 | 现有状态机事件和有界一次性计时；GLB 内置动画、VRM 小幅程序化姿态 |
| 待机 | VRM 眨眼、胸部轻微变化；GLB 既有 Idle 和已有根节点轻微移动 |
| 倾听 | 教师录音状态驱动 listen；VRM 头部轻微倾斜。无兼容 GLB Listen clip 时回退 Idle，不伪造专用动作 |
| 口型 | VRM aa 或 GLB 实际支持的嘴部 morph，按实际播放状态驱动周期变化；**非音素级、非音频能量分析** |
| 暂停 / 恢复 | 清除瞬时状态与表情，暂停渲染；恢复当前合法状态，不自动重播失效实例 |
| VRM 版本 | 真实 VRM 0.51 文件验证；1.0 normalized API 有合成接口单测，未取得真实 VRM 1.0 资产验收 |
| 物理播放 | 未验证物理音箱、真实大屏、儿童现场观感或长时间性能 |

## 4. 本批文件

业务前端（不改后端、schema、Provider 权限或语音引擎）：

- `frontend/src/avatar/animation/VrmVisualController.ts`：渲染适配器内的标准骨骼姿态、眨眼和基础嘴部变化。
- `frontend/src/avatar/AvatarLoader.ts`：VRM 适配、GLB 精确动画回退/过渡、说话结束清理。
- `frontend/src/avatar/action/AvatarActionResolver.ts`：优先短鼓励动画，不用大幅 Dance 作为鼓励回退。
- `frontend/src/avatar/state/AvatarStateMachine.ts`：复用已有状态，增加开场事件和 settle；不新增课堂状态机。
- `frontend/src/stores/digitalHuman.ts`：有界短动作、暂停保护；模型不能回写业务语音状态。
- `frontend/src/composables/useClassroomAvatar.ts`：Run/步骤世代保护；模型加载后每次开场只欢迎一次。
- `frontend/src/components/avatar/ThreeAvatarStage.vue`：不支持某动画不能把业务 action 改为 idle；暂停时清理表情。
- `frontend/src/views/LessonClassroomView.vue`：录音的倾听表现和角色身份加入教学语音取消边界，不改 ASR。
- `frontend/src/services/browserSpeech.ts`：增加可选实际开始回调，保留原播放代次防护。
- `frontend/src/views/ClassroomScreenView.vue`：大屏语音事件到数字人表现，来源变化取消旧实例。

测试与证据：新增 `avatar-visual-lifecycle.spec.ts`、`vrm-visual-controller.spec.ts`、`avatar-browser-speech.spec.ts`，扩展真实模型解析测试；`tests/acceptance/d2-visual.mjs` 及 D-1 浏览器脚本的 opt-in D2 采样/录像。

## 5. 本次测试记录

不引用历史结果充当本轮通过。

- 第一轮定向：5 文件、28 测试通过。
- 后续大屏语音/真实模型/屏幕/I-2-3B 定向：4 文件、37 测试通过。
- 后端权限与生命周期定向：`avatar.e2e-spec.ts classroom-run.e2e-spec.ts classroom-run-legacy.e2e-spec.ts`，3 套、140 通过，0 失败。输出 `D:\trae_project\new1\integration-I1-evidence\d2-backend-targeted.json`。
- 完整前端早期运行 749 通过，结果 `d2-frontend-tests.json`；慢加载修复复跑 749 通过，结果 `d2-frontend-final.json`。
- 最终完整前端（包括大屏 onstart 适配）：**750 通过、0 失败、0 跳过**，结果 `D:\trae_project\new1\integration-I1-evidence\d2-frontend-delivery.json`。
- 最终前端 `npm run type-check`、`npm run build-only`、`node node_modules/eslint/bin/eslint.js .` 全部退出码 0。lint 不使用 --fix。
- 构建存在 >500KB chunk 提示；jsdom 测试存在既有 canvas not implemented 警告，不能据此证明真实 WebGL；真实 WebGL 证据另见浏览器。
- 未运行完整后端 E2E / unit；本批无后端业务修改，按要求运行必要定向。

## 6. 隔离浏览器实际操作

启动前确认原 3001=PID 21796、5173=PID 39000，未停止/接管；3189/5189 空闲。

测试前端：5189，代理 3189。后端为真实 Controller/Service，src via ts-jest。每轮独立 SQLite，在 `backend/.tmp/d2-browser-20261019-01`、`-02`、`-03` 中，均非原 A 数据库。应用连接 `synchronize=false`、`migrationsRun=false`，新建空测试库仅由既有夹具初始化，无迁移、无正式结构修改。

本机离线 Windows SAPI 生成英语合成教学文本 WAV。浏览器仅拦截 AI 草稿/TTS 响应，不调用付费服务；教师语音授权仍调用真实 CommandBus。真实 HTMLAudioElement 的 playing/pause 和 currentTime 被记录。**不是完整真实 AI/TTS 后端验收，不证明物理音箱发声。**

| 操作 | 结果与范围 |
| --- | --- |
| 管理员登录，为两个合成班级绑定机器人 / VRM | 真实 HTTP 通过；普通教师尝试修改绑定 403 |
| 教师登录，准备并开始两个合成课堂 | 真实 HTTP 通过；开场 identity 与班级绑定一致 |
| 开场欢迎、教学、展开与退出全屏 | 最终轮通过；有连续帧和整段 WebM，VRM 慢加载后的欢迎已修复 |
| 输入合成教学问题、生成草稿、教师确认播放 | 两个班级均通过；草稿/TTS 响应为受控合成，命令授权真实 |
| 播放中本地暂停 / 取消 | 真实音频实例 paused=true，action 从 talk 回 idle；时间线记录 |
| 暂停课堂、恢复、刷新 | 真实 HTTP 通过；暂停后 WebGL draw counter 不增长，恢复后角色不变 |
| 加载失败 | 受控拦截真实授权模型资产；备用形象出现，教师仍可暂停课堂 |
| listening / encourage | 第二轮合成视觉事件与连续帧；不冒称真实麦克风或教师业务触发已完成验收 |
| 失效 Promise / 取消竞态 | 自动化覆盖，不用随机点击替代；真实设备断线/现场竞态未验收 |
| 大屏 SpeechSynthesis 实际声音 | 仅组件/回调回归；真实系统音色、硬件输出及独立大屏端未现场验收 |

浏览器第 03 轮完成于最终大屏 onstart 小型适配之前；教师路径未再改动。其后运行了 37 项定向和最终完整前端测试，但没有将这次自动化结果描述成再次执行浏览器或独立大屏语音验收。

### 首次失败与修复

01：浏览器 1 失败、7 未选择跳过，停在生成草稿后的确认按钮等待。夹具环节正文为空，未产生草稿。改验收操作为明确输入合成教学问题，不改业务要求。

02：浏览器 1 失败、7 未选择跳过。机器人语音已通过；VRM 全屏长时间多帧采样后资源删除计数断言未增长。软件 WebGL + ReadPixels/录像存在负载干扰，**不能据此证明内存泄漏或断言已无意义**。保留全部证据；最终轮将现有全屏卸载断言放在额外长时动作采样之前，不删断言、不关闭性能降级守卫。同时观察并修复欢迎动作在慢加载前提前结束。

03：最终浏览器 **1 通过、0 失败、7 未选择跳过**；原资源释放断言、暂停 draw counter、两个班级真实绑定及失败降级都保留并通过。长时软件渲染压力仍不是本批已通过项目。

## 7. 证据位置

最终根：`D:\trae_project\new1\integration-I1\backend\.tmp\d2-browser-20261019-03`

- `environment.json`：实际 SQLite PRAGMA database_list、进程、源码、关闭同步/迁移。
- `d1-browser.json`：真实请求响应、逐场景结果、Console、WebGL draw/delete 计数；延续复用夹具命名，不是历史 D-1 结果。
- `d2-0-opening-*.png`、`d2-1-opening-*.png` 和对应 timeline：欢迎过程连续帧。
- `d2-speech-0.json` / `d2-speech-1.json`：真实音频实例时间线与 talk/idle。
- `d2-speech-*-*.png`：教学语音连续帧。
- `d2-video/page@4e341b657d8af8ca50b6ac495dfada63.webm`：整段真实操作录像（无物理音箱证明）。
- `fullscreen-class-*.png`、`paused-class-*.png`、`fallback-class-*.png`：实际界面。
- `backend-http.json` / `backend-results.json`：后端日志、表摘要、命令及最终 integrity_check=ok、foreign_key_check=[]。
- 前两轮目录保留失败 JSON、截图、录像及数据库，不删除或覆盖。

Console 有夹具未提供的历史接口 404（例如游客迁移/部分查询）、受控资产失败 net::ERR_FAILED 和软件 WebGL ReadPixels 性能警告；最终无未捕获 pageerror。不声称 Console 完全干净。

## 8. 保护与停止

`D:\trae_project\new1\integration-I1-evidence\d2-original-preservation.json` 的 preservation 与 D-1 一致：original/restore 各 1320 路径、1331 备份产物；HEAD、branch、index、status 一致。仅有已知 ClassroomPartnerPanel BOM 差异，无新差异。

本批 Vite PID 30168 已按完整命令行核实后停止；隔离后端由测试关闭。3189/5189 已释放；原 3001/5173 PID 未改变。测试临时数据与证据保留。无 commit/push/pull/merge，无原 A/I-0/正式数据库写入。

## 9. Remaining / 下一批建议

- 不是最终商用外观封版：需许可明确、儿童友好且包含标准眼嘴表情的管理员批准角色；机器人独立嘴部及倾听 clip 仍缺失。
- 真实 VRM 1.0 资产、移动 GPU、长时间性能、独立大屏音色与物理播放、现场儿童体验未验收。
- 基础说话口型只跟播放生命周期，不承诺语音内容、音素或节拍一致。
- 实际麦克风触发的倾听、真实业务触发鼓励及换设备硬件流程需要后续隔离复验；不可用模拟事件替代。
- 下一批仅建议 D-3 之前优先确定可正式使用的角色资产及表情/动作能力清单，再选定语音细化范围；本批不启动新开发。
