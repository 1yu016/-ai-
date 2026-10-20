# I-2-4C：授权修复的冻结边界阻塞

## 当前结果

2026-10-19，本批尚未修复。按用户“若必须扩大底层改动，保存证据并停止该部分”要求，停止在实施前；没有提交一个只有事务外预检查的不完整补丁。

本批未修改业务源码、测试或既有报告，未启动服务、未连接数据库、未执行测试/浏览器操作。I-2-4B 的真实 200、两个新命令及 Run v8→10 是历史证据，不能描述为本批重新复现。

## 根因与真实链路

1. `backend/src/artworks/artwork.service.ts:85` 的 deliver 检查作品归属、确认和目标设备，却不调用当前授权检查。`requireGuardianConsents:144` 仅在 upload:42 使用。
2. `backend/src/classroom-runs/classroom-command.service.ts:129` executeSerialized 先查原 requestId；新请求在151保存 Processing记录，199才执行领域操作。
3. 同文件 mediaCommand 中 display_artwork 仅检查 Run 关联和确认；speak_text 写入文本，600进入 checkpointControl。
4. `backend/src/classroom-runs/classroom-run.service.ts:1071–1107` 在已有 transactionRequired 内完成 Run CAS、Event、required Snapshot。该事务不包含前面的 Processing 命令记录。
5. `backend/src/platform/platform.service.ts:1167` upsertConsent 通过全局 repository 更新授权，并另写审计；没有使用共享 FIFO/独立事务。不能假定它与展示提交天然互斥。跨请求加入共享 SQLite 事务在此路径属于源码风险，本批未用测试证实，不能声称已复现。

## 为什么不能只补一次检查

- deliver 中增加检查只能封住已撤销后到达的普通 HTTP 请求，仍有检查之后撤销的窗口，且直接 CommandBus 入口仍可绕过。
- 在 checkpoint 的写入事务内增加检查可以保护该事务的 Run/Event/Snapshot，但授权若在 Processing 持久化后撤销，拒绝仍会留下新命令记录。按 I-2-4B 的命令表数量验收口径，不能把它报告成“零新增命令”。
- 在 ArtworkService 外层包 transaction 再调用现有 CommandBus/checkpoint，不是安全捷径：现有调用链还会进入 Snapshot FIFO/事务，存在嵌套或等待自身的风险。未实施这种包裹。
- 目前没有找到可让 ArtworkService 向 CommandBus 和 required Snapshot 同时传入同一个 EntityManager 的现成入口。不得直接删除失败命令记录或改写首次结果来制造零新增。

## 需要明确允许的最小扩展

若必须同时满足“并发拒绝零新命令记录、零Event/Snapshot/版本增长”，需要允许对**作品相关命令的准入/Processing 持久化与实际提交边界**做定向调整，以及将真实授权撤销写入口纳入既有共享数据库写入协调。该范围超过仅补作品服务检查，涉及用户明确冻结的 CommandBus/事务契约；本批没有自行实施。

不建议创建第二套队列、数据库字段或状态机。授权通过与首次新命令必须有一致的数据库顺序；严格匹配并已提交的请求保留合法只读重放，但仍应执行身份、当前访问权限与payload冲突校验。未提交的请求不能因命令记录存在就认定成功。

## 验证状态

- 本轮测试：未执行。
- 本轮浏览器：实际操作未执行，原因是触及明确的冻结边界而暂停实施，不是工具不可用。
- 历史 I-2-4B 失败证据保留于 `backend/.tmp/i2-4b-20261019-04/backend-results.json` 和外部 `integration-I1-evidence/i2-4b-real-final-evidence.log`。
- 原 A/I-0、既有工作区修改、正式数据库及服务均未操作；无 commit/push/pull/merge。

## 下一步

仅请求明确是否允许上述作品命令的定向事务边界扩展；在边界未明确前，不提交只能覆盖顺序场景的补丁，不宣称 I-2-4C 已完成。
