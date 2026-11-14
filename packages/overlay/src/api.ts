import type { AppStatus, SessionInfo } from "@ember-handover/core";
import { explain, type Explanation } from "@ember-handover/core/explain";

const meta = (name: string) => document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? "";

export const config = {
  token: meta("handoff-token"),
  appOrigins: meta("handoff-app-origins").split(" ").filter(Boolean),
};

export type Result<T> = { ok: true; data: T } | { ok: false; error: Explanation };

async function get<T>(path: string): Promise<Result<T>> {
  try {
    const r = await fetch(path, { headers: { "x-handoff-token": config.token }, cache: "no-store" });
    const body = (await r.json()) as T | { error: Explanation };
    if (!r.ok) return { ok: false, error: (body as { error: Explanation }).error ?? explain("UNKNOWN") };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, error: explain("BAD_TOKEN") };
  }
}

export const api = {
  session: () => get<SessionInfo>("/api/session"),
  status: () => get<AppStatus>("/api/status"),
};
