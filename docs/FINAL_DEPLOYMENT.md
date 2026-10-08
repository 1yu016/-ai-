# 最终部署文档
## 1. 部署结构

- 后端：NestJS，默认端口 `3001`。
- 前端：Vue 3 + Vite，生产环境发布 `frontend/dist`。
- 数据库：SQLite，路径由 `DATABASE_PATH` 指定。
- 文件目录：课程资源、数字人资源和幼儿作品分别使用受控目录。
- 教师手机、大屏和后端必须能通过同一园所局域网互相访问。

推荐在园所内部署一台固定地址的课堂服务器。前端通过 HTTPS 访问，反向代理把业务接口和 WebSocket 转发到后端。二维码只能放短期课堂凭证和局域网地址，不能包含教师 Token 或幼儿信息。

## 2. 生产前准备

1. 安装 Node.js `22.18+` 或 `24.12+`。
2. 为服务创建独立运行账号和数据目录。
3. 从 `backend/.env.example`、`frontend/.env.example` 创建生产配置，禁止提交真实密钥。
4. 至少配置：`DATABASE_PATH`、`JWT_ACCESS_SECRET`、上传目录、园所局域网地址。
5. 正式环境固定使用：

```env
DB_SYNCHRONIZE=false
DB_MIGRATIONS_RUN=true
```

6. AI、ASR、TTS、视觉模型按实际采购服务配置；没有配置时系统应进入安全降级，不能伪造成功。

## 3. 安装、质量门禁与构建

```bash
cd backend
npm ci
npm run lint
npm run type-check
npm run build
npm run test -- --runInBand
npm run test:e2e -- --runInBand

cd ../frontend
npm ci
npm run lint
npm run type-check
npm run build
npm run test
npm run test:e2e
```

任何命令失败都应停止发布。数据库升级前先完成备份和迁移副本演练。

## 4. 启动

```bash
cd backend
npm run start:prod
```

前端发布 `frontend/dist`。生产反向代理至少需要转发：

- `/auth`、`/ai`、`/data`、`/emotion`
- `/admin`、`/audit-logs`、`/ai-call-logs`
- `/teachers`、`/classes`、`/students`、`/classrooms`、`/devices`
- `/guardian-consents`、`/device-bindings`、`/classroom-tickets`
- `/resources`、`/uploads`、`/avatars`、`/artworks`
- `/lesson-plans`、`/lesson-runs`、`/classroom-runs`、`/classroom-commands`
- `/classroom-mobile` 及其 WebSocket 升级请求

前端路由刷新必须回退到 `index.html`；XHR 和 WebSocket 请求必须转发后端。

## 5. 首次检查

1. 管理员登录后立即修改初始密码，并从环境变量移除初始密码。
2. 打开管理员看板，检查数据库、上传目录、设备在线状态和待审核资源。
3. 创建教师、班级、教室和设备绑定。
4. 使用测试班级完整走一次扫码、一键上课、恢复、结束和总结流程。
5. 确认普通教师不能访问管理员路由，管理员不能直接控制进行中的课堂。
6. 检查 `audit_log` 和 `ai_call_log` 持续写入，日志中没有密码、Token、原始音频或未脱敏联系方式。

## 6. 现场验收

必须在真实大屏、教师手机、麦克风、摄像头、音响和园所网络上执行 `FINAL_ACCEPTANCE_REPORT.md`。外部 AI 断网时，基础课堂按钮、资源播放和本地关键词仍应可用。现场未执行的项目只能标记“待现场验证”。
