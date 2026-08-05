import net from "node:net";

import type { ServiceProbe, StackStatus } from "./types.js";

const DEFAULT_TIMEOUT_MS = 2500;

function now() {
  return new Date().toISOString();
}

function elapsed(start: number) {
  return Math.max(0, Math.round(performance.now() - start));
}

export async function probeHttp(
  id: "napcat" | "astrbot",
  label: string,
  url: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ServiceProbe> {
  const start = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": "Rosemewbot-Console/0.5.4" },
    });
    return {
      id,
      label,
      state: "ready",
      latencyMs: elapsed(start),
      detail: `HTTP ${response.status}，服务可达`,
      checkedAt: now(),
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      id,
      label,
      state: "unreachable",
      latencyMs: elapsed(start),
      detail: aborted ? `探测超过 ${timeoutMs} ms` : "连接失败，服务可能仍在启动",
      checkedAt: now(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function probeTcp(
  host: string,
  port: number,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ServiceProbe> {
  return new Promise((resolve) => {
    const start = performance.now();
    const socket = new net.Socket();
    let settled = false;

    const finish = (state: ServiceProbe["state"], detail: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({
        id: "onebot",
        label: "OneBot 通道",
        state,
        latencyMs: elapsed(start),
        detail,
        checkedAt: now(),
      });
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish("ready", `AstrBot 正在监听 ${port} 端口`));
    socket.once("timeout", () => finish("waiting", `等待 AstrBot 监听 ${port} 端口`));
    socket.once("error", () => finish("waiting", "OneBot 适配器尚未就绪"));
    socket.connect(port, host);
  });
}

export async function collectStatus(options: {
  astrbotUrl: string;
  napcatUrl: string;
  onebotHost: string;
  onebotPort: number;
  timeoutMs?: number;
}): Promise<StackStatus> {
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const services = await Promise.all([
    probeHttp("napcat", "NapCat", options.napcatUrl, timeout),
    probeHttp("astrbot", "AstrBot", options.astrbotUrl, timeout),
    probeTcp(options.onebotHost, options.onebotPort, timeout),
  ]);

  const readyCount = services.filter((service) => service.state === "ready").length;
  const overall =
    readyCount === services.length
      ? "ready"
      : readyCount === 0
        ? "starting"
        : "attention";

  return { overall, checkedAt: now(), services };
}
