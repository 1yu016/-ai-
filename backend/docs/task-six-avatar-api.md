# 任务6：3D数字人角色、版本与资源管理

本任务只提供服务端数字人数据、文件、版本、审核、完整性检查和课堂版本固定能力，不包含 WebGL、Three.js 或模型渲染。

## 数据库迁移

迁移：`202609270008-AvatarCharacterAssets`

- `avatar_character`：角色名称、分类、所有者、园所、审核状态和当前版本。
- `avatar_version`：递增版本号、引擎版本、模型格式、兼容信息、发布校验值和状态。
- `avatar_asset`：主模型、贴图、动画、表情、口型、预览图和2D备用资源。
- `classroom_run.avatar_version_id`：开课时固定选定版本。
- `classroom_snapshot.avatar_version_id`：恢复时继续使用原数字人版本。

新增列均可空，旧课堂和旧快照不需要补数据；任务5旧快照校验值仍兼容。

## 角色接口

所有接口均要求 Access Token。

- `POST /avatars/characters`：创建私有角色。
- `GET /avatars/characters`：分页查询本人角色和本园已审核共享角色。
- `GET /avatars/characters/:id`：角色、版本及资源详情。
- `PATCH /avatars/characters/:id`：编辑本人角色。
- `POST /avatars/characters/:id/submit-review`：提交管理员审核。
- `POST /avatars/characters/:id/review`：管理员通过、拒绝或停用。

角色分类：`teacher_assistant`、`cartoon_animal`、`kindergarten_custom`。

## 版本与上传接口

### 创建模型版本

`POST /avatars/characters/:id/versions`，使用 `multipart/form-data`：

- `file`：`.glb` 或 `.gltf` 主模型。
- `engineVersion`：例如 `avatar-engine-1`。
- `modelFormat`：`glb` 或 `gltf`。
- `compatibility`：可选JSON对象字符串。

每次上传主模型都创建新版本，旧版本不会被覆盖。

### 上传附属资源

`POST /avatars/versions/:id/assets`，使用 `multipart/form-data`：

- `file`
- `assetType`
- `actionName`：动画资源必填。
- `metadata`：可选JSON对象字符串。

资源类型：`model`、`texture`、`animation`、`expression`、`lip_sync`、`preview`、`fallback_2d`。

白名单动作：`idle`、`listen`、`think`、`speak`、`question`、`happy`、`encourage`、`wave`、`goodbye`。

主模型更新不能通过附属资源接口覆盖，必须创建新版本。配置中的 URL、JavaScript、脚本标签和系统命令会被拒绝。

### 完整性与发布

- `GET /avatars/versions/:id/integrity`：检查并返回明确问题列表。
- `POST /avatars/versions/:id/publish`：检查通过后设为 `ready` 并更新角色当前版本。
- `PATCH /avatars/versions/:id/status`：管理员停用问题版本。
- `DELETE /avatars/versions/:id`：删除非当前、未被课堂引用的版本及文件。
- `GET /avatars/assets/:id/content`：鉴权下载资源，不公开服务器路径。

发布前必须具备：

- 一个主模型。
- 至少一个必要贴图。
- `idle` 和 `speak` 动画。
- 口型资源或配置。
- 预览图。
- 2D备用资源。
- 全部文件哈希正确。
- 模型格式与声明一致。
- 引擎版本在兼容白名单内。

可通过环境变量 `AVATAR_SUPPORTED_ENGINE_VERSIONS` 配置兼容版本，多个值使用逗号分隔；默认值为 `avatar-engine-1`。

## 文件安全

- 复用课程资源模块的安全文件名、魔数识别和根目录路径限制。
- 文件使用UUID物理名称，存储在 `uploads/avatars`。
- 同时检查扩展名、声明MIME、真实类型、大小和SHA256。
- 拒绝双扩展名、伪装内容、路径穿越、脚本和命令配置。
- 数据库保存失败会删除已上传文件。
- 删除时先把文件原子移动到隔离区，数据库事务失败则移回原位置，避免部分删除。

## 权限与课堂固定

- 教师只能编辑、上传和删除自己的角色版本。
- 角色审核通过后，同园所教师可以查询和用于课堂，但不能修改。
- 管理员可以审核和停用本园角色或版本。
- 游客不能访问管理和下载接口。
- 开始课堂时可以传入 `avatarVersionId`；只接受已审核角色的 `ready` 版本。
- 课堂运行和每份新快照均保存该版本ID，后续角色更新不会改变正在运行的课堂。
- 被任意课堂快照或活跃课堂引用的版本不能物理删除。
