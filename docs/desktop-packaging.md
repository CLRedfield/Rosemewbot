# Rosemewbot Windows 原生封装

## 交付结构

桌面应用是统一控制层，AstrBot、NapCat 与 QQ 仍是可单独更新和排错的本机组件：

```text
Rosemewbot
├── 运行控制、状态探测与安装进度
├── 安全 IPC 与单窗口内嵌设置工作区
└── 当前用户的私有运行目录
    ├── 独立 Python 3.12 与 uv
    ├── AstrBot
    ├── NapCat Shell
    ├── 配置、凭据与日志
    └── 下载缓存

Windows QQ（腾讯官方安装）
└── 由 NapCat Shell 以本机方式启动
```

软件不依赖 Docker，不占用系统 Python，也不会要求用户安装 Node.js。首次准备时，控制层通过官方发布源下载所需组件，并把 Python 与 AstrBot 放在应用私有目录中。

## 默认安装与自定义位置

安装器使用需要管理员权限的 NSIS 引导模式。内置的 AppData 目录页已禁用；自定义安装位置页会在安装模式初始化完成后再次把默认路径和输入框初始值设为 `C:\Rosemewbot`。用户可以直接继续，也可以点击“浏览”选择其他目录。

```text
默认：
C:\Rosemewbot\
C:\Rosemewbot-data\

自定义示例：
D:\Bots\Rosemewbot\
D:\Bots\Rosemewbot-data\
```

程序和数据使用两个相邻目录，是为了让所有内容处于用户选择的同一位置，同时避免卸载或覆盖程序时误删 QQ 机器人数据。软件中的“数据目录”按钮可直接打开数据目录。

```text
native-runtime/
├── astrbot/          AstrBot 工作目录与 data
├── napcat/           NapCat Shell 与 config
├── python/           独立 Python 3.12
├── tools/            uv 管理的 AstrBot 工具环境
├── bin/              uv、astrbot 启动程序
├── logs/             安装与运行日志
├── downloads/        官方资源下载缓存
├── manifest.json     组件版本
├── processes.json    受控进程 ID
├── preferences.json  托盘、开机启动与自动恢复选项
└── secrets.json      本机生成的后台凭据
```

Windows 常规卸载只删除程序目录，不删除相邻的 `-data` 目录。“设置”页危险操作中的一键完全卸载会先显示原生危险确认框，确认后停止受控组件、关闭开机启动，再调用已安装目录中的卸载器；专用参数会额外删除相邻数据目录、旧 AppData 数据和旧品牌残留。腾讯 QQ 本身不会被卸载。更新和修复仍会保留 `astrbot/data` 与 `napcat/config`；首次运行新版时，如果发现旧版 `%APPDATA%\agent-space-qq-bridge\native-runtime`，会自动迁移到新位置。开机启动开关写入后会反查 Windows 的实际启用状态；若系统保留了禁用记录，应用会重建一次启动项并再次验证，验证失败时不会让界面错误地显示为已开启。

## 快捷操作

| 操作 | 实际行为 | 数据影响 |
|---|---|---|
| 一键完成首次准备 | 下载独立运行环境、AstrBot、NapCat；缺少 QQ 时打开官方安装器 | 新增本机组件 |
| 启动机器人 | 启动 AstrBot，再通过 NapCat Shell 启动 QQ | 保留数据 |
| 停止 | 只终止本应用记录且校验过身份的进程树 | 保留数据 |
| 重启 | 安全停止后重新启动两个组件 | 保留数据 |
| 更新组件 | 安装 Rosemewbot 当前稳定策略锁定的 AstrBot 与 NapCat 组合 | 升级前自动快照，失败自动回滚 |
| 修复组件 | 重新安装当前稳定策略锁定版本并修复 Rosemewbot 连接契约 | 保留配置与登录 |
| 回滚组件 | 恢复最近一次升级前的组件程序与配置快照 | 保留当前用户数据边界 |
| 打开完整设置 | 在主窗口内切换到隔离的本机后台工作区 | 不自动修改设置 |
| 检查应用更新 | 查询 Rosemewbot 最新正式版；有新版时打开受信任的 GitHub 发布页 | 不自动修改或删除本机数据 |
| 一键完全卸载 | 二次确认后停止组件并启动专用静默卸载流程 | 永久删除 Rosemewbot 程序与全部本地数据，不删除腾讯 QQ |

关闭主窗口会隐藏到系统托盘，不会停止机器人。托盘提供打开控制台、启动、停止、重启、开机启动和掉线恢复开关；“退出并停止机器人”会先安全停止受控组件，再退出应用。

## v0.4 自动验收与恢复

接入向导自动检查以下状态：

- AstrBot 与 NapCat 是否安装并可访问。
- 通过 NapCat WebUI 实时接口确认 QQ 是否登录、在线或已经掉线。
- 6199 端口是否存在真实 `ESTABLISHED` OneBot 连接，而非只有监听端口。
- AstrBot 是否启用预设 OneBot 平台、是否存在启用的默认聊天模型。

