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

Windows 与 macOS 的操作相同。

## Codex++ 脚本

导入以下两个文件：

- `status-model-auto-switch.js`：读取 `status.input.im`，按优先级调用 Codex 原生模型选择接口。
- `codex-task-recovery.js`：保存当前任务检查点，在明确检测到中断和原生 Retry/Continue 按钮后恢复任务。

建议一次只启用一个脚本并验证，然后再启用第二个。两个面板默认折叠，不占用主要操作区域。

## 安全边界

两个脚本均不会：

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
3. 导入 status-model-auto-switch.js 和 codex-task-recovery.js。
4. 保留所有现有脚本及其启用状态，不要覆盖整个注册表。
5. 不要修改 provider、API Key、base_url 或 ~/.codex/config.toml。
6. 对两个脚本运行 JavaScript 语法检查，再依次启用并验证。
```

## 卸载

浏览器扩展可直接从扩展管理页移除。Codex++ 脚本在用户脚本管理器中分别禁用或删除即可；不需要更改 Codex 网络配置。
