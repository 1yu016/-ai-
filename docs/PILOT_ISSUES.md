# 阶段 9 / 冻结审计问题记录

当前工作区没有提供阶段 9 原始试点问题清单。以下为阶段 10 审计中实际发现的问题。

| 编号 | 严重等级 | 复现步骤 | 根因 | 修复文件 | 验证方式 | 回归结果 |
| --- | --- | --- | --- | --- | --- | --- |
| S10-001 | 高 | 开发模式进入备课中心并请求教案 | Vite 未代理 `/lesson-plans`、`/lesson-runs` | `frontend/vite.config.ts` | Playwright 真实后端流程 | 通过 |
| S10-002 | 高 | 执行前端 `npm run test` | 未配置测试框架及脚本 | `frontend/package.json`、`vitest.config.ts`、`tests/` | Vitest 33 项 | 通过 |
| S10-003 | 中 | 独立 E2E 上传测试资源 | 上传目录固定为开发目录 | `resource-file.validation.ts`、`main.ts` | 独立目录上传并在结束后检查删除 | 通过 |
| S10-004 | 中 | 未登录访问受保护路由后登录 | 登录成功始终跳到聊天页 | `LoginView.vue` | 组件测试 | 通过 |
| S10-005 | 阻断 | 尝试管理员审核或访问管理员页面 | 当前代码没有审核接口和管理员页面 | 无；禁止阶段 10 临时扩展业务掩盖 | E2E 明确跳过并报告 | 未修复，阻断冻结 |
| S10-006 | 高 | 登录后直接打开或刷新 `/lesson-plans/new` | 同路径 API 代理错误接管 HTML 导航 | `frontend/vite.config.ts` | Playwright 页面刷新 | 通过 |
| S10-007 | 中 | 新建步骤后填写环节标题 | 弹性布局被类型下拉框挤压，标题输入宽度接近 0 | `LessonPlanEditorView.vue` | Playwright 可见性与填写 | 通过 |
| S10-008 | 低 | 删除教案并查看二次确认 | Element Plus 默认按钮显示英文 OK/Cancel | `LessonPlanListView.vue` | Playwright 二次确认 | 通过 |

若后续补充真实阶段 9 试点记录，应逐项追加原编号、复现证据和真实设备回归结果，不得用本表替代原始记录。
