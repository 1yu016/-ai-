# 任务4：课堂运行状态机与一键上课

本任务新增独立的 `classroom-runs` 模块。旧版 `lesson-runs` 接口继续保留，未加入课堂快照恢复、3D 数字人渲染、手机控制或离线同步。

## 数据库迁移

迁移：`202609270006-ClassroomRunStateMachine`

- `classroom_run`：教案版本、教师、班级、教室、设备、状态、当前步骤、计时及乐观锁版本。
- `classroom_run_step_snapshot`：开课时复制的全部教案步骤、资源、受控动作和恢复点配置。
- `classroom_event`：每个成功写操作的请求 ID、操作者、设备、载荷和结果。
- 活跃状态为 `prepared/running/paused`。数据库使用条件唯一索引，保证同一班级或设备最多存在一堂活跃课堂。
- `operator_type + operator_id + request_id` 唯一，防止同一教师的请求重复执行。

## 接口

所有接口均使用教师 Access Token。

### 一键上课

`POST /classroom-runs/start`

```json
{
  "lessonPlanId": 12,
  "classId": 3,
  "classroomId": 2,
  "deviceId": 5,
  "requestId": "start-20260927-0001"
}
```

开始前依次校验教师班级权限、教案权限、非空步骤、资源审核状态、设备绑定和活跃课堂冲突。创建运行记录、步骤快照和开始事件使用同一个数据库事务。

### 状态操作

- `POST /classroom-runs/:id/pause`
- `POST /classroom-runs/:id/resume`
- `POST /classroom-runs/:id/complete`
- `POST /classroom-runs/:id/cancel`

```json
{
  "version": 2,
  "requestId": "pause-20260927-0001"
}
```

### 切换步骤

`POST /classroom-runs/:id/steps/:stepIndex`

步骤索引从 `0` 开始。

```json
{
  "version": 3,
  "requestId": "step-20260927-0002"
}
```

### 查询

- `GET /classroom-runs/:id`：运行详情及不可变步骤快照。
- `GET /classroom-runs/active`：当前教师负责的活跃课堂。

## 状态转换

| 当前状态    | 可转换为                                      |
| ----------- | --------------------------------------------- |
| `prepared`  | `running`                                     |
| `running`   | `paused`、`completed`、`cancelled`、`failed`  |
| `paused`    | `running`、`completed`、`cancelled`、`failed` |
| `completed` | 无，终态                                      |
| `cancelled` | 无，终态                                      |
| `failed`    | 无，终态                                      |

接口中的非法转换、旧版本并发写入和活跃课堂冲突均返回 `409 Conflict`。`failed` 转换已纳入内部状态机，本任务没有新增公开失败接口。

## 权限和资源规则

- 只有教师账号可以启动及操作课堂，管理员账号不能代替教师上课。
- 教师必须仍与课堂班级有关联，且只能操作自己创建的课堂运行。
- 教案使用现有教案权限；其他教师的教案不可直接开课。
- 所有步骤资源必须存在、当前教师可访问且状态为 `approved`。
- 设备、教室、班级必须存在完全匹配的有效绑定。
- 所有写请求必须提供符合格式的 `requestId`；状态操作同时提供响应中的最新 `version`。
- 相同 `requestId` 的同一操作直接返回已有结果，不重复改变状态或写事件；用于不同操作则返回 `409`。

## 错误码

- `400`：DTO 参数或步骤索引错误、空教案。
- `401`：无效或缺少 Access Token。
- `403`：非教师账号、班级/教案/课堂越权。
- `404`：课堂、教案、设备或教室不存在。
- `409`：非法状态转换、资源未审核、绑定错误、活跃课堂冲突或乐观锁冲突。
