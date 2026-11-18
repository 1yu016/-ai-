# P5-Mobile-UI 手机课堂遥控界面优化
日期：2026-11-03

## 范围
工作区 D:/trae_project/merge-worktrees/integration-I1-unified-20261102
分支 merge/unified-classroom-20261102。保留已有教师控制台、AI备课、角色库和backend/.env.example改动。
仅新增/修改：
- frontend/src/views/ClassroomMobileRemoteView.vue：布局与界面状态。
- frontend/tests/e2e/p5-unified-qa.spec.ts：四尺寸截图、工具展开状态隔离及新入口适配，结束前使用已有刷新状态按钮。
- docs/P5_MOBILE_UI.md：本报告。
原始 integration-I1 工作区仍干净；无后端、迁移或数据库改动，无提交/推送/合并。
本轮前备份：evidence/p5-1/mobile-ui/ClassroomMobileRemoteView.before.vue、p5-unified-qa.before.ts。

## 页面与功能保留
|功能|入口及保留情况|
|---|---|
|连接、课程、计时与课堂状态|顶部紧凑状态区；保留重连、错误提示和退出控制|
|环节与进度|当前环节卡片，上一步/下一步；教学说明可展开|
|点名、奖励、完整考勤|快捷点名/奖励展开原有学生选择、考勤及操作按钮；原命令未变|
|儿童问答、教师审核|问答入口；待审核时自动显示面板和提醒；v-show保留组件实例，收起不停止会话|
|数字人|问答内状态说明；停止媒体沿用恢复数字人权威状态；不新增模型或替换身份|
|媒体|更多工具→媒体与资源；播放、暂停媒体、继续媒体、翻页；底栏统一停止媒体与声音按钮|
|课堂|底栏暂停/继续课堂，与暂停媒体明确分开；更多→课间与课堂保留课间与结束确认|
|历史与反馈|更多内最近点名、奖励、互动、送达回执及指令记录；失败提示保持可见|
|语音/AI|原手机只有问答文字与审核，没有教师语音识别或独立AI建议面板；语音入口如实提示电脑端操作，未伪造功能|
|资源选择|原手机仅支持当前步骤绑定资源，没有独立资源库选择器；保留原能力，本轮未新建业务接口|

所有手机命令继续通过 mobile.execute 与现有 CommandBus/权限/版本控制。没有合并语义不同的命令。
未更改奖励或问答审批策略；不在布局任务内增加或降低业务确认。
技术媒体状态换为中文。固定底栏使用安全区padding，页面预留底部空间；按钮最小44–48px。
保持原暖色渐变、圆角、原按钮配色与图标，未引入新主题。

## 测试
- mobile-ui-build：npm run build通过（含类型检查）；保留原有大块构建警告。
- mobile-ui-final-type：最终类型检查通过。
- mobile-ui-tests：3个文件40项通过：手机会话/命令、扫码面板、儿童问答。
- mobile-ui-browser-confirm：Chromium真实渲染E2E 1条完整流程通过，41.3秒。
  包含教师入口、临时课堂与独立大屏、手机授权登录、四尺寸首屏与问答截图、无横向溢出、
  展开工具不改变Run版本/展示快照、种子知识问答、审核前后大屏展示、6条问题保存、
  手机问答退出、媒体播放与重复停止、大屏恢复、手机退出不结束课堂、结束确认、总结及班级问题查询。
- 点名和奖励：入口浏览器可访问，命令由现有单元回归覆盖；本轮浏览器合成课堂未配置学生，不将真实点名/奖励执行标记为通过。
- git diff --check通过。

首轮修改前截图流程最后结束确认超时，四尺寸截图已获得；验收脚本结束前补用已有刷新课堂状态入口后完整通过。未改课堂结束逻辑。
扩展复测一次大屏问题未出现，与源码空格清理触发热更新时间重叠；未据此修改业务逻辑。稳定源码后同流程复跑通过。两次失败日志均保留，不计为通过。

全部浏览器数据通过既有E2E runner在新临时SQLite和随机端口生成，未使用5592/3592演示数据库。
相关日志位于 evidence/p5-1/mobile-ui-*.log。
未重启已有服务。当前5592源码热更新可查看页面；后端及数据库保持原状。

## 截图
- 360×800：[修改前](../evidence/p5-1/mobile-ui-before-results/.last-run.json/before-360x800.png) / [新版首屏](../evidence/p5-1/mobile-ui-browser-confirm-results/.last-run.json/compact-360x800.png) / [问答展开](../evidence/p5-1/mobile-ui-browser-confirm-results/.last-run.json/after-360x800.png)
- 375×812：[修改前](../evidence/p5-1/mobile-ui-before-results/.last-run.json/before-375x812.png) / [新版首屏](../evidence/p5-1/mobile-ui-browser-confirm-results/.last-run.json/compact-375x812.png) / [问答展开](../evidence/p5-1/mobile-ui-browser-confirm-results/.last-run.json/after-375x812.png)
- 390×844：[修改前](../evidence/p5-1/mobile-ui-before-results/.last-run.json/before-390x844.png) / [新版首屏](../evidence/p5-1/mobile-ui-browser-confirm-results/.last-run.json/compact-390x844.png) / [问答展开](../evidence/p5-1/mobile-ui-browser-confirm-results/.last-run.json/after-390x844.png)
- 430×932：[修改前](../evidence/p5-1/mobile-ui-before-results/.last-run.json/before-430x932.png) / [新版首屏](../evidence/p5-1/mobile-ui-browser-confirm-results/.last-run.json/compact-430x932.png) / [问答展开](../evidence/p5-1/mobile-ui-browser-confirm-results/.last-run.json/after-430x932.png)

## 人工验收与限制
本轮为桌面Chromium与独立手机视口验证，不是微信内置浏览器、iOS Safari或真实手机证明。
待真机检查：同Wi-Fi扫码、微信返回/切后台后的连接、软键盘与底栏避让、刘海屏安全区、
实际点名和奖励、音箱静音/恢复与大屏播放。手机没有启用麦克风，不能声称通过手机语音识别。
教师在电脑课堂页连接手机→扫码授权→当前环节→快捷功能；媒体/考勤/历史/课间在更多工具内。
恢复只需用本轮备份还原手机页及验收脚本；不使用git reset，不覆盖教师端或其他改动，不动数据库。
完成本轮后停止功能开发，等待人工验收。
