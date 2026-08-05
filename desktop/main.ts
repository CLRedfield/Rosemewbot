import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { cp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  nativeImage,
  net,
  Notification,
  protocol,
  session,
  shell,
  Tray,
  WebContentsView,
  type IpcMainInvokeEvent,
} from "electron";

import {
  NativeRuntimeManager,
  type InstallProgress,
  type NativeAction,
  type NativePreferences,
  type NativeServiceId,
} from "./native-runtime.js";
import { buildFullUninstallPlan } from "./uninstall.js";

type PanelId = "astrbot" | "napcat";
type PanelLoadState = "loading" | "ready" | "error";

interface PanelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PanelState {
  panel: PanelId;
  state: PanelLoadState;
  message: string;
}

const isDev = process.argv.includes("--dev");
const smokeTest = process.argv.includes("--smoke-test");
const captureUi = process.argv.includes("--capture-ui");
const captureThemeArgument = process.argv.find((argument) => argument.startsWith("--capture-theme="));
const captureTheme = captureThemeArgument?.split("=")[1];
const captureViewArgument = process.argv.find((argument) => argument.startsWith("--capture-view="));
const captureView = captureViewArgument?.split("=")[1];
const backgroundLaunch = process.argv.includes("--background");
const panelViews = new Map<PanelId, WebContentsView>();
const panelStates = new Map<PanelId, PanelState>();
let mainWindow: BrowserWindow | null = null;
let activePanel: PanelId | null = null;
let runtimeManager: NativeRuntimeManager;
let tray: Tray | null = null;
let isQuitting = false;
let watchdogTimer: NodeJS.Timeout | null = null;
let watchdogRunning = false;

const legacyUserDataDir = process.env.APPDATA
  ? path.join(process.env.APPDATA, "agent-space-qq-bridge")
  : null;
const packagedDataDir = app.isPackaged && process.platform === "win32"
  ? `${path.dirname(process.execPath)}-data`
  : null;

if (packagedDataDir) app.setPath("userData", packagedDataDir);

protocol.registerSchemesAsPrivileged([
  {
    scheme: "rosemewbot",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
    },
  },
]);

function sendRuntimeProgress(progress: InstallProgress) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("desktop:runtime-progress", progress);
  }
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    void createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function syncLoginItemSettings(preferences: NativePreferences) {
  if (!app.isPackaged || process.platform !== "win32") return;
  app.setLoginItemSettings({
    openAtLogin: preferences.launchAtLogin,
    path: process.execPath,
    args: ["--background"],
  });
}

async function requestFullUninstall() {
  if (!app.isPackaged || process.platform !== "win32") {
    return { ok: false, message: "一键完全卸载仅在已安装的 Windows 版本中可用" };
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, message: "主窗口不可用，请重新打开 Rosemewbot 后再试" };
  }

  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    title: "完全卸载 Rosemewbot",
    message: "确认完全卸载 Rosemewbot？",
    detail: "此操作将停止机器人，并永久删除 Rosemewbot、AstrBot、NapCat、独立 Python、配置、凭据、缓存与日志。腾讯 QQ 本身不会被卸载。",
    buttons: ["取消", "完全卸载"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  if (confirmation.response !== 1) {
    return { ok: false, code: "CANCELLED" as const, message: "已取消完全卸载" };
  }

  const plan = buildFullUninstallPlan(process.execPath);
  if (!existsSync(plan.uninstallerPath)) {
    return { ok: false, code: "UNINSTALLER_NOT_FOUND" as const, message: "没有找到卸载程序，请重新安装后再试" };
  }

  try {
    await runtimeManager.stopAll();
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "停止机器人组件失败" };
  }

  app.setLoginItemSettings({
    openAtLogin: false,
    path: process.execPath,
    args: ["--background"],
  });
  if (watchdogTimer) clearInterval(watchdogTimer);
  watchdogTimer = null;

  setTimeout(() => {
    try {
      const child = spawn(plan.uninstallerPath, plan.arguments, {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });
      child.once("error", (error) => console.error("Unable to launch full uninstaller", error));
      child.unref();
      isQuitting = true;
      app.quit();
    } catch (error) {
      console.error("Unable to launch full uninstaller", error);
    }
  }, 500);

  return { ok: true, message: "正在关闭 Rosemewbot 并执行完全卸载…" };
}

