# P5-1：unified-classroom → integration-I1 代码整合报告

日期：2026-11-02。此报告只交付独立分支中的代码，未部署、未向原分支合并、未执行任何真实数据库迁移。

## 1. 代码和工作区

- 只读源：D:\codex\2026-10-21\referenced-chatgpt-conversation-this-is-an\outputs\unified-classroom
- 原目标：D:\trae_project\new1\integration-I1；integration/i1-ab；81eea14a4b1b41251feb324ddb0af0ce7ba430a0。
- 唯一修改工作区：D:\trae_project\merge-worktrees\integration-I1-unified-20261102
- 合并分支：merge/unified-classroom-20261102；基线 81eea14。
- 源没有用于此次合并的 Git 分支，采用审计后的文件增量补丁，没有伪造 Git 合并历史。
- 后端恢复点 ee26b8f；前端恢复点849750b。文档恢复点见本分支 Git 日志。
- 源和原目标的源码、测试和脚本指纹复核未发现变化；原目标分支/HEAD及工作区保持不变。Worktree 正常共用 Git 对象库，此说明不表示共享 Git 元数据完全未变化。
- 沿用 P5-0 的完整备份：D:\trae_project\backups\integration-I1-pre-merge-20261102。106 项保全基线仍在祖先提交中；8 个诊断脚本归档未被覆盖或搬入运行包。未操作 -ai- 原工作区。
- 前后端依赖目录物理复制到 Worktree，测试不共用原目录的可写依赖；依赖声明与锁文件未升级。本轮不是全新 npm ci 验证。

## 2. A—G 实施清单

|阶段|实际整合内容|取舍|
|---|---|---|
|A 基础契约|命令类型、问题 DTO/实体、作品筛选、教案环节动作、前后端公共返回结构|增加字段和能力；原接口保留|
|B P0|作品访问重查监护授权、no-store；总结草稿读取/生成/确认/放弃/报告统一 owner 校验|保留 I1 原有作品事务、撤权保护、教师/班级访问体系|
|C P1|单一迁移注册表、显式迁移、迁移前备份/完整性检查、只读验证；默认关闭自动建表和自动迁移|保留目标全部30份历史迁移；新增前向兼容迁移|
|D P2|环节有效用时/偏差、完成播放检查点、考勤/点名/有效奖励、助教活动、九类问题与未分类、管理员聚合看板|复用真实记录；保留原统计字段；旧版看板载荷缺新字段时显示“—”|
|E P3|stop_media、权威 presentationMode、媒体退出、大屏数字人恢复、进度和媒体快照保留|使用原 CommandBus / Policy；停止媒体不结束 Run|
|F P4|备课启用、教师显式进入/退出、文字/本地 Vosk、问题记录、教师审核、大屏字幕、手机入口、媒体互斥|复用 StudentQuestionRecord；不另建儿童问题系统|
|G P4-D/D2|文本规范化、同义词、具体意图优先、水作用/缺水/发芽/光照卡、无关问题转交|保留最新六条缺水表达和审核门控；没有接入通用大模型|

依赖成组接入：问答 Provider/Service 的后端基础随模块依赖提前注册，媒体与问答执行器共用同一个命令服务；没有制造两套状态机。每组应用后进行了对应测试，结果见第6节。

## 3. 重复功能与原功能保留

1. 认证、班级访问、ClassroomRun、手机后端、设备会话、业务 receipt、canonical 事务、Cockpit、资源服务、数字人服务等共同实现保留。
2. 同名文件没有直接覆盖处理：先比较生产差异与依赖，再应用公共契约、权限、分析和展示补丁；环境配置、迁移注册、历史迁移和测试等待策略单独适配。
3. 旧控制器原254个HTTP方法/路径装饰器声明均保留；原路由定义保留，增加作品入口及旧管理地址重定向。教师默认落点改为工作台，原“我的班级”页仍可访问。
4. 原班级/设备选择与扫码页保留，二维码生成复用新共享面板，当前课堂绑定校验避免串 Run。
5. 原“列表一键开始”测试改为“进入准备页且不直接创建 Run”，采用更安全的已有准备流程；原课堂功能并未删除。
6. new1 的游客聊天/历史会话、打卡、情绪事件记录、旧课次等兼容能力保留；没有把这些扩展成儿童控制通道。
7. P0 授权并发、奖励撤回、集体奖励、考勤、分组点名、绑定撤权、故障恢复、原数字人/教师语音等原测试均纳入后端/前端全量回归。

## 4. 数据库兼容方案

### 4.1 历史迁移不变

目标原30份迁移在 Git 基线与最终代码之间均未修改。三个冲突文件继续采用 I1 原实现：

- 202610020013-ClassroomRunBreakFields.ts
- 202610060014-ClassroomCommandBus.ts
- 202610060020-StudentQuestionMap.ts

