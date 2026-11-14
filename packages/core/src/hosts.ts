/** Loopback names Handoff answers to. Anything else is a DNS-rebinding attempt (SPEC S3). */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function hostname(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  const m = /^(\[[^\]]+\]|[^:]+)(?::(\d{1,5}))?$/.exec(hostHeader.trim().toLowerCase());
  return m?.[1] ?? null;
}

export function isAllowedHost(hostHeader: string | undefined): boolean {
  const h = hostname(hostHeader);
  return h !== null && LOOPBACK.has(h);
}

/**
 * Origins the app page may have when opened through the proxy.
 * [::1] is deliberately absent: Chrome's CSP rejects IPv6 literals in frame-ancestors,
 * so the overlay can't be framed there anyway. Handoff always prints a localhost URL.
 */
export function loopbackOrigins(port: number): string[] {
  return ["localhost", "127.0.0.1"].map((h) => `http://${h}:${port}`);
}
