// S11 — Proxy weakens the app's own security.
import { gzipSync } from "node:zlib";
import { addScriptHash, bridgeIntegrity } from "@ember-handover/proxy";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bridgeCode, rawRequest, startStack } from "./lib/servers.js";

const APP_HEADERS: Record<string, string> = {
  "content-security-policy": "default-src 'self'; script-src 'self' https://cdn.example; object-src 'none'; frame-ancestors 'none'",
  "content-security-policy-report-only": "default-src 'self'; report-uri /csp",
  "x-frame-options": "DENY",
  "strict-transport-security": "max-age=31536000",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=()",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-embedder-policy": "require-corp",
  "set-cookie": "sid=1; HttpOnly; SameSite=Strict",
  "x-app": "kept",
};
const HTML = "<!doctype html><html><head><title>t</title></head><body>hello</body></html>";

let stack: Awaited<ReturnType<typeof startStack>>;
beforeAll(async () => {
  stack = await startStack((req, res) => {
    if (req.url === "/app.js") {
      res.writeHead(200, { "content-type": "text/javascript", ...APP_HEADERS });
      return res.end("console.log(1)");
    }
    if (req.url === "/gz") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-encoding": "gzip", ...APP_HEADERS });
      return res.end(gzipSync(HTML));
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", ...APP_HEADERS });
    res.end(HTML);
  });
});
afterAll(() => stack.close());

const TRANSPORT = new Set(["content-length", "content-encoding", "transfer-encoding", "date", "connection", "keep-alive"]);
const CSP = new Set(["content-security-policy", "content-security-policy-report-only"]);

async function both(path: string) {
  const direct = await rawRequest(stack.upstreamPort, { path, headers: { host: `localhost:${stack.proxyPort}` } });
  const proxied = await rawRequest(stack.proxyPort, { path, headers: { host: `localhost:${stack.proxyPort}` } });
  return { direct, proxied };
}

describe("S11 proxy only adds the bridge hash to script-src", () => {
  it.each(["/", "/gz"])("HTML %s: every header kept; only CSP gains the hash", async (path) => {
    const { direct, proxied } = await both(path);
    const hash = bridgeIntegrity(bridgeCode());
    for (const [k, v] of Object.entries(direct.headers)) {
      if (TRANSPORT.has(k)) continue;
      if (CSP.has(k)) expect(proxied.headers[k], k).toBe(addScriptHash(String(v), hash));
      else expect(proxied.headers[k], k).toEqual(v);
    }
    const added = Object.keys(proxied.headers).filter((k) => !(k in direct.headers) && !TRANSPORT.has(k));
    expect(added).toEqual([]);
    expect(proxied.headers["content-security-policy"]).toContain(`script-src 'self' https://cdn.example '${hash}'`);
    expect(proxied.headers["content-security-policy"]).toContain("object-src 'none'; frame-ancestors 'none'");
    expect(proxied.headers["content-security-policy-report-only"]).toContain(`'${hash}'`);
  });

  it("HTML body only gains the bridge script tag", async () => {
    const { proxied } = await both("/");
    const body = proxied.body.toString();
    const tag = /<script src="\/__handoff\/bridge\.js"[^>]*><\/script>/.exec(body)?.[0];
    expect(tag).toBeDefined();
    expect(body.replace(tag ?? "", "")).toBe(HTML);
    expect(tag).toContain(`integrity="${bridgeIntegrity(bridgeCode())}"`);
  });

  it("non-HTML responses pass through byte-for-byte with identical headers", async () => {
    const { direct, proxied } = await both("/app.js");
    expect(proxied.body).toEqual(direct.body);
    const strip = (raw: string[]) => {
      const out: string[] = [];
      for (let i = 0; i < raw.length; i += 2) if (!TRANSPORT.has(raw[i]!.toLowerCase())) out.push(`${raw[i]}: ${raw[i + 1]}`);
      return out;
    };
    expect(strip(proxied.rawHeaders)).toEqual(strip(direct.rawHeaders));
  });

  it("addScriptHash never drops a directive or source", () => {
    const policies = [
      APP_HEADERS["content-security-policy"]!,
      "default-src 'none'; style-src 'self'",
      "script-src 'nonce-a' 'strict-dynamic' https:; base-uri 'none'",
      "upgrade-insecure-requests; script-src-elem 'self' blob:",
    ];
    for (const p of policies) {
      const out = addScriptHash(p, "sha384-x");
      for (const directive of p.split(";").map((d) => d.trim()).filter(Boolean)) {
        const [name, ...sources] = directive.split(/\s+/);
        const outDirective = out.split(";").map((d) => d.trim()).find((d) => d.split(/\s+/)[0] === name);
        expect(outDirective, `${name} kept`).toBeDefined();
        for (const s of sources) if (s !== "'none'") expect(outDirective!.split(/\s+/), `${name} ${s}`).toContain(s);
      }
    }
  });
});
