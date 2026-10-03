# 成员 A 阶段一接口说明

本文件记录账号、权限、班级、学生、教室、设备、课堂凭证、监护人授权和日志接口。所有 JSON 输入均由全局 `ValidationPipe` 执行白名单校验；除登录、刷新和课堂凭证消费外，接口均要求 `Authorization: Bearer <access_token>`。

## 认证

| 方法 | 路径                | 权限     | 说明                               |
| ---- | ------------------- | -------- | ---------------------------------- |
| POST | `/auth/login`       | 公开限流 | 教师登录                           |
| POST | `/auth/admin/login` | 公开限流 | 管理员登录                         |
| POST | `/auth/refresh`     | 公开限流 | 轮换 Refresh Token，旧令牌立即失效 |
| POST | `/auth/logout`      | 已登录   | 撤销会话并提升 tokenVersion        |
| POST | `/auth/logout-all`  | 已登录   | 撤销该账号全部会话                 |
| GET  | `/auth/profile`     | 已登录   | 恢复登录状态                       |

登录返回 `access_token`、`refresh_token`、`expires_in`、`userType`，以及 `teacherId` 或 `administratorId`。Refresh Token 仅向客户端返回一次，数据库只保存 SHA-256 哈希。

## 班级与教师关系

- `POST /classes`：管理员新建班级。
- `GET /classes`：管理员查看园所班级；教师只返回 `teacher_class` 关联班级。
- `GET /classes/:id`：班级详情，教师必须存在关联关系。
- `PATCH /classes/:id`：管理员编辑或停用班级。
- `POST /classes/:classId/teachers`：管理员绑定教师，正文为 `teacherId`、`role`。
- `GET /classes/:classId/teachers`：查询班级教师。
- `DELETE /classes/:classId/teachers/:teacherId`：管理员解绑教师。

## 学生

- `POST /students`：在有权限的班级新增学生。
- `GET /students?classId=&page=&pageSize=`：分页查询；默认响应不包含生日、性别等非必要隐私字段。
- `PATCH /students/:id`：编辑或停用学生。
- `POST /students/sync`：按 `classId + studentNo` 幂等批量同步，返回 created、updated、unchanged。

## 教室、设备与绑定

- `POST/GET /classrooms`、`PATCH /classrooms/:id`：教室管理。
- `POST/GET /devices`、`PATCH /devices/:id`：设备管理。
- `POST /device-bindings`：绑定设备、教室和班级；一个设备同时只能存在一个有效绑定。
- `DELETE /device-bindings/:id`：解绑但保留历史记录。
- `GET /devices/context/:deviceCode`：查询当前设备绑定的班级和教室，教师仍需通过班级权限校验。

## 短期课堂凭证

- `POST /classroom-tickets`：教师或管理员生成30至600秒有效的一次性凭证。
- `POST /classroom-tickets/consume`：使用 `ticket + deviceCode` 消费凭证。

凭证数据库只保存SHA-256哈希。凭证必须未过期、未使用、设备匹配且设备绑定仍有效；消费采用事务和条件更新防止重放。

## 监护人授权

- `POST /guardian-consents`：新增或更新授权状态。
- `GET /guardian-consents?studentId=`：查询学生授权。

`consentType` 支持 `photo`、`voice`、`artwork`；`status` 支持 `pending`、`granted`、`revoked`。调用前必须通过学生所属班级权限校验。

## 日志

- `GET /audit-logs`：管理员分页查询操作日志。
- `GET /ai-call-logs`：管理员分页查询AI调用基础日志。
- `AuditService.write()` 和 `AuditService.writeAi()` 供现有模块后续增量接入，不保存提示词、儿童原始语音或密钥。

## 权限规则

1. 独立管理员账号可管理全部班级、教室和设备；若管理员设置了 `schoolId`，只可管理同园数据。
2. 普通教师只能访问 `teacher_class` 中与自己关联的班级。
3. 学生和设备上下文接口在 Service 层重复校验，修改 URL 中的 `classId` 不会越权。
4. 学生照片、声音和作品被其他模块使用前，应查询 `guardian_consent` 且状态必须为 `granted`。
5. 本阶段只预留 `schoolId` 隔离字段，不提供多租户管理后台。

## 数据库升级

启动时默认执行迁移：

- `StageOnePlatformFoundation2026092700001`
- `RefreshSessionTokenVersion2026092700002`

迁移通过 `CREATE TABLE IF NOT EXISTS` 和列存在性检查兼容旧SQLite数据库，不删除旧教师和业务数据。部署前应先备份数据库。生产环境完成迁移验证后可设置 `DB_SYNCHRONIZE=false`；不要删除迁移记录表或直接重建正式数据库。
