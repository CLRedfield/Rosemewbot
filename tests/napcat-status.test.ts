import { describe, expect, it, vi } from "vitest";

import { hashNapCatToken, NapCatStatusClient } from "../desktop/napcat-status";

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("NapCat real-time QQ session status", () => {
  it("hashes the managed WebUI token using NapCat's login contract", () => {
    expect(hashNapCatToken("local-secret")).toBe("3d7c1af88005c3a612fb2169b33ef94cc76e2a5b85d6adf16b762ad6ee597bab");
  });

  it("reports the live account only when NapCat confirms it is online", async () => {
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.endsWith("/api/auth/login")) {
        expect(JSON.parse(String(init?.body))).toEqual({ hash: hashNapCatToken("local-secret") });
        return jsonResponse({ code: 0, data: { Credential: "credential" } });
      }
      expect(init?.headers).toEqual(expect.objectContaining({ Authorization: "Bearer credential" }));
      if (input.endsWith("/CheckLoginStatus")) {
        return jsonResponse({ code: 0, data: { isLogin: true, isOffline: false } });
      }
      return jsonResponse({ code: 0, data: { uin: "123456789", nick: "测试猫" } });
    });
    const client = new NapCatStatusClient({ fetcher, now: () => Date.parse("2026-08-07T07:00:00.000Z") });

    await expect(client.getSession("local-secret")).resolves.toEqual({
      state: "online",
      account: "123456789",
      nickname: "测试猫",
      checkedAt: "2026-08-07T07:00:00.000Z",
      detail: "QQ 123456789 当前在线",
    });
  });

  it.each([
    [{ isLogin: false, isOffline: false }, "logged-out", "等待扫码登录 QQ"],
    [{ isLogin: false, isOffline: true }, "offline", "QQ 登录会话已掉线"],
  ] as const)("distinguishes the %s response", async (data, state, detail) => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.endsWith("/api/auth/login")) return jsonResponse({ code: 0, data: { Credential: "credential" } });
      if (input.endsWith("/CheckLoginStatus")) return jsonResponse({ code: 0, data });
      return jsonResponse({ code: 0, data: {} });
    });
    const client = new NapCatStatusClient({ fetcher });

    const result = await client.getSession("local-secret");
    expect(result).toEqual(expect.objectContaining({ state, detail, account: null }));
  });

  it("reuses the in-memory credential instead of hitting NapCat's login rate limit", async () => {
    const fetcher = vi.fn(async (input: string) => input.endsWith("/api/auth/login")
      ? jsonResponse({ code: 0, data: { Credential: "credential" } })
      : jsonResponse({ code: 0, data: { isLogin: false, isOffline: false } }));
    const client = new NapCatStatusClient({ fetcher });

    await client.getSession("local-secret");
    await client.getSession("local-secret");

    expect(fetcher.mock.calls.filter(([input]) => String(input).endsWith("/api/auth/login"))).toHaveLength(1);
  });

  it("shares an in-flight authentication across concurrent status checks", async () => {
    const fetcher = vi.fn(async (input: string) => input.endsWith("/api/auth/login")
      ? jsonResponse({ code: 0, data: { Credential: "credential" } })
      : jsonResponse({ code: 0, data: { isLogin: false, isOffline: false } }));
    const client = new NapCatStatusClient({ fetcher });

    await Promise.all([client.getSession("local-secret"), client.getSession("local-secret")]);

    expect(fetcher.mock.calls.filter(([input]) => String(input).endsWith("/api/auth/login"))).toHaveLength(1);
  });

  it("uses unknown instead of falsely reporting logged out when the live check fails", async () => {
    const fetcher = vi.fn(async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    });
    const client = new NapCatStatusClient({ fetcher });

    await expect(client.getSession("local-secret")).resolves.toEqual(expect.objectContaining({
      state: "unknown",
      detail: "读取 QQ 实时状态超时",
    }));
  });
});
