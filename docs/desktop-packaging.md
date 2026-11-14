# Rosemewbot Windows 原生封装

从 0.6.5 起，桌面控制层使用 SnowLuma 接入官方 Windows QQ，消息仍交给原来的 AstrBot。平台 ID、模型、人设、插件和历史数据库沿用既有数据。

## 运行结构

- AstrBot：独立 Python，后台 `127.0.0.1:6185`。
- SnowLuma：官方完整发行包自带 Node，后台 `127.0.0.1:5099`。
- OneBot：SnowLuma 连接 `ws://127.0.0.1:6199/ws`，由 AstrBot 接收。
- Windows QQ：官方客户端管理登录，SnowLuma 仅接入所选账号。

默认程序位于 `C:\Rosemewbot`，数据位于相邻的 `C:\Rosemewbot-data`。自定义安装目录也使用相邻的 `-data` 目录。最终用户无需安装 Python、Node.js 或 Docker。

`native-runtime/astrbot/data` 保存原有配置、插件、人设和数据库。`snowluma` 保存新组件及其 config/data/logs；旧 `napcat` 目录保留用于排错，停止运行。`python`、`tools`、`bin` 是私有运行环境。`logs` 中的 `astrbot.log`、`snowluma.log` 及对应 error.log 记录运行状态。`manifest.json` 记录版本，`processes.json` 记录受管进程，`preferences.json` 记录启动、恢复、账号偏好，`secrets.json` 保存本机随机后台凭据。

## 启动与登录

启动时只启动缺少的 AstrBot 或 SnowLuma，必要时打开官方 QQ 登录窗口。登录后，桌面守护按 15 秒周期发现并接入所选账号。全账号自动加载关闭，默认 OneBot 网络为空；只有选定账号的配置包含受管 AstrBot 连接。

0.6.6 起，“设置 → 启动与连接”提供独立选项：

- `launchAtLogin`：随 Windows 登录在托盘打开控制台。
- `startBotAtLogin`：从 Windows 登录启动时运行组件，依赖上一项。
- `startBotOnLaunch`：手动打开 Rosemewbot 时运行组件，默认关闭，与开机选项独立。
- `autoLoginSnowLuma`：向本机内嵌 SnowLuma 页同步认证会话，默认开启；关闭会移除由 Rosemewbot 写入的会话，之后可手动登录。状态检测使用的本机管理 API 认证不受此开关影响。
- `autoStartQQ`：启动组件时，若没有目标账号或待登录的 QQ 窗口则打开官方 QQ，默认开启。管理 API 尚未就绪时推迟检查；成功检查后只执行一次，不重复弹出窗口。
- `autoConnectQQ`：自动接入指定账号并启用受管 AstrBot 连接，默认开启。关闭会卸载所选账号的接入、禁用受管连接；恢复逻辑不会越过这个开关。自定义连接保留。
- `autoLoginAccount`：账号下拉框或手动 QQ 号输入保存的目标账号，独立于自动步骤开关。

冷启动未勾选启动机器人时，清除上次关机遗留的恢复意图，防止自动恢复绕过启动开关；已经在后台运行的组件保持运行。启动检查或手动刷新账号列表时，对未识别、未加载的进程调用一次 SnowLuma 的身份刷新，以免把已登录的个人 QQ 误当成待登录窗口。等待指定账号期间，对仍未识别的进程最多每分钟刷新一次，覆盖 QQ 登录后身份缓存没有失效的情况；识别出账号后不再刷新，确认账号匹配后才接入。关闭自动连接会停止这项后台识别。

QQ 自动启动使用官方客户端自己的登录设置，不传入未经验证的 QQ 命令行登录参数，不保存 QQ 密码。若 QQ 停留在选账号、点击登录或扫码页，需在官方客户端完成；SnowLuma 只会接入指定账号，不会把另一个已登录账号当作目标。登录完成后无需打开 SnowLuma 页面，守护会继续连接。

账号识别同时处理未注入前的本地账号信息和注入后的实时 UIN。不会把另一只在线的个人 QQ 当作机器人，也不会自动加载它。扫码、设备验证和 QQ 自身的自动登录由腾讯 QQ 管理。

SnowLuma 使用独立随机管理密码。启用自动登录时，内嵌页通过本机 API 获取会话，在同源页面内设置登录状态，不在 URL 中携带密码或 Token。同步时检查页面实际存储的令牌，清除或轮换后重新写入，不依赖“曾经写入过”的内存标记；登录开关在异步认证期间关闭也不会继续写入。授权到期后刷新认证，认证失败会退避；服务恢复后桌面守护也会同步内嵌页的新会话。

