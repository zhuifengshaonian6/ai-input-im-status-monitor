# 部署指南

## 发布文件

- 浏览器扩展：`ai-input-im-status-monitor-extension.zip`
- Codex++ 脚本：`ai-input-im-status-monitor-codex-plus-plus.zip`
- 最新 Release：<https://github.com/zhuifengshaonian6/ai-input-im-status-monitor/releases/latest>

## 浏览器扩展

1. 下载并解压浏览器扩展 ZIP。
2. Chrome 打开 `chrome://extensions/`，Edge 打开 `edge://extensions/`。
3. 开启开发者模式。
4. 点击“加载已解压的扩展程序”，选择解压目录。
5. 打开扩展面板并点击刷新，确认显示 `6/6` 和“读取正常”。
6. 面板会显示当前版本；点击“检查更新”可查询 GitHub Release 并下载新版。

Windows 与 macOS 的操作相同。

开发者模式加载的扩展受浏览器安全限制，不能静默替换自身代码。“检查更新”会在线比较版本并提供下载入口；下载并解压后，在扩展管理页重新加载目录即可。通过扩展商店安装时，更新由浏览器管理。

## Codex++ 脚本

只需导入并启用 `codex-status-suite.js`。该文件同时包含：

- 状态自动切换：读取 `status.input.im`，按优先级调用 Codex 原生模型选择接口。
- 任务恢复：保存当前任务检查点，在明确检测到中断和原生 Retry/Continue 按钮后恢复任务。

两个面板默认折叠，并分别提供设置菜单。升级前先禁用或删除旧的 `status-model-auto-switch.js` 和 `codex-task-recovery.js`，避免重复运行。

## 安全边界

状态套件不会：

- 修改 provider、API Key 或 `base_url`
- 修改 `~/.codex/config.toml`
- 启动本地代理或占用固定端口
- 禁用或覆盖其他 Codex++ 用户脚本
- 自动提交代码或上传任务内容

## 跨设备 Codex 指令

```text
请从 https://github.com/zhuifengshaonian6/ai-input-im-status-monitor/releases/latest
下载浏览器扩展和 Codex++ 脚本包。

1. 解压浏览器扩展，在 Chrome/Edge 扩展管理页加载包含 manifest.json 的目录。
2. 备份 Codex++ 用户脚本配置。
3. 导入并启用 codex-status-suite.js；不要同时启用旧的两个独立脚本。
4. 保留所有现有脚本及其启用状态，不要覆盖整个注册表。
5. 不要修改 provider、API Key、base_url 或 ~/.codex/config.toml。
6. 对合并脚本运行 JavaScript 语法检查，再启用并验证。
```

## 卸载

浏览器扩展可直接从扩展管理页移除。Codex++ 状态套件在用户脚本管理器中禁用或删除即可；不需要更改 Codex 网络配置。