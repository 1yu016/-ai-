# D-10 教师自然语言课堂操作闭环

日期：2026-10-20。仅在 integration-I1 修改；未提交、推送、迁移或访问正式数据库。保留工作区既有改动。本文只记录本轮执行，不引用 D-9 数字作为本轮结果。

## 实际功能

教师现有“课堂语音与口令”入口支持文字随机／指定点名、指定学生小红花奖励、当前资源播放、前后步骤、暂停／恢复、开始／结束课间。复用正式 CommandBus 和领域服务，不创建第二套业务事实。

“给他两朵小红花”只追问学生姓名，保留奖励数；重名、非本班、非 active 学生不猜测。课堂版本、Run、设备、步骤或阶段变化使尚未发送的旧任务失效。正常轮询不会取消同一上下文的补参。

文字参数完整可执行；语音识别沿用教师确认，结束课堂保留生命周期确认。模糊分组名称不能冒充正式 groupId。考勤、集体奖励仍使用已有正式面板，没有扩大旧接口支持范围。

成功后展示真实业务结果，奖励触发现有鼓励表现；文案明确“实际大屏播放尚未确认”。本批没有增加自动语音宣布点名结果，不宣称物理屏幕／音箱已执行。

## 调用链与保护

认证教师入口 → TeacherInstructionSession → 精确学生解析／现有能力提示 → lessonRun.teacherCommand → 原 CommandBus → 正式服务／事务／回执。

公共儿童对话入口不接入 TeacherInstructionSession。普通儿童问题继续已有安全问答；儿童说出奖励意图只提示交给教师，不发送课堂命令。

发送前保留原 requestId。响应丢失后只查询原命令，校验请求、Run、设备及 operation；可靠成功回执保留首次 result，并复用 Store 的现有状态更新与恢复。查询／刷新失败不能把已经确认成功的业务说成失败。没有可靠回执不推断成功，不自动重新 POST。

## 本轮文件

- frontend/src/classroom/command/TeacherInstructionSession.ts：新增教师输入编排、补参、上下文与请求身份保护。
- frontend/src/stores/lessonRun.ts：向既有命令链透传可选 requestId。
- frontend/src/views/LessonClassroomView.vue：连接现有入口、完整分页学生集合、资源候选确认、上下文清理；同一口令抽屉跨课间保留。
- frontend/src/components/classroom/ClassroomVoiceControl.vue：未知结果提示与只读查询入口。
- frontend/tests/unit/teacher-instruction-session.spec.ts：17 项专项。
- frontend/tests/acceptance/d10-teacher-browser.mjs：真实页面、真实 HTTP、响应丢失和公共输入分流验收。
- backend/test/artwork-real-browser.e2e-spec.ts：增加 opt-in D10 合成夹具与数据库核验，保留原测试。
- 本报告。

这些文件可能同时含以前批次的未提交修改，不能把相对 HEAD 的全部差异归为 D10。未修改后端业务实现、冻结权限、事务、生命周期、schema 或整体导航。

## 浏览器与数据库证据

最终目录：`backend/.tmp/d10-browser-08/`。

真实 Nest Controller/Service（src/ts-jest），新 SQLite `acceptance.sqlite`，后端 3189，测试 Vite 5189。运行时 synchronize=false、migrationsRun=false；新隔离数据库由测试夹具初始化，不是正式数据库副本。

`environment.json` 保存实际 PRAGMA database_list、进程及来源。AI/审核使用合成 Provider，输入为文字；未调用付费 ASR/AI/TTS，无真实幼儿资料。

| 实际浏览器操作 | 结论 |
|---|---|
| 合成教师登录、指定与随机点名 | 通过，正式点名共 2 条，Snapshot 最后结果与正式记录一致 |
| 当前图片资源提交 | 通过，Snapshot 保存真实资源身份；不代表设备 ACK |
| 缺对象追问，跨一次真实轮询后补姓名 | 通过，保留原奖励数量 |
| 第二次奖励实际提交后丢弃 HTTP 响应，再点击只读查询 | 通过，恢复原结果，没有自动重复 POST |
| 同请求同 payload 重放 | 通过，九张核心表计数与内容摘要不变 |
| 同 requestId 修改 stars | 409，九张核心表不变 |
| 暂停后随机点名 | 通过拒绝，前端无新增 POST |
| 恢复、下一步、开始课间、继续上课 | 通过 |
| 儿童入口输入奖励意图 | 通过，不发送课堂写命令 |
| 儿童普通问题 | 真实只读后端通过；AI/审核内容为合成，不是付费模型验收 |
| 越权教师查询／执行 | 403；执行按既有契约留下 1 条明确失败的命令回执，其他 8 张核心表摘要不变 |

