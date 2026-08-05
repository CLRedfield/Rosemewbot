import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, createWriteStream, existsSync, openSync } from "node:fs";
import {
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import extract from "extract-zip";

import componentLock from "../config/components-lock.json";
import { collectStatus } from "../src/server/probe.js";

export type NativeAction = "install" | "install-qq" | "start" | "stop" | "restart" | "update" | "repair" | "rollback";
export type NativeServiceId = "astrbot" | "napcat";

export interface NativePreferences {
  launchAtLogin: boolean;
  startBotAtLogin: boolean;
  autoRecovery: boolean;
}

interface StoredPreferences extends NativePreferences {
  desiredRunning: boolean;
}

export interface NativeAcceptanceState {
  componentsReady: boolean;
  servicesReady: boolean;
  qqInstalled: boolean;
  qqLoginDetected: boolean;
  qqAccount: string | null;
  onebotConfigured: boolean;
  onebotConnected: boolean;
  modelConfigured: boolean;
  modelName: string | null;
}

export type DiagnosticSeverity = "pass" | "warning" | "error";
export type DiagnosticAction = NativeAction | "open-astrbot" | "open-napcat";

export interface DiagnosticItem {
  id: string;
  title: string;
  severity: DiagnosticSeverity;
  detail: string;
  suggestion: string | null;
  action?: DiagnosticAction;
  actionLabel?: string;
}

export interface DiagnosticReport {
  checkedAt: string;
  overall: "healthy" | "attention" | "error";
  summary: string;
  items: DiagnosticItem[];
}

export interface RecoveryResult {
  recovered: boolean;
  message: string;
}

export interface InstallProgress {
  stage: "idle" | "checking" | "downloading" | "installing" | "configuring" | "waiting" | "complete" | "error";
  component: "runtime" | "astrbot" | "napcat" | "qq";
  percent: number;
  detail: string;
}

export interface NativeRuntimeService {
  id: NativeServiceId;
  installed: boolean;
  running: boolean;
  state: "running" | "stopped" | "missing" | "error";
  status: string;
  version: string | null;
  startedAt: string | null;
}

export interface NativeCompatibilityComponent {
  id: "astrbot" | "napcat" | "uv" | "qq";
  label: string;
  installedVersion: string | null;
  targetVersion: string;
  status: "compatible" | "update-available" | "unknown" | "missing";
}

export interface NativeCompatibilitySnapshot {
  available: boolean;
  createdAt: string | null;
  reason: "update" | "repair" | null;
  versions: {
    astrbot: string | null;
    napcat: string | null;
    uv: string | null;
  };
}

export interface NativeCompatibilityState {
  policyVersion: string;
  channel: "stable";
  testedAt: string;
  overall: "compatible" | "update-available" | "unknown" | "unavailable";
  message: string;
  components: NativeCompatibilityComponent[];
  snapshot: NativeCompatibilitySnapshot;
  lastOperation: CompatibilityOperation | null;
}

export interface NativeRuntimeState {
  platformSupported: boolean;
  nativeReady: boolean;
  qqInstalled: boolean;
  qqPath: string | null;
  stackState: "running" | "partial" | "stopped" | "unavailable";
  services: NativeRuntimeService[];
  runtimeDir: string;
  busy: boolean;
  message: string;
  installProgress: InstallProgress;
  preferences: NativePreferences;
  compatibility: NativeCompatibilityState;
}

export interface NativeActionResult {
  ok: boolean;
  message: string;
  code?: "QQ_REQUIRED" | "QQ_DOWNLOAD_FAILED" | "UNSUPPORTED_PLATFORM" | "ALREADY_CURRENT" | "NO_SNAPSHOT" | "ROLLED_BACK";
}

interface GitHubAsset {
  name: string;
  browser_download_url: string;
  digest?: string | null;
}

interface GitHubRelease {
  tag_name: string;
  body?: string;
  assets: GitHubAsset[];
}

export interface CompatibilityOperation {
  at: string;
  action: "update" | "repair" | "rollback";
  status: "success" | "failed" | "rolled-back";
  message: string;
}

interface RuntimeManifest {
  astrbotVersion?: string;
  napcatVersion?: string;
  uvVersion?: string;
  updatedAt?: string;
  policyVersion?: string;
  lastCompatibilityOperation?: CompatibilityOperation;
}

interface SnapshotMetadata {
  schemaVersion: 1;
  createdAt: string;
  reason: "update" | "repair";
  versions: {
    astrbot: string | null;
    napcat: string | null;
    uv: string | null;
  };
}

interface RuntimeSecrets {
  astrbotUsername: string;
  astrbotPassword: string;
  napcatToken: string;
}

interface ProcessRecord {
  astrbot?: number;
  napcat?: number;
  startedAt?: Partial<Record<NativeServiceId, string>>;
}

interface TcpConnection {
  localAddress: string;
  localPort: number;
  remoteAddress: string;
  remotePort: number;
  state: string;
  pid: number;
}

const execFileAsync = promisify(execFile);
export const COMPONENT_POLICY = componentLock as {
  schemaVersion: 1;
  policyVersion: string;
  channel: "stable";
  testedAt: string;
  python: { version: string };
  uv: { repository: string; version: string; asset: string; sha256: string };
  astrbot: { package: string; version: string };
  napcat: { repository: string; version: string; asset: string; sha256: string };
  qq: { minimumBuild: number; testedBuild: number; downloadUrl: string };
};
const githubHeaders = {
  Accept: "application/vnd.github+json",
  "User-Agent": "Rosemewbot-Native/0.5.3",
  "X-GitHub-Api-Version": "2022-11-28",
};
const managedNapCatConnectionName = "Rosemewbot · AstrBot";
const legacyNapCatConnectionName = "Agent Space · AstrBot";
const managedAstrBotPlatformId = "rosemewbot-qq";
const legacyAstrBotPlatformId = "agent-space-qq";

const defaultPreferences: StoredPreferences = {
  launchAtLogin: false,
  startBotAtLogin: false,
  autoRecovery: true,
  desiredRunning: false,
};

function randomSecret(bytes = 18) {
  return randomBytes(bytes).toString("base64url");
}

function randomDashboardPassword() {
  return `Aq7-${randomSecret(18)}`;
}

export function isValidDashboardPassword(value: string) {
  return value.length >= 12 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /\d/.test(value);
}

function normalizeUninstallPath(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/^"([^"]+)"|^(.*?\.exe)(?:\s|$)/i);
  return match?.[1] ?? match?.[2] ?? trimmed.replace(/^"|"$/g, "");
}

export function parseQQInstallPath(registryOutput: string) {
  const line = registryOutput.split(/\r?\n/).find((item) => /UninstallString\s+REG_SZ/i.test(item));
  if (!line) return null;
  const value = line.replace(/^.*?REG_SZ\s+/i, "").trim();
  const uninstallExecutable = normalizeUninstallPath(value);
  return path.join(path.dirname(uninstallExecutable), "QQ.exe");
}

export function buildNapCatWebUiConfig(token: string) {
  return { host: "127.0.0.1", port: 6099, token, loginRate: 3 };
}

export function buildNapCatOneBotConfig() {
  return {
    network: {
      httpServers: [],
      httpClients: [],
      websocketServers: [],
      websocketClients: [{
        name: managedNapCatConnectionName,
        enable: true,
        url: "ws://127.0.0.1:6199/ws",
        messagePostFormat: "array",
        reportSelfMessage: false,
        reconnectInterval: 5000,
        token: "",
        debug: false,
        heartInterval: 30000,
      }],
    },
    musicSignUrl: "",
    enableLocalFile2Url: false,
    parseMultMsg: false,
  };
}

export function reconcileNapCatOneBotConfig(config: Record<string, unknown>) {
  const desired = buildNapCatOneBotConfig();
  const desiredClient = desired.network.websocketClients[0];
  const network = config.network && typeof config.network === "object"
    ? config.network as Record<string, unknown>
    : {};
  const clients = Array.isArray(network.websocketClients)
    ? network.websocketClients.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];
  const ownedIndex = clients.findIndex((item) => (
    item.name === desiredClient.name
    || item.name === legacyNapCatConnectionName
    || item.url === desiredClient.url
  ));
  const nextClients = [...clients];
  if (ownedIndex >= 0) nextClients[ownedIndex] = { ...nextClients[ownedIndex], ...desiredClient };
  else nextClients.push(desiredClient);

  return {
    ...config,
    network: {
      ...network,
      httpServers: Array.isArray(network.httpServers) ? network.httpServers : [],
      httpClients: Array.isArray(network.httpClients) ? network.httpClients : [],
      websocketServers: Array.isArray(network.websocketServers) ? network.websocketServers : [],
      websocketClients: nextClients,
    },
    musicSignUrl: typeof config.musicSignUrl === "string" ? config.musicSignUrl : "",
    enableLocalFile2Url: typeof config.enableLocalFile2Url === "boolean" ? config.enableLocalFile2Url : false,
    parseMultMsg: typeof config.parseMultMsg === "boolean" ? config.parseMultMsg : false,
  };
}

