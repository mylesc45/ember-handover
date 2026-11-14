import { randomBytes, timingSafeEqual } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import http from "node:http";
import { join } from "node:path";
import { explain, type ErrorCode } from "./explain.js";
import { isAllowedHost } from "./hosts.js";

export type AppState = "starting" | "running" | "attached" | "restarting" | "stopped";
export interface AppStatus {
  state: AppState;
  /** Last few lines of the dev server's log, for the "Your app stopped" banner. */
  lines: string[];
}
export interface SessionInfo {
  version: string;
  framework: string | null;
  appUrl: string;
}
export interface OverlayAssets {
  js: Buffer;
  css: Buffer;
  fonts: Map<string, Buffer>;
}
export interface CoreServerOptions {
  token: string;
  /** Origins of the proxied app page: the only pages allowed to frame the overlay. */
  appOrigins: string[];
  assets: OverlayAssets;
  session: () => SessionInfo;
  status: () => AppStatus;
}

export const TOKEN_HEADER = "x-handoff-token";

/** 256-bit session token, hex encoded. Lives only in the overlay iframe. */
export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export function loadOverlayAssets(dir: string): OverlayAssets {
  const fonts = new Map<string, Buffer>();
  for (const f of readdirSync(join(dir, "fonts"))) if (/^[a-z0-9-]+\.woff2$/.test(f)) fonts.set(f, readFileSync(join(dir, "fonts", f)));
  return { js: readFileSync(join(dir, "overlay.js")), css: readFileSync(join(dir, "overlay.css")), fonts };
}

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
  "cross-origin-resource-policy": "same-origin",
};

function tokenMatches(given: string | string[] | undefined, expected: string): boolean {
  if (typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function createCoreServer(opts: CoreServerOptions): http.Server {
  const frameAncestors = opts.appOrigins.join(" ");

  const server = http.createServer((req, res) => {
    const fail = (status: number, code: ErrorCode) => {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: explain(code) }));
    };

    if (!isAllowedHost(req.headers.host)) return fail(403, "FORBIDDEN_HOST");

    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const selfOrigin = `http://${req.headers.host}`;

    if (url.pathname.startsWith("/api/")) {
      // Fetch metadata and Origin: only the overlay's own origin may call the API.
      const site = req.headers["sec-fetch-site"];
      if (site !== undefined && site !== "same-origin" && site !== "none") return fail(403, "FORBIDDEN_ORIGIN");
      const origin = req.headers.origin;
      if (origin !== undefined && origin !== selfOrigin) return fail(403, "FORBIDDEN_ORIGIN");
      if (!tokenMatches(req.headers[TOKEN_HEADER], opts.token)) return fail(401, "BAD_TOKEN");

      if (req.method !== "GET" && req.method !== "HEAD") {
        if (req.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED");
        if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) return fail(415, "UNSUPPORTED_MEDIA_TYPE");
        return fail(404, "NOT_FOUND"); // no write endpoints yet
      }
      const json = (body: unknown) => {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", ...SECURITY_HEADERS });
        res.end(JSON.stringify(body));
      };
      if (url.pathname === "/api/session") return json(opts.session());
      if (url.pathname === "/api/status") return json(opts.status());
      return fail(404, "NOT_FOUND");
    }

    if (req.method !== "GET" && req.method !== "HEAD") return fail(405, "METHOD_NOT_ALLOWED");

    const asset = (type: string, body: Buffer) => {
      res.writeHead(200, { "content-type": type, ...SECURITY_HEADERS });
      res.end(body);
    };
    if (url.pathname === "/") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": [
          "default-src 'none'",
          "script-src 'self'",
          "style-src 'self'",
          "font-src 'self'",
          "connect-src 'self'",
          "img-src 'self' data:",
          "base-uri 'none'",
          "form-action 'none'",
          `frame-ancestors ${frameAncestors}`,
        ].join("; "),
        ...SECURITY_HEADERS,
      });
      res.end(
        `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
          `<meta name="handoff-token" content="${escapeHtml(opts.token)}">` +
          `<meta name="handoff-app-origins" content="${escapeHtml(opts.appOrigins.join(" "))}">` +
          `<link rel="stylesheet" href="/overlay.css"><script type="module" src="/overlay.js"></script>` +
          `<title>Handoff</title></head><body><div id="root"></div></body></html>`,
      );
      return;
    }
    if (url.pathname === "/overlay.js") return asset("text/javascript; charset=utf-8", opts.assets.js);
    if (url.pathname === "/overlay.css") return asset("text/css; charset=utf-8", opts.assets.css);
    const font = /^\/fonts\/([a-z0-9-]+\.woff2)$/.exec(url.pathname)?.[1];
    const fontBody = font ? opts.assets.fonts.get(font) : undefined;
    if (fontBody) return asset("font/woff2", fontBody);
    return fail(404, "NOT_FOUND");
  });
  return server;
}
