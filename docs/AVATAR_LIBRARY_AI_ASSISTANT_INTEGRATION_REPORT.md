# 数字人角色库与 AI 助教统一：架构审计与实施方案

日期：2026-11-06。阶段：已完成只读审计及隔离基线测试；尚未实施业务修复。

## 1. 结论与本轮边界

角色、版本、资产、语音、性格、绑定和审计记录已经存在，不需要另建角色系统。管理员新建草稿、上传模型、版本校验、角色审核及停用入口也已存在，但没有形成用户要求的完整流程。

已确认代码层断链：聊天选择器未主动加载后台角色列表，选择动作没有解析对应资产；角色语音配置没有传到实际 TTS；预览使用全局运行状态；2D备用资源未被前端作为图片消费。这些足以解释名称、形象和声音可能不一致，但没有查询运行数据库，不能断言截图中具体角色实际绑定了哪一个资产 ID。

完整目标还涉及纯2D版本、园所默认作用域、声音与性格版本化、课堂完整配置快照。按任务“涉及较大数据结构调整，先交付审计及实施方案”的要求，本轮停在方案审核点，不实施迁移、不修改业务代码。下文所有拟新增接口、字段均为方案，不能当作已实现。

## 2. 项目与安全核查

| 项目 | 本轮核实结果 |
|---|---|
| 唯一分析项目 | `D:\trae_project\merge-worktrees\integration-I1-unified-20261102` |
| Git 根目录 | 同上 |
| 分支 | `merge/unified-classroom-20261102` |
| HEAD | `d24d9e9f3a1a24a90f70542f368165acd623efca` |
| 提交说明 | Save teacher console, mobile remote UI and lesson generation recovery point |
| 原有未跟踪内容 | `docs/P0_RESOURCE_TO_LESSON_FIX.md`、`docs/tender/`；完整保留 |
| 服务监听 | 只读 netstat：5592 / PID 24212，3592 / PID 38608；未停止或重启 |
| 数据库 | 代码使用 TypeORM / SQLite；未连接、打开或查询运行数据库 |
| 默认数据库路径 | `DATABASE_PATH` 未配置时为后端工作目录下 `data/app.sqlite`，不等同已确认的运行库路径 |
| 启动建表与迁移 | `DB_SYNCHRONIZE === 'true'`、`DB_MIGRATIONS_RUN === 'true'` 才启用；本轮没有启动应用 |
| 隔离测试 | 后端专用测试 `ignoreEnvFile: true`，SQLite `:memory:`；上传目录显式指定到本轮临时目录 |
| 未触碰事项 | API Key、JWT、模型配置、P6、真实数据、原始 integration-I1、Git 提交/推送 |

前端代理代码读取 `VITE_BACKEND_PROXY_TARGET`。本轮未提取正在运行进程的环境变量，也没有重新声明已验证5592代理配置或数据库绝对路径。现有监听仅证明服务存在，不代表本轮完成页面验收。

## 3. 现有架构：复用范围

### 3.1 数据结构

| 实体/类型 | 已有职责 | 缺口或注意事项 |
|---|---|---|
| AvatarCharacter | 名称、分类、简介、归属、园所、审核状态、当前版本 | 元信息可变，不能替代课堂完整快照 |
| AvatarVersion | 角色内版本号、引擎、模型格式、校验和、状态、compatibility JSON | 模型格式必填且仅 glb/gltf/vrm；没有纯2D版本契约 |
| AvatarAsset | model、texture、animation、expression、lip_sync、preview、fallback_2d | 已有文件访问保护，不应改为公开上传目录 |
| AvatarVoiceProfile | 按 characterId 唯一的声音配置 | 可变记录，不是每版本不可变配置；实际 TTS 未读取 |
| AvatarPersonality | 角色问候语、性格等 | 可变配置，修改可能影响后续解析结果 |
| AvatarBinding | system/class/lesson_plan/classroom_run 绑定 | system 使用 scopeId=0，没有独立园所默认作用域字段 |
| AvatarConfigHistory | 配置前后摘要、操作者、原因、上下文 | 有记录，无完整查询/恢复管理闭环 |
| AvatarUsageLog | 解析降级与使用事件 | 无面向管理员的完整使用情况页面/API闭环 |
| Run / Snapshot | avatarCharacterId、avatarVersionId | 没有完整固定名称、声音、性格等解析结果 |
| 前端 AvatarIdentity | 班级/Run/设备/角色/版本身份类型 | 不是另一张独立角色数据库表 |

