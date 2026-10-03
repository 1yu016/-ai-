# 成员 A 阶段三：AI 备课与教案

本阶段只实现 AI 备课和教案编辑，不新增正式课堂运行或数字人渲染能力。旧课堂运行接口仅为兼容已有客户端而保留。

## 数据库

- `lesson_plan`：教案主体，增加教案类型、领域、园所、当前版本、AI 大纲和软删除字段。
- `lesson_plan_version`：完整教案与步骤快照，`lesson_plan_id + version_no` 唯一。
- `lesson_step`：步骤标题、类型、内容、顺序、时长和资源关联。
- `lesson_recovery_point`：恢复点名称、触发方式、目标步骤和教师提示。
- `lesson_ai_draft`：AI 输入、结构化输出、模型、耗时、Token 用量、状态和教师确认信息。
- `lesson_step_action`：受控的数字人动作名称、语音提示、奖励及点名建议。

迁移 `202609270005-LessonPreparationStageThree` 使用存在性检查和增量加列，保留旧教案及步骤。SQLite 的 `current_version_id` 使用应用层完整性校验，避免重建父表触发级联而删除旧步骤；其他数据库创建外键。

## 教案接口

- `POST /lesson-plans`：创建教案并生成第一个版本快照。
- `GET /lesson-plans`：按关键字、年龄段、领域、类型和状态分页查询。
- `GET /lesson-plans/:id`：查询教案、步骤、动作与恢复点。
- `GET /lesson-plans/:id/versions`：查询历史版本。
- `PATCH /lesson-plans/:id`：编辑教案或切换 `draft/ready/archived` 状态。
- `POST /lesson-plans/:id/copy`：复制为新的草稿教案。
- `DELETE /lesson-plans/:id`：软删除教案并移除资源引用，不删除课程资源。
- `PUT /lesson-plans/:id/steps`：事务式批量保存全部步骤。
- `POST /lesson-plans/:id/steps`：新增步骤。
- `PATCH /lesson-plans/:id/steps/:stepId`：编辑步骤。
- `DELETE /lesson-plans/:id/steps/:stepId`：删除步骤。
- `POST /lesson-plans/:id/steps/:stepId/copy`：复制步骤。
- `PUT /lesson-plans/:id/steps-order`：按完整步骤 ID 列表重新排序。

所有写接口均携带当前 `version`。版本已变化时返回 `409`，避免多人编辑互相覆盖。资源关联先调用资源库权限校验，再在事务内更新引用记录。

## AI 备课接口

- `POST /lesson-plans/ai-drafts`：根据主题、年龄段、领域、时长、教学目标、教师要求、ASR 文本及可用资源生成结构化草稿。
- `GET /lesson-plans/ai-drafts/:id`：查询本人生成的草稿。
- `POST /lesson-plans/ai-drafts/:id/confirm`：教师确认草稿并转换为正式的 `draft` 教案。

模型输出必须包含教学目标、导入、过程、互动问题、延伸活动、评价建议、资源推荐和步骤时长。系统使用严格 DTO 校验，拒绝未知字段、缺失字段、非法 JSON、超长内容、未授权资源、URL 和脚本代码。AI 最多尝试两次；失败会保存失败记录但不会产生教案。只有教师确认后才创建教案、步骤、资源引用和版本快照。

## 动作与安全

动作名称采用固定白名单：

- 数字人动作：`wave/nod/clap/point/think/celebrate/idle`
- 语音建议：`speak`
- 奖励建议：`flower/star/applause`
- 点名建议：`random/specific`

阶段三只保存这些建议，不执行 JavaScript、URL 或任何前端代码。教师只能访问自己的教案和 AI 草稿；管理员仍受园所边界限制。AI 日志记录模型、耗时、Token 用量和结果状态，不记录密钥。
