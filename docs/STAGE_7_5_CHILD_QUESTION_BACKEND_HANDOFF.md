# Stage 7.5 儿童问题记录——后端接口交接单

> 背景：成员 B 已调查现有前端。
> 当前"幼儿问题地图"只是 localStorage：
> - 无正式 Question entity
> - 无后端接口
> - 无权限隔离
> - 换设备丢失
>
> 前端不能继续把 localStorage 当正式业务数据。

---

## 一、最小数据模型

建议新增：

`student_question_record`

字段：

| 字段 | 约束 |
| --- | --- |
| id | 主键 |
| student_id | nullable |
| class_id | NOT NULL |
| classroom_run_id | NOT NULL |
| lesson_step_index | nullable |
| question_text | NOT NULL |
| topic | nullable |
| teacher_id | NOT NULL |
| request_id | NOT NULL |
| created_at | datetime |

第一版：

- classroom_run_id 不允许 NULL
- 不做历史回填
- student_id 可空
- lesson_step_index 可空
- topic 可空

幂等唯一约束：

```
(classroom_run_id, request_id)
```

建议查询索引：

```
(class_id, created_at)
(class_id, student_id, created_at)
```

---

## 二、课堂写接口

`POST /classroom-runs/:runId/questions`

request:

```json
{
  "requestId": "string",
  "studentId": "number?" ,
  "lessonStepIndex": "number?",
  "questionText": "string",
  "topic": "string?"
}
```

要求：

1. requireTeacher
2. ownedRun / 等价课堂权限
3. studentId 存在时：`student.classId === run.classId`
4. questionText 做长度校验
5. requestId 幂等：
   - 同 requestId + 同 payload → 幂等成功
   - 同 requestId + 不同 payload → 409

response:

```json
{
  "question": {
    "id": "number",
    "studentId": "number?",
    "studentName": "string?",
    "classId": "number",
    "classroomRunId": "number",
    "lessonStepIndex": "number?",
    "questionText": "string",
    "topic": "string?",
    "teacherId": "number",
    "teacherName": "string?",
    "createdAt": "datetime"
  }
}
```

---

## 三、本节课堂问题

`GET /classroom-runs/:runId/questions`

要求：

- 有课堂访问权限
- 按 `createdAt ASC, id ASC`
- 返回本节课堂所有正式问题

---

## 四、班级历史问题

`GET /classes/:classId/questions`

query:

```
page
pageSize
studentId?
keyword?
```

要求：

- 教师必须有 TeacherClass 权限
- 管理员沿用现有权限
- keyword 对 question_text 搜索
- 默认排序：`createdAt DESC, id DESC`

response 建议：

```json
{
  "items": [],
  "total": "number",
  "page": "number",
  "pageSize": "number"
}
```

items 至少含：

```
questionId
questionText
topic
studentId
studentName
classroomRunId
lessonStepIndex
lessonTitle / runTitle
teacherName
createdAt
```

---

## 五、第一版不要做

不要：

- AI 回答落 QuestionRecord
- 排行榜
- 自动主题分类
- 家长端
- 历史回填
- 问题修改 / 删除
- 新的 AI pipeline

AI 已有：

- `/ai/classroom-assistant`
- `/ai/tts`

成员 B 后续复用即可。

---

## 六、成员 B 前端依赖

后端完成后，成员 B 会实现：

1. `/classroom/insights`：localStorage → 正式 API
2. 记录问题：backend 成功后才显示成功
3. 班级页：`/classes/:classId/questions`
4. 学生 / 关键词筛选
5. AI draft → 教师确认 → TTS

未确认回答绝不直接展示 / 播放给儿童。