import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeRuntimeManager } from "../desktop/native-runtime";
import { SnowLumaClient, describeSnowLumaSession, reconcileSnowLumaConfig, selectSnowLumaProcess, type SnowLumaProcess } from "../desktop/snowluma";

const at = "2026-10-21T14:00:00.000Z";
const account = "2056798478";
function processInfo(overrides: Partial<SnowLumaProcess> = {}): SnowLumaProcess {
  return { pid: 100, path: "QQ.exe", injected: true, connected: true, loggedIn: true,
    uin: account, status: "online", account: { uin: account, nickname: "辉夜" }, ...overrides };
}
const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

describe("SnowLuma account isolation and live health", () => {
  it("does not count another online QQ as the selected bot", () => {
    const processes = [processInfo({ uin: "3111675", account: { uin: "3111675", nickname: "Personal" } })];
    expect(selectSnowLumaProcess(processes, account)).toBeUndefined();
    expect(describeSnowLumaSession(processes, account, at).state).toBe("logged-out");
    expect(describeSnowLumaSession(processes, null, at).state).toBe("unknown");
  });
  it("recognizes the local identity before injection when the live UIN is zero", () => {
    const current = processInfo({ uin: "0", injected: false, connected: false, loggedIn: false, status: "available" });
    expect(selectSnowLumaProcess([current], account)?.pid).toBe(100);
    expect(describeSnowLumaSession([current], account, at).state).toBe("unknown");
    expect(selectSnowLumaProcess([processInfo({ loggedIn: false, connected: false, account: { uin: "3111675", nickname: "Other" } })], account)).toBeUndefined();
  });
  it("does not label a loaded hook without a QQ login as online", () => {
    expect(describeSnowLumaSession([processInfo({ status: "loaded", loggedIn: false })], account, at).state).toBe("logged-out");
    expect(describeSnowLumaSession([processInfo({ status: "disconnected", connected: false })], account, at).state).toBe("offline");
  });
  it("preserves custom connections and settings while making the managed connection unique", () => {
    const custom = { name: "user-connection", url: "ws://localhost:9000", enabled: false };
    const config = reconcileSnowLumaConfig({ historySync: { enabled: true }, networks: {
      httpServers: [{ name: "local-api", port: 3000 }], wsClients: [custom, { name: "old", url: "ws://127.0.0.1:6199/ws" }],
    } }, "onebot-secret");
    expect(config.historySync).toEqual({ enabled: true });
    expect(config.networks.httpServers).toHaveLength(1);
    expect(config.networks.wsClients).toHaveLength(2);
    expect(config.networks.wsClients[0]).toEqual(custom);
    expect(config.networks.wsClients[1]).toMatchObject({ accessToken: "onebot-secret", role: "Universal" });
  });
  it("shares authentication and requires this account's connected reverse adapter", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const route = String(url);
      if (route.endsWith("/api/login")) return Response.json({ success: true, token: "session-token" });
      if (route.endsWith("/api/processes")) return Response.json({ list: [processInfo()] });
      return Response.json({ list: [{ uin: account, adapters: [{ name: "Rosemewbot · AstrBot", kind: "wsClient", status: "ok" }] }] });
    });
    const client = new SnowLumaClient({ fetcher: fetcher as typeof fetch });
    const result = await client.getSnapshot("secret", account);
    expect(result.session.state).toBe("online");
    expect(result.onebotConnected).toBe(true);
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/api/login"))).toHaveLength(1);
    expect((await client.getSnapshot("secret", "9999999")).onebotConnected).toBe(false);
  });
  it("does not confuse HTTP availability or an API failure with a login", async () => {
    const client = new SnowLumaClient({ fetcher: vi.fn(async () => Response.json({ message: "Unavailable" }, { status: 503 })) });
    expect((await client.getSnapshot("secret", account)).session.state).toBe("unknown");
  });
  it("renews a management session after SnowLuma invalidates its token", async () => {
    let logins = 0;
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/api/login")) return Response.json({ token: `session-${++logins}` });
      if (new Headers(init?.headers).get("x-snowluma-token") === "session-1") return Response.json({ message: "expired" }, { status: 401 });
      return Response.json({ list: [processInfo()] });
    });
    const client = new SnowLumaClient({ fetcher: fetcher as typeof fetch });
    expect(await client.getProcesses("secret")).toHaveLength(1);
    expect(logins).toBe(2);
  });
  it("backs off after authentication failure instead of hammering the login endpoint", async () => {
    let now = 1000;
    const fetcher = vi.fn(async () => Response.json({ success: false, message: "密码错误" }, { status: 401 }));
    const client = new SnowLumaClient({ fetcher, now: () => now });
    await client.getSnapshot("wrong", account);
    await client.getSnapshot("wrong", account);
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += 60_001;
    await client.getSnapshot("wrong", account);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("attaches only the selected process and bounds retries", async () => {
    let now = 1000;
    const routes: string[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      routes.push(String(url));
      if (String(url).endsWith("/api/login")) return Response.json({ success: true, token: "token" });
      if (String(url).endsWith("/api/processes")) return Response.json({ list: [
        processInfo({ pid: 200, uin: "0", injected: false, connected: false, loggedIn: false, status: "available", account: { uin: "3111675", nickname: "Personal" } }),
        processInfo({ uin: "0", injected: false, connected: false, loggedIn: false, status: "available" }),
      ] });
      return Response.json({ success: true });
    });
    const client = new SnowLumaClient({ fetcher: fetcher as typeof fetch, now: () => now });
    await Promise.all([client.attachSelected("secret", account), client.attachSelected("secret", account)]);
    await client.attachSelected("secret", account);
    expect(routes.filter((route) => route.endsWith("/load"))).toEqual(["http://127.0.0.1:5099/api/processes/100/load"]);
    for (let i = 0; i < 4; i++) { now += 61_000; await client.attachSelected("secret", account); }
    expect(routes.filter((route) => route.endsWith("/load"))).toHaveLength(3);
  });
  it("refreshes a previously unidentified personal QQ at startup without loading its hook", async () => {
    const routes: string[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      routes.push(String(url));
      if (String(url).endsWith("/api/login")) return Response.json({ token: "token" });
      const unidentified = processInfo({ uin: "0", injected: false, connected: false, loggedIn: false, status: "available", account: null });
      if (String(url).endsWith("/api/processes")) return Response.json({ list: [unidentified] });
      return Response.json({ success: true, process: { ...unidentified, account: { uin: "3111675", nickname: "Personal" } } });
    });
    const client = new SnowLumaClient({ fetcher: fetcher as typeof fetch });
    const processes = await client.getProcessesForStartup("secret");
    expect(processes[0].account?.uin).toBe("3111675");
    expect(selectSnowLumaProcess(processes, account)).toBeUndefined();
    expect(routes.filter((url) => url.endsWith("/refresh"))).toHaveLength(1);
    expect(routes.some((url) => url.endsWith("/load"))).toBe(false);
  });
  it("continues after a delayed QQ login even when the process list keeps its pre-login identity", async () => {
    let now = 0;
    let loggedIn = false;
    const routes: string[] = [];
    const unidentified = processInfo({ uin: "0", injected: false, connected: false, loggedIn: false,
      status: "available", account: null });
    const personal = { ...unidentified, pid: 200, account: { uin: "3111675", nickname: "Personal" } };
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      routes.push(String(url));
      if (String(url).endsWith("/api/login")) return Response.json({ token: "token" });
      if (String(url).endsWith("/api/processes")) return Response.json({ list: [unidentified, personal] });
      if (String(url).endsWith("/refresh")) return Response.json({ success: true,
        process: { ...unidentified, account: loggedIn ? { uin: account, nickname: "辉夜" } : null } });
      return Response.json({ success: true });
    });
    const client = new SnowLumaClient({ fetcher: fetcher as typeof fetch, now: () => now });
    expect(await client.attachSelected("secret", account)).toBe(false);
    for (let i = 0; i < 3; i++) { now += 15_000; await client.attachSelected("secret", account); }
    expect(routes.filter((url) => url.endsWith("/refresh"))).toHaveLength(1);
    expect(routes.some((url) => url.endsWith("/load"))).toBe(false);
    now += 15 * 60_000;
    loggedIn = true;
    expect(await client.attachSelected("secret", account)).toBe(true);
    expect(routes.filter((url) => url.endsWith("/refresh"))).toHaveLength(2);
    expect(routes.filter((url) => url.endsWith("/load"))).toEqual(["http://127.0.0.1:5099/api/processes/100/load"]);
    expect(routes.some((url) => url.includes("/processes/200/"))).toBe(false);
  });
});

