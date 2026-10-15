# 任务8：AI课堂导演与教师建议

## 范围

本任务只提供教师可编辑、可确认的课堂建议。服务端不会因为模型输出或教师决策记录而自动暂停课堂、切换步骤、播放资源、点名或发放奖励；儿童启发式回答和语音课堂指令不在本任务范围内。

## 数据库

迁移 `202609270010-ClassroomDirectorSuggestions.ts` 新增 `classroom_director_suggestion`：

- 按 `teacher_id + request_id` 唯一约束实现幂等和并发占位。
- 保存课堂与版本、结构化建议、模型元数据、Token 用量和教师决定。
- 关联课堂、教师，并建立课堂、教师和状态索引。
- 只保存脱敏输入摘要；不保存 API Key 或完整儿童信息。

## 接口

### 生成建议

`POST /ai/classroom-director`

```json
{
  "classroomRunId": 12,
  "currentStepIndex": 1,
  "remainingMinutes": 10,
  "recentEvents": ["孩子刚完成观察"],
  "teacherRequest": "下一步怎样组织互动？",
  "requestId": "director-20260928-001"
}
```

客户端课堂上下文只用于请求校验和辅助说明。服务端会重新读取课堂运行、教案步骤快照、班级年龄段、课堂事件、最新恢复快照、可访问且已审核资源和当前数字人配置。返回对象包含 `recordOnly: true`，表示只记录建议、不执行课堂操作。

### 记录教师决定

`POST /ai/classroom-director/:suggestionId/decision`

```json
{
  "decision": "edited",
  "editedTeacherMessage": "请小朋友先观察，再说说自己的发现。",
  "editedSuggestedAction": {
    "type": "ask_question",
    "description": "提出一个观察问题"
  },
  "executed": false,
  "executionResult": "教师暂未执行"
}
```

`decision` 只允许 `accepted`、`edited`、`rejected`、`ignored`。重复提交完全相同的决定幂等返回；不一致的二次决定返回 409。

## 权限与安全规则

- 两个接口都要求 JWT 教师身份；管理员、游客和非当前课堂教师不能调用。
- 教师还必须持续拥有课堂班级权限。
- 只有 `running` 或 `paused` 课堂可生成建议，终态课堂返回 409。
- AI 输出按严格 DTO 白名单校验；URL、JavaScript、脚本、SQL、系统命令和路径内容触发安全降级。
- 资源候选必须来自该课堂步骤快照，并再次通过教师访问权限及 `approved` 审核状态校验。
- 步骤编号必须属于当前课堂步骤快照。
- 置信度低于 0.75 时强制教师确认；含建议动作时同样要求确认。
- 模型调用期间若课堂版本、步骤或状态变化，返回无动作的安全降级建议。
- 模型超时、网络错误、429、非法 JSON 或字段缺失不会影响课堂运行。
- 日志仅记录 ID、类型、长度、耗时、Token 统计和结果状态，不记录密钥或完整儿童隐私。

## 建议输出类型

只允许：`ask_question`、`group_activity`、`summarize`、`transition`、`recommend_resource`、`switch_step`、`reward_suggestion`、`time_adjustment`。

## 测试说明

E2E 使用 Mock 替代真实模型，明确验证：鉴权与课堂归属、服务端真实上下文、资源和步骤过滤、低置信度确认、幂等、四种教师决定、安全降级、终态保护、建议不自动执行、日志脱敏和迁移唯一约束。Mock 结果不代表真实第三方模型可用性或质量。
