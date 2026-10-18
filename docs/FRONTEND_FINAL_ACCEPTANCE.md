# 成员 B 前端最终交付

## Changed

- 加固课堂记录时间线、总结草稿确认/导出、问题地图失败隔离和绘画评价授权、确认、投递及媒体释放。
- 完善手机控制端状态机：服务端时钟、重连鉴权、完整状态恢复、版本冲突、TTL、原 requestId 重试、终端课堂失权和资源预加载。
- 增补组件、Store 和手机控制测试。
- 新增教师、手机、大屏操作手册和现场验收记录。

## Reused

复用现有 `ResourcePlayer`、`ClassroomScreenView`、`ClassroomMobileRemoteView`、课堂和设备 Store、`studentArtwork` 服务、统一课堂命令入口、现有 API 适配层及后端设备会话。未新增数据库迁移、课堂状态机或实时协议。

## API / 协议事实

手机后端当前真实字段为 `requestId`、`expectedVersion`、`operation`、`targetDeviceId`、`issuedAt`、`ttlMs`，回执使用 `deliveryStatus=confirmed`。后端尚未提供 `commandId`、`executionStatus`、`expiresAt` 或 `resumeCursor` 的完整异步命令接口；前端只对现有确认回执做兼容映射，没有伪造请求字段或另建协议。该接口缺口应由成员 A 后续冻结协议后补齐。

## Tests

- Frontend lint、type-check、build：通过。
- Frontend unit/component：76 files，596 tests，通过。
- Frontend E2E：不通过；后端测试端口启动超时。
- Backend lint、type-check、build：通过。
- Backend unit：不通过；12 项 `EACCES` 临时端口连接失败。
- Backend E2E：不通过；多套件临时端口连接被拒绝。
- Production preview：根路由和 `/classroom/remote` HTTP 200。

## Remaining

真实大屏、教师手机、麦克风、摄像头、音响、Wi-Fi 切换、外网断开、浏览器崩溃恢复和 1–2 小时长时间运行均为“待现场验证”。前后端 E2E 需在允许本机监听测试端口的环境重跑。不得把当前环境阻塞写成业务通过。

## 风险与回退

主要风险是后端实时协议尚未提供完整异步状态字段，以及测试环境禁止临时端口监听。发生版本冲突、命令过期或后端不可用时，回退到只读状态、基础课堂按钮和上一版前端构建；不在客户端自行合并服务端状态。
