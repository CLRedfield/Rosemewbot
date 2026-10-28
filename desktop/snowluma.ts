import type { NapCatQuickLoginAccount, QQSessionStatus } from "./napcat-status.js";

export const SNOWLUMA_URL = "http://127.0.0.1:5099";
export const MANAGED_CONNECTION_NAME = "Rosemewbot · AstrBot";
// v2.1.0's updater spawns a child without windowsHide. Keep the official updater
// and its IPC shutdown behavior, while applying our desktop console policy to children.
export const SNOWLUMA_CONSOLE_PRELOAD = `import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const originalSpawn = childProcess.spawn;
childProcess.spawn = function(command, args, options) {
  if (!Array.isArray(args)) { options = args; args = []; }
  return originalSpawn(command, args, { ...options, windowsHide: true });
};
syncBuiltinESMExports();
`;
export interface SnowLumaProcess {
  pid: number;
  path: string;
  injected: boolean;
  connected: boolean;
  loggedIn: boolean;
  uin: string;
  status: "available" | "loading" | "connecting" | "loaded" | "online" | "error" | "disconnected";
  error?: string;
  account: { uin: string; nickname: string } | null;
}
export interface SnowLumaConnection {
  uin: string;
  nickname?: string;
  adapters: Array<{ name: string; kind: string; status: string }>;
}
export interface SnowLumaSnapshot {
  session: QQSessionStatus;
  processes: SnowLumaProcess[];
  onebotConnected: boolean;
}

export function reconcileSnowLumaConfig(config: Record<string, unknown>, accessToken = "", autoConnect = true) {
  const networks = config.networks && typeof config.networks === "object"
    ? config.networks as Record<string, unknown> : {};
  const clients = Array.isArray(networks.wsClients) ? networks.wsClients : [];
  const managed = {
    name: MANAGED_CONNECTION_NAME, enabled: autoConnect,
    url: "ws://127.0.0.1:6199/ws", role: "Universal", accessToken,
    messageFormat: "array", reportSelfMessage: false, reconnectIntervalMs: 5000,
  };
  return {
    ...config,
    networks: {
      httpServers: [], httpClients: [], wsServers: [], ...networks,
      wsClients: [...clients.filter((entry) => entry && typeof entry === "object"
        && entry.name !== MANAGED_CONNECTION_NAME && entry.url !== managed.url), managed],
    },
    statusCommand: config.statusCommand ?? { enabled: false, swallow: false, cooldownSeconds: 5, trigger: "#sl" },
    historySync: config.historySync ?? { enabled: false },
    notifications: config.notifications ?? { channelIds: [] },
  };
}

export function selectSnowLumaProcess(processes: SnowLumaProcess[], account: string | null) {
  // Never infer the bot from whichever personal QQ happens to be online first.
  if (!account) return undefined;
  return processes.find((item) => item.uin === account && item.loggedIn && item.connected)
    ?? processes.find((item) => (item.account?.uin === account && (!/^[1-9]\d{4,11}$/.test(item.uin) || item.uin === account))
      || (!item.account && item.uin === account));
}

export function describeSnowLumaSession(processes: SnowLumaProcess[], account: string | null, checkedAt: string): QQSessionStatus {
  const current = selectSnowLumaProcess(processes, account);
  if (!account) return { state: "unknown", account: null, nickname: null, checkedAt, detail: "请在设置中选择要接入的 QQ 账号" };
  const nickname = current?.account?.nickname ?? null;
  if (!current) return { state: "logged-out", account, nickname, checkedAt, detail: `请在 Windows QQ 中登录 ${account}，登录后会自动接入` };
  if (current.loggedIn && current.connected && current.status === "online") {
    return { state: "online", account, nickname, checkedAt, detail: `QQ ${account} 当前在线` };
  }
  if (current.status === "available" || current.status === "loading" || current.status === "connecting") {
    return { state: "unknown", account, nickname, checkedAt, detail: `正在等待 SnowLuma 接入 QQ ${account}` };
  }
  if (current.status === "error" || current.status === "disconnected") {
    return { state: "offline", account, nickname, checkedAt, detail: current.error || `QQ ${account} 的接入连接已断开` };
  }
  return { state: "logged-out", account, nickname, checkedAt, detail: `QQ ${account} 尚未登录，请在 Windows QQ 中完成登录` };
}

class SnowLumaApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export class SnowLumaClient {
  private credential: { password: string; token: string; expiresAt: number } | null = null;
  private authentication: { password: string; promise: Promise<string> } | null = null;
  private authenticationFailure: { password: string; retryAt: number; error: Error } | null = null;
  private attachAttempts = new Map<number, { at: number; attempts: number }>();
  private identityRefreshedAt = new Map<number, number>();
  private attachment: Promise<boolean> | null = null;

  constructor(private readonly options: {
    baseUrl?: string; fetcher?: typeof fetch; now?: () => number; timeoutMs?: number;
  } = {}) {}

  private now() { return (this.options.now ?? Date.now)(); }
  reset() { this.credential = null; this.authenticationFailure = null; this.attachAttempts.clear(); this.identityRefreshedAt.clear(); }

  private async request<T>(route: string, token?: string, body?: unknown): Promise<T> {
    const response = await (this.options.fetcher ?? fetch)(`${this.options.baseUrl ?? SNOWLUMA_URL}${route}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...(token ? { "x-snowluma-token": token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 5000),
    });
    const result = await response.json() as T & { message?: string; success?: boolean };
    if (!response.ok || result.success === false) throw new SnowLumaApiError(result.message || `SnowLuma HTTP ${response.status}`, response.status);
    return result;
  }

  async getToken(password: string): Promise<string> {
    if (!password) throw new Error("缺少 SnowLuma 管理密码");
    if (this.credential?.password === password && this.credential.expiresAt > this.now()) return this.credential.token;
    if (this.authentication?.password === password) return this.authentication.promise;
    if (this.authenticationFailure?.password === password && this.authenticationFailure.retryAt > this.now()) throw this.authenticationFailure.error;
    const promise = this.request<{ token?: string; mustChangePassword?: boolean }>("/api/login", undefined, { password })
      .then((data) => {
        if (!data.token) throw new Error("SnowLuma 未返回访问凭据，请检查后台登录或二次验证设置");
        if (data.mustChangePassword) throw new Error("请先在 SnowLuma 后台设置管理密码");
        this.credential = { password, token: data.token, expiresAt: this.now() + 23 * 60 * 60_000 };
        this.authenticationFailure = null;
        return data.token;
      }).catch((error: Error) => {
        this.authenticationFailure = { password, retryAt: this.now() + 60_000, error };
        throw error;
      }).finally(() => { this.authentication = null; });
    this.authentication = { password, promise };
    return promise;
  }

  async api<T>(password: string, route: string, body?: unknown): Promise<T> {
    const token = await this.getToken(password);
    try { return await this.request<T>(route, token, body); }
    catch (error) {
      if (!(error instanceof SnowLumaApiError) || error.status !== 401) throw error;
      if (this.credential?.token === token) this.credential = null;
      return this.request<T>(route, await this.getToken(password), body);
    }
  }

  async getProcesses(password: string) {
    const result = await this.api<{ list: SnowLumaProcess[] }>(password, "/api/processes");
    if (!Array.isArray(result.list)) throw new Error("SnowLuma 进程状态格式无效");
    return result.list;
  }

  async getProcessesForStartup(password: string) {
    return this.refreshUnknownIdentities(password, await this.getProcesses(password), true);
  }

  private async refreshUnknownIdentities(password: string, current: SnowLumaProcess[], force = false) {
    const processes = [...current];
    const livePids = new Set(processes.map((item) => item.pid));
    for (const pid of this.identityRefreshedAt.keys()) {
      if (!livePids.has(pid)) this.identityRefreshedAt.delete(pid);
    }
    // QQ can be logged into long after startup without SnowLuma's identity cache
    // being invalidated. Only unresolved, unloaded processes need a bounded-rate
    // refresh; never inject one until it identifies itself as the selected account.
    for (const [index, item] of processes.entries()) {
      if (item.account || item.injected || item.connected || item.status !== "available") continue;
      const previous = this.identityRefreshedAt.get(item.pid);
      if (!force && previous !== undefined && this.now() - previous < 60_000) continue;
      this.identityRefreshedAt.set(item.pid, this.now());
      try {
        const result = await this.api<{ process: SnowLumaProcess }>(password, `/api/processes/${item.pid}/refresh`, {});
        if (result.process?.pid === item.pid) processes[index] = result.process;
      } catch (error) {
        // Explicit startup / account-list checks report failure. Background attach
        // can still use another process and retry this one after the cooldown.
        if (force) throw error;
      }
    }
    return processes;
  }

  async getSnapshot(password: string, account: string | null): Promise<SnowLumaSnapshot> {
    const checkedAt = new Date(this.now()).toISOString();
    try {
      const [processes, connections] = await Promise.all([
        this.getProcesses(password), this.api<{ list: SnowLumaConnection[] }>(password, "/api/connections"),
      ]);
      const session = describeSnowLumaSession(processes, account, checkedAt);
      return { session, processes, onebotConnected: session.state === "online" && (connections.list ?? []).some((item) => item.uin === account
        && item.adapters.some((adapter) => adapter.kind === "wsClient" && adapter.name === MANAGED_CONNECTION_NAME && adapter.status === "ok")) };
    } catch (error) {
      return { processes: [], onebotConnected: false, session: { state: "unknown", account, nickname: null, checkedAt,
        detail: error instanceof Error ? error.message : "无法读取 SnowLuma 登录状态" } };
    }
  }

  async getAccounts(password: string): Promise<NapCatQuickLoginAccount[]> {
    const accounts = new Map<string, NapCatQuickLoginAccount>();
    for (const item of await this.getProcessesForStartup(password)) {
      const account = /^[1-9]\d{4,11}$/.test(item.uin) ? item.uin : item.account?.uin;
      if (account && /^[1-9]\d{4,11}$/.test(account)) accounts.set(account, {
        account, nickname: item.account?.nickname ?? null, avatarUrl: null,
      });
    }
    return [...accounts.values()];
  }

  async attachSelected(password: string, account: string | null) {
    if (this.attachment) return this.attachment;
    this.attachment = this.attachOnce(password, account).finally(() => { this.attachment = null; });
    return this.attachment;
  }

  private async attachOnce(password: string, account: string | null) {
    if (!account) return false;
    const processes = await this.getProcesses(password);
    const item = selectSnowLumaProcess(processes, account)
      ?? selectSnowLumaProcess(await this.refreshUnknownIdentities(password, processes), account);
    if (!item) return false;
    if (item.connected && item.loggedIn) { this.attachAttempts.delete(item.pid); return false; }
    if (item.status === "loading" || item.status === "connecting" || (item.connected && !item.loggedIn)) return false;
    const previous = this.attachAttempts.get(item.pid);
    if (previous && (previous.attempts >= 3 || this.now() - previous.at < 60_000)) return false;
    this.attachAttempts.set(item.pid, { at: this.now(), attempts: (previous?.attempts ?? 0) + 1 });
    const result = await this.api<{ success: boolean }>(password, `/api/processes/${item.pid}/load`, {});
    return result.success;
  }

  async detachSelected(password: string, account: string | null) {
    if (!account) return;
    const current = selectSnowLumaProcess(await this.getProcesses(password), account);
    if (current?.injected || current?.connected) await this.api(password, `/api/processes/${current.pid}/unload`, {});
  }
}
