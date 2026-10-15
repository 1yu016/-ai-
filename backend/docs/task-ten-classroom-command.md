# 任务10：课堂指令识别、白名单与弱网规则

## 实现范围

本任务只处理前端或现有 ASR 传入的文字，不包含语音唤醒、持续麦克风监听或前端自动执行。

## 白名单

仅允许：`next_page`、`previous_page`、`play`、`pause`、`resume`、`stop`、`zoom_in`、`zoom_out`、`call_student`、`reward`、`mute`、`unmute`、`break_mode`、`return_to_class`、`next_step`、`previous_step`、`unknown`。

任何模型自造意图、额外参数、URL、脚本、SQL、路径或系统命令都会降级为 `unknown` 或直接拒绝。

## 接口

### 识别文字指令

`POST /ai/classroom-command`

```json
{
  "classroomRunId": 12,
  "text": "播放小星星",
  "locale": "zh-CN",
  "context": {
    "currentPage": "lesson",
    "playerStatus": "paused"
  },
  "requestId": "command-20260928-0001"
}
```

识别顺序固定为：教师自定义精确短语、本地确定性规则、AI 结构化分类。响应包含 `intent`、`parameters`、`confidence`、`candidates`、`requiresConfirmation`、短期 `executionToken`、`message`、识别来源和状态。

多个资源或学生匹配时不签发执行凭证。教师选择候选后，可在新请求的 `context.currentResourceId` 或 `context.selectedStudentId` 中提交所选对象，服务端重新验证后签发凭证。

### 执行已识别指令

`POST /ai/classroom-command/execute`

```json
{
  "executionToken": "短期执行凭证",
  "requestId": "execute-20260928-0001"
}
```

凭证采用服务器密钥签名，只在数据库保存 SHA-256 哈希，默认两分钟有效且只能使用一次。执行前重新验证当前教师、班级、课堂状态、学生和资源权限。课堂结束后拒绝执行。

`break_mode`、`return_to_class`、`next_step`、`previous_step` 复用现有课堂状态机；点名和奖励复用现有课堂检查点与快照；页面、播放器、缩放和静音类返回受控前端动作。

### 保存教师自定义短语

`POST /ai/classroom-command/rules`

```json
{
  "phrase": "翻一张",
  "locale": "zh-CN",
  "intent": "next_page",
  "parameterTemplate": {},
  "priority": 250
}
```

只能映射已有白名单。相同教师、语言和标准化短语唯一；相同短语改映射会返回 409；合法更新会增加规则版本。

### 下载弱网规则

`GET /ai/classroom-command/rules/download?locale=zh-CN`

返回规则包版本、短语、白名单意图、参数模板、冲突优先级、单条规则版本和有效期。只下发页面、播放器、缩放和静音等安全本地规则，不下发点名、奖励或课堂状态切换规则。

### 上传离线执行日志

`POST /ai/classroom-command/offline-logs`

批量上传离线事件，使用 `localEventId` 幂等。服务端仅保存文字哈希、白名单参数、规则版本、结果、错误码和时间。非安全意图若声称离线执行成功会被拒绝，但可上传其 `rejected` 或 `error` 结果。

## 数据库

迁移 `202609280012-ClassroomCommands.ts` 新增：

- `classroom_command_record`：识别来源、置信度、确认、执行、拒绝、错误与一次性凭证状态。
- `classroom_command_rule`：教师自定义短语、白名单映射、优先级、版本和有效期。
- `classroom_command_offline_log`：弱网执行结果及幂等上传记录。

所有表具有教师和课堂外键、唯一约束及查询索引；不保存原始语音或完整文字指令，只保存不可逆文本哈希。
