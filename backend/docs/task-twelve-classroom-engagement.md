# 任务12：奖励、荣誉、班级成长与课间模式

## 数据库

迁移：`202609300014-ClassroomEngagement.ts`

新增表：

- `reward_rule`：园所奖励规则，支持积分、徽章、小红花和班级成长值组合。
- `reward_record`：不可删除的奖励事实记录。
- `reward_reversal`：奖励撤销审计，一条奖励最多撤销一次。
- `badge_definition`、`student_badge`：徽章定义及学生获得记录。
- `class_growth_record`：班级成长值追加式流水，保存每次变更后的余额。
- `honor_record`：荣誉草稿、教师确认及展示冷却信息。
- `collective_goal`：班级共同目标、进度和完成状态。
- `break_config`：班级课间活动配置。
- `break_run`：课间运行、倒计时、原课堂状态和步骤快照。

迁移只新增表和索引，不清空、不重建已有业务表。

## 奖励接口

- `POST /badge-definitions`、`GET /badge-definitions`
- `POST /reward-rules`、`PATCH /reward-rules/:id`、`GET /reward-rules`
- `POST /classroom-runs/:runId/rewards`
- `GET /classroom-runs/:runId/rewards`
- `POST /rewards/:rewardId/reverse`
- `GET /students/:studentId/badges`

奖励类型：`answer`、`cooperation`、`focus`、`labor`、`exploration`、`progress`。

同一教师的相同 `requestId` 只产生一次奖励。撤销只把原记录标记为 `reversed`，同时追加 `reward_reversal`、徽章失效时间和负向班级成长流水，不删除原记录。

## 班级成长接口

- `POST /classes/:classId/collective-goals`
- `POST /classes/:classId/growth/adjust`
- `GET /classes/:classId/growth`

奖励成长值和教师调整都保存独立流水。活跃目标随成长事件更新，到达目标时保存完成状态和目标完成事件；奖励撤销会回退相应成长值。

## 荣誉接口

- `POST /classroom-runs/:runId/honors/suggest`
- `POST /honors/:honorId/publish`
- `GET /classroom-runs/:runId/honors`

荣誉类型：今日之星、合作之星、探索之星、劳动之星、集体荣誉。

候选依据至少包含奖励类型丰富度、相关行为次数、课堂参与次数和历史展示次数。近期已经展示的幼儿进入冷却，优先轮换给未处于冷却期的合格幼儿。接口只返回建议的单个荣誉对象，不提供总分排名、末位名单或负面榜单。所有荣誉先进入 `draft`，教师确认后才发布。

## 课间接口

- `POST /break-configs`
- `PATCH /break-configs/:id`
- `GET /classes/:classId/break-configs`
- `POST /classroom-runs/:runId/breaks/start`
- `GET /classroom-runs/:runId/breaks/active`
- `GET /break-runs/:id`
- `POST /break-runs/:id/pause`
- `POST /break-runs/:id/resume`
- `POST /break-runs/:id/end`

课间类型：饮水、如厕、活动、眼保健操、自定义活动。

开始课间时保存原课堂状态、当前步骤、课堂版本和快照，课堂主状态暂时切换为暂停。课间倒计时根据数据库中的 `elapsedSeconds` 和 `resumedAt` 计算，因此刷新或服务重启不依赖进程内存。结束课间后恢复原状态和步骤。数据库部分唯一索引保证同一课堂只有一个 `running` 或 `paused` 课间。课堂完成或取消时，在同一事务中把有效课间标记为 `auto_terminated`。

## 权限和安全

- 只有当前课堂教师可以奖励、撤销、生成荣誉草稿、发布荣誉和控制课间。
- 学生必须属于课堂班级且处于启用状态。
- 管理员默认只可读取奖励、荣誉、成长和课间审计数据。
- 课间进行时禁止普通课堂恢复、步骤切换和检查点写入，避免覆盖保存的恢复位置。
- 所有外部输入经过 DTO 校验；服务端重新验证课堂、班级、学生、规则和徽章权限。
