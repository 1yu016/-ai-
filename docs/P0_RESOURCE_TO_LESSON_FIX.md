# P0：旧版资源到 AI 备课断链修复

日期：2026-11-03。范围仅为旧版 integration-I1-unified-20261102，未读取或修改 P6 实现。

## 1. 状态与工作区

**修复与隔离浏览器验收已完成，尚未更新正在运行的 5592/3592。等待用户批准应用。**

运行版：`D:/trae_project/merge-worktrees/integration-I1-unified-20261102`，分支 `merge/unified-classroom-20261102`，HEAD `d24d9e9f3a1a24a90f70542f368165acd623efca`。

为避免 Vite 热更新影响正在使用的教师页面，增量修改和测试全部位于独立工作区：
`D:/trae_project/merge-worktrees/integration-I1-resource-fix-20261103`，分支 `fix/old-resource-lesson-20261103`，基于上述 HEAD。未提交、未推送、未部署。没有复制整套项目覆盖运行版。

原版 5592 前端 PID 24212，创建时间 2026-11-02 22:19:16 +08:00；3592 后端 PID 38608，创建时间 2026-11-03 11:55:07 +08:00。本轮核实命令行仍分别为该旧版 Vite 和 backend/dist/main.js，末次复核仍是同一 PID。没有启动、停止或重启它们。

运行数据库记录路径：`D:/trae_project/merge-worktrees/integration-I1-unified-20261102/backend/data/classroom.sqlite`。依据为旧版 B 阶段脱敏运行配置记录、回退记录与本轮相同 PID/创建时间核对；本轮只核实文件存在，不读取进程环境，不连接这个数据库，也未读取其业务数据。前端实际代理目标记录为 `http://127.0.0.1:3592`。上传和备课均由此后端的 ResourceModule/LessonPlanModule 使用同一个 TypeORM DataSource，没有代码上的第二套资源数据库。代码默认 app.sqlite 不能当作实际运行库。

## 2. 实际根因与证据

1. `frontend/src/components/lesson/LessonAiPlanGenerator.vue`：没有任何资源选择入口，生成请求把 `resourceIds` 写死为 `[]`。这是完整 AI 备课不能使用上传资源的直接断点，非缓存问题。
2. `frontend/src/components/LessonResourceSelector.vue`：请求固定 `reviewStatus=approved`，前端再过滤一次，导致教师自己的草稿/待审核资源完全消失，没有解释原因。后台上传默认创建 draft，因此上传成功不等于已获课堂使用许可。
3. 同文件的“PDF/PPT课件”选项实际只发送 `resourceType=document`；真实上传类型通常为 `pdf` 或 `ppt`，被错误筛掉。
4. `frontend/src/stores/courseResource.ts`：只允许八个前端固定分类；后台支持自定义分类，合法资源被 normalizeServerResource 返回 null 静默丢弃。浏览器本次特意使用“自定义科学课件”验证。
5. `backend/src/lesson-plans/lesson-plan.service.ts` 已验证 resourceIds，但完整生成方法仅把原始 DTO 交给模型；没有传递资源标题、类型、标签和描述。输入只有数字 ID，模型无法了解所选资料的元信息。
6. 隔离浏览器发现第二个实际故障：创建成功返回带 resourceId 的 steps 后，从 new 跳转 edit 复用同一个 LessonPlanEditorView；其原代码只在 onMounted 读取教案，路由变化不加载，造成保存成功后界面仍为空。现仅补 route.params.id 变化后的加载。

已排除：后端资源列表不是固定测试数据，按 created_at DESC、id DESC 稳定排序且支持分页；选择器每次打开重新请求。未发现上传与备课使用不同后端/数据源的代码路径。没有关闭后端权限或审核过滤来修复。

## 3. 上传、列表、审核、生成和持久化接口

旧版资源库可见页面实际使用分片上传：
- `POST /resources/upload-sessions`
- `POST /resources/upload-sessions/:id/chunks/:chunkNo`
- `GET /resources/upload-sessions/:id/chunks`
- `POST /resources/upload-sessions/:id/complete`
另保留原始兼容接口 `POST /resources/upload`。

合并后在 RESOURCE_UPLOAD_PATH 保存原始文件，通过 ResourceService 写 `teaching_resource`、`resource_version` 及相关元数据；初始审核状态 draft。不会伪造已审核状态。

