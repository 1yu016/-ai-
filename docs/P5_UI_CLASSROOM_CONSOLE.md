# P5-UI 教师课堂控制台布局与交互优化

## 范围与恢复点
- 工作区：D:/trae_project/merge-worktrees/integration-I1-unified-20261102。
- 分支：merge/unified-classroom-20261102；修改前 HEAD：046d64e8086a0a75fdf04e8b65b9a3cc923b1563。
- 修改前逐文件备份及哈希：evidence/p5-1/p5-ui/before-files、baseline.json。
- 原始 integration-I1 仍为 integration/i1-ab@81eea14，工作区干净。
- 已有 AI 备课三个未提交文件 SHA-256 均与修改前相同，见 protected-verification.json。
- 未提交、推送或合并代码。未修改后端、迁移、数据库或独立大屏业务组件。未重启服务。

## 实际变更
|文件|内容|
|---|---|
|frontend/src/views/LessonClassroomView.vue|顶部状态重排，约20/40/40三栏，课堂控制集中，互动/AI标签、问答常驻、当前展示待审核提醒，重复入口合并|
|frontend/src/components/classroom/ClassroomHeader.vue|状态、课程、当前环节、计时与暂停/结束操作分行，长文本正常换行|
|frontend/src/components/classroom/ClassroomStepSidebar.vue|导航随栏宽变化，长名称完整换行，保留当前/完成标记与折叠|
|frontend/src/components/classroom/LivePresentationPreview.vue|16:9静音监看、高度不超过300px、可折叠；当前有效问答字幕；未批准不显示答案|
|frontend/src/components/classroom/ClassroomQuickActions.vue|可选控制台分组，资源和AI重复入口由页面统一提供|
|frontend/tests/component/components.spec.ts|适配下一环节按钮名称，保留暂停禁用和结束确认断言|
|frontend/tests/component/interaction-fullscreen.spec.ts|适配下一环节名称，保留开场能力限制断言|
|frontend/tests/component/lesson-classroom-rightcol.spec.ts|按新位置检查功能入口，保留互动/榜单/数字人功能验证|
|frontend/tests/component/classroom-preview.spec.ts|折叠不卸载数字人、不发送命令、未审核/过期字幕保护|
|frontend/tests/e2e/classroom-console-composition.spec.ts|三分辨率截图、预览比例与高度、无横向溢出、折叠及标签不修改Run、原工具入口验证|

视觉继续使用现有 app 设计变量、暖色卡片、圆角、按钮和数字人。没有新主题或形象。
预览使用 v-show，折叠不销毁数字人，不执行媒体/问答/课堂命令。
教师预览不是视频镜像：图片和数字人可视预览；视频、音频、PDF等沿用资源名称/状态/页码监看，不额外播放声音。独立大屏仍负责完整播放。
顶部手机状态如实显示以手机端为准，未伪造在线状态。待审数字指当前权威展示的问题，不声称是所有历史待审总数；儿童问答面板及处理入口始终位于标签外。

## 功能保留
- 暂停/恢复、结束确认、中止确认、步骤切换和完整教案均保留。
- 播放暂停/继续、停止媒体、队列前后项、PDF页控制、课程资源、手机入口与独立大屏入口保留。
- 儿童问答、教师审核、点名、奖励确认、榜单、考勤、奖励记录、儿童问题与作品入口保留。
- AI建议、语音控制、唤醒、播报与数字人交互沿用原组件。
- 独立大屏、手机、CommandBus、权限与生命周期代码未更改。
- 在1366×768上使用单一整页滚动；较下方工具可折叠预览或向下滚动访问，无横向溢出。

## 测试与证据
所有浏览器测试使用现有 E2E runner 的新建临时数据库和随机端口，与3592运行数据库分离。
- npm run build（含 vue-tsc）：最终通过，日志 p5-ui-final-build.log；保留既有大块构建警告。
- 定向组件/单元：9文件106项通过，p5-ui-focused-final.log。
- 新增预览隔离：1项通过，p5-ui-preview.log。
- 三分辨率 Chromium：通过，p5-ui-browser-final.log。折叠、切换标签、查看队列及工具抽屉前后 Run 版本、当前环节及展示快照不变；检查互动、数字人、榜单、AI和教案入口。
- 问答/大屏/模拟手机 E2E：通过，p5-ui-qa-browser.log。种子问题→教师审核→大屏答案→记录保存；模拟手机加入、问答、媒体播放/停止及返回课堂。
- 首轮全量运行遇到三处旧布局断言失败，已逐项适配并定向复测通过；不得将首轮记作全通过。
- 完整前端最终复跑：127个文件、1028项全部通过（312.28秒），p5-ui-all-final.log。
- git diff --check 通过。已有AI备课变更哈希一致；原工作区干净。
- 5592/3592 监听进程保持24212/9740，本轮未启动或重启这些服务。

截图目录：evidence/p5-1/p5-ui/screenshots
每个分辨率1920x1080、1600x900、1366x768均有 before、after、collapsed、AI drawer 和 after-full 截图。
浏览器截图仅为合成课堂验收，不代表真实手机、麦克风、物理大屏或音箱通过。

## 恢复与人工验收
打开 http://localhost:5592，按原有教师入口进入课堂即可查看当前布局。现有服务已通过源码热更新读取本轮UI。
如需撤销，只按 before-files 的逐文件备份恢复本轮5个组件/页面及原测试；删除本轮新增预览测试/报告即可。不运行整库reset，不触碰AI备课文件、原integration-I1或数据库。用户尚未要求恢复，未执行。
真实手机扫码、麦克风、音箱与物理大屏仍待人工验收；本轮不声称完成。停止进一步功能开发，等待审核。

## 截图索引
|分辨率|修改前|修改后|折叠后|
|---|---|---|---|
|1920×1080|[before](../evidence/p5-1/p5-ui/screenshots/before-1920x1080.png)|[after](../evidence/p5-1/p5-ui/screenshots/after-1920x1080.png)|[collapsed](../evidence/p5-1/p5-ui/screenshots/after-1920x1080-collapsed.png)|
|1600×900|[before](../evidence/p5-1/p5-ui/screenshots/before-1600x900.png)|[after](../evidence/p5-1/p5-ui/screenshots/after-1600x900.png)|[collapsed](../evidence/p5-1/p5-ui/screenshots/after-1600x900-collapsed.png)|
|1366×768|[before](../evidence/p5-1/p5-ui/screenshots/before-1366x768.png)|[after](../evidence/p5-1/p5-ui/screenshots/after-1366x768.png)|[collapsed](../evidence/p5-1/p5-ui/screenshots/after-1366x768-collapsed.png)|

完整测试命令（工作区根目录）：
- python evidence/p5-1/run_check.py p5-ui-all-final frontend npm test
- python evidence/p5-1/run_check.py p5-ui-final-build frontend npm run build
- python evidence/p5-1/run_check.py p5-ui-browser-final frontend npm run test:e2e -- classroom-console-composition.spec.ts
- E2E_LAN_HOST=本机局域网地址，python evidence/p5-1/run_check.py p5-ui-qa-browser frontend npm run test:e2e -- p5-unified-qa.spec.ts

所有日志均位于 evidence/p5-1 下。设备回归只代表 Chromium 与模拟手机视口，未新增真实设备验收结论。
