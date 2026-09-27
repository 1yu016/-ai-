# 任务5：课堂快照、刷新恢复与换设备恢复

本任务在任务4的 `classroom-runs` 模块上增加持久化恢复能力。没有实现 3D 数字人、手机控制或离线事件队列。

## 数据库迁移

迁移：`202609270007-ClassroomSnapshotRecovery`

- `classroom_snapshot`：保存运行状态、当前步骤、准确计时、已播放资源及点名、奖励、互动、播放器状态；`snapshot_version` 在每堂课内递增，`checksum` 用于校验损坏。
- `classroom_device_transfer`：记录旧设备、新设备、教师、接管原因及接管时间。
- 同一课堂的快照版本具有唯一约束。快照保留最近 20 份，并在总量最多 50 份内额外保留关键快照。
- 任务4已有课堂数据不修改、不清空；迁移只新增表和索引。

## 恢复接口

所有接口均使用教师 Access Token，并继续校验教师、课堂所有者和班级权限。

### 查询当前设备的活跃课堂

`GET /classroom-runs/active?deviceId=5`

不传 `deviceId` 时返回当前教师负责的全部活跃课堂；传入时只返回该设备当前可控制的课堂。

### 获取刷新/重启后的恢复数据

`GET /classroom-runs/:id/restore?deviceId=5`

响应包含课堂状态、当前步骤和步骤快照、计时状态、已完成资源、点名/奖励/互动状态、播放器恢复建议、最新有效快照版本及允许执行的操作。播放器建议始终为 `autoPlay: false`，刷新后不会自动重播资源。

若最新快照校验失败，服务自动向前查找上一份有效快照；全部快照均无效时返回安全状态，并设置 `manualInterventionRequired: true`，不会创建新课堂。

### 换设备接管

`POST /classroom-runs/:id/takeover`

```json
{
  "version": 4,
  "oldDeviceId": 5,
  "newDeviceId": 8,
  "teacherConfirmed": true,
  "reason": "原设备断电，改用备用大屏",
  "requestId": "takeover-20260927-0001"
}
```

新设备必须是当前教室和班级的有效绑定设备；若无此绑定，则必须由教师明确确认，且设备与教师属于同一园所。接管成功后课堂的当前设备立即变更，旧设备后续写操作返回 `403`。重复提交同一 `requestId` 不会重复接管或写记录。

### 从有效快照恢复

`POST /classroom-runs/:id/recover`

```json
{
  "version": 5,
  "deviceId": 8,
  "requestId": "recover-20260927-0001"
}
```

恢复当前步骤和计时基线。运行中的课堂使用新的 `resumedAt` 继续计时，暂停课堂仍保持暂停。完成、取消或失败课堂返回 `409`。

## 可恢复事件上报

`POST /classroom-runs/:id/checkpoints`

用于在资源播放完成、点名、奖励、可恢复错误或前端要求保存时形成事件与快照。

```json
{
  "version": 6,
  "deviceId": 8,
  "checkpointType": "resource_completed",
  "resourceId": 21,
  "playerState": { "positionSeconds": 38, "completed": true },
  "requestId": "checkpoint-20260927-0001"
}
```

`checkpointType` 支持：`resource_completed`、`roll_call`、`reward`、`recoverable_error`、`timed`。资源必须属于开课时生成的步骤快照。

## 快照时机与计时

- 开始课堂、步骤切换、暂停、恢复、完成、取消、换设备、显式恢复及上述可恢复事件完成后保存快照。
- 运行或暂停课堂每 30 秒检查一次，若近期没有快照则定时保存。
- 快照发生在业务事件事务成功之后；失败不会撤销已经成功的课堂操作，而会写入 `snapshot_failed` 事件并保留错误摘要。
- 运行时长以数据库中的 `elapsed_seconds + (当前时间 - resumed_at)` 计算，不依赖进程内存，刷新或服务重启不会从零开始或重复累计。

## 写操作设备校验

任务4的暂停、恢复、结束、取消和步骤切换请求现在都必须携带当前 `deviceId`：

```json
{
  "version": 7,
  "deviceId": 8,
  "requestId": "pause-20260927-0001"
}
```

这样在接管完成后，旧设备即使持有旧页面和有效教师 Token，也不能继续控制课堂。

## 错误码

- `400`：DTO 参数、资源或步骤参数错误。
- `401`：缺少或无效 Access Token。
- `403`：课堂/班级越权、旧设备继续操作、未授权的新设备。
- `404`：课堂或设备不存在。
- `409`：版本并发冲突、非法状态、设备被占用、终态课堂恢复或接管。