证据：evidence/p5-1/historical-migrations-preserved.json，含每份原 Git blob 和当前 SHA-256。原目录与新 Worktree 少量文件存在初始 CRLF/LF 差异，规范化内容一致；没有将源项目的历史修订覆盖过去。

### 4.2 追加内容

- 202610120026—31：问答答案字段、actionType 列名兼容、教案动作/命令枚举、字段长度、问题检索索引。
- 1792800000000/1000/2000 文件仅作继承实现，未在注册表中作为历史迁移再次注册；不能改用目录通配符注册所有导出类。
- 202611020032：在已有历史迁移记录的库中补齐缺失 break / reward revoke 列和唯一索引；重复值令事务失败，不删除冲突记录。
- 202611020033：补齐 I1 原来依赖 synchronize 创建的六张兼容表：lesson_run、session、chat_message、check_in、emotion_event、visitor_migration。存在的表保留，缺失表才创建；相关索引检查后补充。
- action_type 与 actionType 同时存在且值冲突时停止，不静默覆盖。
- 已有结构但无迁移账本，或检测到已加字段但相应历史账本缺失时，显式迁移脚本停止，要求先在备份上建立经审查的基线；不伪造执行记录。
- 新迁移的 down 拒绝破坏性降级。失败按事务回滚，保留迁移前一致备份。

### 4.3 配置与验证

AppModule 和 backend/.env.example 默认 DB_SYNCHRONIZE=false、DB_MIGRATIONS_RUN=false。新增 db:migrate / db:verify 命令。迁移要求显式绝对 DATABASE_PATH；已有库先完整性检查并在线备份，再验证备份；全事务迁移。db:verify 只读打开 SQLite，不启动 Nest，不建用户、不跑定时任务、不执行迁移。

真实/团队权威库仍为 UNCONFIRMED。本轮只使用 :memory:、Worktree evidence/p5-1/tmp 下新建文件，以及 frontend/.tmp/e2e-进程号-时间 下新建浏览器库。没有复制、连接或修改任何既有真实/演示数据库。

空库迁移后对84个实体检查：没有缺表和缺列。ORM schema builder 仍提出988条结构调整候选（包含历史外键、约束、索引命名及表重建等差异），未执行这些候选。因此这里不宣称迁移结构与 synchronize 元数据逐项完全相同；真实升级前仍须审查权威库副本，不可开启 synchronize 来“自动修齐”。

## 5. 本轮发现并修复的集成问题

|问题|依据及处理|
|---|---|
|新增 ChildQa 枚举后备课动作表缺项|初次后端类型检查失败；补入原源项目的配置读取和验证|
|分析返回结构更新导致旧测试载荷不完整|初次前端类型检查失败；保留新结构并适配测试|
|看板收到旧版聚合数据会抛 formalSummaries 异常|全量前端回归实际失败；补齐旧载荷兼容，保留原测试并加新指标测试|
|历史模块只依赖自动建表|空库迁移后的实体比对发现六张缺表；用新追加迁移补齐，并验证仓储真实读写及重复迁移数据保留|
|手机旧状态可以覆盖较新的已确认版本|定向时序测试复现；采纳成功命令的同 Run/设备权威结果，丢弃较旧版本帧；撤权/终态仍即时生效|
|浏览器脚本在问答退出请求未完成就点播放|网络证据为 stop 请求成功返回17而预先发送的 play 仍携带16；后端正确拒绝。脚本等待已有界面完成退出，再播放，没有放宽版本规则|
|旧 E2E 输出目录缺失|首次全量后端108项因写证据 ENOENT 失败；只补齐隔离测试目录后全量重跑通过|
|浏览器定位和隔离设置|适配工作台/准备页真实入口、同名按钮精确定位；不同浏览器批次使用独立截图/报告目录，保留首次失败日志|
|localhost 不生成手机二维码|原有合法限制保留；手机视口测试显式使用本机 WLAN 地址和随机端口临时前端，未伪造真实手机扫码结果|

## 6. 自动化验证

最终结果必须以对应日志汇总为准；较早失败日志保留，不用最终成功掩盖它们。

|范围|命令（相应子目录）|最终结果|证据|
|---|---|---|---|
|后端类型|npm run type-check|通过|final-backend-types.log|
|后端构建|npm run build|通过|C-backend-rebuild.log|
|后端单元|npm test -- --runInBand|33组、701项通过|all-backend-unit.log|
|后端完整 E2E|npm run test:e2e -- --runInBand|45组、474项通过；5组/17项有条件跳过|final-backend-e2e.log|
|迁移及兼容|Stage8 + integration-migration-safety|空库/原30迁移旧库/重复/冲突拒绝/无账本不改写/只读校验/六旧模块读写均通过|C-legacy-crud.log|
|前端类型/构建|npm run type-check；npm run build|通过；保留产物体积警告|integrated-frontend-types.log / integrated-frontend-build.log|
|前端全量|npm test -- --maxWorkers=2 --reporter=verbose|125文件、1025项通过|integrated-frontend-all.log|
|手机版本顺序与问答/大屏|定向3个文件|55项通过|mobile-state-ordering.log|

