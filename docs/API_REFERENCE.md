# 接口文档
## 通用规则

- 后端默认地址：`http://localhost:3001`。
- 鉴权：`Authorization: Bearer <access_token>`。
- 管理员接口由服务端校验 `administrator` 身份；前端路由隐藏不能替代服务端权限。
- 改变课堂状态的命令使用 `requestId`、`runId`、`deviceId/targetDeviceId`、`expectedVersion` 和 `source`。
- 同一 `requestId` 同一请求返回首次结果；同 ID 不同内容或版本冲突返回 `409`。
- DTO 非白名单字段返回 `400`；无身份返回 `401`；无权限返回 `403`。

## 认证与平台

| 路径 | 用途 | 权限 |
| --- | --- | --- |
| `POST /auth/login` | 教师登录 | 公开 |
| `POST /auth/admin/login` | 管理员登录 | 公开 |
| `POST /auth/refresh` | 刷新并轮换 Token | Refresh Token |
| `POST /auth/logout` | 当前会话退出 | 已登录 |
| `GET /auth/profile` | 当前身份 | 已登录 |
| `/teachers` | 教师账号查询、新增、修改 | 管理员 |
| `/classes`、`/classes/:id/teachers` | 班级和教师关系 | 管理员；教师按班级隔离读取 |
| `/students`、`/students/sync` | 幼儿管理和同步 | 当前班教师或管理员 |
| `/classrooms`、`/devices`、`/device-bindings` | 教室、设备、绑定、心跳 | 按接口和班级权限 |
| `/classroom-tickets` | 创建一次性扫码凭证 | 当前班教师 |
| `POST /classroom-tickets/consume` | 消费扫码凭证 | 已登录教师 |
| `/guardian-consents` | 照片、语音、作品授权 | 当前班教师 |

## 管理员后台

| 路径 | 用途 |
| --- | --- |
| `GET /admin/dashboard` | 园所聚合看板：账号、班级、幼儿、设备、课堂、资源、AI、存储 |
| `GET /audit-logs` | 只读操作审计，支持 action、actorType、result、时间筛选 |
| `GET /ai-call-logs` | 只读 AI 调用记录 |
| `POST /resources/:id/review` | 审核、驳回或停用异常资源 |

上述接口仅管理员可用。不存在审计日志修改或删除接口。

## 课程资源、教案和数字人

| 路径组 | 用途 |
| --- | --- |
| `/resources` | 上传、分片续传、搜索、编辑、审核、收藏、引用和下载 |
| `/lesson-plans` | 教案 CRUD、复制、版本、步骤、AI 草稿和教师确认 |
| `/avatars` | 角色、版本、资源、审核、发布、声音、性格和绑定 |

受保护文件使用携带 Authorization 的请求获取，Token 不放入 URL。

## 课堂运行

| 路径组 | 用途 |
| --- | --- |
| `/classroom-runs` | 开始、状态查询、恢复、快照、考勤、点名、奖励、课间、问题、总结和导出 |
| `POST /classroom-commands` | 统一课堂命令入口 |
| `/classroom-mobile` | 手机加入、状态、心跳、命令和退出 |
| `/classroom-mobile-discovery` | 不含敏感信息的局域网发现 |
| `/artworks` | 幼儿作品上传、视觉草稿、教师确认和大屏投递 |

管理员默认无权调用进行中课堂控制入口。课堂教师、班级、设备和版本在服务端再次校验。

## AI

| 路径 | 用途 |
| --- | --- |
| `POST /ai/chat` | 游客/普通聊天 |
| `POST /ai/asr`、`POST /ai/tts` | 主动录音识别和语音合成 |
| `POST /ai/classroom-director` | 课堂导演结构化建议 |
| `POST /ai/classroom-assistant` | 启发式儿童助教 |
| `POST /ai/command` | 课堂指令识别，不直接执行 |
| `/ai/command-synonyms` | 教师自定义白名单同义词 |
| `POST /ai/artwork-review` | 幼儿作品可见内容分析草稿 |

AI 输出为建议或草稿。涉及资源、幼儿姓名、奖励、作品评价或低置信度操作必须经教师确认。

## 实时同步

手机端通过课堂控制会话建立实时通道。每条命令携带 `requestId`、`targetDeviceId` 和 TTL；服务端确认前前端不能显示成功。重连后必须重新鉴权并拉取完整课堂权威状态。