相关实体均位于 `backend/src/avatars/entities/`；类型在 `backend/src/avatars/avatar.types.ts`、前端 `src/avatar/`。

### 3.2 已有后端接口

以下路径以 Controller 声明为准；受 `AuthGuard` 保护，业务服务继续检查角色归属及课堂/班级访问权。

| 方法与路径 | 现有用途 |
|---|---|
| GET /avatars/characters；POST /avatars/characters | 列表、创建草稿 |
| GET /avatars/characters/:id；PATCH 同路径 | 详情、修改元信息 |
| POST /avatars/characters/:id/versions | 上传模型并创建版本 |
| POST /avatars/versions/:id/assets | 上传版本附属资产 |
| GET /avatars/versions/:id/integrity | 完整性检查 |
| POST /avatars/versions/:id/publish | 版本进入 ready；不等于角色已审核 |
| POST /avatars/characters/:id/submit-review | 提交角色审核 |
| POST /avatars/characters/:id/review | 管理员批准、拒绝、停用 |
| PATCH /avatars/versions/:id/status | 版本停用 |
| DELETE /avatars/versions/:id | 删除未被引用的版本；有活动Run/快照保护 |
| PATCH /avatars/characters/:id/voice-profile | 更新声音配置 |
| PATCH /avatars/characters/:id/personality | 更新性格配置 |
| POST / DELETE /avatars/bindings/classes/:id | 班级绑定及解除 |
| POST / DELETE /avatars/bindings/lesson-plans/:id | 教案绑定及解除 |
| POST / DELETE /avatars/bindings/system-default | 系统默认绑定及解除 |
| GET /avatars/resolve | 按授权上下文解析可用角色与降级结果 |
| GET /avatars/assets/:id/content | 授权后读取资产内容 |
| POST /classroom-runs/:id/avatar-binding | 已有正式Run角色切换，含设备/版本/requestId保护 |

实现：`backend/src/avatars/avatar.controller.ts`、`avatar.service.ts`、`avatar-configuration.service.ts`，以及 `backend/src/classroom-runs/classroom-run.controller.ts`、`classroom-run.service.ts`。

### 3.3 各页面实际数据流

1. **角色库**：`AvatarLibraryView.vue` → `api/avatar.ts` → 角色详情/版本/资产 → `previewRuntime()` 写入全局 digitalHuman store → DigitalHumanStage / ThreeAvatarStage。管理员入口已存在，不应再造页面。
2. **AI 助教**：`ChatView.vue` → DigitalHumanStage → store 的本地角色和 `selectRole()`。全项目没有找到对 `loadRoles()` 的调用点；选择只改名称与ID，不请求该ID的有效资产配置。
3. **课堂准备**：`ClassroomPreflightView.vue` 选择教案、班级、教室、设备并进行准备；没有明确的数字人选择器，数字人检查是降级提示。正式Run创建由后端解析教案/班级/默认绑定，并固定角色与版本ID。
4. **课堂大屏**：`ClassroomScreenView.vue` → `useClassroomAvatar()` → `loadRuntime({classId,classroomRunId,deviceId,lessonPlanId})` → `/avatars/resolve`。有异步代际保护，但上下文缓存键不含角色/版本或Run版本；同Run换角色时需要额外失效机制。
5. **声音**：ChatView 发 `/ai/tts`，DTO只有 text → `AudioService.tts(text, signal)` → 服务配置中的 speaker；角色库返回的 voiceId/provider 未进入这条请求链路。

数字人视觉、声音、性格、大模型与课堂命令是不同职责。后续切角色不得切模型供应商，也不得扩大教师/儿童权限。

## 4. 已确认的问题与证据

