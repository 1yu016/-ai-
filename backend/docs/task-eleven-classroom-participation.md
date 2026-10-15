# 任务11：考勤、分组和公平点名

## 数据库

迁移：`202609280013-ClassroomParticipation.ts`

新增表：

- `attendance_record`：每个课堂、每名学生唯一一条当前考勤。
- `attendance_change_log`：保存修改前后状态、来源、操作者和 requestId；语音确认凭证哈希唯一，防止重复确认。
- `student_group`：课堂级分组及成员快照。
- `student_group_member`：成员加入、移除状态，移除后保留审计信息。
- `roll_call_record`：点名模式、算法版本、冷却配置和最终结果。
- `roll_call_candidate_snapshot`：逐名学生保存是否候选、排除原因和当时的调用统计。

所有表均提供外键、唯一约束和常用查询索引。迁移只新增表，不修改或清空已有数据。

## 接口

所有接口都需要 Bearer Access Token。

### 考勤

- `POST /classroom-runs/:runId/attendance`：手动新增或修改考勤。
- `POST /classroom-runs/:runId/attendance/batch`：批量考勤，同一批次内学生不可重复。
- `GET /classroom-runs/:runId/attendance`：查询课堂全部学生和当前考勤。
- `GET /classroom-runs/:runId/attendance/change-logs`：查询考勤变更日志。
- `GET /students/:studentId/attendance-history?page=1&pageSize=20`：查询学生历史考勤。
- `POST /classroom-runs/:runId/attendance/voice/recognize`：接收现有 ASR 文本，只返回匹配候选和短期确认凭证，不写考勤。
- `POST /classroom-runs/:runId/attendance/voice/confirm`：教师确认候选后写考勤；确认凭证五分钟过期且只可使用一次。

考勤状态：`present`、`absent`、`late`、`leave`。

手动考勤示例：

```json
{
  "studentId": 12,
  "status": "present",
  "note": "已到园",
  "requestId": "attendance-20260928-0001"
}
```

语音识别示例：

```json
{
  "text": "朵朵迟到了",
  "requestId": "voice-attendance-20260928-0001"
}
```

### 课堂分组

- `POST /classroom-runs/:runId/groups`：创建分组，可同时加入学生。
- `GET /classroom-runs/:runId/groups`：查询课堂分组和成员快照。
- `PATCH /classroom-runs/:runId/groups/:groupId`：编辑分组。
- `DELETE /classroom-runs/:runId/groups/:groupId`：软删除分组。
- `POST /classroom-runs/:runId/groups/:groupId/members`：添加成员。
- `DELETE /classroom-runs/:runId/groups/:groupId/members/:studentId`：移除成员但保留历史记录。
- `POST /classroom-runs/:runId/groups/random`：按 requestId 稳定随机、均匀分组，重复请求返回同一批分组。

学生必须处于当前课堂班级且状态为 active。分组属于具体课堂，成员 ID 同步保存在 `membership_snapshot` 中，因此后续班级变化不会改写本次课堂分组快照。

### 公平点名

- `POST /classroom-runs/:runId/roll-calls`：执行点名。
- `GET /classroom-runs/:runId/roll-calls`：查询点名和候选快照。

模式：

- `all`：全班随机。
- `range`：在 `studentIds` 指定范围内随机。
- `group`：在 `groupId` 分组内随机。
- `teacher_specified`：教师通过 `specifiedStudentId` 指定。

示例：

```json
{
  "mode": "group",
  "groupId": 3,
  "cooldownCount": 2,
  "requestId": "roll-call-20260928-0001"
}
```

算法 `fair-v1` 先排除缺勤和请假幼儿，再排除最近冷却窗口内已经被点到的幼儿；若候选全部处于冷却期才放宽冷却。候选中优先选择累计点名次数最少者，再使用 requestId 哈希稳定打散。查询只选择学生 ID、姓名、昵称、班级和启用状态，不读取性别、成绩、AI评价或奖励数据。

每次点名保存完整候选集合、排除原因、累计次数、最近点名状态和最终结果。相同课堂的相同 requestId 只生成一次结果。

## 权限规则

- 教师写操作：必须是课堂创建教师，并且仍拥有课堂班级权限。
- 其他教师：返回 403，不能通过修改 runId、groupId 或 studentId 越权。
- 管理员：只允许查询课堂考勤、分组和点名审计信息，不允许写入。
- 语音识别结果：只在内存中匹配，原始 ASR 文本不持久化；教师确认前不写考勤。
- 终态课堂：禁止语音考勤、分组变更和点名；允许教师修正历史手动考勤。

## 异常行为

- DTO 错误、重复学生、跨班学生：400。
- 无 Token：401。
- 非课堂负责教师或跨班访问：403。
- 课堂、学生或分组不存在：404。
- 已结束课堂操作、无可点名学生、语音凭证重放：409。
