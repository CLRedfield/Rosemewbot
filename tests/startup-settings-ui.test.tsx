// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultStartupPreferences } from "../desktop/startup-policy";
import type { DesktopPreferences, DesktopRuntimeState } from "../src/client/types";

let SettingsView: (typeof import("../src/client/App"))["SettingsView"];
let preferences: DesktopPreferences;
const setPreferences = vi.fn(async (next: Partial<DesktopPreferences>) => (preferences = { ...preferences, ...next }));

beforeAll(async () => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn().mockReturnValue({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }) });
  ({ SettingsView } = await import("../src/client/App"));
});
beforeEach(() => {
  preferences = { ...defaultStartupPreferences, autoLoginAccount: "2056798478" };
  setPreferences.mockClear();
  Object.defineProperty(window, "rosemewbotDesktop", { configurable: true, value: {
    getAppVersion: vi.fn().mockResolvedValue("0.6.6"), setPreferences,
    getQQLoginAccounts: vi.fn().mockResolvedValue([]),
  } });
});
afterEach(() => { cleanup(); Object.defineProperty(window, "rosemewbotDesktop", { configurable: true, value: undefined }); });

function show() {
  return render(<SettingsView runtime={{ preferences, services: [] } as unknown as DesktopRuntimeState}
    theme="dark" onThemeChange={vi.fn()} fontScale="comfortable" onFontScaleChange={vi.fn()} onRefresh={vi.fn()} />);
}

describe("startup settings", () => {
  it("saves the independent automatic-login and connection choices", async () => {
    show();
    fireEvent.click(screen.getByRole("switch", { name: /^自动登录 SnowLuma/ }));
    await waitFor(() => expect(screen.getByRole("switch", { name: /^自动登录 SnowLuma/ })).toHaveAttribute("aria-checked", "false"));
    expect(setPreferences).toHaveBeenLastCalledWith({ autoLoginSnowLuma: false });
    fireEvent.click(screen.getByRole("switch", { name: /^自动连接指定 QQ/ }));
    await waitFor(() => expect(screen.getByRole("switch", { name: /^自动连接指定 QQ/ })).toHaveAttribute("aria-checked", "false"));
    expect(setPreferences).toHaveBeenLastCalledWith({ autoConnectQQ: false });
    expect(screen.getByRole("switch", { name: /^自动启动 QQ/ })).toHaveAttribute("aria-checked", "true");
  });

  it("can choose the bot while QQ is stopped and rejects malformed account input", async () => {
    preferences.autoLoginAccount = null;
    show();
    expect(screen.getByRole("switch", { name: /^自动连接指定 QQ/ })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "手动指定 QQ 号" }), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(setPreferences).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "手动指定 QQ 号" }), { target: { value: "2056798478" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: /^自动连接指定 QQ/ })).toBeEnabled());
    expect(setPreferences).toHaveBeenLastCalledWith({ autoLoginAccount: "2056798478" });
  });
});