日志均在 Worktree/evidence/p5-1；机器汇总在 docs/P5_1_VERIFICATION_SUMMARY.json。跳过的是需要显式授权外部付费服务或既有验收材料的条件测试，本轮没有启用它们，不计为通过。

首轮前端全量曾为1021通过/1失败并有未处理异常，系旧版看板载荷缺字段；修复后先1023项通过，再增加手机顺序回归后1025项通过。首轮无详细输出的前端尝试在未取得汇总时中止，退出码非零；从未标成通过。

## 7. 真实浏览器操作与证据边界

使用本机 Chrome，经 Playwright 操作实际页面与真实后端，不是组件 Mock。后端先显式迁移全新测试库；随机端口，测试结束关闭自己的临时进程。合成班级/设备/教案/图片等前置资料通过授权 API 建立，未直接插入课堂行为记录；教学操作从教师登录和可见准备入口开始。

- 原核心四条：教师登录→编辑教案→准备/开课→环节/暂停恢复→结束/总结/记录，游客聊天（模型返回 Mock），管理员审核归档，教师拒绝管理员页面：4通过。browser-core.log。
- 认证/角色/刷新、退出后后退保护、班级/学生与资源导航：7通过。browser-auth-final.log。
- 完整种子问答/手机协同：browser-qa-settled.log 为1通过，覆盖四题教师批准、大屏字幕、无关问题 handoff；手机视口追加缺水问题、媒体→问答→退出→再次播放→连续两次停止；大屏刷新恢复；Run仍running、步骤仍0、六条记录保存；手机退出不结束课堂，最后教师正常结束。
- 课后班级问题页也已通过：正常结束→课堂记录→我的班级→进入班级→儿童问题，六条问题、答案及审核状态真实显示。最终日志browser-complete-offline.log。
- 手机视口为独立浏览器上下文390×844，通过当前二维码界面生成的合法票据和对应地址模拟打开扫码链接，并正常教师登录；没有物理摄像头扫码。
- 没有真实麦克风/儿童语音、物理手机、投影或音箱验收。Vosk语音输入的代码/模拟回调测试通过，不代表儿童识别准确率或真实播报声音已验证。
- 本轮没有更换 AvatarIdentity，没有接入收费模型；回答能力是有限本地知识卡和确定性规则。

|输入|知识卡/处理|浏览器证据|
|---|---|---|
|芽需要水|water_role，待审核|审核前问题+等待状态；批准后显示答案|
|种子要喝水吗|water_role，待审核|同上|
|不给种子浇水会怎么样|no_water，待审核|缺水答案不宣称立即死亡|
|种子为什么需要水|water_role，待审核|说明水的作用|
|天空为什么是蓝色|teacher_handoff|不显示未经审核的知识卡答案|
|手机：种子不浇水会怎样|no_water，待审核|手机批准，大屏实际显示|

六条指定缺水表达及原有发芽/光照、歧义/无关/含控制词等问题已纳入 child-qa.core.spec.ts；整体单元汇总已包含这些测试，不把每个规则命中包装成通用语义模型。

## 8. 未整合/未验证与风险

1. 没有迁入源项目演示库、真实配置、种子初始化/固定端口启动脚本、历史人工验收的私有运行物和临时诊断脚本。它们不是应覆盖目标的生产功能。
2. 权威数据库、实际迁移账本、发布过的旧迁移字节来源仍待确认。旧库升级测试是从目标历史迁移生成的合成样本，不能替代权威旧库副本演练。
3. 988条 ORM候选结构变化未执行，也不作为全部约束完全一致的证据。默认禁用 synchronize 必须保留；新增前向迁移在真实环境仍需审批。
4. 旧的普通问题记录接口仍属于教师记录通道；儿童问答使用更严格的 Run/步骤/会话校验。没有扩展或重写通用问题模块的既有业务规则。
5. 本地知识卡只覆盖已知主题，未知/风险问题转教师。没有开放式云模型能力承诺。
6. 浏览器真渲染通过不等同于真麦克风、物理手机和音箱验收。真实设备、长时间离线重连、多物理客户端压力和干净机器依赖安装尚未验证。
7. 原目标的真实 .env 未修改。将来部署时须显式审查原有 DB_SYNCHRONIZE/DB_MIGRATIONS_RUN 值，示例改为false不等于旧配置已改变。
8. 媒体测试的浏览器主样本为图片；音视频/绘本/PDF/页码/快照/迟到事件还依赖组件和后端回归证据，不冒充这些媒体均已在物理大屏逐项播放。
9. 首轮浏览器错误包括测试年龄枚举、同名定位、等待命令结束和 localhost二维码限制；日志保留。生产改动只针对已确认的兼容/顺序问题，没有为脚本放宽授权或业务规则。

