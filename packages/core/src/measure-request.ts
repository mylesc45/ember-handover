/** Validation for POST /api/measure. The headless browser may only ever load the proxied app. */

export interface MeasureRequest {
  url: string;
  path: string;
  width?: number;
  state?: "default" | "hover" | "focus" | "active" | "disabled";
}

const PATH = /^html:nth-child\(1\)(?: > [a-z][a-z0-9-]{0,63}:nth-child\([1-9]\d{0,4}\)){0,256}$/;
const STATES = new Set(["default", "hover", "focus", "active", "disabled"]);
const KEYS = new Set(["url", "path", "width", "state"]);

export function parseMeasureRequest(body: unknown, appOrigins: string[]): MeasureRequest | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (Object.keys(b).some((k) => !KEYS.has(k))) return null;
  if (typeof b.url !== "string" || b.url.length > 2048 || typeof b.path !== "string" || !PATH.test(b.path)) return null;
  let u: URL;
  try {
    u = new URL(b.url);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" || u.username || u.password || !appOrigins.includes(u.origin)) return null;
  const out: MeasureRequest = { url: u.href, path: b.path };
  if (b.width !== undefined) {
    if (!Number.isInteger(b.width) || (b.width as number) < 200 || (b.width as number) > 3840) return null;
    out.width = b.width as number;
  }
  if (b.state !== undefined) {
    if (typeof b.state !== "string" || !STATES.has(b.state)) return null;
    out.state = b.state as NonNullable<MeasureRequest["state"]>;
  }
  return out;
}