export function hasManagedNapCatConnection(config: Record<string, unknown>) {
  const network = config.network && typeof config.network === "object"
    ? config.network as Record<string, unknown>
    : {};
  const clients = Array.isArray(network.websocketClients)
    ? network.websocketClients.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];
  return clients.some((item) => (
    ([managedNapCatConnectionName, legacyNapCatConnectionName].includes(String(item.name)) || item.url === "ws://127.0.0.1:6199/ws")
    && item.enable !== false
    && item.url === "ws://127.0.0.1:6199/ws"
  ));
}

export function reconcileAstrBotConfig(config: Record<string, unknown>) {
  const platforms = Array.isArray(config.platform)
    ? config.platform.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];
  const ownedIndex = platforms.findIndex((item) => (
    item.id === managedAstrBotPlatformId || item.id === legacyAstrBotPlatformId
  ));
  const desiredPlatform = {
    id: managedAstrBotPlatformId,
    type: "aiocqhttp",
    enable: true,
    ws_reverse_host: "127.0.0.1",
    ws_reverse_port: 6199,
    ws_reverse_token: "",
  };
  const nextPlatforms = [...platforms];
  if (ownedIndex >= 0) nextPlatforms[ownedIndex] = { ...nextPlatforms[ownedIndex], ...desiredPlatform };
  else nextPlatforms.push(desiredPlatform);

  const dashboard = config.dashboard && typeof config.dashboard === "object"
    ? config.dashboard as Record<string, unknown>
    : {};
  return {
    ...config,
    platform: nextPlatforms,
    timezone: typeof config.timezone === "string" && config.timezone ? config.timezone : "Asia/Tokyo",
    dashboard: {
      ...dashboard,
      enable: true,
      host: "127.0.0.1",
      port: 6185,
    },
  };
}

export function normalizeComponentVersion(value?: string | null) {
  if (!value) return null;
  return value.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/)?.[0] ?? (value.trim() || null);
}

export function getComponentCompatibilityStatus(installedVersion: string | null | undefined, targetVersion: string, installed: boolean) {
  if (!installed) return "missing" as const;
  const current = normalizeComponentVersion(installedVersion);
  if (!current) return "unknown" as const;
  return current === normalizeComponentVersion(targetVersion) ? "compatible" as const : "update-available" as const;
}

export function parseQQDisplayVersion(registryOutput: string) {
  const line = registryOutput.split(/\r?\n/).find((item) => /DisplayVersion\s+REG_SZ/i.test(item));
  return line?.replace(/^.*?REG_SZ\s+/i, "").trim() || null;
}

export function parseNetstatConnections(output: string): TcpConnection[] {
  const connections: TcpConnection[] = [];
  for (const line of output.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 5 || columns[0]?.toUpperCase() !== "TCP") continue;
    const local = columns[1]?.match(/^(.+):(\d+)$/);
    const remote = columns[2]?.match(/^(.+):(\d+)$/);
    const pid = Number.parseInt(columns[4] ?? "", 10);
    if (!local || !remote || !Number.isSafeInteger(pid)) continue;
    connections.push({
      localAddress: local[1],
      localPort: Number.parseInt(local[2], 10),
      remoteAddress: remote[1],
      remotePort: Number.parseInt(remote[2], 10),
      state: columns[3]?.toUpperCase() ?? "UNKNOWN",
      pid,
    });
  }
  return connections;
}

export function inspectAstrBotConfig(config: Record<string, unknown>) {
  const platforms = Array.isArray(config.platform) ? config.platform as Array<Record<string, unknown>> : [];
  const onebotConfigured = platforms.some((item) => (
    ([managedAstrBotPlatformId, legacyAstrBotPlatformId].includes(String(item.id)) || item.type === "aiocqhttp")
    && item.enable !== false
    && Number(item.ws_reverse_port) === 6199
  ));
  const providers = Array.isArray(config.provider) ? config.provider as Array<Record<string, unknown>> : [];
  const enabledProviders = providers.filter((item) => item.enable !== false && typeof item.id === "string" && item.id.length > 0);
  const providerSettings = config.provider_settings && typeof config.provider_settings === "object"
    ? config.provider_settings as Record<string, unknown>
    : {};
  const defaultProviderId = typeof providerSettings.default_provider_id === "string"
    ? providerSettings.default_provider_id
    : null;
  const selected = enabledProviders.find((item) => item.id === defaultProviderId) ?? enabledProviders[0];
  const modelName = selected
    ? [selected.model, selected.model_name, selected.id].find((value): value is string => typeof value === "string" && value.length > 0) ?? null
    : null;
  return {
    onebotConfigured,
    modelConfigured: providerSettings.enable !== false && Boolean(selected),
    modelName,
  };
}

export function findNapCatAccountFromNames(names: string[]) {
  for (const name of names) {
    const match = name.match(/^(?:napcat|onebot11)_([1-9]\d{4,11})\.json$/i);
    if (match) return match[1];
  }
  return null;
}

async function fileExists(target: string) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function findFile(root: string, filename: string): Promise<string | null> {
  if (!await fileExists(root)) return null;
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) return target;
    if (entry.isDirectory()) {
      const nested = await findFile(target, filename);
      if (nested) return nested;
    }
  }
  return null;
}

async function readJson<T>(target: string, fallback: T): Promise<T> {
  try {
    return JSON.parse((await readFile(target, "utf8")).replace(/^\uFEFF/, "")) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(target: string, value: unknown) {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

async function githubRelease(repository: string, tag?: string): Promise<GitHubRelease> {
  const suffix = tag ? `/releases/tags/${encodeURIComponent(tag)}` : "/releases/latest";
  const response = await fetch(`https://api.github.com/repos/${repository}${suffix}`, { headers: githubHeaders });
  if (!response.ok) throw new Error(`GitHub 返回 HTTP ${response.status}`);
  return await response.json() as GitHubRelease;
}

async function sha256(target: string) {
  const hash = createHash("sha256");
  hash.update(await readFile(target));
  return hash.digest("hex");
}

async function verifyDigest(target: string, digest?: string | null) {
  if (!digest?.startsWith("sha256:")) return;
  const actual = await sha256(target);
  if (actual.toLowerCase() !== digest.slice(7).toLowerCase()) {
    throw new Error("下载文件校验失败，请重试");
  }
}

async function verifyLockedDigest(target: string, expected: string, published?: string | null) {
  const normalizedExpected = expected.replace(/^sha256:/i, "").toLowerCase();
  const normalizedPublished = published?.replace(/^sha256:/i, "").toLowerCase() ?? null;
  if (normalizedPublished && normalizedPublished !== normalizedExpected) {
    throw new Error("发布文件摘要与兼容策略不一致，已停止安装");
  }
  await verifyDigest(target, `sha256:${normalizedExpected}`);
}

function downloadFile(
  url: string,
  target: string,
  onProgress: (downloaded: number, total: number | null) => void,
  redirectCount = 0,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (redirectCount > 8) {
      reject(new Error("下载重定向次数过多"));
      return;
    }
    const transport = url.startsWith("https:") ? https : http;
    const request = transport.get(url, { headers: githubHeaders }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        const nextUrl = new URL(response.headers.location, url).toString();
        void downloadFile(nextUrl, target, onProgress, redirectCount + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`下载失败：HTTP ${response.statusCode ?? "unknown"}`));
        return;
      }
      const total = response.headers["content-length"] ? Number(response.headers["content-length"]) : null;
      let downloaded = 0;
      const output = createWriteStream(target);
      response.on("data", (chunk: Buffer) => {
        downloaded += chunk.length;
        onProgress(downloaded, total);
      });
      response.once("error", reject);
      output.once("error", reject);
      output.once("finish", () => output.close(() => resolve()));
      response.pipe(output);
    });
    request.setTimeout(120_000, () => request.destroy(new Error("下载连接超时")));
    request.once("error", reject);
  });
}

async function managedProcessRunning(service: NativeServiceId, pid?: number) {
  if (!pid || !Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    const result = await execFileAsync("tasklist.exe", ["/fi", `PID eq ${pid}`, "/fo", "csv", "/nh"], {
      windowsHide: true,
      timeout: 5_000,
    });
    const imageName = result.stdout.match(/^"([^"]+)"/)?.[1]?.toLowerCase();
    const expected = service === "astrbot" ? "astrbot.exe" : "napcatwinbootmain.exe";
    return imageName === expected;
  } catch {
    return false;
  }
}

function formatMegabytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export class NativeRuntimeManager {
  readonly runtimeDir: string;
  readonly onProgress: (progress: InstallProgress) => void;
  private busy = false;
  private progress: InstallProgress = { stage: "idle", component: "runtime", percent: 0, detail: "等待操作" };

  private readonly astrbotRoot: string;
  private readonly napcatRoot: string;
  private readonly toolsRoot: string;
  private readonly binRoot: string;
  private readonly pythonRoot: string;
  private readonly cacheRoot: string;
  private readonly downloadsRoot: string;
  private readonly logsRoot: string;
  private readonly snapshotsRoot: string;
  private readonly lastGoodSnapshotRoot: string;
  private readonly manifestPath: string;
  private readonly secretsPath: string;
  private readonly processesPath: string;
  private readonly preferencesPath: string;
  private unhealthyChecks = 0;
  private wasHealthy = false;
  private recoveryAttempted = false;

  constructor(userDataDir: string, onProgress: (progress: InstallProgress) => void = () => undefined) {
    this.runtimeDir = path.join(userDataDir, "native-runtime");
    this.astrbotRoot = path.join(this.runtimeDir, "astrbot");
    this.napcatRoot = path.join(this.runtimeDir, "napcat");
    this.toolsRoot = path.join(this.runtimeDir, "tools");
    this.binRoot = path.join(this.runtimeDir, "bin");
    this.pythonRoot = path.join(this.runtimeDir, "python");
    this.cacheRoot = path.join(this.runtimeDir, "cache");
    this.downloadsRoot = path.join(this.runtimeDir, "downloads");
    this.logsRoot = path.join(this.runtimeDir, "logs");
    this.snapshotsRoot = path.join(this.runtimeDir, "snapshots");
    this.lastGoodSnapshotRoot = path.join(this.snapshotsRoot, "last-good");
    this.manifestPath = path.join(this.runtimeDir, "manifest.json");
    this.secretsPath = path.join(this.runtimeDir, "secrets.json");
    this.processesPath = path.join(this.runtimeDir, "processes.json");
    this.preferencesPath = path.join(this.runtimeDir, "preferences.json");
    this.onProgress = onProgress;
  }

  private setProgress(progress: InstallProgress) {
    if (
      this.progress.stage === progress.stage
      && this.progress.component === progress.component
      && this.progress.percent === progress.percent
      && this.progress.detail === progress.detail
    ) return;
    this.progress = progress;
    this.onProgress(progress);
  }

  private assertManagedPath(target: string) {
    const resolvedRoot = path.resolve(this.runtimeDir);
    const resolvedTarget = path.resolve(target);
    if (resolvedTarget === resolvedRoot || !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new Error("拒绝操作运行目录之外的路径");
    }
  }

  private async removeManagedPath(target: string) {
    this.assertManagedPath(target);
    await rm(target, { recursive: true, force: true });
  }

  async initialize() {
    await Promise.all([
      mkdir(this.astrbotRoot, { recursive: true }),
      mkdir(this.napcatRoot, { recursive: true }),
      mkdir(this.toolsRoot, { recursive: true }),
      mkdir(this.binRoot, { recursive: true }),
      mkdir(this.pythonRoot, { recursive: true }),
      mkdir(this.cacheRoot, { recursive: true }),
      mkdir(this.downloadsRoot, { recursive: true }),
      mkdir(this.logsRoot, { recursive: true }),
      mkdir(this.snapshotsRoot, { recursive: true }),
    ]);
    await this.ensureSecrets();
    await this.ensurePreferences();
  }

  private async ensurePreferences(): Promise<StoredPreferences> {
    const stored = await readJson<Partial<StoredPreferences>>(this.preferencesPath, {});
    const preferences: StoredPreferences = {
      launchAtLogin: typeof stored.launchAtLogin === "boolean" ? stored.launchAtLogin : defaultPreferences.launchAtLogin,
      startBotAtLogin: typeof stored.startBotAtLogin === "boolean" ? stored.startBotAtLogin : defaultPreferences.startBotAtLogin,
      autoRecovery: typeof stored.autoRecovery === "boolean" ? stored.autoRecovery : defaultPreferences.autoRecovery,
      desiredRunning: typeof stored.desiredRunning === "boolean" ? stored.desiredRunning : defaultPreferences.desiredRunning,
    };
    if (JSON.stringify(stored) !== JSON.stringify(preferences)) await writeJson(this.preferencesPath, preferences);
    return preferences;
  }

  async getPreferences(): Promise<NativePreferences> {
    const { desiredRunning: _desiredRunning, ...preferences } = await this.ensurePreferences();
    return preferences;
  }

  async setPreferences(next: Partial<NativePreferences>): Promise<NativePreferences> {
    const stored = await this.ensurePreferences();
    for (const key of ["launchAtLogin", "startBotAtLogin", "autoRecovery"] as const) {
      if (typeof next[key] === "boolean") stored[key] = next[key];
    }
    if (!stored.launchAtLogin) stored.startBotAtLogin = false;
    await writeJson(this.preferencesPath, stored);
    return this.getPreferences();
  }

  private async setDesiredRunning(value: boolean) {
    const stored = await this.ensurePreferences();
    if (stored.desiredRunning === value) return;
    stored.desiredRunning = value;
    await writeJson(this.preferencesPath, stored);
  }

  private async getSnapshotMetadata(): Promise<SnapshotMetadata | null> {
    const metadataPath = path.join(this.lastGoodSnapshotRoot, "metadata.json");
    if (!await fileExists(metadataPath)) return null;
    const metadata = await readJson<SnapshotMetadata | null>(metadataPath, null);
    return metadata?.schemaVersion === 1 ? metadata : null;
  }

  async createCompatibilitySnapshot(reason: "update" | "repair"): Promise<SnapshotMetadata | null> {
    await this.initialize();
    const manifest = await readJson<RuntimeManifest>(this.manifestPath, {});
    const sources = [
      { source: path.join(this.astrbotRoot, "data"), name: "astrbot-data" },
      { source: this.napcatRoot, name: "napcat" },
      { source: this.toolsRoot, name: "tools" },
      { source: this.binRoot, name: "bin" },
    ];
    const hasComponents = await Promise.all(sources.slice(1).map(({ source }) => fileExists(source)));
    if (!hasComponents.some(Boolean)) return null;

    const pending = path.join(this.snapshotsRoot, "pending");
    const previous = path.join(this.snapshotsRoot, "previous");
    await this.removeManagedPath(pending);
    await mkdir(pending, { recursive: true });
    for (const { source, name } of sources) {
      if (await fileExists(source)) await cp(source, path.join(pending, name), { recursive: true, force: true });
    }
    if (await fileExists(this.manifestPath)) await copyFile(this.manifestPath, path.join(pending, "manifest.json"));
    const metadata: SnapshotMetadata = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      reason,
      versions: {
        astrbot: normalizeComponentVersion(manifest.astrbotVersion),
        napcat: normalizeComponentVersion(manifest.napcatVersion),
        uv: normalizeComponentVersion(manifest.uvVersion),
      },
    };
    await writeJson(path.join(pending, "metadata.json"), metadata);

    await this.removeManagedPath(previous);
    if (await fileExists(this.lastGoodSnapshotRoot)) await rename(this.lastGoodSnapshotRoot, previous);
    try {
      await rename(pending, this.lastGoodSnapshotRoot);
      await this.removeManagedPath(previous);
    } catch (error) {
      if (!await fileExists(this.lastGoodSnapshotRoot) && await fileExists(previous)) {
        await rename(previous, this.lastGoodSnapshotRoot);
      }
      throw error;
    }
    return metadata;
  }

  private async restoreCompatibilitySnapshotFiles() {
    const metadata = await this.getSnapshotMetadata();
    if (!metadata) throw new Error("没有可用的组件快照");
    this.setProgress({ stage: "installing", component: "runtime", percent: 35, detail: "正在恢复上一可用组件" });

    const entries = [
      { source: path.join(this.lastGoodSnapshotRoot, "napcat"), target: this.napcatRoot },
      { source: path.join(this.lastGoodSnapshotRoot, "tools"), target: this.toolsRoot },
      { source: path.join(this.lastGoodSnapshotRoot, "bin"), target: this.binRoot },
      { source: path.join(this.lastGoodSnapshotRoot, "astrbot-data"), target: path.join(this.astrbotRoot, "data") },
    ];
    for (const { source, target } of entries) {
      if (!await fileExists(source)) continue;
      await this.removeManagedPath(target);
      await mkdir(path.dirname(target), { recursive: true });
      await cp(source, target, { recursive: true, force: true });
    }
    const snapshotManifest = path.join(this.lastGoodSnapshotRoot, "manifest.json");
    if (await fileExists(snapshotManifest)) await copyFile(snapshotManifest, this.manifestPath);
    await this.saveProcessRecords({});
    return metadata;
  }

  private async recordCompatibilityOperation(operation: CompatibilityOperation) {
    const manifest = await readJson<RuntimeManifest>(this.manifestPath, {});
    manifest.lastCompatibilityOperation = operation;
    manifest.updatedAt = operation.at;
    await writeJson(this.manifestPath, manifest);
  }

  private async getCompatibilityState(
    manifest: RuntimeManifest,
    installed: { astrbot: boolean; napcat: boolean; uv: boolean; qq: boolean },
    qqVersion: string | null,
  ): Promise<NativeCompatibilityState> {
    const qqBuild = Number.parseInt(qqVersion?.split(".").at(-1) ?? "", 10);
    const qqStatus = !installed.qq
      ? "missing" as const
      : Number.isSafeInteger(qqBuild)
        ? qqBuild >= COMPONENT_POLICY.qq.minimumBuild ? "compatible" as const : "update-available" as const
        : "unknown" as const;
    const components: NativeCompatibilityComponent[] = [
      {
        id: "astrbot",
        label: "AstrBot",
        installedVersion: normalizeComponentVersion(manifest.astrbotVersion),
        targetVersion: COMPONENT_POLICY.astrbot.version,
        status: getComponentCompatibilityStatus(manifest.astrbotVersion, COMPONENT_POLICY.astrbot.version, installed.astrbot),
      },
      {
        id: "napcat",
        label: "NapCat",
        installedVersion: normalizeComponentVersion(manifest.napcatVersion),
        targetVersion: COMPONENT_POLICY.napcat.version,
        status: getComponentCompatibilityStatus(manifest.napcatVersion, COMPONENT_POLICY.napcat.version, installed.napcat),
      },
      {
        id: "uv",
        label: "uv",
        installedVersion: normalizeComponentVersion(manifest.uvVersion),
        targetVersion: COMPONENT_POLICY.uv.version,
        status: getComponentCompatibilityStatus(manifest.uvVersion, COMPONENT_POLICY.uv.version, installed.uv),
      },
      {
        id: "qq",
        label: "Windows QQ",
        installedVersion: qqVersion,
        targetVersion: `构建 ≥ ${COMPONENT_POLICY.qq.minimumBuild}（已测 ${COMPONENT_POLICY.qq.testedBuild}）`,
        status: qqStatus,
      },
    ];
    const core = components.filter((component) => component.id !== "qq");
    const overall = !installed.astrbot || !installed.napcat
      ? "unavailable" as const
      : core.some((component) => component.status === "update-available")
        ? "update-available" as const
        : core.some((component) => component.status === "unknown")
          ? "unknown" as const
          : qqStatus === "update-available"
            ? "unknown" as const
            : "compatible" as const;
    const metadata = await this.getSnapshotMetadata();
    const message = overall === "compatible"
      ? "核心组件与当前稳定策略一致"
      : overall === "update-available"
        ? "检测到与稳定策略不同的组件版本"
        : overall === "unknown"
          ? qqStatus === "update-available"
            ? `Windows QQ 构建低于兼容下限 ${COMPONENT_POLICY.qq.minimumBuild}`
            : "部分组件版本无法确认，可执行兼容修复"
          : "组件尚未准备完成";
    return {
      policyVersion: COMPONENT_POLICY.policyVersion,
      channel: COMPONENT_POLICY.channel,
      testedAt: COMPONENT_POLICY.testedAt,
      overall,
      message,
      components,
      snapshot: {
        available: Boolean(metadata),
        createdAt: metadata?.createdAt ?? null,
        reason: metadata?.reason ?? null,
        versions: metadata?.versions ?? { astrbot: null, napcat: null, uv: null },
      },
      lastOperation: manifest.lastCompatibilityOperation ?? null,
    };
  }

  private async ensureSecrets() {
    const existing = await fileExists(this.secretsPath)
      ? await readJson<RuntimeSecrets>(this.secretsPath, {
        astrbotUsername: "astrbot",
        astrbotPassword: "",
        napcatToken: "",
      })
      : null;
    const secrets: RuntimeSecrets = {
      astrbotUsername: existing?.astrbotUsername || "astrbot",
      astrbotPassword: existing && isValidDashboardPassword(existing.astrbotPassword)
        ? existing.astrbotPassword
        : randomDashboardPassword(),
      napcatToken: existing?.napcatToken || randomSecret(),
    };
    if (!existing || JSON.stringify(existing) !== JSON.stringify(secrets)) await writeJson(this.secretsPath, secrets);
    return secrets;
  }

  private uvEnvironment() {
    return {
      ...process.env,
      UV_TOOL_DIR: this.toolsRoot,
      UV_TOOL_BIN_DIR: this.binRoot,
      UV_PYTHON_INSTALL_DIR: this.pythonRoot,
      UV_CACHE_DIR: path.join(this.cacheRoot, "uv"),
      UV_MANAGED_PYTHON: "1",
      UV_PYTHON_NO_REGISTRY: "1",
      UV_PYTHON_INSTALL_REGISTRY: "0",
      UV_SYSTEM_CERTS: "true",
      UV_NO_PROGRESS: "1",
      PYTHONUTF8: "1",
    };
  }

  private async ensureUv(force = false) {
    const uvPath = path.join(this.binRoot, "uv.exe");
    if (!force && await fileExists(uvPath)) return uvPath;

    this.setProgress({ stage: "checking", component: "astrbot", percent: 5, detail: "正在获取 Python 运行工具" });
    const release = await githubRelease(COMPONENT_POLICY.uv.repository, COMPONENT_POLICY.uv.version);
    const assetName = COMPONENT_POLICY.uv.asset;
    const asset = release.assets.find((item) => item.name === assetName);
    if (!asset) throw new Error(`找不到 ${assetName}`);

    const archive = path.join(this.downloadsRoot, assetName);
    await downloadFile(asset.browser_download_url, archive, (downloaded, total) => {
      const fraction = total ? downloaded / total : 0;
      this.setProgress({
        stage: "downloading",
        component: "astrbot",
        percent: Math.min(15, 5 + Math.round(fraction * 10)),
        detail: `准备运行工具 ${formatMegabytes(downloaded)}${total ? ` / ${formatMegabytes(total)}` : ""}`,
      });
    });
    await verifyLockedDigest(archive, COMPONENT_POLICY.uv.sha256, asset.digest);

    const staging = path.join(this.runtimeDir, "staging-uv");
    await this.removeManagedPath(staging);
    await mkdir(staging, { recursive: true });
    await extract(archive, { dir: staging });
    const extractedUv = await findFile(staging, "uv.exe");
    if (!extractedUv) throw new Error("uv 压缩包中缺少 uv.exe");
    await copyFile(extractedUv, uvPath);
    await this.removeManagedPath(staging);

    const manifest = await readJson<RuntimeManifest>(this.manifestPath, {});
    manifest.uvVersion = COMPONENT_POLICY.uv.version;
    manifest.policyVersion = COMPONENT_POLICY.policyVersion;
    await writeJson(this.manifestPath, manifest);
    return uvPath;
  }

  private async runInstallerCommand(
    executable: string,
    args: string[],
    cwd: string,
    logName: string,
    extraEnv: NodeJS.ProcessEnv = {},
  ) {
    const result = await execFileAsync(executable, args, {
      cwd,
      env: { ...this.uvEnvironment(), ...extraEnv },
      windowsHide: true,
      timeout: 30 * 60_000,
      maxBuffer: 24 * 1024 * 1024,
    });
    const output = `${result.stdout}\n${result.stderr}`.trim();
    if (output) await writeFile(path.join(this.logsRoot, logName), `${output}\n`, "utf8");
    return output;
  }

  private async mergeAstrBotConfig() {
    const configPath = path.join(this.astrbotRoot, "data", "cmd_config.json");
    const config = await readJson<Record<string, unknown>>(configPath, { config_version: 2, platform: [], provider: [] });
    await writeJson(configPath, reconcileAstrBotConfig(config));
  }

  private async configureAstrBot(executable: string) {
    this.setProgress({ stage: "configuring", component: "astrbot", percent: 50, detail: "正在初始化 AstrBot" });
    const dataDir = path.join(this.astrbotRoot, "data");
    const secrets = await this.ensureSecrets();
    if (!await fileExists(dataDir)) {
      await this.runInstallerCommand(
        executable,
        ["init", "--yes"],
        this.astrbotRoot,
        "astrbot-init.log",
        { ASTRBOT_DASHBOARD_INITIAL_PASSWORD: secrets.astrbotPassword },
      );
    }
    for (const [key, value] of [
      ["dashboard.port", "6185"],
      ["dashboard.username", secrets.astrbotUsername],
      ["dashboard.password", secrets.astrbotPassword],
      ["timezone", "Asia/Tokyo"],
    ]) {
      await this.runInstallerCommand(executable, ["conf", "set", key, value], this.astrbotRoot, "astrbot-config.log");
    }
    await this.mergeAstrBotConfig();
    const version = await this.runInstallerCommand(executable, ["--version"], this.astrbotRoot, "astrbot-version.log");
    const manifest = await readJson<RuntimeManifest>(this.manifestPath, {});
    manifest.astrbotVersion = normalizeComponentVersion(version) ?? COMPONENT_POLICY.astrbot.version;
    manifest.policyVersion = COMPONENT_POLICY.policyVersion;
    manifest.updatedAt = new Date().toISOString();
    await writeJson(this.manifestPath, manifest);
  }

  private async prepareAstrBot(force = false) {
    const executable = path.join(this.binRoot, "astrbot.exe");
    if (!force && await fileExists(executable)) {
      await this.configureAstrBot(executable);
      return;
    }
    const uvPath = await this.ensureUv(force);
    this.setProgress({ stage: "installing", component: "astrbot", percent: 18, detail: "正在准备 AstrBot 和独立 Python 3.12" });
    await this.runInstallerCommand(uvPath, [
      "tool",
      "install",
      "--python",
      COMPONENT_POLICY.python.version,
      "--managed-python",
      "--force",
      `${COMPONENT_POLICY.astrbot.package}==${COMPONENT_POLICY.astrbot.version}`,
    ], this.astrbotRoot, "astrbot-install.log");
    if (!await fileExists(executable)) throw new Error("AstrBot 安装完成，但没有找到启动程序");

    await this.configureAstrBot(executable);
  }

  private async configureNapCat(root = this.napcatRoot) {
    const configRoot = path.join(root, "config");
    const secrets = await this.ensureSecrets();
    await writeJson(path.join(configRoot, "webui.json"), buildNapCatWebUiConfig(secrets.napcatToken));
    const defaultOneBotPath = path.join(configRoot, "onebot11.json");
    const defaultOneBot = await readJson<Record<string, unknown>>(defaultOneBotPath, {});
    await writeJson(defaultOneBotPath, reconcileNapCatOneBotConfig(defaultOneBot));
    const accountConfigs = await readdir(configRoot).catch(() => []);
    for (const name of accountConfigs.filter((item) => /^onebot11_[1-9]\d{4,11}\.json$/i.test(item))) {
      const target = path.join(configRoot, name);
      const accountConfig = await readJson<Record<string, unknown>>(target, {});
      await writeJson(target, reconcileNapCatOneBotConfig(accountConfig));
    }
    const napcatConfigPath = path.join(configRoot, "napcat.json");
    if (!await fileExists(napcatConfigPath)) {
      await writeJson(napcatConfigPath, {
        fileLog: true,
        consoleLog: true,
        fileLogLevel: "info",
        consoleLogLevel: "info",
        packetBackend: "auto",
        packetServer: "",
        o3HookMode: 1,
      });
    }
  }

  private async prepareNapCat(force = false) {
    const executable = path.join(this.napcatRoot, "NapCatWinBootMain.exe");
    if (!force && await fileExists(executable)) {
      await this.configureNapCat();
      return;
    }

    this.setProgress({ stage: "checking", component: "napcat", percent: 55, detail: "正在获取 NapCat Windows 版本" });
    const release = await githubRelease(COMPONENT_POLICY.napcat.repository, COMPONENT_POLICY.napcat.version);
    const asset = release.assets.find((item) => item.name === COMPONENT_POLICY.napcat.asset);
    if (!asset) throw new Error("最新 NapCat 版本缺少 Windows Shell 包");
    const archive = path.join(this.downloadsRoot, `NapCat.Shell-${COMPONENT_POLICY.napcat.version}.zip`);
    await downloadFile(asset.browser_download_url, archive, (downloaded, total) => {
      const fraction = total ? downloaded / total : 0;
      this.setProgress({
        stage: "downloading",
        component: "napcat",
        percent: Math.min(82, 55 + Math.round(fraction * 27)),
        detail: `下载 NapCat ${formatMegabytes(downloaded)}${total ? ` / ${formatMegabytes(total)}` : ""}`,
      });
    });
    await verifyLockedDigest(archive, COMPONENT_POLICY.napcat.sha256, asset.digest);

    const staging = path.join(this.runtimeDir, "staging-napcat");
    await this.removeManagedPath(staging);
    await mkdir(staging, { recursive: true });
    this.setProgress({ stage: "installing", component: "napcat", percent: 84, detail: "正在安装 NapCat" });
    await extract(archive, { dir: staging });
    if (!await fileExists(path.join(staging, "NapCatWinBootMain.exe"))) throw new Error("NapCat 压缩包结构不完整");
    if (await fileExists(path.join(this.napcatRoot, "config"))) {
      await cp(path.join(this.napcatRoot, "config"), path.join(staging, "config"), { recursive: true, force: true });
    }
    await this.configureNapCat(staging);

    const backup = path.join(this.runtimeDir, "backup-napcat");
    await this.removeManagedPath(backup);
    const hadExistingInstall = await fileExists(this.napcatRoot);
    if (hadExistingInstall) await rename(this.napcatRoot, backup);
    try {
      await rename(staging, this.napcatRoot);
      await this.removeManagedPath(backup);
    } catch (error) {
      if (!await fileExists(this.napcatRoot) && await fileExists(backup)) {
        await rename(backup, this.napcatRoot);
      }
      throw error;
    }

    const manifest = await readJson<RuntimeManifest>(this.manifestPath, {});
    manifest.napcatVersion = COMPONENT_POLICY.napcat.version;
    manifest.policyVersion = COMPONENT_POLICY.policyVersion;
    manifest.updatedAt = new Date().toISOString();
    await writeJson(this.manifestPath, manifest);
  }

  async findQQPath() {
    const registryKeys = [
      "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\QQ",
      "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\QQ",
      "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\QQ",
    ];
    for (const key of registryKeys) {
      try {
        const result = await execFileAsync("reg.exe", ["query", key, "/v", "UninstallString"], { windowsHide: true, timeout: 5_000 });
        const candidate = parseQQInstallPath(result.stdout);
        if (candidate && await fileExists(candidate)) return candidate;
      } catch {
        // Try the next registry location.
      }
    }
    const programFiles = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA]
      .filter((item): item is string => Boolean(item));
    const candidates = programFiles.flatMap((root) => [
      path.join(root, "Tencent", "QQNT", "QQ.exe"),
      path.join(root, "Programs", "Tencent", "QQNT", "QQ.exe"),
    ]);
    for (const candidate of candidates) if (await fileExists(candidate)) return candidate;
    return null;
  }

  private async getQQVersion() {
    const registryKeys = [
      "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\QQ",
      "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\QQ",
      "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\QQ",
    ];
    for (const key of registryKeys) {
      try {
        const result = await execFileAsync("reg.exe", ["query", key, "/v", "DisplayVersion"], { windowsHide: true, timeout: 5_000 });
        const version = parseQQDisplayVersion(result.stdout);
        if (version) return version;
      } catch {
        // Try the next registry location.
      }
    }
    return null;
  }

  private async qqDownloadUrl() {
    return COMPONENT_POLICY.qq.downloadUrl;
  }

  private async verifyQQInstaller(target: string) {
    const command = "$signature=Get-AuthenticodeSignature -LiteralPath $args[0]; Write-Output ($signature.Status.ToString() + '|' + $signature.SignerCertificate.Subject)";
    const result = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command, target], {
      windowsHide: true,
      timeout: 30_000,
    });
    const output = result.stdout.trim();
    if (!output.startsWith("Valid|") || !/Tencent/i.test(output)) throw new Error("QQ 安装程序数字签名验证失败");
  }

  private async installQQ(): Promise<NativeActionResult> {
    const existing = await this.findQQPath();
    if (existing) return { ok: true, message: "已检测到 Windows QQ" };
    const url = await this.qqDownloadUrl();
    if (!url) return { ok: false, code: "QQ_DOWNLOAD_FAILED", message: "没有找到 QQ 官方下载地址" };
    const installer = path.join(this.downloadsRoot, "QQ-Official-x64.exe");
    this.setProgress({ stage: "downloading", component: "qq", percent: 2, detail: "正在下载 QQ 官方安装程序" });
    try {
      await downloadFile(url, installer, (downloaded, total) => {
        const fraction = total ? downloaded / total : 0;
        this.setProgress({
          stage: "downloading",
          component: "qq",
          percent: Math.min(72, 2 + Math.round(fraction * 70)),
          detail: `下载 Windows QQ ${formatMegabytes(downloaded)}${total ? ` / ${formatMegabytes(total)}` : ""}`,
        });
      });
      await this.verifyQQInstaller(installer);
    } catch (error) {
      return { ok: false, code: "QQ_DOWNLOAD_FAILED", message: error instanceof Error ? error.message : "QQ 下载失败" };
    }

    this.setProgress({ stage: "waiting", component: "qq", percent: 75, detail: "请在打开的窗口中完成 QQ 安装" });
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(installer, [], { cwd: this.downloadsRoot, windowsHide: false, stdio: "ignore" });
      child.once("error", reject);
      child.once("exit", resolve);
    });
    const qqPath = await this.findQQPath();
    if (exitCode !== 0 || !qqPath) return { ok: false, code: "QQ_REQUIRED", message: "QQ 尚未安装完成，可重新尝试或从 QQ 官网安装" };
    this.setProgress({ stage: "complete", component: "qq", percent: 100, detail: "Windows QQ 已就绪" });
    return { ok: true, message: "Windows QQ 安装完成" };
  }

  private async prepare(force = false) {
    if (process.platform !== "win32" || process.arch !== "x64") {
      return { ok: false, code: "UNSUPPORTED_PLATFORM", message: "当前安装版仅支持 Windows x64" } satisfies NativeActionResult;
    }
    await this.initialize();
    await this.prepareAstrBot(force);
    await this.prepareNapCat(force);
    const qqPath = await this.findQQPath();
    this.setProgress({
      stage: "complete",
      component: "runtime",
      percent: 100,
      detail: qqPath ? "本机机器人组件已准备完成" : "基础组件已完成，下一步安装 Windows QQ",
    });
    return qqPath
      ? { ok: true, message: "本机机器人组件已准备完成" }
      : { ok: true, code: "QQ_REQUIRED", message: "AstrBot 与 NapCat 已准备完成，请继续安装 Windows QQ" } satisfies NativeActionResult;
  }

  private async validateCompatibilityInstall() {
    const manifest = await readJson<RuntimeManifest>(this.manifestPath, {});
    const expected = [
      ["AstrBot", manifest.astrbotVersion, COMPONENT_POLICY.astrbot.version],
      ["NapCat", manifest.napcatVersion, COMPONENT_POLICY.napcat.version],
      ["uv", manifest.uvVersion, COMPONENT_POLICY.uv.version],
    ] as const;
    for (const [label, current, target] of expected) {
      if (normalizeComponentVersion(current) !== normalizeComponentVersion(target)) {
        throw new Error(`${label} 版本验收失败：需要 ${target}，实际为 ${current ?? "未知"}`);
      }
    }
    if (!await fileExists(path.join(this.binRoot, "astrbot.exe"))) throw new Error("AstrBot 启动程序验收失败");
    if (!await fileExists(path.join(this.napcatRoot, "NapCatWinBootMain.exe"))) throw new Error("NapCat 启动程序验收失败");

    const astrbotConfig = await readJson<Record<string, unknown>>(path.join(this.astrbotRoot, "data", "cmd_config.json"), {});
    if (!inspectAstrBotConfig(astrbotConfig).onebotConfigured) throw new Error("AstrBot OneBot 连接契约验收失败");
    const napcatConfig = await readJson<Record<string, unknown>>(path.join(this.napcatRoot, "config", "onebot11.json"), {});
    if (!hasManagedNapCatConnection(napcatConfig)) throw new Error("NapCat OneBot 连接契约验收失败");
  }

  private async managementServicesHealthy() {
    const stack = await collectStatus({
      astrbotUrl: "http://127.0.0.1:6185",
      napcatUrl: "http://127.0.0.1:6099",
      onebotHost: "127.0.0.1",
      onebotPort: 6199,
      timeoutMs: 1_500,
    });
    return ["astrbot", "napcat"].every((id) => stack.services.find((service) => service.id === id)?.state === "ready");
  }

  private async waitForManagementServices(timeoutMs = 45_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.managementServicesHealthy()) return true;
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
    return false;
  }

  private async maintainCompatibleComponents(action: "update" | "repair"): Promise<NativeActionResult> {
    const [manifest, preferences, records] = await Promise.all([
      readJson<RuntimeManifest>(this.manifestPath, {}),
      this.ensurePreferences(),
      this.processRecords(),
    ]);
    const nativeReady = await fileExists(path.join(this.binRoot, "astrbot.exe"))
      && await fileExists(path.join(this.napcatRoot, "NapCatWinBootMain.exe"));
    const versionsCurrent = normalizeComponentVersion(manifest.astrbotVersion) === normalizeComponentVersion(COMPONENT_POLICY.astrbot.version)
      && normalizeComponentVersion(manifest.napcatVersion) === normalizeComponentVersion(COMPONENT_POLICY.napcat.version)
      && normalizeComponentVersion(manifest.uvVersion) === normalizeComponentVersion(COMPONENT_POLICY.uv.version);
    if (action === "update" && nativeReady && versionsCurrent) {
      return { ok: true, code: "ALREADY_CURRENT", message: "组件已是当前稳定兼容版本，无需更新" };
    }

    const wasRunning = await managedProcessRunning("astrbot", records.astrbot)
      || await managedProcessRunning("napcat", records.napcat);
    const shouldRestart = preferences.desiredRunning || wasRunning;
    const requireLiveValidation = wasRunning && await this.managementServicesHealthy();
    await this.stopServices();
    const existingSnapshot = await this.getSnapshotMetadata();
    const snapshot = nativeReady
      ? action === "repair" && existingSnapshot
        ? existingSnapshot
        : await this.createCompatibilitySnapshot(action)
      : null;

    try {
      const result = await this.prepare(true);
      if (!result.ok) throw new Error(result.message);
      await this.validateCompatibilityInstall();
      if (shouldRestart) {
        const started = await this.startServices();
        if (!started.ok) throw new Error(started.message);
        if (requireLiveValidation && !await this.waitForManagementServices()) {
          throw new Error("新组件启动后管理服务未在 45 秒内恢复");
        }
      } else {
        await this.setDesiredRunning(false);
      }
      const message = action === "update"
        ? "组件已更新到稳定兼容版本，升级前快照已保留"
        : "组件已按稳定兼容版本修复，配置与登录数据已保留";
      await this.recordCompatibilityOperation({ at: new Date().toISOString(), action, status: "success", message });
      this.setProgress({ stage: "complete", component: "runtime", percent: 100, detail: message });
      return { ok: true, code: result.code, message };
    } catch (error) {
      const failure = error instanceof Error ? error.message : "组件维护失败";
      if (snapshot) {
        await this.stopServices();
        await this.restoreCompatibilitySnapshotFiles();
        let restartMessage = "";
        if (shouldRestart) {
          const restarted = await this.startServices();
          restartMessage = restarted.ok ? "，旧版本已重新启动" : `，但旧版本重新启动失败：${restarted.message}`;
        } else {
          await this.setDesiredRunning(false);
        }
        const message = `新组件验收失败：${failure}；已自动回滚${restartMessage}`;
        await this.recordCompatibilityOperation({ at: new Date().toISOString(), action, status: "rolled-back", message });
        this.setProgress({ stage: "error", component: "runtime", percent: 100, detail: message });
        return { ok: false, code: "ROLLED_BACK", message };
      }
      const message = `${failure}；没有可回滚的旧组件快照`;
      await this.recordCompatibilityOperation({ at: new Date().toISOString(), action, status: "failed", message });
      throw new Error(message);
    }
  }

  private async rollbackCompatibleComponents(): Promise<NativeActionResult> {
    if (!await this.getSnapshotMetadata()) return { ok: false, code: "NO_SNAPSHOT", message: "还没有可回滚的组件快照" };
    const [preferences, records] = await Promise.all([this.ensurePreferences(), this.processRecords()]);
    const shouldRestart = preferences.desiredRunning
      || await managedProcessRunning("astrbot", records.astrbot)
      || await managedProcessRunning("napcat", records.napcat);
    await this.stopServices();
    const metadata = await this.restoreCompatibilitySnapshotFiles();
    if (shouldRestart) {
      const result = await this.startServices();
      if (!result.ok) throw new Error(`快照已恢复，但组件重新启动失败：${result.message}`);
    } else {
      await this.setDesiredRunning(false);
    }
    const versions = [metadata.versions.astrbot, metadata.versions.napcat].filter(Boolean).join(" / ");
    const message = `已回滚到 ${versions || "上一份组件快照"}，用户配置保持不变`;
    await this.recordCompatibilityOperation({ at: new Date().toISOString(), action: "rollback", status: "success", message });
    this.setProgress({ stage: "complete", component: "runtime", percent: 100, detail: message });
    return { ok: true, message };
  }

  private async processRecords() {
    return readJson<ProcessRecord>(this.processesPath, {});
  }

  private async saveProcessRecords(records: ProcessRecord) {
    await writeJson(this.processesPath, records);
  }

  private async launchDetached(service: NativeServiceId, executable: string, args: string[], cwd: string, env = process.env) {
    const stdout = openSync(path.join(this.logsRoot, `${service}.log`), "a");
    const stderr = openSync(path.join(this.logsRoot, `${service}.error.log`), "a");
    try {
      const child = spawn(executable, args, {
        cwd,
        env,
        detached: true,
        windowsHide: true,
        stdio: ["ignore", stdout, stderr],
      });
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      child.unref();
      const records = await this.processRecords();
      records[service] = child.pid;
      records.startedAt = { ...records.startedAt, [service]: new Date().toISOString() };
      await this.saveProcessRecords(records);
    } finally {
      closeSync(stdout);
      closeSync(stderr);
    }
  }

  private async startServices(): Promise<NativeActionResult> {
    const astrbotExecutable = path.join(this.binRoot, "astrbot.exe");
    const napcatExecutable = path.join(this.napcatRoot, "NapCatWinBootMain.exe");
    if (!await fileExists(astrbotExecutable) || !await fileExists(napcatExecutable)) {
      return { ok: false, message: "本机组件尚未准备，请先点击一键准备" };
    }
    const qqPath = await this.findQQPath();
    if (!qqPath) return { ok: false, code: "QQ_REQUIRED", message: "请先安装 Windows QQ" };
    const records = await this.processRecords();

    if (!await managedProcessRunning("astrbot", records.astrbot)) {
      const secrets = await this.ensureSecrets();
      await this.launchDetached("astrbot", astrbotExecutable, ["run"], this.astrbotRoot, {
        ...this.uvEnvironment(),
        ASTRBOT_DASHBOARD_INITIAL_PASSWORD: secrets.astrbotPassword,
      });
      await new Promise((resolve) => setTimeout(resolve, 900));
    }

    if (!await managedProcessRunning("napcat", records.napcat)) {
      const mainModule = path.join(this.napcatRoot, "napcat.mjs");
      const loadPath = path.join(this.napcatRoot, "loadNapCat.js");
      const importUrl = pathToFileURL(mainModule).href;
      await writeFile(loadPath, `(async () => { await import(${JSON.stringify(importUrl)}); })();\n`, "utf8");
      const napcatEnv = {
        ...process.env,
        NAPCAT_PATCH_PACKAGE: path.join(this.napcatRoot, "qqnt.json"),
        NAPCAT_LOAD_PATH: loadPath,
        NAPCAT_INJECT_PATH: path.join(this.napcatRoot, "NapCatWinBootHook.dll"),
        NAPCAT_LAUNCHER_PATH: napcatExecutable,
        NAPCAT_MAIN_PATH: mainModule.replace(/\\/g, "/"),
      };
      await this.launchDetached("napcat", napcatExecutable, [qqPath, path.join(this.napcatRoot, "NapCatWinBootHook.dll")], this.napcatRoot, napcatEnv);
    }
    await this.setDesiredRunning(true);
    return { ok: true, message: "本机机器人正在启动，请稍候扫码登录 QQ" };
  }

  private async stopService(service: NativeServiceId) {
    const records = await this.processRecords();
    const pid = records[service];
    if (await managedProcessRunning(service, pid)) {
      try {
        await execFileAsync("taskkill.exe", ["/pid", String(pid), "/t", "/f"], { windowsHide: true, timeout: 20_000 });
      } catch {
        // The process may have exited between the status check and taskkill.
      }
    }
    delete records[service];
    if (records.startedAt) {
      delete records.startedAt[service];
      if (Object.keys(records.startedAt).length === 0) delete records.startedAt;
    }
    await this.saveProcessRecords(records);
  }

  private async stopServices() {
    await this.stopService("napcat");
    await this.stopService("astrbot");
  }

  async stopAll() {
    await this.stopServices();
    await this.setDesiredRunning(false);
    return { ok: true, message: "机器人已停止，配置与登录数据均已保留" } satisfies NativeActionResult;
  }

  async runAction(action: NativeAction): Promise<NativeActionResult> {
    if (this.busy) return { ok: false, message: "已有操作正在进行，请稍候" };
    this.busy = true;
    try {
      if (action === "install") return await this.prepare(false);
      if (action === "install-qq") return await this.installQQ();
      if (action === "stop") return await this.stopAll();
      if (action === "restart") {
        this.recoveryAttempted = false;
        await this.stopServices();
        return await this.startServices();
      }
      if (action === "start") {
        this.recoveryAttempted = false;
        return await this.startServices();
      }
      if (action === "update" || action === "repair") return await this.maintainCompatibleComponents(action);
      if (action === "rollback") return await this.rollbackCompatibleComponents();
      return { ok: false, message: "不支持的操作" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "本机运行操作失败";
      this.setProgress({ stage: "error", component: "runtime", percent: this.progress.percent, detail: message });
      return { ok: false, message: message.slice(0, 500) };
    } finally {
      this.busy = false;
    }
  }

  async getState(): Promise<NativeRuntimeState> {
    await this.initialize();
    const [qqPath, qqVersion, records, manifest, preferences] = await Promise.all([
      this.findQQPath(),
      this.getQQVersion(),
      this.processRecords(),
      readJson<RuntimeManifest>(this.manifestPath, {}),
      this.getPreferences(),
    ]);
    const astrbotInstalled = await fileExists(path.join(this.binRoot, "astrbot.exe"));
    const napcatInstalled = await fileExists(path.join(this.napcatRoot, "NapCatWinBootMain.exe"));
    const uvInstalled = await fileExists(path.join(this.binRoot, "uv.exe"));
    const [astrbotRunning, napcatRunning] = await Promise.all([
      managedProcessRunning("astrbot", records.astrbot),
      managedProcessRunning("napcat", records.napcat),
    ]);
    const runningCount = [astrbotRunning, napcatRunning].filter(Boolean).length;
    const nativeReady = astrbotInstalled && napcatInstalled;
    const stackState = !nativeReady
      ? "unavailable"
      : runningCount === 2
        ? "running"
        : runningCount === 0
          ? "stopped"
          : "partial";
    const platformSupported = process.platform === "win32" && process.arch === "x64";
    const compatibility = await this.getCompatibilityState(manifest, {
      astrbot: astrbotInstalled,
      napcat: napcatInstalled,
      uv: uvInstalled,
      qq: Boolean(qqPath),
    }, qqVersion);
    return {
      platformSupported,
      nativeReady,
      qqInstalled: Boolean(qqPath),
      qqPath,
      stackState,
      services: [
        {
          id: "napcat",
          installed: napcatInstalled,
          running: napcatRunning,
          state: !napcatInstalled ? "missing" : napcatRunning ? "running" : "stopped",
          status: !napcatInstalled ? "等待一键准备" : napcatRunning ? "本机进程运行中" : "已安装，尚未启动",
          version: manifest.napcatVersion ?? null,
          startedAt: napcatRunning ? records.startedAt?.napcat ?? null : null,
        },
        {
          id: "astrbot",
          installed: astrbotInstalled,
          running: astrbotRunning,
          state: !astrbotInstalled ? "missing" : astrbotRunning ? "running" : "stopped",
          status: !astrbotInstalled ? "等待一键准备" : astrbotRunning ? "本机进程运行中" : "已安装，尚未启动",
          version: manifest.astrbotVersion ?? null,
          startedAt: astrbotRunning ? records.startedAt?.astrbot ?? null : null,
        },
      ],
      runtimeDir: this.runtimeDir,
      busy: this.busy,
      message: !platformSupported
        ? "当前设备不支持此 Windows 安装版"
        : !nativeReady
          ? "首次使用需要自动准备本机机器人组件"
          : !qqPath
            ? "组件已准备，请安装 Windows QQ"
            : stackState === "running"
              ? "AstrBot 与 NapCat 正在本机运行"
              : stackState === "partial"
                ? "部分组件需要重新启动"
                : "本机组件已就绪",
      installProgress: this.progress,
      preferences,
      compatibility,
    };
  }

  private async getTcpConnections() {
    if (process.platform !== "win32") return [];
    try {
      const result = await execFileAsync("netstat.exe", ["-ano", "-p", "tcp"], {
        windowsHide: true,
        timeout: 8_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      return parseNetstatConnections(result.stdout);
    } catch {
      return [];
    }
  }

  private async getQQAccount() {
    try {
      return findNapCatAccountFromNames(await readdir(path.join(this.napcatRoot, "config")));
    } catch {
      return null;
    }
  }

  private async getAstrBotInspection() {
    const configPath = path.join(this.astrbotRoot, "data", "cmd_config.json");
    const config = await readJson<Record<string, unknown>>(configPath, {});
    return inspectAstrBotConfig(config);
  }

  private async getAcceptance(runtime: NativeRuntimeState, stack: Awaited<ReturnType<typeof collectStatus>>): Promise<NativeAcceptanceState> {
    const [connections, qqAccount, astrbot] = await Promise.all([
      this.getTcpConnections(),
      this.getQQAccount(),
      this.getAstrBotInspection(),
    ]);
    const servicesReady = ["astrbot", "napcat"].every((id) => stack.services.find((service) => service.id === id)?.state === "ready");
    const onebotConnected = connections.some((connection) => (
      connection.state === "ESTABLISHED"
      && (connection.localPort === 6199 || connection.remotePort === 6199)
    ));
    return {
      componentsReady: runtime.nativeReady,
      servicesReady,
      qqInstalled: runtime.qqInstalled,
      qqLoginDetected: Boolean(qqAccount),
      qqAccount,
      onebotConfigured: astrbot.onebotConfigured,
      onebotConnected,
      modelConfigured: astrbot.modelConfigured,
      modelName: astrbot.modelName,
    };
  }

  async getStatus() {
    const [runtime, stack] = await Promise.all([
      this.getState(),
      collectStatus({
        astrbotUrl: "http://127.0.0.1:6185",
        napcatUrl: "http://127.0.0.1:6099",
        onebotHost: "127.0.0.1",
        onebotPort: 6199,
        timeoutMs: 1500,
      }),
    ]);
    const acceptance = await this.getAcceptance(runtime, stack);
    return { runtime, stack, acceptance };
  }

  async runDiagnostics(): Promise<DiagnosticReport> {
    const [{ runtime, stack, acceptance }, connections, disk] = await Promise.all([
      this.getStatus(),
      this.getTcpConnections(),
      statfs(this.runtimeDir).catch(() => null),
    ]);
    const items: DiagnosticItem[] = [];
    const add = (item: DiagnosticItem) => items.push(item);

    add(runtime.platformSupported
      ? { id: "platform", title: "Windows 运行环境", severity: "pass", detail: "当前为受支持的 Windows x64 环境。", suggestion: null }
      : { id: "platform", title: "Windows 运行环境", severity: "error", detail: "此安装版只支持 Windows x64。", suggestion: "请改用 64 位 Windows 10 或 Windows 11。" });
    add(acceptance.componentsReady
      ? { id: "components", title: "本机组件", severity: "pass", detail: "AstrBot 与 NapCat 程序文件完整。", suggestion: null }
      : { id: "components", title: "本机组件", severity: "error", detail: "AstrBot 或 NapCat 尚未准备完成。", suggestion: "运行一键首次准备。", action: "install", actionLabel: "一键准备" });
    add(acceptance.qqInstalled
      ? { id: "qq-installed", title: "Windows QQ", severity: "pass", detail: runtime.qqPath ? `已识别：${runtime.qqPath}` : "已安装。", suggestion: null }
      : { id: "qq-installed", title: "Windows QQ", severity: "error", detail: "没有找到 Windows QQ。", suggestion: "安装腾讯官方 Windows QQ。", action: "install-qq", actionLabel: "安装 QQ" });

    for (const id of ["astrbot", "napcat"] as const) {
      const label = id === "astrbot" ? "AstrBot 服务" : "NapCat 服务";
      const service = stack.services.find((candidate) => candidate.id === id);
      const running = runtime.services.find((candidate) => candidate.id === id)?.running;
      add(service?.state === "ready"
        ? { id: `${id}-service`, title: label, severity: "pass", detail: `${service.detail}，响应 ${service.latencyMs ?? "—"} ms。`, suggestion: null }
        : {
          id: `${id}-service`,
          title: label,
          severity: acceptance.componentsReady ? "error" : "warning",
          detail: running ? `${label}进程存在，但管理页面不可达。` : `${label}当前没有运行。`,
          suggestion: running ? "尝试重启；若仍失败，再执行组件修复。" : "启动机器人后重新诊断。",
          action: running ? "restart" : "start",
          actionLabel: running ? "重新启动" : "启动机器人",
        });
    }

    add(acceptance.qqLoginDetected
      ? { id: "qq-login", title: "QQ 登录", severity: "pass", detail: `已检测到机器人账号 ${acceptance.qqAccount}。`, suggestion: null }
      : { id: "qq-login", title: "QQ 登录", severity: acceptance.servicesReady ? "warning" : "error", detail: "尚未发现已登录的机器人 QQ。", suggestion: "打开 NapCat，使用手机 QQ 扫码登录独立测试账号。", action: "open-napcat", actionLabel: "打开 NapCat" });
    add(acceptance.onebotConfigured && acceptance.onebotConnected
      ? { id: "onebot", title: "OneBot 通道", severity: "pass", detail: "NapCat 已与 AstrBot 建立本机 WebSocket 连接。", suggestion: null }
      : {
        id: "onebot",
        title: "OneBot 通道",
        severity: acceptance.qqLoginDetected ? "error" : "warning",
        detail: acceptance.onebotConfigured ? "AstrBot 已配置 6199 端口，但尚无真实客户端连接。" : "AstrBot 的 OneBot v11 配置不完整。",
        suggestion: acceptance.onebotConfigured ? "确认 QQ 已登录，随后重启机器人。" : "执行组件修复以恢复预设连接。",
        action: acceptance.onebotConfigured ? "restart" : "repair",
        actionLabel: acceptance.onebotConfigured ? "重新启动" : "修复配置",
      });
    add(acceptance.modelConfigured
      ? { id: "model", title: "聊天模型", severity: "pass", detail: acceptance.modelName ? `已配置：${acceptance.modelName}` : "已配置可用的模型提供商。", suggestion: null }
      : { id: "model", title: "聊天模型", severity: "warning", detail: "AstrBot 尚未配置默认聊天模型。", suggestion: "打开 AstrBot，在模型提供商中添加模型并设为默认。", action: "open-astrbot", actionLabel: "配置模型" });

    const freeBytes = disk ? Number(disk.bavail) * Number(disk.bsize) : null;
    if (freeBytes !== null) {
      const freeGb = freeBytes / 1024 / 1024 / 1024;
      add({
        id: "disk",
        title: "数据盘空间",
        severity: freeGb < 2 ? "error" : freeGb < 5 ? "warning" : "pass",
        detail: `机器人数据所在磁盘剩余 ${freeGb.toFixed(1)} GB。`,
        suggestion: freeGb < 5 ? "清理下载缓存或把数据迁移到空间更充足的磁盘。" : null,
      });
    }

    for (const port of [6099, 6185, 6199]) {
      const listeners = connections.filter((connection) => connection.localPort === port && connection.state === "LISTENING");
      const listenerPids = [...new Set(listeners.map((item) => item.pid))];
      if (listenerPids.length > 1) {
        add({
          id: `port-${port}`,
          title: `${port} 端口冲突`,
          severity: "error",
          detail: `发现多个进程监听 ${port} 端口：${listenerPids.map((pid) => `PID ${pid}`).join("、")}。`,
          suggestion: "关闭重复启动的组件后重新启动机器人。",
          action: "restart",
          actionLabel: "重新启动",
        });
      }
    }

    const errors = items.filter((item) => item.severity === "error").length;
    const warnings = items.filter((item) => item.severity === "warning").length;
    const overall = errors > 0 ? "error" : warnings > 0 ? "attention" : "healthy";
    const summary = overall === "healthy"
      ? "所有自动检查均已通过。"
      : errors > 0
        ? `发现 ${errors} 个需要处理的问题${warnings ? `，另有 ${warnings} 项提醒` : ""}。`
        : `基础链路正常，还有 ${warnings} 项需要完成。`;
    return { checkedAt: new Date().toISOString(), overall, summary, items };
  }

  async recoverIfNeeded(): Promise<RecoveryResult> {
    const stored = await this.ensurePreferences();
    if (!stored.autoRecovery || !stored.desiredRunning || this.busy) return { recovered: false, message: "无需恢复" };
    const { runtime, stack, acceptance } = await this.getStatus();
    const servicesHealthy = ["astrbot", "napcat"].every((id) => stack.services.find((service) => service.id === id)?.state === "ready");
    const processesHealthy = runtime.stackState === "running";
    if (processesHealthy && servicesHealthy && (!this.wasHealthy || acceptance.onebotConnected)) {
      if (acceptance.onebotConnected) {
        this.wasHealthy = true;
        this.recoveryAttempted = false;
      }
      this.unhealthyChecks = 0;
      return { recovered: false, message: "运行正常" };
    }
    if (!this.wasHealthy && processesHealthy && servicesHealthy) return { recovered: false, message: "等待 QQ 登录" };
    if (this.recoveryAttempted) return { recovered: false, message: "自动恢复已尝试，等待人工处理" };

    this.unhealthyChecks += 1;
    const shouldRecoverImmediately = runtime.stackState === "partial" || runtime.stackState === "stopped";
    if (!shouldRecoverImmediately && this.unhealthyChecks < 3) return { recovered: false, message: "正在确认掉线状态" };

    this.busy = true;
    this.recoveryAttempted = true;
    try {
      await this.stopServices();
      const result = await this.startServices();
      this.unhealthyChecks = 0;
      this.wasHealthy = false;
      return { recovered: result.ok, message: result.ok ? "检测到组件掉线，已自动重新启动" : result.message };
    } catch (error) {
      return { recovered: false, message: error instanceof Error ? error.message : "自动恢复失败" };
    } finally {
      this.busy = false;
    }
  }

  async getCredentials() {
    const secrets = await this.ensureSecrets();
    const [webUi, astrbotConfig] = await Promise.all([
      readJson<{ token?: string }>(path.join(this.napcatRoot, "config", "webui.json"), {}),
      readJson<Record<string, unknown>>(path.join(this.astrbotRoot, "data", "cmd_config.json"), {}),
    ]);
    const dashboard = astrbotConfig.dashboard && typeof astrbotConfig.dashboard === "object"
      ? astrbotConfig.dashboard as Record<string, unknown>
      : {};
    return {
      ...secrets,
      astrbotUsername: typeof dashboard.username === "string" && dashboard.username ? dashboard.username : secrets.astrbotUsername,
      napcatToken: webUi.token ?? secrets.napcatToken,
    };
  }

  async getLogs(service: NativeServiceId) {
    const files = [path.join(this.logsRoot, `${service}.log`), path.join(this.logsRoot, `${service}.error.log`)];
    const chunks: string[] = [];
    for (const file of files) {
      try {
        const value = await readFile(file, "utf8");
        chunks.push(value.slice(-256_000));
      } catch {
        // The service may not have been started yet.
      }
    }
    if (chunks.length === 0) return "暂时没有日志。首次准备并启动后，日志会显示在这里。";
    const secrets = await this.getCredentials();
    return [secrets.astrbotPassword, secrets.napcatToken]
      .filter(Boolean)
      .reduce((logs, secret) => logs.split(secret).join("[REDACTED]"), chunks.join("\n").trim());
  }
}