- `POST /resources/:id/submit-review`：教师提交审核。
- `POST /resources/:id/review`：管理员审核。
- `GET /resources`：资源库与备课选择器共用，后台继续限制自己的资源及合法已审核共享资源。
- `GET /resources/:id`：教案重新打开时按 ID 获取详情，避免第一页之外的资源回显失效。
- `POST /lesson-plans/ai-drafts`：实际提交选中的 resourceIds。
- `POST /lesson-plans/ai-drafts/:id/confirm`：教师确认后创建草稿教案；再次校验资源仍可使用。
- `POST /lesson-plans/authoring` 与 `GET /lesson-plans/:id`：编辑保存和重新读取。

生成草稿 inputJson 保存所选 ID；通过校验的 teachingProcess.resourceId 写入 `lesson_step.resource_id`，同步 `resource_reference` 并建立 `lesson_plan_version`。确认时不自动发布或开启课堂。

## 4. 实际修复

### 业务源码（共六个文件）
- `frontend/src/components/lesson/LessonAiPlanGenerator.vue`：复用现有资源选择器，多选去重/移除，最多 30 项，显示已选资源，发送实际 ID；输入或资源变化使旧候选失效。
- `frontend/src/components/LessonResourceSelector.vue`：显示后台允许查看的全部审核状态，不可用项禁选并说明原因；独立使用 ppt/pdf/document 等真实类型；保留分页、搜索和访问控制。
- `frontend/src/stores/courseResource.ts`：允许服务端自定义分类，保留真实分类名称；继续验证 ID、类型和文件 URL。表单分类类型同步放宽以兼容已有后台能力。
- `frontend/src/views/LessonPlanEditorView.vue`：仅补新建到编辑或不同教案 ID 跳转时加载，保留已绑定资源按 ID 获取机制。
- `backend/src/lesson-plans/lesson-plan.service.ts`：将已经 getUsable 验证的资源元数据交给现有 AI 服务。
- `backend/src/lesson-plans/lesson-plan-ai.service.ts`：请求只附所选资源的 ID/标题/类型/年龄/标签/描述，不附文件地址、所有者或原始文件；提示词明确 metadata_only，不宣称解析正文；校验每个选中资源出现在教学环节中，缺失时按既有两次上限失败回退，避免“选择成功但保存丢关联”。

### 测试与工具
- `frontend/tests/component/lesson-ai-plan-generator.spec.ts`
- `frontend/tests/component/lesson-resource-binding.spec.ts`
- `backend/src/lesson-plans/lesson-plan-ai.service.spec.ts`
- `backend/test/lesson-plan.e2e-spec.ts`
- `frontend/tests/e2e/resource-to-ai.spec.ts`：所有主流程从可见登录/UI进入，无手填资源ID或隐藏路由。
- `tools/run-resource-lesson-browser.cjs`：只启动随机端口的隔离服务，环境采用允许列表，显式临时库，自动建表/启动迁移关闭；迁移仅显式初始化新测试库。
- `tools/resource-lesson-vite.mjs`：隔离的 Vite 缓存和配置加载，不改运行版 Vite 配置。
- `tools/resource-lesson-offline-provider.cjs`：测试进程 preload，明确离线返回，不进入业务代码、不调用外部模型。

源文件/测试基线备份：独立工作区 `.tmp/resource-lesson-backup/`。可审查补丁：`evidence/resource-to-ai-20261103/resource-to-lesson.patch`。没有历史迁移、实体结构、API密钥、JWT配置或数据库结构改动。

## 5. 浏览器实际验收

Chrome 实际渲染页面，使用全新合成教师/管理员和合成 PPTX，不使用真实课件或录音。

最终成功环境：
- 数据库：`D:/trae_project/merge-worktrees/integration-I1-resource-fix-20261103/evidence/resource-to-ai-20261103/after/acceptance-1793685598046.sqlite`
- 本次后端 62182、前端 62183；均由测试工具启动并在验收结束后停止。并非 5592/3592。
- DB_SYNCHRONIZE=false，DB_MIGRATIONS_RUN=false。模型为 OFFLINE_FIXTURE_NO_NETWORK。

实际链路：教师登录 → 工作台课程资源 → 上传资源 → 真实分片上传并保存元数据 → AI生成教案中看见 draft 但禁选 → 返回资源详情提交审核 → 独立浏览器管理员登录/资源审核/通过 → 教师重新打开资源选择器 → PPT/PPTX 类型查询 → 选择 → 生成 → 预览 → 教师确认创建 → 编辑页显示资源 → 刷新 → 保存 → 备课中心重新打开 → 资源仍回显。

结果：resourceId=1，类型 ppt，分类“自定义科学课件”；aiDraftId=1；lessonPlanId=1，保持 draft；请求 resourceIds=[1]，保存资源 ID=[1]。文件与元信息真实保存，AI 内容来自明确的离线替身，不代表真实模型质量验收。

