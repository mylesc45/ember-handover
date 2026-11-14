// S3 — Malicious website calls the local API (CSRF, DNS rebinding).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rawRequest, startStack } from "./lib/servers.js";

let stack: Awaited<ReturnType<typeof startStack>>;
beforeAll(async () => {
  stack = await startStack((_req, res) => res.end("<html><head></head><body>app</body></html>"));
});
afterAll(() => stack.close());

const api = (headers: Record<string, string>, extra: { method?: string; path?: string; body?: string } = {}) =>
  rawRequest(stack.corePort, {
    path: "/api/session",
    ...extra,
    headers: { host: `127.0.0.1:${stack.corePort}`, ...headers },
  });

describe("S3 local API rejects cross-site and rebinding requests", () => {
  it("accepts a same-origin request with the session token", async () => {
    const r = await api({ "x-handoff-token": stack.token });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body.toString())).toMatchObject({ framework: "Test" });
  });

  it.each(["evil.example", "evil.example:4001", "127.0.0.1.nip.io", "localhost.evil.example", "0.0.0.0", "[::ffff:7f00:1]"])(
    "rejects Host %s (DNS rebinding) on the API and the overlay page",
    async (host) => {
      expect((await api({ host, "x-handoff-token": stack.token })).status).toBe(403);
      expect((await rawRequest(stack.corePort, { path: "/", headers: { host } })).status).toBe(403);
    },
  );

  it.each(["localhost", "127.0.0.1", "[::1]"])("accepts loopback Host %s", async (h) => {
    expect((await api({ host: `${h}:${stack.corePort}`, "x-handoff-token": stack.token })).status).toBe(200);
  });

  it("rejects a foreign Origin even with the token", async () => {
    const r = await api({ origin: "https://evil.example", "x-handoff-token": stack.token });
    expect(r.status).toBe(403);
  });

  it("rejects the app page's origin (only the overlay origin may call the API)", async () => {
    const r = await api({ origin: `http://localhost:${stack.proxyPort}`, "x-handoff-token": stack.token });
    expect(r.status).toBe(403);
  });

  it("rejects cross-site fetch metadata", async () => {
    const r = await api({ "sec-fetch-site": "cross-site", "x-handoff-token": stack.token });
    expect(r.status).toBe(403);
  });

  it("rejects a missing token", async () => {
    expect((await api({})).status).toBe(401);
  });

  it("rejects a wrong token of the right length", async () => {
    expect((await api({ "x-handoff-token": "0".repeat(64) })).status).toBe(401);
  });

  it("does not accept the token as a cookie or query parameter", async () => {
    expect((await api({ cookie: `x-handoff-token=${stack.token}` })).status).toBe(401);
    expect((await api({}, { path: `/api/session?token=${stack.token}` })).status).toBe(401);
  });

  it("token is 256-bit", () => {
    expect(stack.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never sends CORS headers, even to a preflight", async () => {
    for (const r of [
      await api({ "x-handoff-token": stack.token, origin: "https://evil.example" }),
      await api({ origin: "https://evil.example", "access-control-request-method": "POST" }, { method: "OPTIONS" }),
      await rawRequest(stack.corePort, { path: "/", headers: { host: `127.0.0.1:${stack.corePort}` } }),
    ]) {
      expect(Object.keys(r.headers).filter((k) => k.startsWith("access-control-"))).toEqual([]);
    }
  });

  it("writes require POST with a JSON content type", async () => {
    const t = { "x-handoff-token": stack.token };
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      expect((await api(t, { method, body: "{}" })).status, method).toBe(405);
    }
    const form = await api({ ...t, "content-type": "application/x-www-form-urlencoded" }, { method: "POST", body: "a=1" });
    expect(form.status).toBe(415);
    const text = await api({ ...t, "content-type": "text/plain" }, { method: "POST", body: "{}" });
    expect(text.status).toBe(415);
  });

  it("overlay page may only be framed by the app origins", async () => {
    const r = await rawRequest(stack.corePort, { path: "/", headers: { host: `127.0.0.1:${stack.corePort}` } });
    expect(r.status).toBe(200);
    const csp = String(r.headers["content-security-policy"]);
    expect(csp).toContain(`frame-ancestors http://localhost:${stack.proxyPort} http://127.0.0.1:${stack.proxyPort}`);
    expect(csp).not.toMatch(/frame-ancestors[^;]*\*/);
    expect(csp).toContain("default-src 'none'");
  });
});
