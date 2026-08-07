import { createHash } from "node:crypto";

export type QQSessionState = "online" | "offline" | "logged-out" | "unknown";

export interface QQSessionStatus {
  state: QQSessionState;
  account: string | null;
  nickname: string | null;
  checkedAt: string;
  detail: string;
}

interface NapCatResponse<T> {
  code: number;
  message?: string;
  data?: T;
}

interface NapCatAuthData {
  Credential?: string;
  require2FA?: boolean;
}

interface NapCatLoginStatusData {
  isLogin?: boolean;
  isOffline?: boolean;
  loginError?: string;
}

interface NapCatLoginInfoData {
  uin?: string | number;
  user_id?: string | number;
  nick?: string;
  nickname?: string;
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

class NapCatApiError extends Error {
  constructor(message: string, readonly unauthorized = false) {
    super(message);
    this.name = "NapCatApiError";
  }
}

const CREDENTIAL_TTL_MS = 50 * 60_000;

export function hashNapCatToken(token: string) {
  return createHash("sha256").update(`${token}.napcat`).digest("hex");
}

export class NapCatStatusClient {
  private credential: { token: string; value: string; expiresAt: number } | null = null;
  private authentication: { token: string; promise: Promise<string> } | null = null;

  constructor(private readonly options: {
    baseUrl?: string;
    fetcher?: Fetcher;
    now?: () => number;
    timeoutMs?: number;
  } = {}) {}

  private get baseUrl() {
    return (this.options.baseUrl ?? "http://127.0.0.1:6099").replace(/\/$/, "");
  }

  private get fetcher() {
    return this.options.fetcher ?? globalThis.fetch;
  }

  private get now() {
    return this.options.now ?? Date.now;
  }

  private async post<T>(path: string, body: Record<string, unknown>, credential?: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 1_500);
    try {
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new NapCatApiError(`NapCat HTTP ${response.status}`, response.status === 401 || response.status === 403);
      const result = await response.json() as NapCatResponse<T>;
      if (result.code !== 0) {
        const message = result.message || "NapCat API 请求失败";
        throw new NapCatApiError(message, /unauthor|authorization|token/i.test(message));
      }
      return result.data as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private async authenticate(token: string) {
    const data = await this.post<NapCatAuthData>("/api/auth/login", { hash: hashNapCatToken(token) });
    if (!data?.Credential) {
      if (data?.require2FA) throw new NapCatApiError("NapCat WebUI 已启用二次验证");
      throw new NapCatApiError("NapCat WebUI 没有返回访问凭据");
    }
    this.credential = {
      token,
      value: data.Credential,
      expiresAt: this.now() + CREDENTIAL_TTL_MS,
    };
    return data.Credential;
  }

  private async getCredential(token: string) {
    if (this.credential && this.credential.token === token && this.credential.expiresAt > this.now()) {
      return this.credential.value;
    }
    if (this.authentication?.token === token) return this.authentication.promise;
    this.credential = null;
    const promise = this.authenticate(token).finally(() => {
      if (this.authentication?.promise === promise) this.authentication = null;
    });
    this.authentication = { token, promise };
    return promise;
  }

  private async authorizedPost<T>(token: string, path: string) {
    let credential = await this.getCredential(token);
    try {
      return await this.post<T>(path, {}, credential);
    } catch (error) {
      if (!(error instanceof NapCatApiError) || !error.unauthorized) throw error;
      this.credential = null;
      credential = await this.getCredential(token);
      return this.post<T>(path, {}, credential);
    }
  }

  private async getLoginInfo(token: string) {
    try {
      return await this.authorizedPost<NapCatLoginInfoData>(token, "/api/QQLogin/GetQQLoginInfo");
    } catch {
      return null;
    }
  }

  async getSession(token: string): Promise<QQSessionStatus> {
    const checkedAt = new Date(this.now()).toISOString();
    if (!token) {
      return { state: "unknown", account: null, nickname: null, checkedAt, detail: "缺少 NapCat WebUI Token" };
    }

    try {
      const status = await this.authorizedPost<NapCatLoginStatusData>(token, "/api/QQLogin/CheckLoginStatus");
      const state: QQSessionState = status?.isLogin === true
        ? "online"
        : status?.isOffline === true
          ? "offline"
          : "logged-out";
      const info = state === "logged-out" ? null : await this.getLoginInfo(token);
      const rawAccount = info?.uin ?? info?.user_id;
      const account = typeof rawAccount === "string" || typeof rawAccount === "number" ? String(rawAccount) : null;
      const nickname = typeof info?.nick === "string" && info.nick
        ? info.nick
        : typeof info?.nickname === "string" && info.nickname
          ? info.nickname
          : null;
      const detail = state === "online"
        ? account ? `QQ ${account} 当前在线` : "QQ 当前在线"
        : state === "offline"
          ? account ? `QQ ${account} 已掉线` : "QQ 登录会话已掉线"
          : status?.loginError || "等待扫码登录 QQ";
      return { state, account, nickname, checkedAt, detail };
    } catch (error) {
      const detail = error instanceof Error && error.name === "AbortError"
        ? "读取 QQ 实时状态超时"
        : error instanceof Error
          ? error.message
          : "无法读取 QQ 实时状态";
      return { state: "unknown", account: null, nickname: null, checkedAt, detail };
    }
  }
}
