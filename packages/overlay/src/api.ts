import type { RawSpec } from "@ember-handover/bridge";
import type { AppStatus, MeasureRequest, SessionInfo } from "@ember-handover/core";
import type { TokenSet } from "@ember-handover/tokens";
import { explain, type Explanation } from "@ember-handover/core/explain";

const meta = (name: string) => document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? "";

export const config = {
  token: meta("handoff-token"),
  appOrigins: meta("handoff-app-origins").split(" ").filter(Boolean),
};

export type Result<T> = { ok: true; data: T } | { ok: false; error: Explanation };

async function call<T>(path: string, body?: unknown): Promise<Result<T>> {
  try {
    const r = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "x-handoff-token": config.token, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      cache: "no-store",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = (await r.json()) as T | { error: Explanation };
    if (!r.ok) return { ok: false, error: (data as { error: Explanation }).error ?? explain("UNKNOWN") };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: explain("APP_UNREACHABLE", { port: location.port }) };
  }
}

export const api = {
  session: () => call<SessionInfo>("/api/session"),
  status: () => call<AppStatus>("/api/status"),
  tokens: () => call<TokenSet>("/api/tokens"),
  browser: () => call<{ available: boolean; kind: string | null }>("/api/browser"),
  measure: (req: MeasureRequest) => call<RawSpec>("/api/measure", req),
};
