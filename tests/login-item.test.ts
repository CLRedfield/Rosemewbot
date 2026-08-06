import { describe, expect, it } from "vitest";

import {
  syncWindowsLoginItem,
  WINDOWS_LOGIN_ITEM_ARGS,
  WINDOWS_LOGIN_ITEM_NAME,
  windowsLoginItemSettings,
  type LoginItemApp,
} from "../desktop/login-item";

const executablePath = "C:\\Rosemewbot\\Rosemewbot.exe";

describe("Windows login item registration", () => {
  it("uses a stable identity, background argument, and explicit enabled state", () => {
    expect(windowsLoginItemSettings(true, executablePath)).toEqual({
      openAtLogin: true,
      enabled: true,
      name: WINDOWS_LOGIN_ITEM_NAME,
      path: executablePath,
      args: [...WINDOWS_LOGIN_ITEM_ARGS],
    });
  });

  it("accepts only an effectively enabled registration", () => {
    const calls: unknown[] = [];
    const app: LoginItemApp = {
      isPackaged: true,
      setLoginItemSettings: (settings) => calls.push(settings),
      getLoginItemSettings: () => ({ openAtLogin: true, executableWillLaunchAtLogin: true }),
    };

    expect(syncWindowsLoginItem(app, true, executablePath, "win32")).toMatchObject({
      registered: true,
      enabled: true,
      matches: true,
      repaired: false,
    });
    expect(calls).toHaveLength(1);
  });

  it("recreates a registration that Windows has disabled", () => {
    const calls: Array<{ openAtLogin?: boolean; enabled?: boolean }> = [];
    const app: LoginItemApp = {
      isPackaged: true,
      setLoginItemSettings: (settings) => calls.push(settings),
      getLoginItemSettings: () => calls.length < 3
        ? { openAtLogin: true, executableWillLaunchAtLogin: false }
        : { openAtLogin: true, executableWillLaunchAtLogin: true },
    };

    expect(syncWindowsLoginItem(app, true, executablePath, "win32")).toMatchObject({
      matches: true,
      repaired: true,
    });
    expect(calls.map(({ openAtLogin, enabled }) => ({ openAtLogin, enabled }))).toEqual([
      { openAtLogin: true, enabled: true },
      { openAtLogin: false, enabled: false },
      { openAtLogin: true, enabled: true },
    ]);
  });

  it("verifies that disabling removes the exact background registration", () => {
    const app: LoginItemApp = {
      isPackaged: true,
      setLoginItemSettings: () => undefined,
      getLoginItemSettings: () => ({ openAtLogin: false, executableWillLaunchAtLogin: false }),
    };

    expect(syncWindowsLoginItem(app, false, executablePath, "win32")).toMatchObject({
      registered: false,
      matches: true,
    });
  });

  it("retries removal when an exact registration remains", () => {
    let writes = 0;
    const app: LoginItemApp = {
      isPackaged: true,
      setLoginItemSettings: () => { writes += 1; },
      getLoginItemSettings: () => writes < 2
        ? { openAtLogin: true, executableWillLaunchAtLogin: true }
        : { openAtLogin: false, executableWillLaunchAtLogin: false },
    };

    expect(syncWindowsLoginItem(app, false, executablePath, "win32")).toMatchObject({
      registered: false,
      matches: true,
      repaired: true,
    });
    expect(writes).toBe(2);
  });
});
