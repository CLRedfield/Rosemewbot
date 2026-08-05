// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { copyTextToClipboard } from "../src/client/clipboard";

describe("copyTextToClipboard", () => {
  afterEach(() => {
    delete window.rosemewbotDesktop;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    vi.restoreAllMocks();
  });

  it("uses the Electron native clipboard when running in the desktop app", async () => {
    const copyText = vi.fn().mockResolvedValue(true);
    window.rosemewbotDesktop = { copyText } as unknown as NonNullable<Window["rosemewbotDesktop"]>;

    await expect(copyTextToClipboard("本机凭据")).resolves.toBe(true);
    expect(copyText).toHaveBeenCalledWith("本机凭据");
  });

  it("uses the browser clipboard when the desktop bridge is unavailable", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    await expect(copyTextToClipboard("测试消息")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("测试消息");
  });

  it("falls back to the selection-based copy command when browser writes fail", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("permission denied"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.assign(document, { execCommand });

    await expect(copyTextToClipboard("兼容模式")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });
});