| 编号 | 问题 | 代码证据与影响 |
|---|---|---|
| A01 | 聊天没有实际加载后台角色列表 | `frontend/src/stores/digitalHuman.ts` 定义 loadRoles，但源码无调用点；仍可展示 flower/bear/garden 本地项，新发布角色不能据此保证出现 |
| A02 | 切换只更新名称，不更新角色资产 | 同文件 selectRole 仅设 roleId、roleName、modelState、error；没有按选中ID resolve，原runtime可残留 |
| A03 | 无选中聊天角色的统一解析契约 | `backend/src/avatars/dto/avatar-config.dto.ts` 的 ResolveAvatarQueryDto 仅班级/教案/Run/设备/actionName，没有聊天选中角色参数及用途约束 |
| A04 | 默认/后备模型可能与显示名称无关 | `ThreeAvatarStage.vue` 使用内置 RobotExpressive.glb 后备和少量本地角色特判；不能把此后备冒称所选角色的已加载资产 |
| A05 | 2D降级数据被当3D URL | store 的 toRuntimeConfig 将 renderAsset.contentUrl 直接写 modelUrl，不区分 fallback_2d 图片；DigitalHumanStage 的非3D分支是程序化占位形象，没有消费对应备用图 |
| A06 | 预览污染业务运行状态 | 角色库 previewRuntime 写同一个store并清空课堂上下文；选中没有ready版本的角色时未建立清晰的新预览/清空流程，可能保留前一角色形象 |
| A07 | 当前版本选择不准确 | AvatarLibraryView 的 selectedReadyVersion/find ready 不优先使用 currentVersionId；预览、绑定可拿到与当前发布版本不同的ready版本 |
| A08 | 声音配置与实际播报断开 | ChatView 三处TTS只传text；`ai/dto/tts.dto.ts`、`ai.controller.ts`、`audio.service.ts` 没有角色音色解析；角色库试听用浏览器speechSynthesis，不验证provider/voiceId |
| A09 | 纯2D角色无法完成现有发布流程 | createVersion强制模型上传；AvatarVersion.modelFormat必填3D格式；完整性校验要求model/texture/idle+speak动画/lip_sync/preview/fallback_2d |
| A10 | 管理闭环不完整 | 系统默认后端接口存在，前端未接入；无配置历史查询/恢复完整流程，无使用情况管理流程；“新建角色草稿”复用当前编辑表单，缺少明确空白新建过程 |
| A11 | 课堂只固定ID，不是完整配置快照 | avatar-configuration.service 的 buildResolved 按characterId即时读取voice/personality及当前角色名称；后台改声音后重新解析会改变有效配置 |
| A12 | 运行中身份仍可能回退到新默认 | bindingCandidates 将Run角色放首位，之后仍允许教案/班级/system候选；Run原角色停用/不可用时可能静默换到其他角色，应明确区分故障占位与身份切换 |
| A13 | 园所默认尚不等同system默认 | AvatarBinding没有schoolId，system scopeId=0；访问校验仍存在，但不能将全局默认称为多园所独立默认，存在配置互扰或不可用风险 |
| A14 | 当前课堂切换缺少明确确认交互 | 角色库 bind('run') 直接调用版本化Run接口，未见切换确认对话；后端权限与并发校验必须继续保留 |

上述为代码审计结果，不等于已在运行数据库中逐项复现。尤其是园所专属角色的当前模型ID、实际授权音色、真实资产加载失败原因，仍需后续在授权隔离样本及真实设备上核对。

## 5. 已有管理流程与拟补齐流程

### 5.1 现有可复用流程

管理员进入数字人角色库 → 创建角色草稿 → 上传模型版本及附属资产 → 完整性检查 → 发布版本ready → 提交角色审核 → 管理员批准 → 绑定班级/教案。

“ready版本”与“approved角色”是两个状态，不能只点版本发布就承诺教师可用。当前上传普通图片不能生成3D模型，也不能完成纯2D角色发布。

### 5.2 建议的新建流程

在原页面增加明确的新建/编辑状态：空白元信息 → 选择2D或3D展示类型 → 上传或关联授权资产 → 独立预览 → 配置已获许可的音色 → 显示兼容性与降级检查 → 保存草稿 → 提交/审核发布 → 选择园所默认或班级绑定。