最终正式奖励 2 条；数据库 integrity_check=ok，foreign_key_check 无异常。不能笼统宣称所有被拒绝 HTTP 请求都零命令记录：现有通用 CommandBus 的越权拒绝会持久化失败回执，本批未修改该契约。

截图：`d10-reward.png`、`d10-recovered.png`、`d10-step.png`、`d10-child-question.png`。
浏览器请求／响应与 Console：`d10-browser.json`；录像：`d10-video/`。
后端日志：`backend-http.json`；数据前后摘要及回执：`backend-results.json`。

测试结束关闭本批 Vite PID 33492；后端由测试 afterAll 关闭。最终只有原 3001/PID43644 与 5173/PID39000 仍监听，3189/5189 已关闭。未接管用户服务。

## 自动化与失败证据

- 前端完整回归：`npm run test -- --reporter=json --outputFile=../backend/.tmp/d10-frontend-release.json`：843 通过，0 失败，0 跳过。交付前另运行同范围 `d10-frontend-delivery.json`：843 通过、0 失败、0 跳过（246 suites），该文件为最终结果。
- 最终前端 `npm run type-check`、`npm run build`、`node node_modules/eslint/bin/eslint.js .` 均通过；lint 未使用 --fix。构建仍有大 chunk 警告，不代表运行失败。
- 后端六套定向 E2E：classroom-run、command-postcommit-fault、student-reward、roll-call-canonical、attendance-canonical、classroom-operation-policy：176 通过、0 失败、0 跳过，`backend/.tmp/d10-backend-regression.json`。
- 最终浏览器专项：`npm run test:e2e -- --runInBand --runTestsByPath test/artwork-real-browser.e2e-spec.ts --testNamePattern='D10 teacher instructions' --json --outputFile=.tmp/d10-browser-test-08.json`：1 通过，0 失败，11 未选中测试跳过；不是完整后端 E2E。
- 后端项目 `npm run type-check`、build、lint 本轮通过；lint 有 6 条已有警告。
- 额外尝试的裸 `npx tsc --noEmit` 包含历史测试文件，因测试 mock 类型等报错失败；项目正式 type-check 使用 tsconfig.build.json。未删除断言、放宽类型或声称该额外检查通过。
- 前端 jsdom 提示无 canvas getContext；不等同真实 WebGL／硬件验证。

保留首次 `d10-session-first.json` 的“两”字解析失败，业务修复后通过。保留 browser 01—07 失败：
01 拒绝提示断言词不匹配；02 未区分越权失败传输回执；03 真实课间抽屉卸载问题，已修复；05 合成资源分类不合法，修正夹具；06 隐藏抽屉选择器歧义；07 奖励实际字段为 result.record.id，修正对真实契约的断言。04 和最终 08 均通过；08 增加资源和儿童分流完整覆盖。未覆盖旧失败产物。

## 限制与下一步

- 未验证真实教师 ASR、物理屏幕、音箱、远场语音；没有新增费用调用。
- 未新增自动 TTS 宣布业务结果；本轮反馈是正式结果文字和既有奖励鼓励表现。
- 未知请求暂存在当前组件生命周期，刷新整个页面后没有新增持久恢复队列。Processing 且无可查询成功回执时保持未知，不擅自重新写入。
- 任意自然语言不是无限制开放：资源搜索沿用已有候选确认；正式分组、考勤、集体奖励保留原面板。
- 测试夹具缺少 visitor migration、command-synonyms 等非核心路由，Console 有对应 404；已保存，不当成生产环境完整验收。
- 未执行完整后端 unit/E2E，仅上述必要定向回归。

下一步仅建议：以已确认业务结果为唯一来源，接入可取消、受现有儿童安全与播放身份保护的简短数字人语音反馈，并验收真实音频；不自动开始。
