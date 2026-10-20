# 阶段五 D-1：数字人统一身份与课堂联动

日期：2026-10-19。工作范围仅 `D:\trae_project\new1\integration-I1`，未提交或推送。

## 1. Before / After 与产品体验

之前：开场/全屏用 Three 舞台，右侧伙伴固定用另一个 SVG 机器人；resolve 响应没有世代校验；班级/Run 切换可能被旧请求覆盖；数字人暂停主要依赖文案和页面可见性。

现在：同一运行课堂的开场、右侧伙伴、全屏复用服务端解析的 AvatarIdentity。教师不用重复选角色；Run/班级/设备变化撤下旧身份并重新解析。暂停停止实际 WebGL 动画循环，恢复重新启用且重置时间基准。模型下载失败仍保留课堂按钮和安全备用表现，儿童界面不出现角色选择、管理或调试控件。

本批还修复真实操作发现的管理员角色选择竞态：选择第二角色时撤下旧详情/绑定按钮，旧异步响应和预览 Blob 不得覆盖当前选择，避免把前一角色绑定给另一班。

## 2. Identity / Provider 边界

- `AvatarIdentity`：classId / runId / deviceId / characterId / versionId。只由已有 `/avatars/resolve` 的权威结果生成，前端不通过名称猜角色。
- 页面通过 `useClassroomAvatar` 提供 Run 上下文及暂停状态；同上下文的多场景请求去重，切换/重置使旧 resolve 成功或失败均失效。
- `ClassroomAvatar` 在课堂上下文中复用 `DigitalHumanStage`；非课堂上下文保留原 SVG Adapter 能力。
- `DigitalHumanStage` 不再在挂载时自行读取 Run 或覆盖管理员预览。Three 层不获取班级权限，不执行 CommandBus、课堂步骤、ASR 或 TTS 业务。
- 复用 `AvatarLoadedModel` 的 update/playAnimation/setExpression/resetExpressions/dispose，未新建数字人框架、课堂状态机、Provider 服务或音频引擎。
- Three 的模型下载支持 AbortSignal；解析已经开始时未强制中断解析，而是在返回后校验 generation 并释放旧模型。
- 按模型资源优先加载，避免 cartoon_animal 分类或名字包含“小熊”就跳过已绑定主模型；失败使用已有内置模型/程序化/2D 降级。共享几何和材质按对象去重释放；清空旧程序化部件引用。
- VRM 0.x 使用已安装 three-vrm 的 `VRMUtils.rotateVRM0` 归一化正面方向，不开发新动作或口型。

### 兼容边界

班级绑定修改/取消新增既有管理员守卫；普通教师真实 HTTP 返回 403，前端班级绑定按钮禁用。管理员仍受原班级/园所访问及角色版本资格检查。没有修改通用 PlatformAccessService、Operation Policy 或 ClassroomRun 生命周期。

保留已有服务端教案/课堂覆盖优先级及 Run 冻结版本：运行中的课堂不会因为管理员修改班级默认角色而突然换脸，新的班级绑定影响后续课堂。没有强制让班级默认值覆盖历史 Run 或已有教案/临时绑定；若产品要求“跨所有历史/临时覆盖也强制班级唯一”，属于另需明确的兼容规则，不在本批悄悄改写。

## 3. 本批修改文件

以下是 D-1 实际涉及文件，不把集成仓库其他既有 dirty 修改归入本批：