describe("SnowLuma recovery policy", () => {
  async function fixture() {
    const dir = await mkdtemp(path.join(os.tmpdir(), "snowluma-recovery-"));
    directories.push(dir);
    const manager = new NativeRuntimeManager(dir);
    await manager.initialize();
    await writeFile(path.join(manager.runtimeDir, "preferences.json"), JSON.stringify({
      launchAtLogin: false, startBotAtLogin: false, autoRecovery: true, autoLoginAccount: account, desiredRunning: true,
    }));
    const snapshot = { runtime: { stackState: "running", services: [
      { id: "astrbot", running: true }, { id: "napcat", running: true },
    ] }, stack: { services: [{ id: "astrbot", state: "ready" }, { id: "napcat", state: "ready" }] },
    acceptance: { servicesReady: true, qqSession: { state: "online", detail: "online" }, onebotConnected: true } };
    vi.spyOn(manager, "getStatus").mockResolvedValue(snapshot as Awaited<ReturnType<typeof manager.getStatus>>);
    // Private boundaries are replaced to prove no real process is touched by recovery tests.
    const internal = manager as unknown as {
      snowlumaStatus: SnowLumaClient; startServices(): Promise<{ok:boolean;message:string}>;
      stopServices(): Promise<void>; stopService(id: string): Promise<void>;
    };
    vi.spyOn(internal.snowlumaStatus, "attachSelected").mockResolvedValue(false);
    const start = vi.spyOn(internal, "startServices").mockResolvedValue({ ok: true, message: "started" });
    const stopAll = vi.spyOn(internal, "stopServices").mockResolvedValue();
    const stop = vi.spyOn(internal, "stopService").mockResolvedValue();
    return { manager, snapshot, internal, start, stopAll, stop };
  }
  it("never restarts a healthy service when QQ requires a new login, even after being online", async () => {
    const { manager, snapshot, start, stopAll, stop } = await fixture();
    await manager.recoverIfNeeded();
    snapshot.acceptance.qqSession.state = "logged-out";
    snapshot.acceptance.onebotConnected = false;
    for (let i = 0; i < 5; i++) await manager.recoverIfNeeded();
    expect(start).not.toHaveBeenCalled(); expect(stopAll).not.toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled();
  });
  it("debounces a service crash and starts missing services without killing the healthy QQ stack", async () => {
    const { manager, snapshot, start, stopAll, stop } = await fixture();
    snapshot.runtime.stackState = "partial";
    snapshot.runtime.services[0].running = false;
    snapshot.stack.services[0].state = "unreachable";
    snapshot.acceptance.servicesReady = false;
    for (let i = 0; i < 5; i++) await manager.recoverIfNeeded();
    expect(start).toHaveBeenCalledTimes(1); expect(stopAll).not.toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled();
  });
  it("does not attach or repair OneBot while automatic connection is disabled", async () => {
    const { manager, snapshot, internal, start, stop } = await fixture();
    await manager.setPreferences({ autoConnectQQ: false });
    snapshot.acceptance.onebotConnected = false;
    const api = vi.spyOn(internal.snowlumaStatus, "api");
    for (let i = 0; i < 5; i++) await manager.recoverIfNeeded();
    expect(internal.snowlumaStatus.attachSelected).not.toHaveBeenCalled();
    expect(api).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    await manager.setPreferences({ autoConnectQQ: true, autoRecovery: false });
    await manager.recoverIfNeeded();
    expect(internal.snowlumaStatus.attachSelected).toHaveBeenCalledWith(expect.any(String), account);
  });
});
