# AI.INPUT.IM Status Monitor

一个适用于 Windows 和 macOS 的 Chrome / Edge 浏览器扩展。它会定时读取 [status.input.im](https://status.input.im/) 的模型状态，在指定模型发生异常或恢复正常时发送桌面通知，并通过紧凑的状态面板呈现关键指标。

> 本项目是独立的第三方状态查看工具，与 `status.input.im` 官方没有隶属或担保关系。

## 主要功能

- 按自定义优先级自动选择第一个当前正常的模型
- 状态接口中断时保持后台重试，恢复后自动继续并处理未读样本
- 仅在状态实际变化时通知，首次安装不会补发历史通知
- 展示最近 60 个状态样本、可用率、延迟和错误摘要
- 按北京时间统计今日正常时长、异常时长与异常次数
- 支持修改模型优先级、检查间隔和桌面通知开关
- 数据保存在浏览器本地，不需要 Python、Node.js 或常驻本地服务

## 浏览器扩展与模型切换

浏览器扩展负责读取状态、展示统计并发送通知。浏览器扩展本身无法控制 Codex 桌面应用中的当前会话模型；真正的模型切换由项目中的 Codex++ 用户脚本完成：

`codex-plus-plus/status-model-auto-switch.js`

脚本按以下顺序选择状态源中第一个明确健康、且 Codex 当前版本实际提供的模型：

1. `gpt-5.6-sol`
2. `gpt-5.6-terra`
3. `gpt-5.6-luna`
4. `gpt-5.5`
5. `gpt-5.4`
6. `gpt-5.4-mini`

自动轮询每分钟执行一次，并要求连续两次得到相同健康候选后才请求切换，降低瞬时状态抖动造成的频繁切换。点击脚本面板中的 `Check now` 可立即检查并请求切换。API 请求失败不会停止任务，下一轮仍会继续运行。

脚本通过 Codex 界面自身的 `onSelectModel` / `onSelectPower` 回调切换当前会话，不修改 `~/.codex/config.toml`、provider 或 `base_url`。因此它只能选择当前 Codex 原生模型菜单中实际存在的模型；状态源健康但 Codex 未提供的模型不会被伪装成已切换。

## 界面信息

点击浏览器工具栏中的扩展图标，可以快速查看：

| 区域 | 内容 |
| --- | --- |
| 当前状态 | 自动选中的模型、正常/异常状态、状态已持续时间 |
| 60 分钟概览 | 最近样本的可用率和状态条 |
| 今日统计 | 正常时长、异常时长、异常次数 |
| 状态细节 | 最近检查时间、请求延迟和错误信息 |
| 服务概览 | 状态源返回的全部模型及其可用率 |

## 安装

### 使用发布包

1. 下载 Release 中的 ZIP 文件并解压。
2. 在 Chrome 打开 `chrome://extensions/`，或在 Edge 打开 `edge://extensions/`。
3. 开启页面右上角或左侧的“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择包含 `manifest.json` 的 `status-input-monitor-extension` 文件夹。
6. 将扩展固定到浏览器工具栏，点击图标即可打开状态面板。

Windows 与 macOS 的步骤相同，仅文件夹选择界面略有不同。

### 在 Codex++ 中启用自动切换

1. 打开 Codex++ 的用户脚本管理页面。
2. 导入 `codex-plus-plus/status-model-auto-switch.js`。
3. 启用脚本并重启 Codex++。
4. 首次使用时打开一次 Codex 原生模型菜单，让脚本发现当前版本的原生模型选择接口。
5. 查看右下角面板：`AUTO` 表示正在自动检查，`PAUSED` 表示已暂停。

Codex++ 内置脚本依赖其宿主页面结构。Codex 或 Codex++ 升级后若出现“Open the native model menu once to enable switching”，先重新打开一次原生模型菜单；仍无法识别时需要更新兼容选择器。

### 从源码安装

```bash
git clone <你的仓库地址>
```

克隆后，在扩展管理页面直接加载仓库根目录即可。项目没有构建步骤，也不需要安装依赖。

## 配置

在状态面板底部点击“设置”，可修改以下选项：

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| 状态接口 | `https://status.input.im/api/status` | 当前扩展权限仅允许访问 `status.input.im` 域名 |
| 模型优先级 | `gpt-5.6-sol` 起 | 每行一个模型，从上到下选择第一个当前正常项 |
| 检查间隔 | `1` 分钟 | 可设置为 1-60 分钟 |
| 桌面通知 | 开启 | 只在模型状态发生变化时发送 |

默认顺序为 `gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna`、`gpt-5.5`、`gpt-5.4` 和 `gpt-5.4-mini`。插件每次成功读取接口后，从上到下选择第一个当前正常的模型；如果列表内全部异常，则继续跟踪列表中最高优先级且仍由接口返回的模型，保留异常诊断和恢复通知。

## 通知规则

- 第一次安装或浏览器启动时只初始化状态，不发送历史事件通知。
- 正常变为异常时，通知会包含本次正常运行时长和今日统计。
- 异常恢复正常时，通知会包含本次异常持续时长和今日统计。
- 接口读取失败会记录中断开始时间，但不会被误判为模型状态异常。
- 后台闹钟不会因接口失败停止；下一轮会继续请求，接口恢复后自动处理接口返回的未读样本。
- 接口恢复和自动切换模型时可发送单独通知，并在面板中显示恢复时间与当前优先级。

今日统计根据扩展已经获取的样本在本地累计。刚安装时、浏览器长期未运行时，或清除扩展数据后，统计可能与状态站点的完整历史记录不同。

## 权限与隐私

扩展只申请运行所需的最小权限：

| 权限 | 用途 |
| --- | --- |
| `alarms` | 按设置的间隔在后台检查状态 |
| `notifications` | 在状态变化时发送系统通知 |
| `storage` | 在浏览器本地保存设置、状态和统计 |
| `https://status.input.im/*` | 读取状态接口 |

扩展不收集账号、浏览记录或页面内容，也不会把本地数据发送给开发者。完整说明见 [PRIVACY.md](PRIVACY.md)。

## 常见问题

- **没有桌面通知：** 检查扩展设置、浏览器通知权限和操作系统的通知/专注模式。
- **一直显示等待样本：** 点击刷新，并确认可以直接访问 `https://status.input.im/api/status`。
- **没有匹配的优先模型：** 插件会临时选择接口返回的正常模型；建议在设置页补充其名称。
- **统计重新开始：** 浏览器清理站点或扩展数据、删除扩展后重装，都会移除本地统计。

更多处理方法见 [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)。

## 开发与验证

项目使用 Manifest V3 和原生 JavaScript，无第三方运行时依赖。修改文件后，在扩展管理页点击“重新加载”即可生效。

```powershell
node --check background.js
node --check popup.js
node --check options.js
python -m json.tool manifest.json
node --test tests/*.test.js
```

提交改动前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。版本变化记录在 [CHANGELOG.md](CHANGELOG.md)。

## 数据源与兼容性

- 数据源：`https://status.input.im/api/status`
- 浏览器：Chrome、Microsoft Edge 及其他兼容 Manifest V3 的 Chromium 浏览器
- 操作系统：Windows、macOS
- 默认时区：`Asia/Shanghai`（北京时间）

由于后台轮询依赖浏览器扩展调度，浏览器完全退出、系统休眠或浏览器节能策略可能推迟检查。

## 许可证

[MIT License](LICENSE)
