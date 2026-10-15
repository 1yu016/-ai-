# 幼儿园数字人课堂

Vue 3 + Vite + Pinia 前端与 NestJS + SQLite 后端组成的幼儿园数字人课堂系统。

## 稳定入口

- 教师登录：`/login`
- 教师班级：`/my-classes`
- 管理员工作台：`/admin`
- 备课中心（阶段三入口）：`/lesson-plans`
- 教学资源：`/resources`
- 课堂大屏：`/classroom/screen/:deviceId`

## 本地启动

```powershell
cd backend
Copy-Item .env.example .env
npm ci
npm run start:dev
```

```powershell
cd frontend
Copy-Item .env.example .env
npm ci
npm run dev
```

请先修改 `.env` 中的 JWT 密钥、管理员初始密码和第三方服务配置。生产部署、接口、权限和阶段一、二联合验收结果见 [docs/STAGE_1_2_JOINT_ACCEPTANCE.md](docs/STAGE_1_2_JOINT_ACCEPTANCE.md)。
