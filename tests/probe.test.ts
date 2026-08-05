import { createServer as createHttpServer } from "node:http";
import { createServer as createTcpServer } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { collectStatus, probeHttp, probeTcp } from "../src/server/probe.js";

const closers: Array<() => Promise<void>> = [];

async function listenHttp() {
  const server = createHttpServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end("ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("HTTP test server did not bind");
  closers.push(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  return address.port;
}

async function listenTcp() {
  const server = createTcpServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("TCP test server did not bind");
  closers.push(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  return address.port;
}

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

describe("service probes", () => {
  it("recognizes a reachable HTTP service", async () => {
    const port = await listenHttp();
    const result = await probeHttp("astrbot", "AstrBot", `http://127.0.0.1:${port}`, 500);

    expect(result.state).toBe("ready");
    expect(result.detail).toContain("HTTP 200");
  });

  it("marks an unavailable HTTP service as unreachable", async () => {
    const result = await probeHttp("napcat", "NapCat", "http://127.0.0.1:1", 100);

    expect(result.state).toBe("unreachable");
  });

  it("recognizes a listening OneBot TCP port", async () => {
    const port = await listenTcp();
    const result = await probeTcp("127.0.0.1", port, 500);

    expect(result.state).toBe("ready");
    expect(result.detail).toContain(String(port));
  });

  it("reports the complete stack as ready", async () => {
    const httpPort = await listenHttp();
    const tcpPort = await listenTcp();
    const result = await collectStatus({
      astrbotUrl: `http://127.0.0.1:${httpPort}`,
      napcatUrl: `http://127.0.0.1:${httpPort}`,
      onebotHost: "127.0.0.1",
      onebotPort: tcpPort,
      timeoutMs: 500,
    });

    expect(result.overall).toBe("ready");
    expect(result.services).toHaveLength(3);
  });
});
