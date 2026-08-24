import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash, pbkdf2Sync } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  COMPONENT_POLICY,
  NativeRuntimeManager,
  buildComponentMaintenancePlan,
  buildNapCatLaunchArgs,
  buildNapCatOneBotConfig,
  buildNapCatWebUiConfig,
  buildGitHubReleaseDownloadUrl,
  downloadFile,
  findNapCatAccountFromNames,
  getComponentCompatibilityStatus,
  getAstrBotCredentialState,
  hasManagedNapCatConnection,
  inspectAstrBotConfig,
  isValidDashboardPassword,
  verifyAstrBotDashboardPassword,
  isValidQQAccount,
  orderDownloadSourcesByHealth,
  parseQQDisplayVersion,
  parseNetstatConnections,
  parseProcessIds,
  parseQQInstallPath,
  probeDownloadSources,
  reconcileAstrBotConfig,
  reconcileNapCatOneBotConfig,
} from "../desktop/native-runtime";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((target) => rm(target, { recursive: true, force: true })));
});

describe("Windows native runtime configuration", () => {
  it("reads a quoted QQ uninstall path from the registry", () => {
    const output = [
      "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\QQ",
      "    UninstallString    REG_SZ    \"C:\\Program Files\\Tencent\\QQNT\\Uninstall.exe\" /uninstall",
    ].join("\r\n");

    expect(parseQQInstallPath(output)).toBe(path.join("C:\\Program Files\\Tencent\\QQNT", "QQ.exe"));
  });

  it("reads an unquoted QQ uninstall path containing spaces", () => {
    const output = "    UninstallString    REG_SZ    C:\\Program Files\\Tencent\\QQNT\\Uninstall.exe /S";
    expect(parseQQInstallPath(output)).toBe(path.join("C:\\Program Files\\Tencent\\QQNT", "QQ.exe"));
  });

  it("adds a validated QQ account to NapCat's official quick-login arguments", () => {
    expect(buildNapCatLaunchArgs("C:\\QQ\\QQ.exe", "C:\\NapCat\\Hook.dll", "123456789")).toEqual([
      "C:\\QQ\\QQ.exe",
      "C:\\NapCat\\Hook.dll",
      "123456789",
    ]);
    expect(buildNapCatLaunchArgs("C:\\QQ\\QQ.exe", "C:\\NapCat\\Hook.dll", null)).toHaveLength(2);
    expect(isValidQQAccount("123456789")).toBe(true);
    expect(isValidQQAccount("1234-invalid")).toBe(false);
  });

  it("keeps the NapCat WebUI local and protected by a token", () => {
    expect(buildNapCatWebUiConfig("local-secret")).toEqual({
      host: "127.0.0.1",
      port: 6099,
      token: "local-secret",
      loginRate: 3,
    });
  });

  it("connects NapCat to AstrBot over the local reverse WebSocket", () => {
    const config = buildNapCatOneBotConfig();
    expect(config.network.websocketClients).toContainEqual(expect.objectContaining({
      enable: true,
      url: "ws://127.0.0.1:6199/ws",
    }));
    expect(config.network.httpServers).toEqual([]);
    expect(config.network.websocketServers).toEqual([]);
  });

  it("rejects legacy dashboard passwords that AstrBot cannot initialize", () => {
    expect(isValidDashboardPassword("lowercase-only-123")).toBe(false);
    expect(isValidDashboardPassword("UPPERCASE-ONLY-123")).toBe(false);
    expect(isValidDashboardPassword("Aq7-long-random-secret")).toBe(true);
  });

  it("detects when an imported AstrBot config replaced the managed dashboard password", () => {
    const password = "Aq7-managed-secret";
    const salt = "00112233445566778899aabbccddeeff";
    const iterations = 1_000;
    const digest = pbkdf2Sync(password, Buffer.from(salt, "hex"), iterations, 32, "sha256").toString("hex");
    const matchingConfig = {
      dashboard: {
        username: "astrbot",
        password: createHash("md5").update(password).digest("hex"),
        pbkdf2_password: `pbkdf2_sha256$${iterations}$${salt}$${digest}`,
      },
    };

    expect(verifyAstrBotDashboardPassword(matchingConfig.dashboard.pbkdf2_password, password)).toBe(true);
    expect(getAstrBotCredentialState(matchingConfig, "astrbot", password)).toBe("ready");
    expect(getAstrBotCredentialState(matchingConfig, "astrbot", "Aq7-imported-secret")).toBe("out-of-sync");
    expect(getAstrBotCredentialState({}, "astrbot", password)).toBe("pending");
  });

  it("recognizes an established OneBot connection from Windows netstat output", () => {
    const output = [
      "  TCP    127.0.0.1:6199       0.0.0.0:0              LISTENING       1200",
      "  TCP    127.0.0.1:6199       127.0.0.1:53142        ESTABLISHED     1200",
      "  TCP    127.0.0.1:53142      127.0.0.1:6199         ESTABLISHED     2400",
    ].join("\r\n");

    expect(parseNetstatConnections(output)).toContainEqual(expect.objectContaining({
      localPort: 6199,
      remotePort: 53142,
      state: "ESTABLISHED",
      pid: 1200,
    }));
  });

  it("detects the QQ account from NapCat account-specific config names", () => {
    expect(findNapCatAccountFromNames(["napcat.json", "onebot11.json", "onebot11_123456789.json"])).toBe("123456789");
    expect(findNapCatAccountFromNames(["napcat.json", "onebot11.json"])).toBeNull();
  });

  it("persists the selected quick-login account without storing a password", async () => {
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), "rosemewbot-preferences-"));
    temporaryDirectories.push(userDataDir);
    const manager = new NativeRuntimeManager(userDataDir);
    await manager.initialize();

    await expect(manager.setPreferences({ autoLoginAccount: "123456789" })).resolves.toMatchObject({
      autoLoginAccount: "123456789",
    });
    await expect(manager.getPreferences()).resolves.toMatchObject({ autoLoginAccount: "123456789" });
    const stored = JSON.parse(await readFile(path.join(manager.runtimeDir, "preferences.json"), "utf8"));
    expect(stored).toMatchObject({ autoLoginAccount: "123456789" });
    expect(JSON.stringify(stored)).not.toMatch(/password/i);
  });

  it("automatically recognizes OneBot and the default AstrBot model", () => {
    const result = inspectAstrBotConfig({
      platform: [{ id: "agent-space-qq", type: "aiocqhttp", enable: true, ws_reverse_port: 6199 }],
      provider: [{ id: "deepseek-chat", enable: true, model: "deepseek-chat" }],
      provider_settings: { enable: true, default_provider_id: "deepseek-chat" },
    });

    expect(result).toEqual({
      onebotConfigured: true,
      modelConfigured: true,
      modelName: "deepseek-chat",
    });
  });

  it("migrates the legacy managed AstrBot platform to Rosemewbot", () => {
    const result = reconcileAstrBotConfig({
      timezone: "Asia/Shanghai",
      platform: [
        { id: "user-platform", type: "aiocqhttp", enable: false, ws_reverse_port: 7000 },
        { id: "agent-space-qq", type: "aiocqhttp", enable: false, ws_reverse_port: 7001, custom: "keep" },
      ],
    });
    const platforms = result.platform as Array<Record<string, unknown>>;

    expect(platforms[0]).toEqual(expect.objectContaining({ id: "user-platform", enable: false, ws_reverse_port: 7000 }));
    expect(platforms[1]).toEqual(expect.objectContaining({
      id: "rosemewbot-qq",
      enable: true,
      ws_reverse_host: "127.0.0.1",
      ws_reverse_port: 6199,
      custom: "keep",
    }));
    expect(result.timezone).toBe("Asia/Shanghai");
  });

  it("preserves user NapCat clients while repairing the managed connection", () => {
    const result = reconcileNapCatOneBotConfig({
      network: {
        websocketClients: [
          { name: "User client", enable: true, url: "ws://127.0.0.1:7000/ws" },
          { name: "Agent Space · AstrBot", enable: false, url: "ws://127.0.0.1:7001/ws", custom: "keep" },
        ],
      },
    });
    const network = result.network as Record<string, unknown>;
    const clients = network.websocketClients as Array<Record<string, unknown>>;

    expect(clients).toHaveLength(2);
    expect(clients[0]).toEqual(expect.objectContaining({ name: "User client", url: "ws://127.0.0.1:7000/ws" }));
    expect(clients[1]).toEqual(expect.objectContaining({
      name: "Rosemewbot · AstrBot",
      enable: true,
      url: "ws://127.0.0.1:6199/ws",
      custom: "keep",
    }));
    expect(hasManagedNapCatConnection(result)).toBe(true);
  });

  it("evaluates locked component and QQ versions", () => {
    expect(getComponentCompatibilityStatus("AstrBot v4.27.3", COMPONENT_POLICY.astrbot.version, true)).toBe("compatible");
    expect(getComponentCompatibilityStatus("4.26.0", COMPONENT_POLICY.astrbot.version, true)).toBe("update-available");
    expect(getComponentCompatibilityStatus(null, COMPONENT_POLICY.astrbot.version, true)).toBe("unknown");
    expect(parseQQDisplayVersion("    DisplayVersion    REG_SZ    9.9.26.44343")).toBe("9.9.26.44343");
  });

  it("updates only components that differ from the stable policy", () => {
    expect(buildComponentMaintenancePlan({
      astrbotVersion: "4.27.2",
      napcatVersion: COMPONENT_POLICY.napcat.version,
      uvVersion: COMPONENT_POLICY.uv.version,
    }, { astrbot: true, napcat: true, uv: true }, "update")).toEqual({
      astrbot: true,
      napcat: false,
      uv: false,
    });
    expect(buildComponentMaintenancePlan({}, { astrbot: false, napcat: false, uv: false }, "repair")).toEqual({
      astrbot: true,
      napcat: true,
      uv: true,
    });
  });

  it("parses unique positive process IDs from PowerShell output", () => {
    expect(parseProcessIds("21232\r\n49576\r\n21232\r\ninvalid\r\n0\r\n")).toEqual([21232, 49576]);
  });

  it("uses locked direct URLs without requiring the GitHub releases API", () => {
    expect(buildGitHubReleaseDownloadUrl("NapNeko/NapCatQQ", "v4.18.19", "NapCat.Shell.zip")).toBe(
      "https://github.com/NapNeko/NapCatQQ/releases/download/v4.18.19/NapCat.Shell.zip",
    );
    expect(COMPONENT_POLICY.uv.downloadSources?.map((source) => source.name)).toEqual([
      "GitHub 官方",
      "Astral 官方分发",
    ]);
    expect(COMPONENT_POLICY.napcat.downloadSources?.[0]?.url).not.toContain("api.github.com");
  });

  it("probes real download responses and falls back to a healthy source", async () => {
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), "rosemewbot-download-"));
    temporaryDirectories.push(userDataDir);
    const payload = Buffer.from("verified component archive", "utf8");
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(request.url ?? "/");
      if (request.url === "/primary") {
        response.writeHead(503, { "Retry-After": "0" });
        response.end("temporarily unavailable");
        return;
      }
      response.writeHead(request.headers.range ? 206 : 200, {
        "Content-Length": request.headers.range ? 1 : payload.length,
        "Content-Range": `bytes 0-${request.headers.range ? 0 : payload.length - 1}/${payload.length}`,
      });
      response.end(request.headers.range ? payload.subarray(0, 1) : payload);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const { port } = server.address() as AddressInfo;
      const primary = { name: "主源", url: `http://127.0.0.1:${port}/primary` };
      const fallback = { name: "备用源", url: `http://127.0.0.1:${port}/fallback` };
      const health = await probeDownloadSources([primary, fallback], 2_000);
      expect(health).toEqual([
        expect.objectContaining({ name: "主源", ok: false, statusCode: 503 }),
        expect.objectContaining({ name: "备用源", ok: true, statusCode: 206 }),
      ]);

      const target = path.join(userDataDir, "component.zip");
      const firstDownload = await downloadFile([primary, fallback], target, () => undefined, {
        sha256: createHash("sha256").update(payload).digest("hex"),
        maxAttempts: 3,
        retryDelaysMs: [0, 0],
        inactivityTimeoutMs: 1_000,
        totalTimeoutMs: 2_000,
      });

      expect(firstDownload).toMatchObject({ cached: false, source: fallback });
      await expect(readFile(target)).resolves.toEqual(payload);
      await expect(readFile(`${target}.part`)).rejects.toMatchObject({ code: "ENOENT" });
      expect(requests.filter((url) => url === "/primary").length).toBeGreaterThanOrEqual(2);
      expect(requests).toContain("/fallback");

      const requestsAfterDownload = requests.length;
      const cachedDownload = await downloadFile([primary, fallback], target, () => undefined, {
        sha256: createHash("sha256").update(payload).digest("hex"),
      });
      expect(cachedDownload).toEqual({ cached: true, source: null });
      expect(requests).toHaveLength(requestsAfterDownload);

      await writeFile(target, "corrupted cache", "utf8");
      const replacement = await downloadFile([fallback], target, () => undefined, {
        sha256: createHash("sha256").update(payload).digest("hex"),
        retryDelaysMs: [0],
        inactivityTimeoutMs: 1_000,
        totalTimeoutMs: 2_000,
      });
      expect(replacement.cached).toBe(false);
      await expect(readFile(target)).resolves.toEqual(payload);
      expect(requests.length).toBeGreaterThan(requestsAfterDownload);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("restores component files from the last-good snapshot", async () => {
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), "rosemewbot-compat-"));
    temporaryDirectories.push(userDataDir);
    const manager = new NativeRuntimeManager(userDataDir);
    await manager.initialize();
    const runtimeDir = manager.runtimeDir;
    const files = {
      astrbotData: path.join(runtimeDir, "astrbot", "data", "marker.txt"),
      napcat: path.join(runtimeDir, "napcat", "NapCatWinBootMain.exe"),
      napcatMarker: path.join(runtimeDir, "napcat", "marker.txt"),
      astrbotExecutable: path.join(runtimeDir, "bin", "astrbot.exe"),
      toolMarker: path.join(runtimeDir, "tools", "marker.txt"),
      manifest: path.join(runtimeDir, "manifest.json"),
    };
    await Promise.all([
      mkdir(path.dirname(files.astrbotData), { recursive: true }),
      mkdir(path.dirname(files.napcat), { recursive: true }),
      mkdir(path.dirname(files.astrbotExecutable), { recursive: true }),
      mkdir(path.dirname(files.toolMarker), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(files.astrbotData, "old-data", "utf8"),
      writeFile(files.napcat, "old-launcher", "utf8"),
      writeFile(files.napcatMarker, "old-napcat", "utf8"),
      writeFile(files.astrbotExecutable, "old-astrbot", "utf8"),
      writeFile(files.toolMarker, "old-tools", "utf8"),
      writeFile(files.manifest, JSON.stringify({ astrbotVersion: "4.26.0", napcatVersion: "v4.18.13", uvVersion: "0.12.0" }), "utf8"),
    ]);

    const snapshot = await manager.createCompatibilitySnapshot("update");
    expect(snapshot?.versions).toEqual({ astrbot: "4.26.0", napcat: "4.18.13", uv: "0.12.0" });
    await Promise.all([
      writeFile(files.astrbotData, "new-data", "utf8"),
      writeFile(files.napcatMarker, "new-napcat", "utf8"),
      writeFile(files.toolMarker, "new-tools", "utf8"),
    ]);

    const result = await manager.runAction("rollback");
    expect(result.ok).toBe(true);
    await expect(readFile(files.astrbotData, "utf8")).resolves.toBe("old-data");
    await expect(readFile(files.napcatMarker, "utf8")).resolves.toBe("old-napcat");
    await expect(readFile(files.toolMarker, "utf8")).resolves.toBe("old-tools");
  });

  it("prefers a healthy lower-latency download source", () => {
    const slow = { name: "慢源", url: "https://slow.example/component.zip" };
    const fast = { name: "快源", url: "https://fast.example/component.zip" };
    const unavailable = { name: "不可用源", url: "https://down.example/component.zip" };
    expect(orderDownloadSourcesByHealth([slow, unavailable, fast], [
      { ...slow, ok: true, latencyMs: 800, statusCode: 206, finalUrl: slow.url, error: null },
      { ...unavailable, ok: false, latencyMs: 10, statusCode: 503, finalUrl: null, error: "HTTP 503" },
      { ...fast, ok: true, latencyMs: 80, statusCode: 206, finalUrl: fast.url, error: null },
    ])).toEqual([fast, slow, unavailable]);
  });

  it("omits unrelated environments from a component-specific snapshot", async () => {
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), "rosemewbot-partial-snapshot-"));
    temporaryDirectories.push(userDataDir);
    const manager = new NativeRuntimeManager(userDataDir);
    await manager.initialize();
    const runtimeDir = manager.runtimeDir;
    await Promise.all([
      mkdir(path.join(runtimeDir, "napcat"), { recursive: true }),
      mkdir(path.join(runtimeDir, "tools"), { recursive: true }),
      writeFile(path.join(runtimeDir, "manifest.json"), JSON.stringify({ napcatVersion: "v4.18.13" }), "utf8"),
    ]);
    await Promise.all([
      writeFile(path.join(runtimeDir, "napcat", "NapCatWinBootMain.exe"), "launcher", "utf8"),
      writeFile(path.join(runtimeDir, "tools", "large-environment.txt"), "keep-live", "utf8"),
    ]);

    await manager.createCompatibilitySnapshot("update", { astrbot: false, napcat: true, uv: false });
    await expect(readFile(path.join(runtimeDir, "snapshots", "last-good", "napcat", "NapCatWinBootMain.exe"), "utf8"))
      .resolves.toBe("launcher");
    await expect(readFile(path.join(runtimeDir, "snapshots", "last-good", "tools", "large-environment.txt"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });
});
