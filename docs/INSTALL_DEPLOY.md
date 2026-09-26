# 安装与部署

## 环境要求

- Node.js：前端 `package.json` 指定的受支持版本。
- SQLite：由 `better-sqlite3` 内嵌使用，无需独立数据库服务。
- Windows 或可运行 Node.js 的 Linux 主机。

## 安装与构建

```bash
cd backend
npm ci
npm run lint
npm run type-check
npm run test
npm run test:e2e
npm run build

cd ../frontend
npm ci
npm run lint
npm run type-check
npm run test
npm run test:e2e
npm run build
```

后端生产启动命令为 `npm run start:prod`。前端 `dist` 应由受控的静态站点服务发布，并将 `/auth`、`/ai`、`/data`、`/emotion`、`/resources`、`/lesson-plans`、`/lesson-runs` 和 `/uploads` 转发到后端。

部署前必须使用 HTTPS、非默认 JWT 密钥、独立运行账号和仅服务账号可写的数据目录。不要把 `.env`、SQLite 文件或上传目录打包到前端产物。
