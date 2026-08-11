import { contextBridge, ipcRenderer } from "electron";

import type { InstallProgress, NativeAction, NativePreferences } from "./native-runtime.js";

type PanelId = "astrbot" | "napcat";

interface PanelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PanelState {
  panel: PanelId;
  state: "loading" | "ready" | "error";
  message: string;
}

contextBridge.exposeInMainWorld("rosemewbotDesktop", {
  isDesktop: true,
  getConfig: () => ipcRenderer.invoke("desktop:get-config"),
  getStatus: () => ipcRenderer.invoke("desktop:get-status"),
  getAppVersion: () => ipcRenderer.invoke("desktop:get-app-version"),
  checkAppUpdate: () => ipcRenderer.invoke("desktop:check-app-update"),
  openAppUpdatePage: () => ipcRenderer.invoke("desktop:open-app-update-page"),
  runAction: (action: NativeAction) => ipcRenderer.invoke("desktop:run-action", action),
  getPreferences: () => ipcRenderer.invoke("desktop:get-preferences"),
  getQQLoginAccounts: () => ipcRenderer.invoke("desktop:get-qq-login-accounts"),
  setPreferences: (preferences: Partial<NativePreferences>) => ipcRenderer.invoke("desktop:set-preferences", preferences),
  runDiagnostics: () => ipcRenderer.invoke("desktop:run-diagnostics"),
  getLogs: (service: "astrbot" | "napcat") => ipcRenderer.invoke("desktop:get-logs", service),
  getCredentials: () => ipcRenderer.invoke("desktop:get-credentials"),
  copyText: (value: string) => ipcRenderer.invoke("desktop:copy-text", value),
  openPanel: (panel: PanelId) => ipcRenderer.invoke("desktop:open-panel", panel),
  showPanel: (panel: PanelId, bounds: PanelBounds) => ipcRenderer.invoke("desktop:show-panel", panel, bounds),
  setPanelBounds: (panel: PanelId, bounds: PanelBounds) => ipcRenderer.invoke("desktop:set-panel-bounds", panel, bounds),
  hidePanel: (panel?: PanelId) => ipcRenderer.invoke("desktop:hide-panel", panel),
  reloadPanel: (panel: PanelId) => ipcRenderer.invoke("desktop:reload-panel", panel),
  openDataFolder: () => ipcRenderer.invoke("desktop:open-data-folder"),
  uninstallApp: () => ipcRenderer.invoke("desktop:uninstall-app"),
  openQQDownload: () => ipcRenderer.invoke("desktop:open-qq-download"),
  setTheme: (theme: "system" | "light" | "dark") => ipcRenderer.invoke("desktop:set-theme", theme),
  onRuntimeProgress: (callback: (progress: InstallProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: InstallProgress) => callback(progress);
    ipcRenderer.on("desktop:runtime-progress", listener);
    return () => ipcRenderer.removeListener("desktop:runtime-progress", listener);
  },
  onPanelRequested: (callback: (panel: PanelId) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, panel: PanelId) => callback(panel);
    ipcRenderer.on("desktop:panel-requested", listener);
    return () => ipcRenderer.removeListener("desktop:panel-requested", listener);
  },
  onPanelState: (callback: (state: PanelState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: PanelState) => callback(state);
    ipcRenderer.on("desktop:panel-state", listener);
    return () => ipcRenderer.removeListener("desktop:panel-state", listener);
  },
});