## 9. 复测与后续审核

在独立工作区的 backend / frontend 内分别运行第6节命令。运行浏览器测试前先构建 backend；frontend 下 npm run test:e2e -- core-flow.spec.ts。完整问答脚本 p5-unified-qa.spec.ts 需要显式 E2E_LAN_HOST 为本机实际 WLAN IPv4，启动器据此配置随机端口二维码地址；不具备局域网地址时不要伪造手机可达性。

测试包装器只用于本次 evidence：设置 TEMP/TMP到工作区、关闭自动建表/启动迁移、禁用真实付费验收开关，截图按批隔离。完整脚本会在frontend/.tmp中新建专属库、显式迁移、退出时只清理自己生成的目录；绝不使用原项目数据库。启动器并非生产部署脚本。

本轮没有启动、停止或重启5591/3591/5592/3592，没有执行真实升级或部署。审核后如获授权，先明确权威库与可恢复备份，再在一致副本上核对账本/结构/行数/关键关联，之后才讨论真实迁移和原分支合并。

## 10. 恢复方式

- 尚未合并回原 integration/i1-ab，因此拒绝本次整合时，继续使用原目录即可，无需还原真实数据库。
- 独立分支各提交是审查/回滚边界；后续可经确认采用新的 revert 提交撤销指定模块，不重写原分支历史，不 reset/clean。
- 基线81eea14和P5-0完整备份仍在。若要另建基线复核工作区，须在未来授权后创建，不能覆盖当前工作区或原目录。
- 新迁移拒绝破坏性down；未来真实升级后的恢复必须使用经过验证的一致备份并妥善保留升级后新增数据。本轮没有真实升级，因此没有真实数据需要回滚。

## 11. 修改文件清单

以下路径以唯一合并工作区为根。源码/配置修改前快照在 evidence/p5-1/backups；完整SHA清单在 evidence/p5-1/changed-files-final.json。

