// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let EmbeddedCredentials: (typeof import("../src/client/App"))["EmbeddedCredentials"];

const credentials = {
  astrbotUsername: "astrbot-admin",
  astrbotPassword: "astrbot-secret",
  napcatToken: "napcat-secret-token",
};

describe("embedded panel credentials", () => {
  const getCredentials = vi.fn().mockResolvedValue(credentials);

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
    Object.defineProperty(window, "rosemewbotDesktop", {
      configurable: true,
      value: { getCredentials },
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
    expect(getCredentials).toHaveBeenCalledTimes(1);
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
});