async function performRuntimeAction(action: NativeAction) {
  const result = await runtimeManager.runAction(action);
  await refreshTray();
  return result;
}

async function refreshTray() {
  if (!tray || tray.isDestroyed()) return;
  const { runtime, acceptance } = await runtimeManager.getStatus();
  const preferences = await runtimeManager.getPreferences();
  const running = runtime.stackState === "running";
  const connected = acceptance.onebotConnected;
  const statusLabel = connected ? "机器人在线" : running ? "机器人运行中，等待链路" : "机器人已停止";
  tray.setToolTip(`Rosemewbot · ${statusLabel}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: statusLabel, enabled: false },
    { type: "separator" },
    { label: "打开控制台", click: showMainWindow },
    {
      label: "启动机器人",
      enabled: runtime.nativeReady && runtime.qqInstalled && !running && !runtime.busy,
      click: () => { void performRuntimeAction("start"); },
    },
    {
      label: "停止机器人",
      enabled: runtime.stackState !== "stopped" && !runtime.busy,
      click: () => { void performRuntimeAction("stop"); },
    },
    {
      label: "重启机器人",
      enabled: running && !runtime.busy,
      click: () => { void performRuntimeAction("restart"); },
    },
    { type: "separator" },
    {
      label: "开机启动控制台",
      type: "checkbox",
      checked: preferences.launchAtLogin,
      click: async (item) => {
        const next = await runtimeManager.setPreferences({ launchAtLogin: item.checked });
        syncLoginItemSettings(next);
        await refreshTray();
      },
    },
    {
      label: "组件掉线自动恢复",
      type: "checkbox",
      checked: preferences.autoRecovery,
      click: async (item) => {
        await runtimeManager.setPreferences({ autoRecovery: item.checked });
        await refreshTray();
      },
    },
    { type: "separator" },
    {
      label: "退出并停止机器人",
      click: async () => {
        isQuitting = true;
        await runtimeManager.stopAll();
        app.quit();
      },
    },
  ]));
}

function createTray() {
  if (tray && !tray.isDestroyed()) return;
  const iconPath = path.join(app.getAppPath(), "assets", "icon.png");
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 });
  tray = new Tray(icon);
  tray.on("click", showMainWindow);
  void refreshTray();
}

function startWatchdog() {
  if (watchdogTimer) clearInterval(watchdogTimer);
  watchdogTimer = setInterval(() => {
    if (watchdogRunning) return;
    watchdogRunning = true;
    void runtimeManager.recoverIfNeeded()
      .then(async (result) => {
        if (result.recovered && Notification.isSupported()) {
          new Notification({ title: "Rosemewbot 已恢复机器人", body: result.message }).show();
        }
        await refreshTray();
      })
      .finally(() => { watchdogRunning = false; });
  }, 15_000);
}

async function migrateLegacyRuntime() {
  if (!legacyUserDataDir || !packagedDataDir) return;
  const source = path.join(legacyUserDataDir, "native-runtime");
  const target = path.join(packagedDataDir, "native-runtime");
  if (!existsSync(source) || existsSync(target)) return;
  await mkdir(packagedDataDir, { recursive: true });
  try {
    await rename(source, target);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "EXDEV")) throw error;
    await cp(source, target, { recursive: true, errorOnExist: true });
    await rm(source, { recursive: true, force: true });
  }
}

function panelUrl(panel: PanelId) {
  return panel === "astrbot" ? "http://127.0.0.1:6185" : "http://127.0.0.1:6099/webui";
}

function assertPanel(panel: PanelId) {
  if (panel !== "astrbot" && panel !== "napcat") throw new Error("Unsupported panel");
}

function sendPanelState(state: PanelState) {
  panelStates.set(state.panel, state);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("desktop:panel-state", state);
  }
}

function normalizePanelBounds(bounds: PanelBounds) {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error("Main window is unavailable");
  if (!bounds || typeof bounds !== "object") throw new Error("Invalid panel bounds");
  const values = [bounds.x, bounds.y, bounds.width, bounds.height];
  if (values.some((value) => typeof value !== "number" || !Number.isFinite(value))) throw new Error("Invalid panel bounds");
  const [contentWidth, contentHeight] = mainWindow.getContentSize();
  const x = Math.max(0, Math.min(contentWidth - 1, Math.round(bounds.x)));
  const y = Math.max(0, Math.min(contentHeight - 1, Math.round(bounds.y)));
  return {
    x,
    y,
    width: Math.max(1, Math.min(contentWidth - x, Math.round(bounds.width))),
    height: Math.max(1, Math.min(contentHeight - y, Math.round(bounds.height))),
  };
}

async function panelTarget(panel: PanelId) {
  let target = panelUrl(panel);
  if (panel === "napcat") {
    const { napcatToken } = await runtimeManager.getCredentials();
    if (napcatToken) target = `${target}?token=${encodeURIComponent(napcatToken)}`;
  }
  return target;
}

function panelMessage(panel: PanelId, state: PanelLoadState, detail?: string): PanelState {
  const label = panel === "astrbot" ? "AstrBot" : "NapCat";
  const defaultMessage = state === "loading"
    ? `正在载入 ${label} 设置`
    : state === "ready"
      ? `${label} 设置已就绪`
      : `${label} 设置暂时无法访问`;
  return { panel, state, message: detail || defaultMessage };
}

function createPanelView(panel: PanelId) {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error("Main window is unavailable");
  const partition = `persist:rosemewbot-${panel}`;
  const panelSession = session.fromPartition(partition);
  panelSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  const panelView = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      partition,
    },
  });
  panelView.setVisible(false);
  panelView.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#090c0e" : "#f3f5f2");
  panelViews.set(panel, panelView);
  mainWindow.contentView.addChildView(panelView);

  panelView.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (new URL(url).origin === new URL(panelUrl(panel)).origin) {
        void panelView.webContents.loadURL(url);
      } else if (url.startsWith("https://")) {
        void shell.openExternal(url);
      }
    } catch {
      // Invalid destinations are denied below.
    }
    return { action: "deny" };
  });
  panelView.webContents.on("will-navigate", (event, url) => {
    try {
      if (new URL(url).origin !== new URL(panelUrl(panel)).origin) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
  panelView.webContents.on("did-start-loading", () => {
    sendPanelState(panelMessage(panel, "loading"));
  });
  panelView.webContents.on("did-finish-load", () => {
    sendPanelState(panelMessage(panel, "ready"));
    if (activePanel === panel) panelView.setVisible(true);
  });
  panelView.webContents.on("did-fail-load", (_event, errorCode, errorDescription, _url, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    panelView.setVisible(false);
    sendPanelState(panelMessage(panel, "error", `${errorDescription}（${errorCode}）`));
  });
  panelView.webContents.on("render-process-gone", () => {
    panelView.setVisible(false);
    sendPanelState(panelMessage(panel, "error", `${panel === "astrbot" ? "AstrBot" : "NapCat"} 设置页面意外退出`));
  });
  return panelView;
}

async function showEmbeddedPanel(panel: PanelId, bounds: PanelBounds) {
  assertPanel(panel);
  const safeBounds = normalizePanelBounds(bounds);
  activePanel = panel;
  for (const [id, view] of panelViews) {
    if (id !== panel) view.setVisible(false);
  }
  const panelView = panelViews.get(panel) ?? createPanelView(panel);
  panelView.setBounds(safeBounds);
  const currentState = panelStates.get(panel) ?? panelMessage(panel, "loading");
  sendPanelState(currentState);
  if (panelView.webContents.getURL()) {
    panelView.setVisible(currentState.state !== "error");
  } else {
    await panelView.webContents.loadURL(await panelTarget(panel));
  }
}

function setEmbeddedPanelBounds(panel: PanelId, bounds: PanelBounds) {
  assertPanel(panel);
  if (activePanel !== panel) return;
  panelViews.get(panel)?.setBounds(normalizePanelBounds(bounds));
}

function hideEmbeddedPanel(panel?: PanelId) {
  if (panel) assertPanel(panel);
  if (panel && activePanel !== panel) return;
  if (activePanel) panelViews.get(activePanel)?.setVisible(false);
  activePanel = null;
}

async function reloadEmbeddedPanel(panel: PanelId) {
  assertPanel(panel);
  const panelView = panelViews.get(panel);
  sendPanelState(panelMessage(panel, "loading"));
  if (panelView?.webContents.getURL()) panelView.webContents.reloadIgnoringCache();
  else if (panelView) await panelView.webContents.loadURL(await panelTarget(panel));
}

function requestEmbeddedPanel(panel: PanelId) {
  assertPanel(panel);
  showMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("desktop:panel-requested", panel);
  }
}

function disposePanelViews() {
  activePanel = null;
  for (const panelView of panelViews.values()) {
    if (!panelView.webContents.isDestroyed()) panelView.webContents.close();
  }
  panelViews.clear();
  panelStates.clear();
}

function isTrustedSender(event: IpcMainInvokeEvent) {
  const url = event.senderFrame?.url ?? "";
  return url.startsWith("rosemewbot://bundle/") || (isDev && url.startsWith("http://127.0.0.1:5173/"));
}

function trustedHandler<T extends unknown[], R>(handler: (...args: T) => Promise<R> | R) {
  return async (event: IpcMainInvokeEvent, ...args: T) => {
    if (!isTrustedSender(event)) throw new Error("Untrusted IPC sender");
    return handler(...args);
  };
}

function registerIpc() {
  ipcMain.handle("desktop:get-config", trustedHandler(() => ({
    astrbotUrl: "http://127.0.0.1:6185",
    napcatUrl: "http://127.0.0.1:6099/webui",
    onebotUrl: "ws://127.0.0.1:6199/ws",
    bindMode: "local" as const,
  })));
  ipcMain.handle("desktop:copy-text", trustedHandler((value: string) => {
    if (typeof value !== "string") throw new Error("Unsupported clipboard value");
    clipboard.writeText(value);
    return clipboard.readText() === value;
  }));
  ipcMain.handle("desktop:get-status", trustedHandler(() => runtimeManager.getStatus()));
  ipcMain.handle("desktop:run-action", trustedHandler((action: NativeAction) => {
    const allowed: NativeAction[] = ["install", "install-qq", "start", "stop", "restart", "update", "repair", "rollback"];
    if (!allowed.includes(action)) throw new Error("Unsupported action");
    return performRuntimeAction(action);
  }));
  ipcMain.handle("desktop:get-preferences", trustedHandler(() => runtimeManager.getPreferences()));
  ipcMain.handle("desktop:set-preferences", trustedHandler(async (next: Partial<NativePreferences>) => {
    if (!next || typeof next !== "object" || Array.isArray(next)) throw new Error("Unsupported preferences");
    const allowed = ["launchAtLogin", "startBotAtLogin", "autoRecovery"];
    if (Object.keys(next).some((key) => !allowed.includes(key))) throw new Error("Unsupported preference key");
    if (Object.values(next).some((value) => typeof value !== "boolean")) throw new Error("Unsupported preference value");
    const preferences = await runtimeManager.setPreferences(next);
    syncLoginItemSettings(preferences);
    await refreshTray();
    return preferences;
  }));
  ipcMain.handle("desktop:run-diagnostics", trustedHandler(() => runtimeManager.runDiagnostics()));
  ipcMain.handle("desktop:get-logs", trustedHandler((service: NativeServiceId) => {
    if (service !== "astrbot" && service !== "napcat") throw new Error("Unsupported log service");
    return runtimeManager.getLogs(service);
  }));
  ipcMain.handle("desktop:get-credentials", trustedHandler(() => runtimeManager.getCredentials()));
  ipcMain.handle("desktop:open-panel", trustedHandler((panel: PanelId) => {
    requestEmbeddedPanel(panel);
    return { ok: true };
  }));
  ipcMain.handle("desktop:show-panel", trustedHandler(async (panel: PanelId, bounds: PanelBounds) => {
    await showEmbeddedPanel(panel, bounds);
    return { ok: true };
  }));
  ipcMain.handle("desktop:set-panel-bounds", trustedHandler((panel: PanelId, bounds: PanelBounds) => {
    setEmbeddedPanelBounds(panel, bounds);
    return { ok: true };
  }));
  ipcMain.handle("desktop:hide-panel", trustedHandler((panel?: PanelId) => {
    hideEmbeddedPanel(panel);
    return { ok: true };
  }));
  ipcMain.handle("desktop:reload-panel", trustedHandler(async (panel: PanelId) => {
    await reloadEmbeddedPanel(panel);
    return { ok: true };
  }));
  ipcMain.handle("desktop:open-data-folder", trustedHandler(async () => {
    await runtimeManager.initialize();
    const error = await shell.openPath(runtimeManager.runtimeDir);
    return { ok: !error, message: error };
  }));
  ipcMain.handle("desktop:uninstall-app", trustedHandler(() => requestFullUninstall()));
  ipcMain.handle("desktop:open-qq-download", trustedHandler(async () => {
    await shell.openExternal("https://im.qq.com/pcqq/index.shtml");
    return { ok: true };
  }));
  ipcMain.handle("desktop:set-theme", trustedHandler((theme: "system" | "light" | "dark") => {
    if (!["system", "light", "dark"].includes(theme)) throw new Error("Unsupported theme");
    nativeTheme.themeSource = theme;
    return { ok: true };
  }));
}

async function registerAppProtocol() {
  const distRoot = path.resolve(app.getAppPath(), "dist");
  protocol.handle("rosemewbot", async (request) => {
    const url = new URL(request.url);
    const relativePath = decodeURIComponent(url.pathname).replace(/^[/\\]+/, "") || "index.html";
    const target = path.resolve(distRoot, relativePath);
    if (target !== distRoot && !target.startsWith(`${distRoot}${path.sep}`)) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(target).toString());
  });
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    title: "Rosemewbot",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#090c0e" : "#f3f5f2",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(app.getAppPath(), "dist-electron", "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: !captureUi,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = url.startsWith("rosemewbot://bundle/") || (isDev && url.startsWith("http://127.0.0.1:5173/"));
    if (!allowed) event.preventDefault();
  });
  if (!smokeTest && !captureUi && !backgroundLaunch) mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("close", (event) => {
    if (isQuitting || smokeTest || captureUi) return;
    event.preventDefault();
    mainWindow?.hide();
  });
  mainWindow.on("closed", () => {
    disposePanelViews();
    mainWindow = null;
  });

  if (isDev) await mainWindow.loadURL("http://127.0.0.1:5173/");
  else await mainWindow.loadURL("rosemewbot://bundle/index.html");

  if (smokeTest) {
    const result = await mainWindow.webContents.executeJavaScript(`Promise.all([
      window.rosemewbotDesktop?.getStatus(),
      window.rosemewbotDesktop?.getPreferences(),
      window.rosemewbotDesktop?.runDiagnostics()
    ]).then(([status, preferences, diagnostics]) => ({ status, preferences, diagnostics }))`);
    console.log(`DESKTOP_SMOKE_OK ${JSON.stringify({
      bridge: Boolean(result),
      stackState: result?.status?.runtime?.stackState ?? "unknown",
      nativeReady: result?.status?.runtime?.nativeReady ?? false,
      qqInstalled: result?.status?.runtime?.qqInstalled ?? false,
      autoRecovery: result?.preferences?.autoRecovery ?? false,
      diagnosticItems: result?.diagnostics?.items?.length ?? 0,
    })}`);
    app.exit(result ? 0 : 1);
  }

  if (captureUi) {
    await mainWindow.webContents.insertCSS("*, *::before, *::after { transition: none !important; animation: none !important; }");
    if (captureTheme === "light" || captureTheme === "dark" || captureTheme === "system") {
      const title = captureTheme === "system" ? "Windows" : captureTheme === "light" ? "亮色" : "暗色";
      const selected = await mainWindow.webContents.executeJavaScript(`(() => {
        const button = [...document.querySelectorAll('.theme-options button')]
          .find((item) => item.getAttribute('title')?.includes(${JSON.stringify(title)}));
        button?.click();
        return Boolean(button);
      })()`);
      if (!selected) throw new Error(`Capture theme option not found: ${captureTheme}`);
    }
    if (["runtime", "napcat", "astrbot", "onboarding", "status", "diagnostics"].includes(captureView ?? "")) {
      const labels: Record<string, string> = { runtime: "运行控制", napcat: "NapCat 设置", astrbot: "AstrBot 设置", onboarding: "接入向导", status: "运行状态", diagnostics: "故障诊断" };
      const selected = await mainWindow.webContents.executeJavaScript(`(() => {
        const button = [...document.querySelectorAll('.sidebar nav button')]
          .find((item) => item.textContent?.includes(${JSON.stringify(labels[captureView!])}));
        button?.click();
        return Boolean(button);
      })()`);
      if (!selected) throw new Error(`Capture view not found: ${captureView}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    const capturedThemeState = await mainWindow.webContents.executeJavaScript(`({
      mode: document.documentElement.dataset.themeMode,
      resolved: document.documentElement.dataset.theme,
      selected: document.querySelector('.theme-options button[aria-pressed="true"]')?.textContent?.trim()
    })`);
    console.log(`DESKTOP_CAPTURE_THEME ${JSON.stringify(capturedThemeState)}`);
    const image = await mainWindow.webContents.capturePage();
    const artifactsDir = path.join(app.getAppPath(), "artifacts");
    await mkdir(artifactsDir, { recursive: true });
    const themeSuffix = captureTheme === "light" || captureTheme === "dark" || captureTheme === "system" ? `-${captureTheme}` : "";
    const viewSuffix = captureView && captureView !== "runtime" ? `-${captureView}` : "";
    const suffix = `${themeSuffix}${viewSuffix}`;
    const target = path.join(artifactsDir, `desktop-runtime${suffix}.png`);
    await writeFile(target, image.toPNG());
    console.log(`DESKTOP_CAPTURE_OK ${target}`);
    app.exit(0);
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow();
  });

  app.whenReady().then(async () => {
    if (process.platform === "win32") app.setAppUserModelId("com.rosemewbot.desktop");
    nativeTheme.themeSource = "system";
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    await migrateLegacyRuntime();
    runtimeManager = new NativeRuntimeManager(app.getPath("userData"), sendRuntimeProgress);
    await runtimeManager.initialize();
    await registerAppProtocol();
    registerIpc();
    if (!smokeTest && !captureUi) createTray();
    await createMainWindow();
    const preferences = await runtimeManager.getPreferences();
    syncLoginItemSettings(preferences);
    if (!smokeTest && !captureUi) startWatchdog();
    if (backgroundLaunch && preferences.startBotAtLogin) await performRuntimeAction("start");
  }).catch((error) => {
    console.error(error);
    app.exit(1);
  });

  app.on("activate", () => {
    showMainWindow();
  });

  app.on("before-quit", () => {
    isQuitting = true;
    if (watchdogTimer) clearInterval(watchdogTimer);
  });
}
