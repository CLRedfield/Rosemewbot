// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let EmbeddedCredentials: (typeof import("../src/client/App"))["EmbeddedCredentials"];

const credentials = {
  astrbotUsername: "astrbot-admin",
  astrbotPassword: "astrbot-secret",
  astrbotCredentialState: "ready" as const,
  napcatToken: "napcat-secret-token",
};

describe("embedded panel credentials", () => {
  const getCredentials = vi.fn().mockResolvedValue(credentials);
  const runAction = vi.fn().mockResolvedValue({ ok: true, message: "done" });

  beforeAll(async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
    ({ EmbeddedCredentials } = await import("../src/client/App"));
  });

  beforeEach(() => {
    getCredentials.mockClear();
    getCredentials.mockResolvedValue(credentials);
    runAction.mockClear();
    Object.defineProperty(window, "rosemewbotDesktop", {
      configurable: true,
      value: { getCredentials, runAction },
    });
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(window, "rosemewbotDesktop", {
      configurable: true,
      value: undefined,
    });
  });

  it("reveals only the NapCat token after an explicit click", async () => {
    render(<EmbeddedCredentials panel="napcat" />);

    expect(getCredentials).not.toHaveBeenCalled();
    expect(screen.queryByText(credentials.napcatToken)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "显示 NapCat 登录凭据" }));

    expect(await screen.findByText(credentials.napcatToken)).toBeInTheDocument();
    expect(screen.queryByText(credentials.astrbotUsername)).not.toBeInTheDocument();
    expect(screen.queryByText(credentials.astrbotPassword)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "隐藏 NapCat 登录凭据" }));
    expect(screen.queryByText(credentials.napcatToken)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "显示 NapCat 登录凭据" }));
    expect(await screen.findByText(credentials.napcatToken)).toBeInTheDocument();
    expect(getCredentials).toHaveBeenCalledTimes(2);
  });

  it("reveals the AstrBot username and password without exposing the NapCat token", async () => {
    render(<EmbeddedCredentials panel="astrbot" />);

    expect(screen.queryByText(credentials.astrbotUsername)).not.toBeInTheDocument();
    expect(screen.queryByText(credentials.astrbotPassword)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "显示 AstrBot 登录凭据" }));

    expect(await screen.findByText(credentials.astrbotUsername)).toBeInTheDocument();
    expect(screen.getByText(credentials.astrbotPassword)).toBeInTheDocument();
    expect(screen.queryByText(credentials.napcatToken)).not.toBeInTheDocument();
    expect(getCredentials).toHaveBeenCalledTimes(1);
  });

  it("does not expose a stale AstrBot password and can reset it", async () => {
    const rotatedCredentials = { ...credentials, astrbotPassword: "new-astrbot-secret" };
    getCredentials
      .mockResolvedValueOnce({ ...credentials, astrbotCredentialState: "out-of-sync" })
      .mockResolvedValueOnce(rotatedCredentials);
    render(<EmbeddedCredentials panel="astrbot" />);

    fireEvent.click(screen.getByRole("button", { name: "显示 AstrBot 登录凭据" }));

    expect(await screen.findByText(/旧密码无法登录/)).toBeInTheDocument();
    expect(screen.queryByText(credentials.astrbotPassword)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重置密码" }));

    expect(await screen.findByText(rotatedCredentials.astrbotPassword)).toBeInTheDocument();
    expect(screen.queryByText(credentials.astrbotPassword)).not.toBeInTheDocument();
    expect(runAction).toHaveBeenCalledWith("reset-astrbot-credentials");
  });
});