截图（以下路径相对于独立修复工作区 `D:/trae_project/merge-worktrees/integration-I1-resource-fix-20261103`，原5592目录仅放报告副本）：
- `evidence/resource-to-ai-20261103/before/01-before-no-resource-entry.png`：旧版原始 UI，无选择入口。
- `evidence/resource-to-ai-20261103/after/02-uploaded-draft.png`：真实新上传资源。
- `evidence/resource-to-ai-20261103/after/03-unreviewed-visible-disabled.png`：未审核可见但禁选。
- `evidence/resource-to-ai-20261103/after/04-admin-approved.png`：正常管理员审核。
- `evidence/resource-to-ai-20261103/after/05-selected-for-ai.png`：已选资源与能力限制说明。
- `evidence/resource-to-ai-20261103/after/06-offline-ai-preview.png`：离线生成预览。
- `evidence/resource-to-ai-20261103/after/07-reopened-resource-binding.png`：刷新、保存及重开后资源仍存在。

机器证据：after/browser-result.json、after/environment.json、after/provider-requests.jsonl、after/browser.log。

首次浏览器尝试有两类失败：测试点击 Element Plus 内层只读 input，被占位层截获（改为点击真实可见选择框，未改业务）；随后复现 new→edit 不加载的真实业务故障，增加最小加载修复和回归后全链路通过。未隐藏失败。

## 6. 测试结果

- 前端 `npm run build`：通过，包含 vue-tsc 类型检查和生产构建；仍有原有大包体积提示。
- 后端 `npm run type-check`、`npm run build`：通过。
- 前端 `npm test -- tests/component/lesson-resource-binding.spec.ts tests/component/lesson-ai-plan-generator.spec.ts tests/unit/resources-adapter.spec.ts tests/unit/resource-stores.spec.ts tests/unit/lesson-authoring.spec.ts`：5文件、27项通过。
- 前端 `npm test -- tests/component/ClassroomScreenView.spec.ts tests/component/child-qa-panel.spec.ts tests/unit/resource-player-media.spec.ts tests/unit/classroom-mobile.spec.ts`：4文件、75项通过。
- 后端 `npm test -- --runInBand src/lesson-plans/lesson-plan-ai.service.spec.ts src/resources/resource.service.spec.ts`：2套、10项通过。
- 后端 `npm run test:e2e -- --runInBand test/lesson-plan.e2e-spec.ts test/resource.e2e-spec.ts`：2套、20项通过。包括匿名拒绝、非法资源引用、他人数据隔离、后台审核限制、上传类型/下载权限/分片归属、确认前草稿、保存和资源引用。
- `node tools/run-resource-lesson-browser.cjs`：最终浏览器完整流程1项通过。
- `node tools/run-resource-lesson-browser.cjs --baseline`：原版 UI 截图1项通过；此模式应只在专用测试基线源上使用，日常不要为截图切换运行版文件。
- `git diff --check`：通过。

未运行全仓全部测试，未将相关回归数量当作完整系统验收。没有真实手机、麦克风、音箱验收；本轮不修改这些功能。

## 7. 类型、权限和能力边界

PPTX/PPT、PDF、图片、音频、视频可在后台既有许可范围内选择并作资源关联，类型筛选使用真实枚举。资源 E2E 覆盖旧版所支持类型；本轮真实浏览器新文件闭环仅测试 PPTX。

**旧版不解析这些文件的正文、图片或声音，不提供P6解析状态、OCR、逐页提取或视觉理解。** 不伪造“解析中/解析完成”；界面明确说明只把元数据作为 AI 备课参考。复杂内容需要教师填写描述/补充要求并核对。

未审核资源仅展示原因，不可绑定；后台 getUsable 在生成、确认和原有保存链路持续校验审核与访问范围。已经被撤销权限/归档的资源仍会被拒绝。共享范围完全沿用既有后端规则，没有添加跨班级权限。

## 8. 应用与恢复

用户尚未批准更新 5592。本次只交付独立分支改动与报告，不能打开旧5592就声称修复已上线。

后续批准后先核对旧版 HEAD/新修改，再逐文件应用六个业务源码与测试，不能全项目覆盖。前端改动会热更新；后端改动需要后续受控重启才能生效。

**3592 原有效密钥仍仅在旧运行进程环境中，当前 .env 无 ARK_API_KEY、VOLC_API_KEY 为空。没有安全重启条件，不能为应用本修复擅自重启。** 若只应用前端，资源选择会出现，但完整后端元数据修复尚未生效，必须如实标记部分应用。

当前恢复方式：运行版未变，无需回滚；独立修复工作区保留备份和补丁，可逐文件比较恢复，不执行 reset/clean，不处理其他开发者改动。所有测试库位于明确隔离目录，未替换任何真实数据库。
