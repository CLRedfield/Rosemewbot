export type ServiceState = "ready" | "waiting" | "unreachable";

export interface ServiceProbe {
  id: "napcat" | "astrbot" | "onebot";
  label: string;
  state: ServiceState;
  latencyMs: number | null;
  detail: string;
  checkedAt: string;
}

export interface StackStatus {
  overall: "ready" | "attention" | "starting";
  checkedAt: string;
  services: ServiceProbe[];
}

export interface PublicConfig {
  astrbotUrl: string;
  napcatUrl: string;
  onebotUrl: string;
  bindMode: "local" | "network";
}

export interface DesktopRuntimeService {
  id: "astrbot" | "napcat";
  installed: boolean;
  running: boolean;
  state: "running" | "stopped" | "missing" | "error";
  status: string;
  version: string | null;
  startedAt: string | null;
}

export interface DesktopInstallProgress {
  stage: "idle" | "checking" | "downloading" | "installing" | "configuring" | "waiting" | "complete" | "error";
  component: "runtime" | "astrbot" | "napcat" | "qq";
  percent: number;
  detail: string;
}

export interface DesktopCompatibilityComponent {
  id: "astrbot" | "napcat" | "uv" | "qq";
  label: string;
  installedVersion: string | null;
  targetVersion: string;
  status: "compatible" | "update-available" | "unknown" | "missing";
}

export interface DesktopCompatibilitySnapshot {
  available: boolean;
  createdAt: string | null;
  reason: "update" | "repair" | null;
  versions: {
    astrbot: string | null;
    napcat: string | null;
    uv: string | null;
  };
}

export interface DesktopCompatibilityOperation {
  at: string;
  action: "update" | "repair" | "rollback";
  status: "success" | "failed" | "rolled-back";
  message: string;
}

export interface DesktopCompatibilityState {
  policyVersion: string;
  channel: "stable";
  testedAt: string;
  overall: "compatible" | "update-available" | "unknown" | "unavailable";
  message: string;
  components: DesktopCompatibilityComponent[];
  snapshot: DesktopCompatibilitySnapshot;
  lastOperation: DesktopCompatibilityOperation | null;
}

export interface DesktopRuntimeState {
  platformSupported: boolean;
  nativeReady: boolean;
  qqInstalled: boolean;
  qqPath: string | null;
  stackState: "running" | "partial" | "stopped" | "unavailable";
  services: DesktopRuntimeService[];
  runtimeDir: string;
  busy: boolean;
  message: string;
  installProgress: DesktopInstallProgress;
  preferences: DesktopPreferences;
  compatibility: DesktopCompatibilityState;
}

export interface DesktopStatus {
  runtime: DesktopRuntimeState;
  stack: StackStatus;
  acceptance: DesktopAcceptanceState;
}

export interface DesktopPreferences {
  launchAtLogin: boolean;
  startBotAtLogin: boolean;
  autoRecovery: boolean;
  autoLoginAccount: string | null;
}

export interface DesktopQQLoginAccount {
  account: string;
  nickname: string | null;
  avatarUrl: string | null;
}

export type DesktopQQSessionState = "online" | "offline" | "logged-out" | "unknown";

export interface DesktopQQSessionStatus {
  state: DesktopQQSessionState;
  account: string | null;
  nickname: string | null;
  checkedAt: string;
  detail: string;
}

export interface DesktopAcceptanceState {
  componentsReady: boolean;
  servicesReady: boolean;
  qqInstalled: boolean;
  qqSession: DesktopQQSessionStatus;
  qqLoginDetected: boolean;
  qqAccount: string | null;
  onebotConfigured: boolean;
  onebotConnected: boolean;
  modelConfigured: boolean;
  modelName: string | null;
}

export type DesktopDiagnosticAction = DesktopAction | "open-astrbot" | "open-napcat";

export interface DesktopDiagnosticItem {
  id: string;
  title: string;
  severity: "pass" | "warning" | "error";
  detail: string;
  suggestion: string | null;
  action?: DesktopDiagnosticAction;
  actionLabel?: string;
}

export interface DesktopDiagnosticReport {
  checkedAt: string;
  overall: "healthy" | "attention" | "error";
  summary: string;
  items: DesktopDiagnosticItem[];
}

export interface DesktopCredentials {
  astrbotUsername: string;
  astrbotPassword: string;
  napcatToken: string;
}

export interface DesktopActionResult {
  ok: boolean;
  message: string;
  code?: "QQ_REQUIRED" | "QQ_DOWNLOAD_FAILED" | "UNSUPPORTED_PLATFORM" | "ALREADY_CURRENT" | "NO_SNAPSHOT" | "ROLLED_BACK" | "CANCELLED" | "UNINSTALLER_NOT_FOUND";
}

export interface DesktopAppUpdateResult {
  status: "current" | "available" | "error";
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string;
  publishedAt: string | null;
  checkedAt: string;
  message: string;
}

export type DesktopAction = "install" | "install-qq" | "start" | "stop" | "restart" | "update" | "repair" | "rollback";

export type EmbeddedPanelId = "astrbot" | "napcat";

export interface EmbeddedPanelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EmbeddedPanelState {
  panel: EmbeddedPanelId;
  state: "loading" | "ready" | "error";
  message: string;
}

export type ViewId = "runtime" | "napcat" | "astrbot" | "onboarding" | "status" | "diagnostics" | "settings";
