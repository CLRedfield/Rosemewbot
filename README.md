# Rosemewbot

面向 Windows 的 AstrBot + SnowLuma QQ 机器人整合应用。用户安装一个软件后，即可在统一界面准备组件、安装或识别 QQ、启动机器人、打开完整设置、查看日志和修复更新。

SnowLuma 接入由腾讯官方 Windows QQ 管理的登录会话。首次登录和失效后的扫码授权仍需在 QQ 中完成。

## Windows 安装版

当前版本：**0.6.8**。下载 [Windows x64 安装包](https://github.com/CLRedfield/Rosemewbot/releases/tag/v0.6.8)，查看[版本更新说明与升级步骤](docs/releases/v0.6.8.md)。

构建产物：

```text
release/Rosemewbot-Setup-0.6.8-x64.exe
```

用户流程只有三步：

1. 双击安装包并允许管理员权限，在“安装位置”页面选择默认位置或点击“浏览”选择其他磁盘/文件夹。
2. 第一次打开后点击“一键完成首次准备”；软件自动准备 AstrBot、SnowLuma 和独立 Python 运行环境，并在需要时打开 QQ 官方安装器。
3. 登录机器人 QQ，点击“启动机器人”，再在 AstrBot 中添加模型。

不需要 Docker Desktop，不需要用户安装 Python、Node.js，也不需要打开 PowerShell。

下载应用安装包、首次准备、更新或修复组件时，需要能访问 GitHub 发布附件。v0.6.8 的桌面组件下载自动沿用 Windows 系统代理，包括 PAC 配置。使用代理软件时请开启“系统代理”，并在下载完成前保持连接。

SnowLuma 配置同版本官方主地址与 [XingYunStar 历史归档备用地址](https://github.com/XingYunStar/snowluma/releases/tag/v2.4.2)，使用 v2.4.2 Windows x64 完整包并固定 SHA-256 校验。下载前检测主源；原官方地址不可用时自动使用归档，正式传输失败也会直接接续其他来源，无需再次点击。已校验缓存可离线复用。归档由第三方保存，不代表上游恢复维护。旧版准备失败的用户请先安装最新 Rosemewbot，再重新点击“一键完成首次准备”；已有组件需重新准备时点击“修复组件”。

默认安装位置：

```text
C:\Rosemewbot\
C:\Rosemewbot-data\
```

安装器会申请管理员权限，默认路径和自定义路径输入框的初始值均为 `C:\Rosemewbot`。选择其他父目录后，程序目录与 `-data` 数据目录会放在同一个所选位置旁。例如最终程序目录为 `D:\Bots\Rosemewbot`，组件和数据位于 `D:\Bots\Rosemewbot-data`。AstrBot、SnowLuma、独立 Python、缓存、配置和日志都跟随该位置；腾讯 QQ 仍由官方 QQ 安装器管理。

当前本地构建尚未配置商业代码签名证书，Windows SmartScreen 可能显示“未知发布者”；正式对外分发前应使用可信 Windows 代码签名证书签署安装包。

桌面版提供：

- AstrBot、SnowLuma 和 Windows QQ 的一键准备与自动识别。
- 启动、停止、重启、组件更新和保留数据修复。
- 经过验证的组件版本策略、升级前快照、升级后验收和失败自动回滚。
- AstrBot、SnowLuma 完整后台的单窗口内嵌工作区。
- 通过 SnowLuma 实时确认所选 QQ 的登录状态及对应 OneBot 连接，避免把其他个人 QQ 误判成机器人。
- Windows 系统托盘、开机启动、打开应用时启动机器人和掉线自动恢复，分别可选。
- “设置 → 启动与连接”可独立开关 SnowLuma 自动登录、QQ 自动启动、指定账号自动连接；QQ 未启动时也可手动保存账号。
- 在设置中选择要接入的 QQ；启动后自动连接该账号，组件故障时保留官方 QQ 登录会话。QQ 会话失效时提示用户在官方 QQ 中重新登录。
- 智能诊断组件、QQ、端口、模型与磁盘空间，并提供对应处理入口。
- 下载/安装进度、运行状态、最近日志和敏感凭据脱敏。
- 运行控制、接入向导及两个内嵌后台顶部均可按需显示、复制对应的后台凭据；SnowLuma 内嵌页自动建立本机会话，AstrBot 凭据失同步时可一键重新生成。
- 跟随 Windows、亮色、暗色三档主题；默认跟随 Windows。
- 独立设置页可调整 100% / 115% / 130% 界面字号，默认使用更易读的 115%。
- 在设置中检查 Rosemewbot 正式版更新，并安全跳转到 GitHub 发布页下载。
- 所有管理端口默认只绑定 `127.0.0.1`。

详细运行结构、安全边界和测试说明见 [Windows 原生封装说明](docs/desktop-packaging.md)。

## 首次接入

1. 在“运行控制”完成首次准备并启动机器人。
2. 点击“打开 QQ 登录”，在官方 QQ 中扫码登录机器人账号，并在设置中选择该账号。
3. SnowLuma 会自动接入所选账号并连接本机 `ws://127.0.0.1:6199/ws`；AstrBot 控制台出现 OneBot v11 已连接即表示链路正常。
4. 打开 AstrBot，添加兼容 OpenAI API 的模型提供商并设为默认模型。
5. 把机器人拉进测试群，发送 `@机器人 你好，请回复“接入成功”`。

## 数据与卸载

运行组件、配置、密码和日志存放在安装目录旁的 `-data` 目录中，可通过“设置 → 应用与数据”打开。Windows 常规卸载会保留这个独立数据目录，重装到同一位置后可继续使用。“设置 → 危险操作”中的“一键完全卸载”会在二次确认后停止组件并删除程序、全部本地组件、配置、凭据、缓存和日志；腾讯 QQ 本身不会被卸载。

“更新组件”和“修复组件”会保留 AstrBot 配置、SnowLuma 配置与 QQ 登录数据。QQ 本身使用腾讯官方 Windows 安装程序安装与卸载。

## 本地开发

开发环境仍需要 Node.js；最终用户不需要。

```powershell
npm install
npm run typecheck
npm test
npm run desktop:dev
```

生成标准 Windows 安装包：

```powershell
npm run desktop:pack
```

生成便于调试的解包目录：

```powershell
npm run desktop:dir
```

## 安全边界

- 主窗口启用渲染沙箱、上下文隔离，并禁用 Node Integration。
- 前端只能调用预加载脚本中的固定白名单操作；主进程再次校验来源和参数。
- AstrBot、SnowLuma 和 OneBot 端口仅绑定到 `127.0.0.1`。
- 组件使用固定发布源；SnowLuma 使用明确标注的第三方历史归档，SnowLuma 与 uv 下载均校验锁定的 SHA-256。
- 自动下载的 QQ 安装程序必须通过 Windows Authenticode 验证，且签名者必须为 Tencent。
- 日志返回界面前会移除本机密码与 Token。
- 停止组件前核对进程身份，卸载所选账号的 SnowLuma 接入并保留官方 QQ；迁移清理旧 NapCat 时只匹配本应用私有目录中的 Hook DLL。
- 一键完全卸载必须经过原生确认框，只调用已安装目录中的卸载程序，并使用专用参数清理相邻数据与旧版残留。

## 当前阶段未包含

- QQ 官方机器人接入。
- 应用内自动下载并安装整包更新；当前可在设置中检查新版本并前往正式发布页下载。
- 版本化知识库、文档检索、群聊日报和多租户计费。

本阶段验收目标是：在 Windows 上完成“QQ 收到消息 → AstrBot 调用模型 → 回复 QQ”，并能从统一桌面界面配置和排查整条链路。

## 许可证

自 v0.5.9 起，Rosemewbot 采用 [MIT License](LICENSE) 授权。

Copyright (c) 2026 Rosepineus