3D校验应识别内嵌贴图和动作，按实际能力报告缺失，不把所有GLB都强制要求额外贴图文件；没有口型能力应明确提示，不能声称实现口型同步。继续校验扩展名、MIME、文件头、大小、内容URI及资产访问权限。

现有上限为主模型300MB、贴图30MB、动画100MB、表情/口型5MB、预览/备用图15MB；这些是代码限制，不是容量或性能承诺。真实上传和渲染兼容性仍要逐模型验证。

### 5.3 建议的更新与恢复流程

更新生成新配置版本 → 对比旧/新资产及声音 → 预览 → 审核 → 发布 → 仅影响新使用场景。恢复历史配置应生成新版本/恢复记录，不改写历史版本，也不删除历史Run引用。

正在授课的Run保持启动时已确认配置；教师要换角色时，确认影响后走现有Run绑定服务及幂等/版本校验，更新权威快照并通知大屏。默认角色变更不触发运行课堂切换。

## 6. 统一配置与同步规则（待确认方案）

| 场景 | 拟采用优先级及边界 |
|---|---|
| 教师聊天 | 当前会话明确选择的授权已发布角色 → 教师已保存偏好（若新增持久化需单独定义）→ 园所默认 → 安全内置占位；不影响聊天记录或课堂 |
| 课堂准备 | 教师明确选择且业务允许的角色 → 教案绑定 → 班级绑定 → 园所默认 → 明确声明的兼容系统默认/占位；页面展示最终来源 |
| 已运行课堂 | 教师合法确认的课堂切换配置 → 启动时冻结配置；不得重新走最新班级/园所默认来悄悄换身份 |
| 管理员预览 | 只读预览指定版本，不写聊天或课堂全局运行状态 |
| 停用/故障 | 停用禁止新选择；运行中按已冻结资产及授权规则处理。安全撤销优先，可转同身份备用图/占位并提醒教师，不静默切另一个角色 |

同一配置解析结果应携带 characterId、versionId、配置修订号、来源作用域、展示类型、授权资产URL、声音配置及降级原因。前端显示角色名、有效版本、实际展示状态和声音来源。

切换采用请求代际保护，旧请求迟到不能覆盖新角色；同Run角色版本变化必须失效解析缓存。聊天选角与消息历史分离。任何来自角色性格的文本都不能转化为额外课堂命令权限。

## 7. 数据兼容及API最小扩展设计

本节为待批准设计，未创建或执行任何迁移。

1. **2D/3D版本契约**：优先在已有 AvatarVersion 增加明确renderMode，旧数据默认3D；2D版本允许无主模型、使用现有图片资产。modelFormat允许2D场景为空，避免以伪GLB标识图片。需核查SQLite约束及向前迁移，不覆盖历史迁移。
2. **不可变发布配置**：在已有版本的兼容/配置结构中冻结声音、性格、名称及资产引用，或添加一个版本配置JSON字段；复用现有表，不建立第二套角色库。版本发布后修改通过新版本承载。
3. **Run配置快照**：优先评估现有 interactionState / snapshot JSON 的兼容扩展，冻结有效配置及来源。若使用现有JSON，不为此新增平行Run表。历史Run不靠当前默认推测回填；缺失快照应标为legacy兼容，制定恢复规则。
4. **园所默认**：扩展现有绑定作用域/归属信息，让园所ID参与默认绑定查询和活动唯一性校验。旧system全局绑定保留；不得猜测归属批量改写。
5. **统一解析**：扩展现有 `/avatars/resolve`，支持目的受限的聊天选角，服务端校验角色、园所、发布状态及版本；课堂仍必须经Run上下文解析，不能用自由角色ID覆盖运行身份。
6. **声音接入**：复用原TTS服务，为请求增加受校验的角色/版本或Run上下文，由后端选出已授权voiceId。禁止前端直接提交任意云音色、服务地址或密钥。现有只传text的调用继续兼容默认音色。不新增供应商或收费调用。
7. **管理接口**：复用现有system/class绑定与ConfigHistory，补充经授权的园所默认操作、使用情况、历史版本查询及恢复命令；所有写入继续审计。具体路径在实施时确定，不将方案路径描述为现有API。

