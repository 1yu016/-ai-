# Stage 7.6 儿童作品 —— AI 图片评价能力缺口交接单

> 背景：成员 B 已调查现有一切 /ai 接口与前端封装，确认当前系统**不具备视觉（多模态）能力**，无法真实分析儿童画作。
> 当前"绘画评价"只能脚本生成文本，判定为 mock，本阶段已移除硬编码文案，禁止冒充成功。

---

## 一、现状

1. `/ai/classroom-assistant` DTO 只接文本 `{ text, speaker, ageGroup, activityContext, history, tool }`，无 `imageUrl/file/base64` 字段。
2. `/ai/chat`、`/ai/voice-chat`、`/ai/asr`、`/ai/tts` 均只处理文本 / 音频，不含图像输入。
3. 项目无视觉模型接入，无图像分析 endpoint，前端无上传图片给 AI 的封装。
4. `guardian_consents` 有 `ConsentType.Photo/Artwork`，但**没有任何接口把图片交给 AI**。

结论：**当前 AI 只能对文本生成草稿，不能真实分析儿童画作。**

---

## 二、第一版产品目标（需视觉能力支撑的部分）

- 教师选择幼儿 → 上传一张作品图片 → 正式保存 → AI 生成评价草稿 → 教师查看/编辑/确认 → 保存教师确认版本。

其中「AI 生成评价草稿」依赖视觉能力。

---

## 三、需求（后端/算法负责人）

新增一个多模态图像评价接口，例如：

`POST /ai/artwork-review`

request:

```json
{
  "artworkId": 10,
  "imageUrl": "string",   // 受保护下载地址，或上传后的文件引用
  "ageGroup": "small|middle|large"
}
```

要求：

- 输入图片（受保护下载 / base64 均可，由服务端下载）。
- 输出评价草稿 `{ "aiDraft": "string" }`。
- 评价风格限定为：观察、描述、鼓励、开放式提问。
- **禁止评分、A+、优秀/良好/差、排名、能力诊断、心理诊断、发展障碍判断。**

response:

```json
{ "aiDraft": "这幅画里画了……，老师很好奇你最喜欢哪个部分？" }
```

---

## 四、前端已就绪的接入点

- `frontend/src/services/studentArtwork.ts` 的 `generateArtworkAiDraft({ artworkId })`
- `frontend/src/components/classroom/operations/ArtworkReviewPanel.vue` 已实现：
  - 上传成功后才调用 AI 草稿
  - AI 接口不存在/失败时**明确失败，不伪造文案**，教师可手动填写后确认
  - 未确认内容不对儿童输出/播放

视觉能力接入后，把 `generateArtworkAiDraft` 的 URL/请求体对齐即可运行。

---

## 五、明确不做（第一阶段）

- 自动评分 / 排行榜 / 能力画像 / 心理发展诊断。
- AI 自动对儿童播放评价（必须 teacher confirm 后才由教师决定是否播放）。
- 把 AI 草稿直接自动保存成"教师确认内容"（两者必须分离）。

---

## 六、阻塞状态

成员 B 前端已完成到 `FRONTEND_READY_BACKEND_BLOCKED`（contract 冻结、service/UI/error states/tests 已写、handoff 已写、无 fake success）。