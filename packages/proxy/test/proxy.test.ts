import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { bridgeIntegrity, createProxy } from "../src/index.js";

const BRIDGE = Buffer.from("/* bridge */");
const servers: http.Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
});

async function listen(s: http.Server): Promise<number> {
  servers.push(s);
  s.listen(0, "127.0.0.1");
  await once(s, "listening");
  return (s.address() as AddressInfo).port;
}

async function setup(
  handler: http.RequestListener = (_q, r) => r.writeHead(200, { "content-type": "text/html" }).end("<html><head></head></html>"),
) {
  const up = http.createServer(handler);
  const upPort = await listen(up);
  const proxy = createProxy({ target: { host: "127.0.0.1", port: upPort }, bridgeCode: BRIDGE, overlayUrl: "http://127.0.0.1:4001/" });
  const port = await listen(proxy);
  return { up, upPort, port };
}

describe("proxy", () => {
  it("serves the bridge script itself, never forwarding that path", async () => {
    let forwarded = false;
    const { port } = await setup((_q, r) => ((forwarded = true), r.end()));
    const r = await fetch(`http://127.0.0.1:${port}/__handoff/bridge.js`);
    expect(r.headers.get("content-type")).toMatch(/javascript/);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(Buffer.from(await r.arrayBuffer())).toEqual(BRIDGE);
    expect(forwarded).toBe(false);
  });

  it("injects a tag pointing at the bridge with SRI and the overlay URL", async () => {
    const { port } = await setup();
    const html = await (await fetch(`http://127.0.0.1:${port}/`, { headers: { accept: "text/html" } })).text();
    expect(html).toContain(
      `<script src="/__handoff/bridge.js" integrity="${bridgeIntegrity(BRIDGE)}" data-handoff-overlay="http://127.0.0.1:4001/" defer></script></head>`,
    );
  });

  it("forwards method, path, headers and body", async () => {
    let seen: Record<string, string | undefined> = {};
    const { port } = await setup((q, r) => {
      let body = "";
      q.on("data", (c) => (body += c));
      q.on("end", () => {
        seen = { method: q.method, url: q.url, host: q.headers.host, x: String(q.headers["x-test"]), body };
        r.end("ok");
      });
    });
    await fetch(`http://localhost:${port}/a/b?c=1`, { method: "POST", headers: { "x-test": "1" }, body: "hi" });
    expect(seen).toEqual({ method: "POST", url: "/a/b?c=1", host: `localhost:${port}`, x: "1", body: "hi" });
  });

  it("rejects non-loopback Host headers (DNS rebinding)", async () => {
    const { port } = await setup();
    const status = await new Promise<number>((resolve) => {
      http.get({ host: "127.0.0.1", port, path: "/", headers: { host: "evil.example" } }, (r) => resolve(r.statusCode ?? 0));
    });
    expect(status).toBe(403);
  });

  it("passes websocket upgrades through both ways (HMR)", async () => {
    const { up, port } = await setup();
    up.on("upgrade", (req, socket) => {
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nX-Path: ${req.url}\r\n\r\n`);
      socket.on("data", (d: Buffer) => socket.write(Buffer.concat([Buffer.from("echo:"), d])));
      socket.on("end", () => socket.destroy());
    });
    const sock = net.connect(port, "127.0.0.1");
    await once(sock, "connect");
    sock.write(`GET /hmr?t=1 HTTP/1.1\r\nHost: localhost:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n`);
    let got = "";
    sock.on("data", (d: Buffer) => {
      got += d.toString();
      if (got.includes("\r\n\r\n") && !got.includes("echo:")) sock.write("ping");
    });
    await new Promise<void>((resolve) => {
      const t = setInterval(() => got.includes("echo:ping") && (clearInterval(t), resolve()), 10);
    });
    sock.destroy();
    await new Promise((r) => setTimeout(r, 50));
    expect(got).toMatch(/^HTTP\/1\.1 101/);
    expect(got).toContain("X-Path: /hmr?t=1");
  });

  it("explains when the app isn't responding instead of hanging", async () => {
    const proxy = createProxy({ target: { host: "127.0.0.1", port: 1 }, bridgeCode: BRIDGE, overlayUrl: "http://127.0.0.1:4001/" });
    const port = await listen(proxy);
    const r = await fetch(`http://127.0.0.1:${port}/`, { headers: { accept: "text/html" } });
    expect(r.status).toBe(502);
    const body = await r.text();
    expect(body).toMatch(/isn.t responding/);
    expect(body).not.toMatch(/ECONNREFUSED|\n\s+at /);
  });
});