迁移验收须包括空库初始化、旧库副本升级、重复执行、字段与索引检查、数据计数和Run/资产引用保持。真实数据库权威性未确认前，不实施真实迁移。

## 8. 拟修改文件清单及阶段顺序

| 阶段 | 文件范围 | 改动目的 |
|---|---|---|
| 1：统一解析与展示 | `frontend/src/stores/digitalHuman.ts`、`src/api/avatar.ts`、`src/avatar/`类型、`DigitalHumanStage.vue`、`avatar/ThreeAvatarStage.vue`、`ChatView.vue` | 加载真实角色、按ID解析、2D图片/3D分流、错误状态、避免旧响应覆盖 |
| 2：预览与管理 | `AvatarLibraryView.vue`及复用的小组件 | 独立预览、新建空表单、当前版本选择、默认/班级绑定、确认切换、历史入口 |
| 3：结构兼容 | `backend/src/avatars/` types/DTO/entities/service；现有迁移注册表中的新前向迁移 | 2D版本、园所默认、不可变发布配置；仅隔离库验证 |
| 4：课堂快照 | `classroom-run.service.ts`、既有快照服务、`useClassroomAvatar.ts`、`ClassroomPreflightView.vue` | 准备时确认合法角色、冻结配置、同Run换角色失效缓存、大屏一致 |
| 5：声音衔接 | `backend/src/ai/dto/tts.dto.ts`、`ai.controller.ts`、`audio.service.ts`及现有角色解析服务 | 使用已授权角色音色，保留旧请求兼容与权限；不改模型或密钥 |
| 6：专项与回归 | backend avatar/Run E2E；frontend角色库、聊天、模型、课堂、大屏测试 | 覆盖下节验收；再做隔离浏览器与真机验收 |

以上是影响清单，不是本轮修改清单。实施每阶段前保存待修改文件及哈希，不自动提交Git；每阶段测试通过后保留恢复点。

## 9. 本轮实际测试结果

所有测试使用现有代码，不新增业务测试或变更业务行为。首次前端测试因受限环境不能创建子进程而启动失败（spawn EPERM），经允许后原命令复跑获得下表汇总；未把启动失败记为功能通过。

| 检查 | 命令/范围 | 结果与限制 |
|---|---|---|
| 后端角色API及迁移基线 | `node --experimental-vm-modules node_modules/jest/bin/jest.js --config test/jest-e2e.json --runInBand --runTestsByPath test/avatar.e2e-spec.ts test/avatar-migration.e2e-spec.ts --cacheDirectory <本轮目录>/jest-cache` | 2套、11项通过；内存SQLite，上传到本轮独立目录；没有调用真实服务 |
| 前端角色相关基线 | `node node_modules/vitest/vitest.mjs run tests/unit/digitalHuman.spec.ts tests/unit/avatar-identity.spec.ts tests/unit/avatar-visual-lifecycle.spec.ts tests/component/avatar-library.spec.ts tests/component/avatar-lifecycle.spec.ts tests/unit/classroom-avatar.spec.ts --no-cache --reporter=verbose` | 6文件、26项通过；jsdom，接口/渲染有模拟，不能证明真实聊天选角闭环 |
| 本地模型解析 | `node node_modules/vitest/vitest.mjs run tests/node-avatar/avatar-model-parse.spec.ts --no-cache --reporter=verbose` | 1文件、7项通过；读取RobotExpressive GLB、AliciaSolid VRM样例；出现贴图加载警告，不能等同真实WebGL渲染通过 |
| 后端类型 | `node node_modules/typescript/bin/tsc --noEmit --incremental false -p tsconfig.build.json` | 退出码0 |
| 前端类型 | `node node_modules/vue-tsc/bin/vue-tsc.js --noEmit --incremental false -p tsconfig.app.json` | 退出码0 |
| 构建、全量P0—P4回归 | 本轮未执行 | 当前为审计阶段，没有业务修改；不把历史报告当本轮结果 |
| 本轮浏览器操作 | 未进行新建/发布/绑定/播报 | 避免向运行数据库写入；需在批准实施后的独立验收环境完成 |
| 真机与声音 | 未验收 | 未操作真实手机、麦克风、大屏或音箱；未调用付费TTS/AI |

