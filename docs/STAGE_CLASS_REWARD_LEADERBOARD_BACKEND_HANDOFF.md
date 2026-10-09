# 班级小红花 Top5 排行榜 —— 后端交接单

> 状态：**FRONTEND_READY_BACKEND_BLOCKED**
> 前端已完成（排行榜组件 + 课堂页/成长奖励页接入 + 奖励后刷新 + loading/error/empty），
> 因后端暂无按学生聚合的排行榜接口，前端当前对排行榜请求会进入「加载失败 / 暂不可用」error 态，属预期行为。
> 本单仅说明后端所需接口契约；**本阶段不改 backend**。

## 现状调查（只读）

- `GET /classes/:classId/rewards`（`PlatformService.listClassRewards`）只返回：
  - 分页历史流水 `items[]`（逐条 RewardRecord）
  - 班级**整体** `summary.totalStars`
  - **没有** 按 `student_id` 聚合的排行数据。
- 使用分页 `items` 自行 `SUM` 是错误的：只覆盖当前页，不代表全班全部历史 RewardRecord。
- 全库搜索 `leaderboard / ranking / totalStars / GROUP BY / SUM(stars) / aggregate`：不存在相关接口。

## 建议后端接口

```
GET /classes/:classId/rewards/leaderboard?limit=5
```

### 响应

```json
{
  "classId": 1,
  "className": "小一班",
  "items": [
    { "rank": 1, "studentId": 1, "studentName": "朵朵", "totalStars": 19 }
  ]
}
```

每个 item：
| 字段 | 类型 | 说明 |
|------|------|------|
| `rank` | number | 名次，从 1 开始（1..N） |
| `studentId` | number | 学生 id |
| `studentName` | string\|null | 学生姓名（可空） |
| `totalStars` | number | 该生全班累计小红花 |

### SQL 语义（必须）

```
按 class_id 过滤
GROUP BY student_id
SUM(stars) AS totalStars
ORDER BY totalStars DESC, student_id ASC
```

- `limit`：默认 `5`，最大 `20`（建议 DTO 校验 `0 < limit <= 20`）。
- 排序稳定：`totalStars DESC` 后接 `student_id ASC` 作 tie breaker。
- 并列名次本阶段按序编号 `1,2,3,4,5`（不做 `1,1,3` 同分并列），如后续需要再单独设计。

### 权限

- 必须经过现有 `requireClassAccess(actor, classId)`，教师不能查询无权限班级。

## 前端 contract（已就绪）

文件：`frontend/src/api/platform.ts`

```ts
export type RewardLeaderboardItem = {
  rank: number
  studentId: number
  studentName: string | null
  totalStars: number
}
export type RewardLeaderboardResponse = {
  classId: number
  className: string
  items: RewardLeaderboardItem[]
}

// platformApi 新增
rewardLeaderboard: (classId: number, limit = 5) =>
  http.get<RewardLeaderboardResponse>(`/classes/${classId}/rewards/leaderboard`, { params: { limit } }),
```

## 后端验收要点

1. `GET /classes/1/rewards/leaderboard?limit=5` → 200，`items` 按 `totalStars DESC, student_id ASC`。
2. 有奖励的班返回真实排序；无奖励的班返回 `items: []`。
3. `limit` 参数生效，`limit > 20` 被拒绝或截断到 20。
4. 非本班教师调用 → 403（requireClassAccess）。
5. 与 `GET /classes/:classId/rewards` 的 `summary.totalStars` 相互自洽（前排之和 ≤ 全班总和）。