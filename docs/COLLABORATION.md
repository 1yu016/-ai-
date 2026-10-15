# 双人协作开发流程

## 分支职责

- `main`：稳定分支，只接受通过质量门禁和代码审查的 Pull Request。
- `feature/member-a`：成员A工作分支，主要负责后端、数据库迁移、权限、AI服务和接口测试。
- `feature/member-b`：成员B工作分支，主要负责前端、课堂大屏、交互和3D数字人。

禁止直接向 `main` 推送功能代码，也禁止在共享分支执行强制推送。

## 开发流程

开始工作前先同步稳定分支：

```bash
git switch main
git pull --ff-only origin main
git switch feature/member-a
git merge main
```

成员B将最后一条命令中的分支改为 `feature/member-b`。

完成一个可独立审查的改动后：

```bash
git add <本次修改的文件>
git commit -m "feat: 简短说明"
git push origin feature/member-a
```

在 GitHub 创建从个人分支到 `main` 的 Pull Request，由另一名成员审查。质量门禁通过且审查意见处理完成后再合并。

## 提交信息

- `feat:` 新功能
- `fix:` 缺陷修复
- `test:` 测试调整
- `docs:` 文档修改
- `chore:` 工程配置和依赖维护
- `refactor:` 不改变外部行为的代码整理

一个提交只处理一个主题。不要把格式化、功能开发和无关文件混入同一个提交。

## 容易冲突的文件

修改以下文件前，两名成员需要先沟通负责人：

- `backend/src/app.module.ts`
- `frontend/src/router/index.ts`
- `backend/package.json`、`frontend/package.json`
- 两端的 `package-lock.json`
- 数据库实体和迁移文件
- 公共接口类型与环境变量示例

数据库迁移编号必须递增且唯一。新迁移提交前先同步 `main`，避免两个人使用相同编号。

## 安全要求

禁止提交：

- `.env` 和真实API密钥
- SQLite实际数据文件
- `node_modules`、`dist`、测试报告
- 用户上传文件和录音
- 临时文档渲染目录

只提交 `.env.example` 中的占位配置。发现密钥误提交时，应立即撤销密钥并更换，不能只删除最新文件。

## 合并条件

Pull Request 必须满足：

1. GitHub Actions `quality` 检查通过。
2. 至少一名协作者完成审查。
3. 分支已合并最新 `main`，没有未解决冲突。
4. 功能包含必要测试和验收说明。
5. 不包含密钥、数据库、上传文件或构建产物。
