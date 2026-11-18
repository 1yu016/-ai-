# 《常识》PDF 直接预览处理记录

- 范围：旧版 5592 / 3592，integration-I1-unified-20261102。
- 根因：资源 8《常识》为 PPTX，后端未发现该资源的 preview.pdf，按现有机制显示待转换说明。现有 PDF 文件直接预览功能正常。
- 处理：核对原课件为 16 页纯图片幻灯片，母版和版式无额外图形。按 presentation.xml 的真实页序及图片坐标、尺寸，把原图生成 16 页 PDF。无 OCR、无生成内容、无第三方课件上传。此方法仅适用于已验证的简单图片页，不表示支持任意复杂 PPT 自动转换。
- 新增文件：backend/uploads/resource-previews/8/preview.pdf；未覆盖任何原始文件。
- 复用现有鉴权预览清单与资产接口，无后端、数据库、配置或迁移变更；无需重启服务。
- 浏览器复测发现 PDF 外层页码改变后 Chrome 内置阅读器仍显示旧页：ResourcePlayer.vue 的 iframe key 仅包含源文件，现改为包含 documentSource，使页码及缩放变化时阅读器重新装载。对应 resource-player-media.spec.ts 增加 DOM 实例更换与不重复下载验证。原文件已逐字节备份到本次任务 .tmp 目录。
- 原 PPTX SHA-256：4f7238de5f511c047b76326c345fc26939cdd91f938d0ed243d073a67158f139。
- PDF SHA-256：3994400dbd38e88993e17eb6f46786e139ffb235e6d0cc170927af3b70cace55。
- 验证：PDF 16 页全部渲染为缩略图检查；教师正常登录→资源库→《常识》→预览，实际页面显示 PDF；全屏课堂模式→下一页，显示第 2 页。预览文件返回 application/pdf、2,270,869 字节。现有《神奇的种子｜03》PDF 资源直接显示亦通过。
- 运行服务保持：3592 PID 45032，5592 PID 4980。
- 使用：关闭当前旧预览后重新点击《常识》的“预览”；已打开页面可刷新重新读取预览清单。
- 恢复：移走本轮新增的 backend/uploads/resource-previews/8/preview.pdf 即回到原先待转换状态。PDF 页码同步修复如需恢复，仅将 iframe 的 key 从 documentSource 改回 mediaSource；勿整文件覆盖此前修复。原课件和课堂记录始终保留。
- 限制：未验证真实手机、物理大屏；尚未建立所有未来 PPTX 的自动转换功能。PDF 不保留 PPT 动画或交互。

## 最终验证结果
- 资源播放器及资源绑定回归：2 个测试文件、25 项通过。
- 前端类型检查通过。
- 最终全屏截图已人工核对：内置 PDF 阅读器与外层页码均为第 2 页，实际显示第 2 页图片。
- 图片证据：当前统一工作区 .tmp/pdf-preview-common-knowledge.png、.tmp/pdf-preview-fullscreen-page2.png、.tmp/pdf-converter/all-pages.png。
