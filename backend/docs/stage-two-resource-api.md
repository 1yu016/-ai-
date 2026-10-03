# 成员 A 阶段二：课程资源库

本阶段只实现资源库，不包含 AI 备课和教案生成。所有接口均需 JWT，除旧版本地演示资源的 `GET /resources/:legacyId/content`。

## 数据库

- `teaching_resource`：资源主记录、所有者、园所、类型、年龄段、领域、审核状态和当前版本。
- `resource_category`：树形分类。
- `resource_version`：版本号、原文件名、UUID 存储名、SHA256、MIME、大小和时长。
- `resource_tag` / `resource_tag_relation`：标签及关系。
- `resource_favorite`：教师收藏，`teacher_id + resource_id` 唯一。
- `resource_reference`：教案、课堂或其他业务引用。
- `resource_review`：审核历史。
- `upload_session` / `upload_chunk`：断点续传会话和分片。

迁移 `202609270004-ResourceLibraryStageTwo` 使用列存在检查和 `CREATE TABLE IF NOT EXISTS`，保留旧 `teaching_resource` 数据。

## 主要接口

- `POST /resources/upload`：普通单文件上传。
- `POST /resources/:id/versions`：上传新版本，资源重置为 `draft`。
- `GET /resources`、`GET /resources/search`、`GET /resources/:id`：分页、筛选、稳定排序。
- `GET /resources/:id/download`：鉴权下载，不接受客户端文件路径。
- `PATCH /resources/:id`、`DELETE /resources/:id`：编辑和安全软删除。
- `POST/DELETE /resources/:id/favorite`：收藏/取消收藏。
- `POST/DELETE /resources/:id/references`：引用/取消引用。
- `POST /resources/:id/submit-review`：教师提交审核。
- `POST /resources/:id/review`：管理员通过、拒绝或停用。
- `POST /resources/categories`、`GET /resources/categories`：分类管理。
- `POST /resources/upload-sessions`：创建分片会话。
- `GET /resources/upload-sessions/:id/chunks`：查询已上传分片。
- `POST /resources/upload-sessions/:id/chunks/:chunkNo`：上传分片，表单字段 `file` 和 `sha256`。
- `POST /resources/upload-sessions/:id/complete`：合并并校验整体 SHA256。
- `DELETE /resources/upload-sessions/:id`：中止并清理会话。
- `POST /resources/:id/ai-suggestion`：生成标注建议，不写库。
- `POST /resources/:id/ai-suggestion/confirm`：教师确认后写入标签、年龄段、目标和活动建议。

## 文件存储与安全

- 正式文件目录：`RESOURCE_UPLOAD_PATH`，默认 `uploads/resources`。
- 分片临时目录：`RESOURCE_CHUNK_PATH`，默认 `uploads/.chunks`。
- 物理文件使用 UUID；数据库保留原文件名。
- 扩展名、声明 MIME、文件魔数、真实内容及资源类型必须一致。
- 拒绝双扩展名、可执行/脚本格式、路径穿越、越权下载和越权分片会话。
- 不再以静态目录公开资源文件；下载必须经过服务端鉴权。
- 分片会话默认 24 小时过期，并每小时清理一次过期文件。

## 审核和权限

- 教师只能管理自己的资源，可查看自己的草稿。
- 园所管理员只能管理本园资源；全局管理员可管理全部资源。
- 新资源是 `draft`，教师提交后为 `pending`，只有管理员可改为 `approved/rejected/disabled`。
- 只有 `approved` 资源可向同园其他教师共享。
- 存在引用时删除返回 `409` 和 `referenceCount`。
