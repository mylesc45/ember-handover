import { once } from "node:events";
import { readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { createCoreServer, generateToken, loadOverlayAssets, loopbackOrigins, type AppStatus, type MeasureRequest } from "@ember-handover/core";
import { createProxy } from "@ember-handover/proxy";
import { packagesDir } from "./repo.js";

export async function listen(server: http.Server, host = "127.0.0.1"): Promise<number> {
  server.listen(0, host);
  await once(server, "listening");
  return (server.address() as AddressInfo).port;
}

export function bridgeCode(): Buffer {
  return readFileSync(join(packagesDir, "bridge", "dist", "bridge.js"));
}

export function overlayAssets() {
  return loadOverlayAssets(join(packagesDir, "overlay", "dist"));
}

/** Upstream "dev server" that answers every request with the given handler. */
export async function upstream(handler: http.RequestListener) {
  const server = http.createServer(handler);
  const port = await listen(server);
  return { server, port, close: () => new Promise<void>((r) => server.close(() => r())) };
}

export async function startStack(
  handler: http.RequestListener,
  opts: { tokens?: () => Promise<unknown>; flows?: NonNullable<Parameters<typeof createCoreServer>[0]["flows"]> } = {},
) {
  const up = await upstream(handler);
  const token = generateToken();
  const status: AppStatus = { state: "running", lines: [] };
  const measureCalls: MeasureRequest[] = [];

  // Reserve the proxy port first so the core server knows the app origins.
  const proxyServer = http.createServer();
  const proxyPort = await listen(proxyServer);
  proxyServer.close();
  const appOrigins = loopbackOrigins(proxyPort);

  const core = createCoreServer({
    token,
    appOrigins,
    assets: overlayAssets(),
    session: () => ({ version: "test", framework: "Test", appUrl: `http://127.0.0.1:${up.port}` }),
    status: () => status,
    tokens: opts.tokens ?? (async () => ({ system: "none", sources: [], spacingBase: null, breakpoints: [], tokens: [] })),
    measure: async (req) => {
      measureCalls.push(req);
      return { ok: true };
    },
    browser: async () => ({ available: false, kind: null }),
    ...(opts.flows ? { flows: opts.flows } : {}),
  });
  const corePort = await listen(core);
  const overlayUrl = `http://127.0.0.1:${corePort}/`;

  const proxy = createProxy({ target: { host: "127.0.0.1", port: up.port }, bridgeCode: bridgeCode(), overlayUrl });
  proxy.listen(proxyPort, "127.0.0.1");
  await once(proxy, "listening");

  return {
    token,
    status,
    measureCalls,
    upstreamPort: up.port,
    proxyPort,
    corePort,
    overlayUrl,
    proxyUrl: `http://localhost:${proxyPort}`,
    async close() {
      proxy.closeAllConnections();
      core.closeAllConnections();
      await Promise.all([
        new Promise((r) => proxy.close(r)),
        new Promise((r) => core.close(r)),
        up.close(),
      ]);
    },
  };
}

/** Raw HTTP request so tests can set Host and other forbidden-in-fetch headers. */
export function rawRequest(
  port: number,
  opts: { method?: string; path?: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; headers: http.IncomingHttpHeaders; rawHeaders: string[]; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method: opts.method ?? "GET", path: opts.path ?? "/", headers: opts.headers, agent: false },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, rawHeaders: res.rawHeaders, body: Buffer.concat(chunks) }),
        );
      },
    );
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}
