import type {
  DesktopActionResult,
  DesktopAction,
  DesktopCredentials,
  DesktopInstallProgress,
  DesktopDiagnosticReport,
  DesktopPreferences,
  DesktopStatus,
  EmbeddedPanelBounds,
  EmbeddedPanelId,
  EmbeddedPanelState,
  PublicConfig,
} from "./types";

interface RosemewbotDesktopApi {
  isDesktop: true;
  getConfig(): Promise<PublicConfig>;
  getStatus(): Promise<DesktopStatus>;
  runAction(action: DesktopAction): Promise<DesktopActionResult>;
  getPreferences(): Promise<DesktopPreferences>;
  setPreferences(preferences: Partial<DesktopPreferences>): Promise<DesktopPreferences>;
  runDiagnostics(): Promise<DesktopDiagnosticReport>;
  getLogs(service: "astrbot" | "napcat"): Promise<string>;
  getCredentials(): Promise<DesktopCredentials>;
  openPanel(panel: EmbeddedPanelId): Promise<{ ok: boolean }>;
  showPanel(panel: EmbeddedPanelId, bounds: EmbeddedPanelBounds): Promise<{ ok: boolean }>;
  setPanelBounds(panel: EmbeddedPanelId, bounds: EmbeddedPanelBounds): Promise<{ ok: boolean }>;
  hidePanel(panel?: EmbeddedPanelId): Promise<{ ok: boolean }>;
  reloadPanel(panel: EmbeddedPanelId): Promise<{ ok: boolean }>;
  openDataFolder(): Promise<DesktopActionResult>;
  openQQDownload(): Promise<{ ok: boolean }>;
  setTheme(theme: "system" | "light" | "dark"): Promise<{ ok: boolean }>;
  onRuntimeProgress(callback: (progress: DesktopInstallProgress) => void): () => void;
  onPanelRequested(callback: (panel: EmbeddedPanelId) => void): () => void;
  onPanelState(callback: (state: EmbeddedPanelState) => void): () => void;
}

declare global {
  interface Window {
    rosemewbotDesktop?: RosemewbotDesktopApi;
  }
}

export {};
