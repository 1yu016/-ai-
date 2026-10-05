# 任务7：数字人配置、绑定与异常回退

本任务只实现服务端声音、性格、绑定、生效角色解析、课堂版本固定和异常回退，不包含前端 WebGL/Three.js 渲染。

## 数据库

迁移：`202609270009-AvatarConfigurationBindings`

- `avatar_voice_profile`：每个角色一份声音配置；速度 0.5–2、音量 0–1、音调 -12–12。
- `avatar_personality`：性格、口头禅、问候、鼓励和告别语。
- `avatar_binding`：系统、班级、教案、课堂四级绑定；同一层级只能存在一个有效绑定。
- `avatar_config_history`：保存操作者、修改前后摘要、原因和业务关联。
- `avatar_usage_log`：记录动作、角色、声音等异常回退。
- `classroom_run.avatar_character_id`、`classroom_snapshot.avatar_character_id`：与已有 `avatar_version_id` 一起固定课堂角色及版本。

## 接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| PATCH | `/avatars/characters/:id/voice-profile` | 设置角色音色 |
| PATCH | `/avatars/characters/:id/personality` | 设置角色性格 |
| POST/DELETE | `/avatars/bindings/classes/:id` | 设置/取消班级默认角色 |
| POST/DELETE | `/avatars/bindings/lesson-plans/:id` | 设置/取消教案角色 |
| POST/DELETE | `/avatars/bindings/system-default` | 管理员设置/取消系统默认角色 |
| GET | `/avatars/resolve` | 查询最终生效角色和回退结果 |
| POST | `/classroom-runs/:id/avatar-binding` | 设置课堂临时角色并生成快照 |
| POST | `/classroom-runs/:id/avatar-binding/cancel` | 取消课堂临时角色并恢复下一级角色 |

绑定请求示例：

```json
{
  "characterId": 12,
  "versionId": 35,
  "reason": "本节课使用森林主题角色"
}
```

课堂临时绑定额外要求 `deviceId`、课堂乐观锁 `version` 和唯一 `requestId`。

解析示例：

`GET /avatars/resolve?classroomRunId=8&deviceId=3&actionName=question`

服务端按“课堂 > 教案 > 班级 > 系统”选择角色。返回值包含 `renderAsset`、实际动作、音色、性格、`fallbackLevel` 和 `reason`，不会返回物理文件路径。

## 权限与回退

- 班级绑定复用教师班级隔离；教案绑定复用教案所有权；课堂绑定要求课堂教师和当前控制设备。
- 只能绑定已审核角色的 ready 版本。
- 3D模型缺失时使用 `fallback_2d`；动作缺失时依次使用 `idle`、`speak`；音色失效时使用系统默认音色。
- 角色或版本不可用时继续检查低优先级绑定，最终回退系统默认角色；系统角色也不可用时返回安全占位建议，不让课堂接口崩溃。
- 每次发生回退都会尽力写入 `avatar_usage_log`；日志失败不会反向阻断课堂。
