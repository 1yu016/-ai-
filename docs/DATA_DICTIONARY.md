# 数据字典
本表列出正式业务核心表。完整字段定义以 `backend/src/**/entities/*.entity.ts` 和迁移 `backend/src/migrations/` 为准。

## 身份与平台

| 表 | 作用 | 关键字段 |
| --- | --- | --- |
| `teachers` | 教师账号 | account、password_hash、name、role、status、school_id、token_version |
| `administrator` | 管理员账号 | account、password_hash、status、school_id、token_version |
| `refresh_token_session` | Refresh Token 哈希和撤销状态 | user_type、user_id、token_hash、expires_at、revoked_at |
| `class` | 班级 | name、grade、age_range、school_year、school_id、status |
| `teacher_class` | 教师班级关系 | teacher_id、class_id、role |
| `student` | 幼儿基础资料 | class_id、student_no、name、nickname、status |
| `guardian_consent` | 监护人授权 | student_id、consent_type、status、consented_at、revoked_at |
| `classroom` | 教室 | name、location、school_id、status |
| `device` | 设备 | device_code、type、status、last_online_at、school_id |
| `device_binding` | 设备、教室和班级绑定 | device_id、classroom_id、class_id、status |
| `classroom_ticket` | 一次性扫码凭证 | ticket_hash、device_id、class_id、expires_at、is_used |

## 资源、教案与数字人

| 表组 | 作用 |
| --- | --- |
| `teaching_resource` | 资源元数据、归属、审核状态、文件信息和 AI 标注 |
| `resource_category/tag/tag_relation` | 分类和标签 |
| `resource_version/reference/favorite/review` | 版本、引用、收藏和审核历史 |
| `upload_session/upload_chunk` | 分片上传、校验和失败清理 |
| `lesson_plan/lesson_plan_version` | 教案及不可变版本快照 |
| `lesson_step/lesson_step_action/lesson_recovery_point` | 课堂步骤、动作和恢复点 |
| `lesson_ai_draft` | 未确认 AI 备课草稿 |
| `avatar_character/version/asset` | 数字人角色、版本和资源 |
| `avatar_voice_profile/personality/binding` | 声音、性格和班级/教案绑定 |
| `avatar_config_history/avatar_usage_log` | 配置审计和使用记录 |

## 正式课堂

| 表 | 作用 | 关键字段/约束 |
| --- | --- | --- |
| `classroom_run` | 服务端课堂权威状态 | teacher_id、class_id、device_id、status、current_step_index、version |
| `classroom_run_step_snapshot` | 开课时步骤快照 | classroom_run_id、sort_order、resource_id |
| `classroom_snapshot` | 资源、页码、播放和恢复快照 | classroom_run_id、version、snapshot_json |
| `classroom_event` | 课堂时间线原始事件 | classroom_run_id、event_type、payload、created_at |
| `classroom_operation_record` | 统一命令幂等和审计 | request_id、request_hash、operation、source、result |
| `student_attendance_record/change` | 正式考勤和变更历史 | run_id、student_id、status、before/after |
| `classroom_roll_call_record` | 随机、指定和分组点名 | request_id 唯一、student_id、mode |
| `student_reward_record` | 奖励及撤销 | request_id、category、forms、points、revoked_at |
| `class_growth_goal`、`class_collective_reward_record` | 班级成长目标和集体奖励 | class_id、target/current、status |
| `student_question_record` | 幼儿问题 | run_id + request_id 幂等、教师修正、主题、领域、匿名 |
| `classroom_summary_draft/summary` | AI 草稿和教师正式总结分离 | draft_status、confirmed_by、confirmed_at |
| `student_artwork_record` | 作品、AI 草稿和教师确认 | file_path、ai_draft、teacher_comment、confirmed_at |
| `classroom_control_session` | 手机控制会话 | token_hash、run_id、teacher_id、device_id、expires_at、revoked_at |
| `classroom_device_transfer` | 换设备接管记录 | source_device_id、target_device_id、status |

`lesson_run` 是旧课堂路径兼容表；正式大屏和多端同步以 `classroom_run` 为权威来源。

## AI 与审计

| 表 | 作用 |
| --- | --- |
| `audit_log` | 只追加的身份、权限、配置和业务操作日志 |
| `ai_call_log` | AI 功能、供应商、模型、状态、耗时和错误码 |
| `classroom_director_suggestion` | 课堂导演建议、教师编辑、确认或拒绝 |
| `teacher_command_synonym` | 只映射白名单操作的教师自定义同义词 |

## 敏感数据规则

- 密码和课堂凭证只存哈希。
- Token、密码、原始音频、完整联系方式不得写入审计元数据。
- 管理看板只返回聚合数据。
- 作品文件放在受保护目录；未授权不得上传。
- 儿童回答和不必要的原始音频不长期保存。
- 所有班级数据查询必须经过教师班级关系校验。