| 文件（相对仓库） | 原因 |
|---|---|
| backend/src/avatars/avatar-configuration.service.ts | 班级绑定设置/取消要求管理员，沿用已有访问及版本资格 |
| frontend/src/avatar/types.ts | 统一 AvatarIdentity 类型 |
| frontend/src/stores/digitalHuman.ts | 身份同步、请求去重/世代、暂停标记；状态机实例按 Store 隔离 |
| frontend/src/composables/useClassroomAvatar.ts（新增） | 权威课堂上下文到身份的轻量连接 |
| frontend/src/components/DigitalHumanStage.vue | 去除挂载时隐式 Run 查询；公开身份观测；课堂禁本地选择；友好降级文字 |
| frontend/src/components/digital-human/ClassroomAvatar.vue | 课堂伙伴和舞台共用身份/Provider；保留非课堂 SVG |
| frontend/src/components/avatar/ThreeAvatarStage.vue | 暂停/隐藏停止真实循环，模型优先，下载取消、迟到失败保护、渲染降级标记 |
| frontend/src/avatar/AvatarLoader.ts | AbortSignal、共享资源去重释放、VRM 0.x 朝向归一化 |
| frontend/src/views/LessonClassroomView.vue | 接入身份；同组件 Run 路由切换时清理旧状态/语音/全屏并加载新 Run |
| frontend/src/views/ClassroomScreenView.vue | 接入同一课堂身份，保留已有生命周期/世代保护 |
| frontend/src/views/AvatarLibraryView.vue | 教师禁止修改班级身份；选择世代与 Blob 清理，防旧角色误绑定 |
| frontend/tests/unit/avatar-identity.spec.ts（新增） | 多场景去重、本地选择锁、旧班响应、解析失败降级 |
| frontend/tests/component/avatar-lifecycle.spec.ts | 真实模型抽象的旧加载释放、迟到失败、实际 renderer 停止/恢复 |
| frontend/tests/component/avatar-library.spec.ts | 角色详情切换期间旧绑定控件撤下 |
| frontend/tests/node-avatar/avatar-model-parse.spec.ts | 真实 VRM 文件朝向断言 |
| backend/test/classroom-run.e2e-spec.ts | 班级配置测试夹具改用管理员，保留原绑定/冻结版本断言 |
| backend/test/classroom-run-legacy.e2e-spec.ts | 同上；保留其他权限/事务断言 |
| backend/test/artwork-real-browser.e2e-spec.ts | 复用既有 opt-in 隔离应用夹具，新增独立 D1 用例；不重写初始化机制 |
| frontend/tests/acceptance/d1-browser.mjs（新增） | 真实管理员与教师页面，HTTP、WebGL 绘制/删除、故障注入、截图 |
| docs/D1_AVATAR_IDENTITY_AND_CLASSROOM.md（新增） | 本报告 |

## 4. 本轮自动化结果

证据目录：`D:\trae_project\new1\integration-I1-evidence`。

| 命令/范围 | 实际结果 | 日志 |
|---|---|---|
| 前端数字人初始定向 5 文件 | 26 通过 | d1-targeted-first.log |
| 新身份/生命周期初始定向 | 5 通过 | d1-identity-lifecycle.log |
| 最终完整 frontend npm test -- --pool=vmThreads --maxWorkers=1 | 92 文件，744 通过，0 失败/跳过 | d1-front-full-complete.log |
| 后端 avatar / classroom-run / classroom-run-legacy | 3 套件，140 通过，0 失败/跳过 | d1-backend-targeted.log |
| opt-in D1 real 浏览器用例 | 1 通过，7 非本轮选中的既有用例跳过 | d1-browser-complete.log |
| 最终前端 typecheck / build / 非修复 lint | 每项退出码 0 | d1-frontend-static-delivery.json |
| 后端 typecheck / build / lint | 每项退出码 0 | d1-backend-static.json |

本轮未重新运行完整后端 unit 或完整后端 E2E；不把 I-2 历史结果当成本轮通过。Canvas/jsdom 警告、既有后端 lint warning 和大 chunk 提示未通过删断言或改安全守卫消除。

### 首次失败记录

1. `d1-browser-first.log`、`.tmp/d1-browser-20261019-01`：真实复现管理员切换角色仍提交前一角色；第二班最终绑定/冻结为角色 1，未得到预期角色 2。修复的是业务界面的选中身份竞态，不是将预期改成角色 1。
2. `.tmp/d1-browser-20261019-02` 真实流程通过，但进一步补充 WebGL 删除证据。
3. `d1-browser-final.log`、`.tmp/d1-browser-20261019-03`：增强测试在全屏模型尚未完成加载时就退出，错误要求删除未分配的 GPU 资源。改为可靠等待 ready 后退出，保留原失败，不放宽资源删除断言。
4. `.tmp/d1-browser-20261019-04` 增强场景通过；人工查看截图发现 VRM 0.x 背向镜头，补库提供的朝向归一化后，在 `.tmp/d1-browser-20261019-05` 重新通过并保存正面截图。

## 5. 智能体真实浏览器操作

隔离前端 `http://127.0.0.1:5189`，仅代理隔离后端 3189。后端 ts-jest 加载当前源码，实际 DataSource 指向：

`D:\trae_project\new1\integration-I1\backend\.tmp\d1-browser-20261019-05\acceptance.sqlite`

运行时 synchronize=false / migrationsRun=false；仅在全新测试文件内初始化现有实体结构，没有新增 schema 或执行 migration。模型上传文件也隔离在该目录的 avatars 子目录。合成管理员/教师/班级/教案；无真实幼儿数据，无外部付费服务。

