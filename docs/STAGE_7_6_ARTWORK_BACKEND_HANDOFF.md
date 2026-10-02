# Stage 7.6 儿童作品 —— 后端接口交接单

> 背景：成员 B 已调查后端，确认**当前无正式儿童作品（Artwork）数据模型与接口**。
> 现有 `TeachingResource` 是学校共享教学资源（需审核/分类/校可见），语义不适合承载儿童个人作品，本阶段**不复用**。

---

## 一、现状

- 无 `StudentArtwork` / `Artwork` / `Drawing` / `Portfolio` / `GrowthRecord` 等作品实体。
- 无作品上传 / 保存 / 查询接口。
- 现有 `TeachingResource` 上传在**技术上**能收图片，但语义为"教学资源审核库"，不自带 `studentId/classroomRunId`，不作儿童作品正式存储。
- `guardian_consents` 已有 `ConsentType.Photo / Artwork / Voice`，可作为授权字段来源。

---

## 二、推荐数据模型（第一版最小）

新增 `student_artwork_record`：

| 字段 | 约束 |
| --- | --- |
| id | 主键 |
| student_id | nullable |
| class_id | NOT NULL |
| classroom_run_id | NOT NULL |
| lesson_step_index | nullable |
| teacher_id | NOT NULL |
| file_url / storage_key | NOT NULL |
| mime_type | NOT NULL |
| original_name | NOT NULL |
| ai_draft | nullable（AI 草稿，未确认） |
| teacher_comment | nullable（教师确认版本） |
| confirmed_at | nullable（确认时间戳） |
| created_at | datetime |

第一版简单模型：作品与评价**同一行**（方案 A），不拆表。必须区分 `ai_draft`（AI 草稿）与 `teacher_comment`（教师确认内容）。

**不允许 A+/优秀/良好/差/排名/能力诊断**等评分字段。

---

## 三、接口契约

### 1. 上传作品

`POST /classroom-runs/:runId/artworks`

- multipart FormData
- 字段：`studentId?`（存在时校验 `student.classId === run.classId`）、`lessonStepIndex?`、`file`
- file 校验：MIME ∈ image/jpeg, image/png；≤10MB
- 需 requireTeacher + ownedRun 权限
- 保存文件到受保护存储，返回：

```json
{ "artwork": { "id": 10, "studentId": 1, "classId": 1, "classroomRunId": 9, "lessonStepIndex": 0, "teacherId": 1, "teacherName": "王雪梅", "fileUrl": "/media/artworks/xx.png", "mimeType": "image/png", "originalName": "a.png", "aiDraft": null, "teacherComment": null, "confirmedAt": null, "createdAt": "2026-10-02T15:00:00.000Z" } }
```

### 2. AI 评价草稿（依赖视觉能力，见 AI 缺口单）

`POST /ai/artwork-review` → `{ "aiDraft": "string" }`（未接入则返回能力不支持错误）

### 3. 教师确认

`POST /artworks/:artworkId/confirm`

request:

```json
{ "teacherComment": "string" }
```

- 保存为正式 `teacher_comment` + `confirmed_at`
- 幂等或返回最新状态

response:

```json
{ "teacherComment": "…", "confirmedAt": "2026-10-02T15:10:00.000Z" }
```

### 4. 查询（可选，班级历史/成长档案）

`GET /classes/:classId/artworks` · query `page/pageSize/studentId?`

`GET /classroom-runs/:runId/artworks` · 本节作品

返回分页 `{ items, total, page, pageSize }`，含 `studentName/lessonStepIndex/confirmedAt`。

---

## 四、授权 / 隐私

- 上传前按现有 `guardian_consents` 判定：`Photo / Artwork` 类型的 consent 状态。
- 教师内部课堂记录允许与否按现有授权模型事实处理，前端不自行推测。
- 未获得授权不与家长端/公开端分享。

---

## 五、成员 B 已就绪的前端

- `services/studentArtwork.ts`：contract 冻结 + 文件校验 + upload/ai/confirm 三接口
- `components/classroom/operations/ArtworkReviewPanel.vue`：选择/预览/校验/上传状态/AI 草稿状态/确认状态/错误态/明确 backend-not-ready
- `tests/component/ArtworkReviewPanel.spec.ts`

### 前端状态机

```
file_pick → preview → uploading → ai_reviewing → teacher_confirm → confirmed
            （校验失败 → error）
  ai 失败 → teacher_confirm（可手动填写，不伪造）
  confirm 失败 → 保持 teacher_confirm
不在_本端播放：未确认内容不对儿童播放（多端播放需跨端 command channel，见多端交接单）
```

---

## 六、明确不做

- 评分 / 排行榜 / 能力诊断 / 心理发展判断。
- AI 自动保存成教师确认内容 / AI 自动对儿童播放。
- 把儿童作品塞进 TeachingResource。

---

## 七、阻塞状态

成员 B 前端已完成到 `FRONTEND_READY_BACKEND_BLOCKED`（contract 冻结、service/UI/error states/tests 已写、handoff 已写、无 fake success）。