智能诊断额外检查 Windows 环境、QQ 路径、端口占用和数据盘剩余空间。控制台在前台时每 5 秒刷新 QQ 在线状态，退到后台后降为每 15 秒；掉线守护仍按 15 秒周期运行。手动停止机器人会清除“应当运行”状态，因此不会被守护程序重新拉起。服务首次健康后若连续确认异常，守护程序只执行一次受控重启，等待 QQ 恢复登录，避免无限重启。

## v0.5 组件兼容、升级与回滚

应用内置 `config/components-lock.json` 稳定策略，固定经过联合验证的 uv、Python、AstrBot、NapCat 和 QQ 兼容下限。首次准备、更新与修复都使用该策略，不再分别追随上游“最新版本”。

- “更新”只在受控组件偏离稳定策略时执行；已匹配时直接返回。
- “修复”会重新安装稳定策略版本，并只校正 Rosemewbot 自己创建的 AstrBot/NapCat OneBot 连接项。
- 升级前保存 AstrBot 数据、NapCat、uv 工具环境和组件清单；仅保留最近一份可回滚快照。
- 安装后验证组件版本、启动文件、AstrBot 平台配置和 NapCat WebSocket 客户端；原本健康运行的服务还会接受启动后探测。
- 验收失败自动恢复升级前快照；用户也可以在“组件兼容中心”手动回滚。

## 下载与配置来源

- `uv`：按 `config/components-lock.json` 从 `astral-sh/uv` 指定 GitHub Release 获取 Windows x64 压缩包并校验固定 SHA-256。
- Python 3.12 与 AstrBot：由私有目录中的 uv 管理，AstrBot 使用策略中锁定的精确 PyPI 版本。
- NapCat：按稳定策略从 `NapNeko/NapCatQQ` 指定 Release 获取 `NapCat.Shell.zip` 并校验固定 SHA-256。
- Windows QQ：从兼容策略记录的腾讯 CDN 地址获取；下载后验证 Authenticode 状态和 Tencent 签名。自动下载失败时，界面提供 QQ 官网入口。

自动写入的本机连接为：

```text
NapCat WebSocket Client
        │ ws://127.0.0.1:6199/ws
        ▼
AstrBot OneBot v11 Reverse WebSocket Server
```

WebUI 使用 `127.0.0.1:6099`，AstrBot 使用 `127.0.0.1:6185`。这些端口不向局域网或公网监听。

## 安全设计

- Electron 主窗口启用 `contextIsolation`、渲染沙箱并禁用 Node Integration。
- IPC 仅接受应用自有协议或开发服务器来源，并校验动作和服务枚举值。
- 本机后台通过禁用 Node Integration 的独立 WebContentsView 嵌入主窗口；跨源导航被拦截，外部 HTTPS 交给系统浏览器。
- GitHub Release 提供 SHA-256 digest 时必须匹配；QQ 安装器必须通过 Tencent 数字签名验证。
- 凭据使用加密随机数生成，文件只保存在当前用户数据目录；日志展示前执行脱敏。
- 日常递归替换和删除只允许发生在 `native-runtime` 管理目录内；用户明确确认一键完全卸载时，安装器才可清理程序目录、相邻数据目录与已知旧版目录。
- 停止进程前同时核对 PID 与可执行文件名，避免 Windows 重启或 PID 复用造成误杀。

## 开发、构建与验证

```powershell
npm install
npm run typecheck
npm test
npm run build
npm run desktop:dir
npm run desktop:pack
```

构建产物：

```text
release/Rosemewbot-Setup-0.5.10-x64.exe
release/win-unpacked/Rosemewbot.exe
```

当前开发构建未配置发行证书，因此 Authenticode 状态为 `NotSigned`。这不影响本地功能验证，但正式发布前应配置可信代码签名证书，避免 Windows SmartScreen 的“未知发布者”提示。

验证项目：

- `npm run typecheck`：Web、服务端和 Electron 主进程类型检查。
- `npm test`：服务探测、QQ 安装路径解析和 NapCat 本机网络配置测试。
- 解包程序 `--smoke-test`：验证自定义协议、安全桥、状态 IPC 和本机运行层初始化。
- `--capture-ui --capture-theme=light|dark|system --capture-view=runtime|settings|...`：检查三种主题下的桌面运行控制页、设置页和其他主要视图。
- 安装包构建：验证 NSIS 默认/自定义目录页面、桌面/开始菜单快捷方式、常规卸载保留数据，以及专用完全卸载参数清理相邻数据目录。
- 真实链路验收仍需用户完成 QQ 扫码，并在 AstrBot 配好模型后发送一条测试消息。

## 可测试性与修复边界

封装没有把三套代码揉成一个进程。UI、安装/进程管理、AstrBot、NapCat 和 QQ 仍可分层定位：

- UI 或 IPC 问题：不影响已安装组件与用户数据。
- AstrBot 问题：查看独立日志或打开 AstrBot 完整设置。
- NapCat/QQ 问题：查看 NapCat 日志或打开 NapCat 完整设置。
- 下载或版本损坏：使用“修复组件”，无需删除配置。
- 升级失败：当前版本会在 NapCat 替换时使用暂存目录与备份目录，完成后再原子切换。

因此，原生封装后的测试和修 bug 仍然清晰；新增的主要测试面是 Windows 安装、组件下载、进程生命周期和不同 QQ 版本兼容性。
