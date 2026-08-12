# 参与贡献

感谢你改进 AI.INPUT.IM Status Monitor。

## 开发环境

项目不需要安装依赖或执行构建。使用支持 Manifest V3 的 Chromium 浏览器，以“加载已解压的扩展程序”方式加载仓库根目录即可。

修改代码后，在扩展管理页点击“重新加载”。涉及后台逻辑时，可以从扩展详情页打开 Service Worker 的开发者工具。

## 提交前检查

```powershell
node --check background.js
node --check popup.js
node --check options.js
python -m json.tool manifest.json
```

同时手动确认：

- 状态面板在正常、异常、加载和接口失败状态下均可阅读
- 切换模型和修改轮询间隔后配置能够保存
- 首次加载不会发送历史事件通知
- 只有真实状态变化会触发桌面通知

## 提交问题

问题描述应包含复现步骤、预期结果、实际结果、浏览器版本、操作系统、扩展版本和必要的错误日志。请勿包含凭据或其他个人数据。

## 变更范围

保持修改聚焦，并在用户可见行为变化时更新 README 与 CHANGELOG。新增权限时，必须同时说明用途并更新 PRIVACY。
