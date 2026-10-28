import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { SnowLumaPanelSession } from "../desktop/snowluma-panel-session";

function fixture() {
  const localStorage = new Map<string, string>();
  const state = { enabled: true, origin: "http://127.0.0.1:5099" };
  const token = vi.fn().mockResolvedValue("fresh-token");
  const contents = {
    isDestroyed: () => false,
    getURL: () => `${state.origin}/`,
    executeJavaScript: vi.fn(async (code: string) => runInNewContext(code, {
      location: { origin: state.origin },
      localStorage: { getItem: (key: string) => localStorage.get(key) ?? null,
        setItem: (key: string, value: string) => localStorage.set(key, value), removeItem: (key: string) => localStorage.delete(key) },
    })),
    reload: vi.fn(),
  };
  const session = new SnowLumaPanelSession({ origin: state.origin, enabled: async () => state.enabled, token });
  return { session, contents, localStorage, state, token };
}

describe("optional embedded SnowLuma authentication", () => {
  it("restores a missing page token and refreshes a rotated token without a reload loop", async () => {
    const { session, contents, localStorage, token } = fixture();
    await session.sync(contents);
    await session.sync(contents);
    expect(contents.reload).toHaveBeenCalledTimes(1);
    localStorage.delete("snowluma_token");
    await session.sync(contents);
    expect(localStorage.get("snowluma_token")).toBe("fresh-token");
    token.mockResolvedValue("rotated-token");
    await session.sync(contents);
    expect(contents.reload).toHaveBeenCalledTimes(3);
    expect(localStorage.get("snowluma_token")).toBe("rotated-token");
  });

  it("removes its automatic session on disable while preserving a later manual login", async () => {
    const { session, contents, localStorage, state, token } = fixture();
    await session.sync(contents);
    state.enabled = false;
    await session.sync(contents);
    expect(localStorage.has("snowluma_token")).toBe(false);
    localStorage.set("snowluma_token", "manual-token");
    await session.sync(contents);
    expect(localStorage.get("snowluma_token")).toBe("manual-token");
    expect(token).toHaveBeenCalledTimes(1);
  });

  it("does not seed any credential if disabled or navigated away during authentication", async () => {
    for (const change of ["disable", "navigate"]) {
      const { session, contents, state, token } = fixture();
      token.mockImplementation(async () => {
        if (change === "disable") state.enabled = false;
        else state.origin = "https://example.com";
        return "secret";
      });
      await session.sync(contents);
      expect(contents.executeJavaScript).not.toHaveBeenCalled();
      expect(contents.reload).not.toHaveBeenCalled();
    }
  });
});
