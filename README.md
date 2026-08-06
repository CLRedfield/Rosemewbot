# Rosemewbot

面向 Windows 的 AstrBot + NapCat QQ 机器人整合应用。用户安装一个软件后，即可在统一界面准备组件、安装或识别 QQ、启动机器人、打开完整设置、查看日志和修复更新。

> NapCat 接入的是普通 QQ，不是 QQ 官方机器人。适合内部验证和小范围试点；正式运营应评估账号风控与平台合规，并保留迁移到 QQ 官方机器人的路径。

## Windows 安装版

构建产物：

```text
release/Rosemewbot-Setup-0.5.7-x64.exe
```

用户流程只有三步：

1. 双击安装包并允许管理员权限，在“安装位置”页面选择默认位置或点击“浏览”选择其他磁盘/文件夹。
2. 第一次打开后点击“一键完成首次准备”；软件自动准备 AstrBot、NapCat 和独立 Python 运行环境，并在需要时打开 QQ 官方安装器。
3. 登录机器人 QQ，点击“启动机器人”，再在 AstrBot 中添加模型。

不需要 Docker Desktop，不需要用户安装 Python、Node.js，也不需要打开 PowerShell。

默认安装位置：

```text
C:\Rosemewbot\
C:\Rosemewbot-data\
```

安装器会申请管理员权限，默认路径和自定义路径输入框的初始值均为 `C:\Rosemewbot`。选择其他父目录后，程序目录与 `-data` 数据目录会放在同一个所选位置旁。例如最终程序目录为 `D:\Bots\Rosemewbot`，组件和数据位于 `D:\Bots\Rosemewbot-data`。AstrBot、NapCat、独立 Python、缓存、配置和日志都跟随该位置；腾讯 QQ 仍由官方 QQ 安装器管理。

当前本地构建尚未配置商业代码签名证书，Windows SmartScreen 可能显示“未知发布者”；正式对外分发前应使用可信 Windows 代码签名证书签署安装包。

桌面版提供：

- AstrBot、NapCat 和 Windows QQ 的一键准备与自动识别。
- 启动、停止、重启、组件更新和保留数据修复。
- 经过验证的组件版本策略、升级前快照、升级后验收和失败自动回滚。
- AstrBot、NapCat 完整后台的单窗口内嵌工作区。
- 自动验收组件、QQ 登录账号、真实 OneBot 连接与默认模型配置。
- Windows 系统托盘、开机启动、登录后自动启动机器人和掉线自动恢复。
- 智能诊断组件、QQ、端口、模型与磁盘空间，并提供对应处理入口。
- 下载/安装进度、运行状态、最近日志和敏感凭据脱敏。
- 运行控制、接入向导及两个内嵌后台顶部均可按需显示、复制对应的 AstrBot 登录凭据或 NapCat Token。
- 跟随 Windows、亮色、暗色三档主题；默认跟随 Windows。
- 独立设置页可调整 100% / 115% / 130% 界面字号，默认使用更易读的 115%。
- 在设置中检查 Rosemewbot 正式版更新，并安全跳转到 GitHub 发布页下载。
- 所有管理端口默认只绑定 `127.0.0.1`。

详细运行结构、安全边界和测试说明见 [Windows 原生封装说明](docs/desktop-packaging.md)。

## 首次接入

1. 在“运行控制”完成首次准备并启动机器人。
2. 打开 NapCat，用手机 QQ 扫码登录独立测试账号。
3. NapCat 会自动连接本机 `ws://127.0.0.1:6199/ws`；AstrBot 控制台出现 OneBot v11 已连接即表示链路正常。
4. 打开 AstrBot，添加兼容 OpenAI API 的模型提供商并设为默认模型。
5. 把机器人拉进测试群，发送 `@机器人 你好，请回复“接入成功”`。

## 数据与卸载

运行组件、配置、密码和日志存放在安装目录旁的 `-data` 目录中，可通过“设置 → 应用与数据”打开。Windows 常规卸载会保留这个独立数据目录，重装到同一位置后可继续使用。“设置 → 危险操作”中的“一键完全卸载”会在二次确认后停止组件并删除程序、全部本地组件、配置、凭据、缓存和日志；腾讯 QQ 本身不会被卸载。

“更新组件”和“修复组件”会保留 AstrBot 配置、NapCat 配置与 QQ 登录数据。QQ 本身使用腾讯官方 Windows 安装程序安装与卸载。

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
- AstrBot、NapCat 和 OneBot 端口仅绑定到 `127.0.0.1`。
- 组件下载来自官方发布源；带摘要的 GitHub 资源会校验 SHA-256。
- 自动下载的 QQ 安装程序必须通过 Windows Authenticode 验证，且签名者必须为 Tencent。
- 日志返回界面前会移除本机密码与 Token。
- 停止组件前会核对进程名，避免因旧 PID 误终止其他程序。
- 一键完全卸载必须经过原生确认框，只调用已安装目录中的卸载程序，并使用专用参数清理相邻数据与旧版残留。

## 当前阶段未包含

- QQ 官方机器人接入。
- 应用内自动下载并安装整包更新；当前可在设置中检查新版本并前往正式发布页下载。
- 版本化知识库、文档检索、群聊日报和多租户计费。

本阶段验收目标是：在 Windows 上完成“QQ 收到消息 → AstrBot 调用模型 → 回复 QQ”，并能从统一桌面界面配置和排查整条链路。