|文件|阶段/依赖组|修改原因|
|---|---|---|
| .gitignore | integration-compatibility | 已审计的同源增量契约、课堂状态或页面适配 |
| backend/.env.example | integration-compatibility | 依赖注册和迁移默认关闭；不携入真实环境配置 |
| backend/package.json | integration-compatibility | 依赖注册和迁移默认关闭；不携入真实环境配置 |
| backend/scripts/migrate-database.ts | C | 绝对路径显式迁移、迁移前备份或只读验证 |
| backend/scripts/verify-migrated-database.ts | C | 绝对路径显式迁移、迁移前备份或只读验证 |
| backend/src/ai/ai.controller.spec.ts | D | 已审计的同源增量契约、课堂状态或页面适配 |
| backend/src/ai/ai.controller.ts | D | 已审计的同源增量契约、课堂状态或页面适配 |
| backend/src/app.module.ts | integration-compatibility | 依赖注册和迁移默认关闭；不携入真实环境配置 |
| backend/src/artworks/artwork.controller.ts | B | 作品授权复核、原事务能力及回顾入口 |
| backend/src/artworks/artwork.service.ts | B | 作品授权复核、原事务能力及回顾入口 |
| backend/src/artworks/dto/artwork.dto.ts | A | 作品授权复核、原事务能力及回顾入口 |
| backend/src/classroom-runs/child-qa.core.spec.ts | A-dependencies | 复用儿童问题记录、有限知识卡、教师审核及问答配置 |
| backend/src/classroom-runs/child-qa.core.ts | A-dependencies | 复用儿童问题记录、有限知识卡、教师审核及问答配置 |
| backend/src/classroom-runs/child-qa.service.spec.ts | D | 复用儿童问题记录、有限知识卡、教师审核及问答配置 |
| backend/src/classroom-runs/child-qa.service.ts | D | 复用儿童问题记录、有限知识卡、教师审核及问答配置 |
| backend/src/classroom-runs/classroom-analysis.spec.ts | D | 真实课堂统计/九类领域及回归 |
| backend/src/classroom-runs/classroom-analysis.ts | D | 真实课堂统计/九类领域及回归 |
| backend/src/classroom-runs/classroom-command.service.ts | E-F | 已审计的同源增量契约、课堂状态或页面适配 |
| backend/src/classroom-runs/classroom-command.types.ts | A | 已审计的同源增量契约、课堂状态或页面适配 |
| backend/src/classroom-runs/classroom-operation-policy.spec.ts | E-F | 已审计的同源增量契约、课堂状态或页面适配 |
| backend/src/classroom-runs/classroom-operation-policy.ts | E-F | 已审计的同源增量契约、课堂状态或页面适配 |
| backend/src/classroom-runs/classroom-record.service.ts | D | 总结所有权、真实分析与旧版响应兼容 |
| backend/src/classroom-runs/classroom-run.module.ts | D | 依赖注册和迁移默认关闭；不携入真实环境配置 |
| backend/src/classroom-runs/dto/student-question.dto.ts | A | 已审计的同源增量契约、课堂状态或页面适配 |
| backend/src/classroom-runs/entities/student-question-record.entity.ts | A | 总结所有权、真实分析与旧版响应兼容 |
| backend/src/classroom-runs/question-domain.spec.ts | D | 真实课堂统计/九类领域及回归 |
| backend/src/classroom-runs/question-domain.ts | D | 真实课堂统计/九类领域及回归 |
| backend/src/classroom-runs/student-question.controller.ts | E-F | 已审计的同源增量契约、课堂状态或页面适配 |
| backend/src/classroom-runs/student-question.service.ts | D | 已审计的同源增量契约、课堂状态或页面适配 |
| backend/src/lesson-plans/lesson-plan.service.ts | A-dependencies | 已审计的同源增量契约、课堂状态或页面适配 |
| backend/src/lesson-plans/lesson-plan.types.ts | A | 已审计的同源增量契约、课堂状态或页面适配 |
| backend/src/migrations/1792800000000-ChildQaAnswerFields.ts | C | 追加迁移实现/注册；原30份迁移保留 |
| backend/src/migrations/1792800001000-ChildQaLessonConfig.ts | C | 追加迁移实现/注册；原30份迁移保留 |
| backend/src/migrations/1792800002000-ChildQaCommandTypes.ts | C | 追加迁移实现/注册；原30份迁移保留 |
| backend/src/migrations/202610120026-ChildQaAnswerFields.ts | C | 追加迁移实现/注册；原30份迁移保留 |
| backend/src/migrations/202610120027-LessonStepActionColumnName.ts | C | 追加迁移实现/注册；原30份迁移保留 |
| backend/src/migrations/202610120028-ChildQaLessonConfig.ts | C | 追加迁移实现/注册；原30份迁移保留 |
| backend/src/migrations/202610120029-ChildQaCommandTypes.ts | C | 追加迁移实现/注册；原30份迁移保留 |
| backend/src/migrations/202610120030-ChildQaAnswerColumnLengths.ts | C | 追加迁移实现/注册；原30份迁移保留 |
| backend/src/migrations/202610120031-StudentQuestionIndexes.ts | C | 追加迁移实现/注册；原30份迁移保留 |
| backend/src/migrations/202611020032-IntegrationSchemaCompatibility.ts | integration-compatibility | 追加迁移实现/注册；原30份迁移保留 |
| backend/src/migrations/202611020033-LegacyFeatureTables.ts | integration-compatibility | 追加迁移实现/注册；原30份迁移保留 |
| backend/src/migrations/unified-migrations.ts | C | 追加迁移实现/注册；原30份迁移保留 |
| backend/src/platform/platform.service.ts | D | 已审计的同源增量契约、课堂状态或页面适配 |
| backend/test/artwork.e2e-spec.ts | B | 保留原回归并适配新入口/新增隔离测试 |
| backend/test/classroom-record.e2e-spec.ts | D | 保留原回归并适配新入口/新增隔离测试 |
| backend/test/classroom-run.e2e-spec.ts | E-F | 保留原回归并适配新入口/新增隔离测试 |
| backend/test/d9-tts-http-cancel.e2e-spec.ts | E-F | 保留原回归并适配新入口/新增隔离测试 |
| backend/test/integration-migration-safety.e2e-spec.ts | integration-compatibility | 保留原回归并适配新入口/新增隔离测试 |
| backend/test/platform-stage-one.e2e-spec.ts | D | 保留原回归并适配新入口/新增隔离测试 |
| backend/test/stage8-migrations.e2e-spec.ts | C | 保留原回归并适配新入口/新增隔离测试 |
| backend/test/student-question.e2e-spec.ts | D | 保留原回归并适配新入口/新增隔离测试 |
| frontend/playwright.config.ts | integration-compatibility | 已审计的同源增量契约、课堂状态或页面适配 |
| frontend/public/vendor/vosk.js | F-local-assets | 复用源项目本地 Vosk 引擎/模型（不调用付费服务） |
| frontend/public/vosk-model/model.tar.gz | F-local-assets | 复用源项目本地 Vosk 引擎/模型（不调用付费服务） |
| frontend/src/api/classroomMobile.ts | A | 手机会话隔离、幂等重试与防止权威状态版本倒退 |
| frontend/src/api/http.ts | E-F-G-frontend | 已审计的同源增量契约、课堂状态或页面适配 |
| frontend/src/api/platform.ts | A | 已审计的同源增量契约、课堂状态或页面适配 |
| frontend/src/classroom/command/TeacherInstructionSession.ts | E-F-G-frontend | 保留教师控制与数字人 Adapter，接入本地语音/受控理解 |
| frontend/src/classroom/command/TeacherVoiceCommandRouter.ts | E-F-G-frontend | 保留教师控制与数字人 Adapter，接入本地语音/受控理解 |
| frontend/src/classroom/command/TeachingCompanion.ts | E-F-G-frontend | 保留教师控制与数字人 Adapter，接入本地语音/受控理解 |
| frontend/src/classroom/command/TeachingLanguage.ts | E-F-G-frontend | 保留教师控制与数字人 Adapter，接入本地语音/受控理解 |
| frontend/src/classroom/lessonAvatarCue.ts | E-F-G-frontend | 已审计的同源增量契约、课堂状态或页面适配 |
| frontend/src/components/AdminLayout.vue | E-F-G-frontend | 保留原路由/角色隔离，接入工作台和班级入口 |
| frontend/src/components/BaseWorkspaceLayout.vue | E-F-G-frontend | 保留原路由/角色隔离，接入工作台和班级入口 |
| frontend/src/components/ClassWorkspaceLayout.vue | E-F-G-frontend | 保留原路由/角色隔离，接入工作台和班级入口 |
| frontend/src/components/ResourcePlayer.vue | E-F-G-frontend | 大屏权威展示、问答字幕、媒体退出/恢复 |
| frontend/src/components/TeacherLayout.vue | E-F-G-frontend | 保留原路由/角色隔离，接入工作台和班级入口 |
| frontend/src/components/classroom/ChildQaPanel.vue | E-F-G-frontend | 复用儿童问题记录、有限知识卡、教师审核及问答配置 |
| frontend/src/components/classroom/ClassroomMobileDrawer.vue | E-F-G-frontend | 已审计的同源增量契约、课堂状态或页面适配 |
| frontend/src/components/classroom/ClassroomWakeControl.vue | E-F-G-frontend | 保留教师控制与数字人 Adapter，接入本地语音/受控理解 |
| frontend/src/components/classroom/MobilePairingPanel.vue | E-F-G-frontend | 已审计的同源增量契约、课堂状态或页面适配 |
| frontend/src/components/classroom/OpeningSequenceOverlay.vue | E-F-G-frontend | 已审计的同源增量契约、课堂状态或页面适配 |
| frontend/src/components/classroom/ScreenOpeningPanel.vue | E-F-G-frontend | 已审计的同源增量契约、课堂状态或页面适配 |
| frontend/src/components/classroom/ScreenSummaryPanel.vue | E-F-G-frontend | 已审计的同源增量契约、课堂状态或页面适配 |
| frontend/src/components/classroom/operations/QuestionRecordPanel.vue | E-F-G-frontend | 总结所有权、真实分析与旧版响应兼容 |
| frontend/src/components/lesson/ChildQaConfigEditor.vue | E-F-G-frontend | 复用儿童问题记录、有限知识卡、教师审核及问答配置 |
| frontend/src/router/authNavigation.ts | E-F-G-frontend | 保留原路由/角色隔离，接入工作台和班级入口 |
| frontend/src/router/index.ts | E-F-G-frontend | 保留原路由/角色隔离，接入工作台和班级入口 |
| frontend/src/router/navigation.ts | E-F-G-frontend | 保留原路由/角色隔离，接入工作台和班级入口 |
| frontend/src/router/routeDefinitions.ts | E-F-G-frontend | 保留原路由/角色隔离，接入工作台和班级入口 |
| frontend/src/services/childQaRecognition.ts | E-F-G-frontend | 保留教师控制与数字人 Adapter，接入本地语音/受控理解 |
| frontend/src/services/classroomCapabilities.ts | A | 已审计的同源增量契约、课堂状态或页面适配 |
| frontend/src/services/classroomCommandBus.ts | A | 已审计的同源增量契约、课堂状态或页面适配 |
| frontend/src/services/classroomQuestions.ts | A | 已审计的同源增量契约、课堂状态或页面适配 |
| frontend/src/services/classroomRecords.ts | A | 总结所有权、真实分析与旧版响应兼容 |
| frontend/src/services/localWakeSpeech.ts | E-F-G-frontend | 保留教师控制与数字人 Adapter，接入本地语音/受控理解 |
| frontend/src/services/studentArtwork.ts | A | 作品授权复核、原事务能力及回顾入口 |
| frontend/src/stores/classroomMobile.ts | E-F-G-frontend | 手机会话隔离、幂等重试与防止权威状态版本倒退 |
| frontend/src/stores/lessonPlan.ts | E-F-G-frontend | 已审计的同源增量契约、课堂状态或页面适配 |
| frontend/src/stores/lessonRun.ts | E-F-G-frontend | 已审计的同源增量契约、课堂状态或页面适配 |
| frontend/src/stores/user.ts | E-F-G-frontend | 已审计的同源增量契约、课堂状态或页面适配 |
| frontend/src/views/AdminDashboardView.vue | D | 总结所有权、真实分析与旧版响应兼容 |
| frontend/src/views/ChatView.vue | E-F-G-frontend | 已审计的同源增量契约、课堂状态或页面适配 |
| frontend/src/views/ClassArtworkHistoryView.vue | E-F-G-frontend | 作品授权复核、原事务能力及回顾入口 |
| frontend/src/views/ClassDetailView.vue | E-F-G-frontend | 已审计的同源增量契约、课堂状态或页面适配 |
| frontend/src/views/ClassQuestionHistoryView.vue | D | 已审计的同源增量契约、课堂状态或页面适配 |
| frontend/src/views/ClassroomJoinView.vue | E-F-G-frontend | 已审计的同源增量契约、课堂状态或页面适配 |
| frontend/src/views/ClassroomMobileRemoteView.vue | E-F-G-frontend | 已审计的同源增量契约、课堂状态或页面适配 |
| frontend/src/views/ClassroomOperationsView.vue | E-F-G-frontend | 已审计的同源增量契约、课堂状态或页面适配 |
| frontend/src/views/ClassroomPreflightView.vue | E-F-G-frontend | 已审计的同源增量契约、课堂状态或页面适配 |
| frontend/src/views/ClassroomRecordView.vue | D | 总结所有权、真实分析与旧版响应兼容 |
| frontend/src/views/ClassroomScanView.vue | E-F-G-frontend | 已审计的同源增量契约、课堂状态或页面适配 |
| frontend/src/views/ClassroomScreenView.vue | E-F-G-frontend | 大屏权威展示、问答字幕、媒体退出/恢复 |
| frontend/src/views/ClassroomsView.vue | E-F-G-frontend | 已审计的同源增量契约、课堂状态或页面适配 |
| frontend/src/views/DevicesView.vue | E-F-G-frontend | 已审计的同源增量契约、课堂状态或页面适配 |
| frontend/src/views/LessonClassroomView.vue | E-F-G-frontend | 已审计的同源增量契约、课堂状态或页面适配 |
| frontend/src/views/LessonPlanEditorView.vue | E-F-G-frontend | 已审计的同源增量契约、课堂状态或页面适配 |
| frontend/src/views/LessonPlanListView.vue | E-F-G-frontend | 已审计的同源增量契约、课堂状态或页面适配 |
| frontend/src/views/LoginView.vue | E-F-G-frontend | 已审计的同源增量契约、课堂状态或页面适配 |
| frontend/src/views/StudentProfileView.vue | E-F-G-frontend | 已审计的同源增量契约、课堂状态或页面适配 |
| frontend/src/views/TeacherHomeView.vue | E-F-G-frontend | 保留原路由/角色隔离，接入工作台和班级入口 |
| frontend/tests/component/ClassArtworkHistoryView.spec.ts | E-F-G-frontend | 保留原回归并适配新入口/新增隔离测试 |
| frontend/tests/component/ClassroomOperationsView.spec.ts | E-F-G-frontend | 保留原回归并适配新入口/新增隔离测试 |
| frontend/tests/component/ClassroomRecordView.spec.ts | A-dependencies | 保留原回归并适配新入口/新增隔离测试 |
| frontend/tests/component/ClassroomScreenView.spec.ts | E-F-G-frontend | 大屏权威展示、问答字幕、媒体退出/恢复 |
| frontend/tests/component/LessonPlanListView.spec.ts | E-F-G-frontend | 保留原回归并适配新入口/新增隔离测试 |
| frontend/tests/component/MobilePairingPanel.spec.ts | E-F-G-frontend | 保留原回归并适配新入口/新增隔离测试 |
| frontend/tests/component/admin-console.spec.ts | integration-compatibility | 保留原回归并适配新入口/新增隔离测试 |
| frontend/tests/component/child-qa-panel.spec.ts | E-F-G-frontend | 复用儿童问题记录、有限知识卡、教师审核及问答配置 |
| frontend/tests/component/classroom-preflight-device.spec.ts | E-F-G-frontend | 保留原回归并适配新入口/新增隔离测试 |
| frontend/tests/component/classroom-scan-device-identity.spec.ts | E-F-G-frontend | 保留原回归并适配新入口/新增隔离测试 |
| frontend/tests/component/components.spec.ts | E-F-G-frontend | 保留原回归并适配新入口/新增隔离测试 |
| frontend/tests/component/lesson-classroom-fullscreen.spec.ts | E-F-G-frontend | 保留原回归并适配新入口/新增隔离测试 |
| frontend/tests/component/lesson-classroom-wake.spec.ts | E-F-G-frontend | 保留原回归并适配新入口/新增隔离测试 |
| frontend/tests/component/navigation-delivery.spec.ts | E-F-G-frontend | 保留原回归并适配新入口/新增隔离测试 |
| frontend/tests/e2e/auth-lifecycle.spec.ts | integration-compatibility | 保留原回归并适配新入口/新增隔离测试 |
| frontend/tests/e2e/classroom-console-composition.spec.ts | integration-compatibility | 保留原回归并适配新入口/新增隔离测试 |
| frontend/tests/e2e/core-flow.spec.ts | integration-compatibility | 保留原回归并适配新入口/新增隔离测试 |
| frontend/tests/e2e/device-online-gate.spec.ts | integration-compatibility | 保留原回归并适配新入口/新增隔离测试 |
| frontend/tests/e2e/gate-run.mjs | integration-compatibility | 保留原回归并适配新入口/新增隔离测试 |
| frontend/tests/e2e/p5-unified-qa.spec.ts | integration-compatibility | 保留原回归并适配新入口/新增隔离测试 |
| frontend/tests/e2e/run.mjs | integration-compatibility | 保留原回归并适配新入口/新增隔离测试 |
| frontend/tests/unit/auth-navigation.spec.ts | E-F-G-frontend | 保留原回归并适配新入口/新增隔离测试 |
| frontend/tests/unit/classroom-mobile.spec.ts | E-F-G-frontend | 手机会话隔离、幂等重试与防止权威状态版本倒退 |
| frontend/tests/unit/http.spec.ts | E-F-G-frontend | 保留原回归并适配新入口/新增隔离测试 |
| frontend/tests/unit/lesson-authoring.spec.ts | E-F-G-frontend | 保留原回归并适配新入口/新增隔离测试 |
| frontend/tests/unit/lesson-avatar-cue.spec.ts | E-F-G-frontend | 保留原回归并适配新入口/新增隔离测试 |
| frontend/tests/unit/lesson-list-navigation.spec.ts | E-F-G-frontend | 保留原回归并适配新入口/新增隔离测试 |
| frontend/tests/unit/local-wake-speech.spec.ts | E-F-G-frontend | 保留原回归并适配新入口/新增隔离测试 |
| frontend/tests/unit/navigation-delivery.spec.ts | E-F-G-frontend | 保留原回归并适配新入口/新增隔离测试 |
| frontend/tests/unit/resource-player-media.spec.ts | E-F-G-frontend | 保留原回归并适配新入口/新增隔离测试 |
| frontend/tests/unit/router-navigation.spec.ts | E-F-G-frontend | 保留原回归并适配新入口/新增隔离测试 |
| frontend/tests/unit/teacher-instruction-session.spec.ts | E-F-G-frontend | 保留原回归并适配新入口/新增隔离测试 |
| frontend/tests/unit/teacher-voice-command.spec.ts | E-F-G-frontend | 保留原回归并适配新入口/新增隔离测试 |
| frontend/tests/unit/teaching-companion.spec.ts | E-F-G-frontend | 保留原回归并适配新入口/新增隔离测试 |
| frontend/tests/unit/teaching-language.spec.ts | E-F-G-frontend | 保留原回归并适配新入口/新增隔离测试 |
| frontend/vite.config.ts | integration-compatibility | 已审计的同源增量契约、课堂状态或页面适配 |