合计44项现有相关测试通过，并非用户14项新目标全部通过。既有数字人store测试甚至只验证本地角色切换，不能证明真实资产已切换。

测试日志见同目录 `avatar-integration-evidence-20261106/`。后端测试上传临时目录为 `D:\codex\2026-10-21\referenced-chatgpt-conversation-this-is-an\outputs\unified-classroom\.tmp\avatar-integration-audit-20261106\uploads`。测试结束清理的是自身生成文件，没有修改运行资产。

## 10. 后续14项专项验收（尚待实施验证）

| 项目 | 可检验标准 |
|---|---|
| 1 创建2D角色 | 管理员可保存纯图片版本、审核发布；没有伪造3D模型 |
| 2 创建3D角色 | 授权上传真实可加载样例；预览和聊天均加载同一版本，记录资产ID |
| 3 模型不兼容 | 类型/内容/外部引用/大小校验失败有明确提示，不破坏原角色 |
| 4 发布可选 | 草稿不可选，approved+ready后列表刷新可选；停用后新会话不可选 |
| 5 名称和形象 | 同一解析响应的角色ID/版本/形象一致，重复切换和迟到响应不串角色 |
| 6 音色切换 | 后端选到对应已授权音色；真实音频及物理音箱另行验收 |
| 7 聊天保留 | 切角色前后会话ID和历史内容不清空，大模型配置不变 |
| 8 班级和准备 | 管理员绑定后从正常教师准备入口读取正确角色与来源 |
| 9 大屏一致 | 正常登录、准备、启动，三端读取Run冻结配置 |
| 10 默认不扰课堂 | Run进行中更换园所默认，当前Run声音/形象/版本保持；新Run使用新默认 |
| 11 停用和故障 | 禁止新选择；运行课堂备用图/占位有明确提示，不能白屏或偷偷换身份 |
| 12 权限 | 普通教师不能修改管理员角色；跨园所/班级、改ID及未登录请求被拒绝 |
| 13 持久化 | 保存绑定后刷新/重新登录仍正确；预览不改变持久绑定 |
| 14 原功能回归 | 点名、奖励确认、媒体停止、儿童问答审核、扫码与CommandBus同步保持 |

浏览器必须从可见登录及教师/管理员入口开始，不能手填RunId/deviceId。使用独立数据库和合成班级，不接真实库。真实手机、云音色、物理音箱分别标注验收状态。

## 11. 页面证据及限制

以下为用户提供的2026-11-05真实页面截图，仅用于说明当时页面布局与管理入口，不是2026-11-06本轮浏览器复验，更不能证明角色资产或声音已接通。

![图1 用户提供的数字人角色库页面](avatar-integration-evidence-20261106/avatar-library-user-20261105.png)

图1：可见角色列表、预览区及配置区域；2D预览空白不能单凭截图判定后端资产缺失，需要按资产ID追踪。

![图2 用户提供的AI助教页面](avatar-integration-evidence-20261106/ai-assistant-user-20261105.png)

图2：可见园所专属角色名称与机器人展示；代码存在名称与资产断链，但该截图所用具体数据库配置未查询确认。

## 12. 本轮实际交付、恢复方式与待确认事项

实际新增仅本报告、现有测试日志和上述用户截图副本；没有修改前后端业务源码、环境配置、历史迁移、运行数据库或角色绑定。测试工具可能生成忽略的临时缓存，不作为功能变更。

不需要回滚业务代码或数据库。删除本报告及本轮证据即可撤销文档交付；不要用Git reset/clean处理其他原有未跟踪资料。运行服务保持原进程。

请确认是否按第6—8节方案继续：复用已有角色实体与接口，补齐纯2D版本契约、园所默认归属、不可变发布配置与Run快照，再逐步修复聊天/预览/音色衔接。确认仅授权在隔离数据库开发验证，不包含真实数据库迁移、部署、3592重启或付费语音调用。

在确认前，本轮停止于审计及实施方案，未宣称“管理员创建、更换和发布数字人全部完成”。