亲自执行：

1. `/login` 管理员登录 → `/avatars`，分别选择两个合成角色，为两个班级真实 POST 绑定。
2. 教师登录 → 两个班级各自 `/classroom/preflight/:planId`，点击“准备到大屏”“开始课堂”。真实创建 Run，服务端冻结各自 characterId/versionId。
3. 查看开场；点击“进入教学”；核对右侧伙伴；展开全屏并退出；暂停/恢复；刷新后核对身份。
4. 两个班级使用不同模型格式：真实 GLB 与 VRM 文件，浏览器实际 WebGL 加载，不是用 Mock 证明绑定。
5. 对受保护模型资源做可控网络失败，保持真实身份解析与后端状态；验证备用形象和教学控制仍可用。

| 场景 | 最终状态 |
|---|---|
| 管理员为两班绑定不同角色 | 通过，真实 HTTP 201 |
| 普通教师直接修改班级绑定 | 通过，真实 HTTP 403 |
| 两班各自开场→教学→右侧→全屏→退出 | 通过，characterId 分别为 1、2 |
| 两班暂停/恢复、刷新后身份恢复 | 通过 |
| 全屏已加载模型退出时 GPU 资源删除 | 通过；班 1 删除计数 195→260，班 2 为 160→240 |
| PAUSED 实际绘制停止 | 通过；在可控两次 rAF 间 draw 计数不增加，不仅检查页面文字 |
| 两班模型下载故障 | 通过，fallback 标记且教师暂停按钮仍可用 |
| 迟到模型/resolve、组件卸载、页面隐藏 | 自动化通过；未将所有这些边界都冒充独立真实浏览器场景 |
| 物理大屏、真实音箱、移动设备性能 | 未验证 |

浏览器 pageerror=[]；Console 不是零告警：精简测试后端不导入游客迁移模块，因此该登录附带请求 404；主动阻断的模型请求 ERR_FAILED；软件 WebGL 有 GPU stall 提示。这些全部保留在证据中。

## 6. 截图、HTTP、模型与数据库证据

最终根目录：`D:\trae_project\new1\integration-I1\backend\.tmp\d1-browser-20261019-05`。

- `admin-binding-1.png` / `admin-binding-2.png`。
- `opening-class-1.png` / `opening-class-2.png`（后者已经正面显示）。
- `fullscreen-class-1.png` / `fullscreen-class-2.png`。
- `paused-class-1.png` / `paused-class-2.png`。
- `fallback-class-1.png` / `fallback-class-2.png`。
- `d1-browser.json`：全部场景、请求响应、身份、模型资源请求、WebGL 绘制和资源删除计数、Console。
- `backend-http.json` / `backend-results.json`：真实后端状态、表计数/SHA-256、实际数据库连接证明。
- 关闭前 integrity_check=ok，foreign_key_check=[]。

这些证据证明浏览器和真实测试后端的身份/生命周期链路，不证明物理设备 ACK 或真实硬件播放完成。

## 7. 保护与服务清理

原 A 和 I-0 的保护核验与 I-2 结束时一致：HEAD/index/status 不变，无新增缺失/备份制品差异。唯一既知 BOM-only 差异没有恢复或覆盖。证据 `d1-original-preservation.json`。

本轮仅创建并最终停止 Vite PID 6336（5189）；Nest 测试应用自行 close。结束时 3189/5189 不再监听，原 3001 PID 21796、5173 PID 39000 保留。证据 `d1-service-stop.json`、`d1-ports-final.json`。测试文件和失败证据保留，不清理用户进程或数据。

## 8. 剩余与 D-2 建议

- 示例 VRM 没有内置可用动作片段，当前仍为静态基础姿态；这不是完整动作/口型验收通过。
- 尚未验证真实低配置终端、长课资源压力、多进程、物理屏幕及商用 Provider。
- 本批真实操作覆盖教师页面的开场/右侧/全屏；独立学生大屏页复用链路有组件回归，但没有单独双终端真实浏览器联验，不将它写成已通过。
- 保留既有教案/Run 覆盖和冻结版本的兼容规则，未强制改写历史身份。

下一批仅建议 D-2：以已绑定身份为基础，先准备儿童友好的审核形象及规范待机姿态；复用 playAnimation/setExpression 接入真实已授权的动作/表情资产与格式适配，逐项验证无动作时降级；再规划口型能力，不把 ASR/实时问答并入这一步。本批停止，未实施 D-2。