SnowLuma v2.1.0 自带更新启动器会再次创建 Node 子进程。受管启动通过独立的 `rosemewbot-console.mjs` 预加载模块为子进程补上 `windowsHide`，保留上游更新启动器和 IPC 退出行为，不改写官方入口文件。

## 状态与恢复

- QQ 在线要求选定进程同时报告已登录、已连接和 online 状态。
- OneBot 连通要求该账号名为 `Rosemewbot · AstrBot` 的 wsClient 适配器状态为 ok。管理页可达或端口监听不能单独代表 QQ 已登录。
- 连续三次检查发现组件故障后，恢复缺少或无响应的组件；健康组件和官方 QQ 保持运行。
- QQ 在线但 OneBot 持续断开时重新应用连接配置；QQ 会话失效时等待用户登录，不反复重启 QQ。
- 每轮故障最多执行一次组件恢复，恢复健康或手动启动后重新允许恢复。接入失败对同一 PID 最多尝试三次，间隔至少一分钟。
- 手动停止清除“应当运行”状态，守护不会重新拉起。停止和重启组件会卸载所选账号的接入，但保留官方 QQ 进程和登录。

关闭主窗口默认隐藏到托盘。开机启动、登录后启动机器人及自动恢复选项沿用原有设置。

## 版本、迁移与数据保护

`config/components-lock.json` 锁定 SnowLuma v2.4.2、AstrBot 4.28.2 与运行工具。SnowLuma 配置同版本官方主地址与 XingYunStar 历史归档备用地址；原官方发布不可达时自动使用归档。第三方归档不代表上游恢复维护，应用安装包不内置或重新分发 SnowLuma 二进制。

v0.6.8 起，桌面通过 Electron `net.fetch` 进行来源检测与组件文件下载，遵循 Windows 系统代理、PAC 和 HTTPS 代理配置。独立 Node 脚本默认使用 Node `fetch`；Python/AstrBot 的 uv 安装进程仍使用其自身的网络设置。

SnowLuma 下载前并行检测来源，单源检测最长 5 秒，优先使用可达来源。下载过程显示版本、字节数、来源与尝试次数；主源失败时显示自动切换提示。正式传输连续 15 秒未收到数据时尝试其他来源，每次传输总时限仍为 15 分钟。失败源的退避与 `Retry-After` 仅约束该来源，不延迟尚未尝试的备用源。所有来源统一校验固定 SHA-256；已校验缓存不再联网下载。404/410 来源退出本轮重试；失败与摘要不符的临时文件会被移除。全部失败时列出各来源错误。

v2.4.2 已验证真实下载、解压、缓存复用、保留配置修复、隔离启动与管理接口。本机 QQ 9.9.31-49738 的登录和 OneBot 记录来自此前 v2.1.0，不能据此认定 v2.4.2 已完成 QQ 消息收发验收；其他 QQ 构建也仍需兼容验证。

升级、修复使用暂存目录并保留 SnowLuma config/data/logs。迁移不复制 NapCat 登录凭据，不重建人设，不修改模型服务。清理旧 NapCat Hook 时只匹配本应用私有目录中的 DLL。

为了兼容已有 IPC，代码中的 service/panel ID `napcat` 及凭据字段 `napcatToken` 暂时保留，现在分别指向 SnowLuma 服务、面板和管理密码。组件维护使用独立的 `last-good-snowluma` 快照，避免恢复旧 NapCat 快照。

常规卸载保留数据目录；“一键完全卸载”经过原生确认后才删除程序与数据。QQ 由官方安装器管理，下载后校验 Tencent Authenticode 签名。

## 验证与构建

```powershell
npm run typecheck
npm test
npm run desktop:dir
npm run desktop:pack

$env:ROSEMEWBOT_DATA_DIR = 'C:\Rosemewbot-data'
node node_modules/tsx/dist/cli.mjs scripts/snowluma-check.mts --processes
```

检查脚本默认只读；`--start`、`--restart`、`--recover` 显式触发对应操作。SnowLuma 自带 Node 也可以运行该脚本。

自动测试覆盖账号隔离、未注入时 UIN 为零、认证并发与失败退避、适配器状态、配置保留、接入重试上限及恢复策略。实机验收包括用户登录、消息收发、组件重启与崩溃恢复。短期验收不能证明两小时以上持续在线，也不能保证腾讯永不要求重新认证。

解包目录为 `release/win-unpacked`。更新已安装桌面时需同时替换可执行文件和 `resources/app.asar`，两者包含匹配的完整性信息。第三方组件使用各自许可证；本仓库许可证不改变它们的使用和分发条款。
