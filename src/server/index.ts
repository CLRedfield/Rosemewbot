import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { collectStatus } from "./probe.js";
import type { PublicConfig } from "./types.js";

const moduleDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const projectRoot = resolve(moduleDir, "../..");
const staticRoot = resolve(projectRoot, "dist");
const port = Number.parseInt(process.env.PORT ?? "4173", 10);
const host = process.env.HOST ?? "127.0.0.1";

const internal = {
  astrbotUrl: process.env.ASTRBOT_INTERNAL_URL ?? "http://127.0.0.1:6185",
  napcatUrl: process.env.NAPCAT_INTERNAL_URL ?? "http://127.0.0.1:6099",
  onebotHost: process.env.ONEBOT_HOST ?? "127.0.0.1",
  onebotPort: Number.parseInt(process.env.ONEBOT_PORT ?? "6199", 10),
  timeoutMs: Number.parseInt(process.env.STATUS_TIMEOUT_MS ?? "2500", 10),
};

const publicConfig: PublicConfig = {
  astrbotUrl: process.env.PUBLIC_ASTRBOT_URL ?? "http://localhost:6185",
  napcatUrl: process.env.PUBLIC_NAPCAT_URL ?? "http://localhost:6099/webui",
  onebotUrl: "ws://127.0.0.1:6199/ws",
  bindMode: (process.env.BIND_HOST ?? "127.0.0.1") === "127.0.0.1" ? "local" : "network",
};

const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function securityHeaders(response: ServerResponse) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
}

function json(response: ServerResponse, status: number, body: unknown) {
  securityHeaders(response);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function serveStatic(request: IncomingMessage, response: ServerResponse) {
  const rawPath = new URL(request.url ?? "/", "http://localhost").pathname;
  const requested = rawPath === "/" ? "/index.html" : rawPath;
  const safePath = normalize(requested)
    .replace(/^[/\\]+/, "")
    .replace(/^(\.\.(\/|\\|$))+/, "");
  let filePath = join(staticRoot, safePath);

  if (!filePath.startsWith(staticRoot) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(staticRoot, "index.html");
  }

  securityHeaders(response);
  response.writeHead(200, {
    "Content-Type": mimeTypes[extname(filePath)] ?? "application/octet-stream",
    "Cache-Control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
  });
  createReadStream(filePath).pipe(response);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (request.method === "GET" && url.pathname === "/api/health") {
    json(response, 200, { status: "ok", service: "rosemewbot-console" });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/config") {
    json(response, 200, publicConfig);
    return;
  }

  if ((request.method === "GET" || request.method === "POST") && url.pathname === "/api/status") {
    const status = await collectStatus(internal);
    json(response, 200, status);
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    json(response, 404, { error: "not_found" });
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    json(response, 405, { error: "method_not_allowed" });
    return;
  }

  serveStatic(request, response);
});

server.listen(port, host, () => {
  console.log(`Rosemewbot Console listening on http://${host}:${port}`);
});