## 12. 最终验收更新

P5-1 A—G代码整合完成，等待人工审核。后端 ee26b8f、前端849750b为模块恢复点；未合并原分支、未推送或部署。

- 最终完整问答/手机/课后回顾浏览器用例1通过（37.0秒），合并前核心4条与认证导航7条另行通过，按12条不同浏览器用例统计，不把反复复测累加为更多能力。
- 最终问题地图建议使用已有QUESTION_MAP_AI_ENABLED=false开关，完整流程走本地回退。首次回顾页测试曾用测试占位密钥尝试原有聚合建议并超时；没有真实密钥，未接入新付费模型。最终离线回退一轮没有该请求。
- 原项目源/目标源码、测试和脚本指纹再次一致；原目标仍为integration/i1-ab@81eea14且干净；30份原迁移没有变更。
- 测试临时服务结束后停止，不把随机测试端口作为部署地址，也不改变原演示端口。
- 问题回顾页在1280宽截图中答案列偏窄、页面较长；记录显示和入口已验收，排版优化留待后续批准，不扩大此次整合范围。

### 已保留截图

- [教师批准前：问题与等待状态](images/p5-1/screen-pending.png)
- [教师批准后：大屏缺水答案](images/p5-1/screen-approved-drought.png)
- [独立手机视口审核](images/p5-1/mobile-reviewed.png)
- [手机批准后大屏答案](images/p5-1/mobile-answer-on-screen.png)
- [课后班级儿童问题回顾：六条](images/p5-1/class-question-history.png)

报告、机器测试汇总、文件指纹清单及这5张截图也属于本轮新增交付文件。日志、失败trace、备份快照和原始SHA清单保留在Worktree的evidence/p5-1，不进入运行包。
