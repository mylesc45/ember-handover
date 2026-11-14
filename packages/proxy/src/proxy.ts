import { createHash } from "node:crypto";
import http from "node:http";
import net from "node:net";
import type { Duplex } from "node:stream";
import zlib from "node:zlib";
import { explain, isAllowedHost } from "@ember-handover/core";
import { addScriptHash } from "./csp.js";
import { createInjector } from "./inject.js";

export const BRIDGE_PATH = "/__handoff/bridge.js";

export interface ProxyOptions {
  target: { host: string; port: number };
  bridgeCode: Buffer;
  /** Overlay iframe URL, e.g. http://127.0.0.1:4001/ */
  overlayUrl: string;
}

export function bridgeIntegrity(code: Buffer): string {
  return `sha384-${createHash("sha384").update(code).digest("base64")}`;
}

const CSP_HEADERS = new Set(["content-security-policy", "content-security-policy-report-only"]);
const DROP_FROM_HTML = new Set(["content-length", "content-encoding", "transfer-encoding"]);
const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export interface ProxyHandlers {
  request: http.RequestListener;
  upgrade: (req: http.IncomingMessage, socket: Duplex, head: Buffer) => void;
}

/** A proxy with default handlers. */
export function createProxy(opts: ProxyOptions): http.Server {
  const server = http.createServer();
  attachProxy(server, opts);
  return server;
}

/** Attach proxy handlers to an already-listening server (lets the CLI reserve ports first). */
export function attachProxy(server: http.Server, opts: ProxyOptions): void {
  const h = createProxyHandlers(opts);
  server.on("request", h.request);
  server.on("upgrade", h.upgrade);
}

export function createProxyHandlers(opts: ProxyOptions): ProxyHandlers {
  const integrity = bridgeIntegrity(opts.bridgeCode);
  const tag = `<script src="${BRIDGE_PATH}" integrity="${integrity}" data-handoff-overlay="${escapeAttr(opts.overlayUrl)}" defer></script>`;

  const request: http.RequestListener = (req, res) => {
    if (!isAllowedHost(req.headers.host)) {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" }).end("Forbidden: Handoff only answers on localhost.");
      return;
    }
    if (req.url === BRIDGE_PATH || req.url?.startsWith(`${BRIDGE_PATH}?`)) {
      res.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      res.end(opts.bridgeCode);
      return;
    }

    const upstream = http.request(
      {
        host: opts.target.host,
        port: opts.target.port,
        method: req.method,
        path: req.url,
        headers: req.headers,
        agent: false,
      },
      (up) => {
        const type = String(up.headers["content-type"] ?? "");
        const isHtml =
          /^text\/html\b/i.test(type) && req.method !== "HEAD" && up.statusCode !== 204 && up.statusCode !== 304;
        if (!isHtml) {
          res.writeHead(up.statusCode ?? 502, up.statusMessage, up.rawHeaders);
          up.pipe(res);
          return;
        }

        const encoding = String(up.headers["content-encoding"] ?? "").toLowerCase().trim();
        const decoder =
          encoding === "gzip" || encoding === "x-gzip"
            ? zlib.createGunzip()
            : encoding === "br"
              ? zlib.createBrotliDecompress()
              : encoding === "deflate"
                ? zlib.createInflate()
                : null;
        if (encoding && encoding !== "identity" && !decoder) {
          // Unknown encoding: pass through untouched rather than corrupt it.
          res.writeHead(up.statusCode ?? 502, up.statusMessage, up.rawHeaders);
          up.pipe(res);
          return;
        }

        const headers: string[] = [];
        for (let i = 0; i < up.rawHeaders.length; i += 2) {
          const name = up.rawHeaders[i] ?? "";
          const lower = name.toLowerCase();
          let value = up.rawHeaders[i + 1] ?? "";
          if (DROP_FROM_HTML.has(lower)) continue;
          if (CSP_HEADERS.has(lower)) value = addScriptHash(value, integrity);
          headers.push(name, value);
        }
        res.writeHead(up.statusCode ?? 200, up.statusMessage, headers);
        const injector = createInjector(tag);
        const fail = () => res.destroy();
        injector.on("error", fail);
        if (decoder) {
          decoder.on("error", fail);
          up.pipe(decoder).pipe(injector).pipe(res);
        } else {
          up.pipe(injector).pipe(res);
        }
      },
    );

    upstream.on("error", () => {
      if (res.headersSent) return void res.destroy();
      const e = explain("APP_UNREACHABLE", { port: opts.target.port });
      const wantsHtml = String(req.headers.accept ?? "").includes("text/html");
      if (wantsHtml) {
        res.writeHead(502, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", refresh: "2" });
        res.end(
          `<!doctype html><meta charset="utf-8"><title>Waiting for your app</title>` +
            `<body style="font:15px system-ui;padding:40px;background:#1E2638;color:#fff">` +
            `<p>${escapeAttr(e.message)}</p><p style="color:#B8BDD0">${escapeAttr(e.fix)}</p>`,
        );
      } else {
        res.writeHead(502, { "content-type": "text/plain; charset=utf-8" }).end(`${e.message}\n${e.fix}\n`);
      }
    });
    req.pipe(upstream);
  };

  const upgrade = (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
    if (!isAllowedHost(req.headers.host)) return void socket.destroy();
    const upstream = net.connect(opts.target.port, opts.target.host, () => {
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      upstream.write(lines.join("\r\n") + "\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(socket).pipe(upstream);
    });
    const close = () => {
      upstream.destroy();
      socket.destroy();
    };
    upstream.on("error", close);
    socket.on("error", close);
    upstream.on("close", close);
    socket.on("close", close);
    upstream.on("end", close);
    socket.on("end", close);
  };

  return { request, upgrade };
}
