import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeRuntimeManager } from "../desktop/native-runtime";
import { defaultStartupPreferences, shouldStartBotOnLaunch } from "../desktop/startup-policy";
import { MANAGED_CONNECTION_NAME, SnowLumaClient, type SnowLumaProcess } from "../desktop/snowluma";

const directories: string[] = [];
const account = "2056798478";
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "rosemewbot-startup-"));
  directories.push(dir);
  const manager = new NativeRuntimeManager(dir);
  await manager.initialize();
  const internal = manager as unknown as {
    snowlumaStatus: SnowLumaClient;
    qqLaunchPending: boolean;
    advanceQQStartup(preferences: unknown): Promise<void>;
    openQQ(): Promise<{ ok: boolean; message: string }>;
    managedProcessRunning(): Promise<boolean>;
    configureSnowLuma(): Promise<void>;
  };
  return { manager, internal, file: path.join(manager.runtimeDir, "preferences.json") };
}

describe("optional startup steps", () => {
  it("keeps Windows startup independent from opening the console manually", () => {
    const preferences = { ...defaultStartupPreferences, startBotAtLogin: true };
    expect(shouldStartBotOnLaunch(preferences, true)).toBe(true);
    expect(shouldStartBotOnLaunch(preferences, false)).toBe(false);
    preferences.startBotAtLogin = false;
    preferences.startBotOnLaunch = true;
    expect(shouldStartBotOnLaunch(preferences, false)).toBe(true);
    expect(shouldStartBotOnLaunch(preferences, true)).toBe(false);
  });

  it("migrates old preferences and persists each switch without exposing credentials", async () => {
    const { manager, file } = await fixture();
    await writeFile(file, JSON.stringify({ launchAtLogin: true, startBotAtLogin: true,
      autoLoginAccount: account, autoRecovery: false, desiredRunning: true }));
    expect(await manager.getPreferences()).toMatchObject({ autoLoginAccount: account,
      autoLoginSnowLuma: true, autoStartQQ: true, autoConnectQQ: true, startBotOnLaunch: false, autoRecovery: false });
    await manager.setPreferences({ autoLoginSnowLuma: false, autoStartQQ: false, autoConnectQQ: false,
      startBotOnLaunch: true, launchAtLogin: false });
    const stored = JSON.parse(await readFile(file, "utf8"));
    expect(stored).toMatchObject({ autoLoginSnowLuma: false, autoStartQQ: false, autoConnectQQ: false,
      startBotOnLaunch: true, startBotAtLogin: false, autoLoginAccount: account, desiredRunning: true });
    const { desiredRunning: _desiredRunning, ...publicPreferences } = stored;
    expect(await new NativeRuntimeManager(path.dirname(manager.runtimeDir)).getPreferences()).toEqual(publicPreferences);
    expect(JSON.stringify(stored)).not.toMatch(/password|secret|token/i);
  });

  it("disables only the managed connection and applies the change to a running bridge", async () => {
    const { manager, internal } = await fixture();
    await manager.setPreferences({ autoLoginAccount: account });
    const configRoot = path.join(manager.runtimeDir, "snowluma", "config");
    await mkdir(configRoot, { recursive: true });
    await writeFile(path.join(manager.runtimeDir, "snowluma", "index.mjs"), "// test");
    const custom = { name: "custom", enabled: true, url: "ws://localhost:9000" };
    await writeFile(path.join(configRoot, `onebot_${account}.json`), JSON.stringify({
      historySync: { enabled: true }, networks: { wsClients: [custom] },
    }));
    vi.spyOn(internal, "managedProcessRunning").mockResolvedValue(true);
    const detach = vi.spyOn(internal.snowlumaStatus, "detachSelected").mockResolvedValue();
    const api = vi.spyOn(internal.snowlumaStatus, "api").mockResolvedValue({ success: true });
    await manager.setPreferences({ autoConnectQQ: false });
    expect(detach).toHaveBeenCalledWith(expect.any(String), account);
    const config = JSON.parse(await readFile(path.join(configRoot, `onebot_${account}.json`), "utf8"));
    expect(config.networks.wsClients).toEqual([custom, expect.objectContaining({ name: MANAGED_CONNECTION_NAME, enabled: false })]);
    expect(config.historySync.enabled).toBe(true);
    expect(api).toHaveBeenCalledWith(expect.any(String), `/api/config/${account}`, expect.objectContaining({ networks: config.networks }));
    await manager.setPreferences({ autoConnectQQ: true });
    expect(api.mock.calls.at(-1)?.[2]).toMatchObject({ networks: { wsClients: [custom,
      expect.objectContaining({ name: MANAGED_CONNECTION_NAME, enabled: true })] } });
  });

  it("does not let persisted recovery intent bypass a disabled cold-start switch", async () => {
    const { manager, internal, file } = await fixture();
    await writeFile(file, JSON.stringify({ ...defaultStartupPreferences, desiredRunning: true }));
    vi.spyOn(internal, "managedProcessRunning").mockResolvedValue(false);
    await manager.prepareApplicationLaunch(false);
    expect(JSON.parse(await readFile(file, "utf8")).desiredRunning).toBe(false);
    expect(await manager.recoverIfNeeded()).toMatchObject({ recovered: false, message: "无需恢复" });
  });

  it("does not launch QQ when disabled and waits for an available inventory before a single launch", async () => {
    const { internal } = await fixture();
    const preferences = { ...defaultStartupPreferences, autoLoginAccount: account };
    const open = vi.spyOn(internal, "openQQ").mockResolvedValue({ ok: true, message: "opened" });
    const list = vi.spyOn(internal.snowlumaStatus, "getProcessesForStartup").mockRejectedValueOnce(new Error("starting"))
      .mockResolvedValue([]);
    internal.qqLaunchPending = true;
    await internal.advanceQQStartup({ ...preferences, autoStartQQ: false });
    expect(list).not.toHaveBeenCalled();
    await expect(internal.advanceQQStartup(preferences)).rejects.toThrow("starting");
    expect(open).not.toHaveBeenCalled();
    expect(internal.qqLaunchPending).toBe(true);
    await internal.advanceQQStartup(preferences);
    await internal.advanceQQStartup(preferences);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it.each(["selected", "login"])("reuses the %s QQ window instead of launching duplicates", async (kind) => {
    const { internal } = await fixture();
    const open = vi.spyOn(internal, "openQQ");
    vi.spyOn(internal.snowlumaStatus, "getProcessesForStartup").mockResolvedValue([{
      pid: 100, path: "QQ.exe", uin: "0", account: kind === "selected" ? { uin: account, nickname: "辉夜" } : null,
      injected: false, connected: false, loggedIn: false, status: "available",
    } satisfies SnowLumaProcess]);
    internal.qqLaunchPending = true;
    await internal.advanceQQStartup({ ...defaultStartupPreferences, autoLoginAccount: account });
    expect(open).not.toHaveBeenCalled();
    expect(internal.qqLaunchPending).toBe(false);
  });
});
