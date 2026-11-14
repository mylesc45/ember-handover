import type { RawSpec } from "@ember-handover/bridge";
import type { AppStatus, MeasureRequest, SessionInfo } from "@ember-handover/core";
import type { Flow } from "@ember-handover/core/flow-model";
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
  flows: () => call<FlowListing>("/api/flows"),
  replay: (id: string, state: string | null) => call<ReplayResult>("/api/flows/replay", { id, state }),
  /** Screenshots need the token header, so they're fetched as blobs, not <img src>. */
  shot: async (flow: string, state: string | null, step: number): Promise<string | null> => {
    try {
      const q = new URLSearchParams({ flow, step: String(step), ...(state ? { state } : {}) });
      const r = await fetch(`/api/flows/shot?${q}`, { headers: { "x-handoff-token": config.token }, cache: "no-store" });
      return r.ok ? URL.createObjectURL(await r.blob()) : null;
    } catch {
      return null;
    }
  },
};

export interface ReplayStep {
  index: number;
  ok: boolean;
  description: string;
  error?: string;
  actual?: string;
  screenshot: string | null;
  url: string;
}
export interface ReplayResult {
  flowId: string;
  state: string | null;
  status: "passing" | "failing";
  failedAt?: number;
  steps: ReplayStep[];
  at: string;
}
export type FlowStatus = "passing" | "failing" | "stale" | "not-run";
export interface FlowListing {
  exists: boolean;
  flows: { flow: Flow; status: FlowStatus; result: ReplayResult | null; states: Record<string, ReplayResult | null> }[];
  errors: { line: number | null; message: string }[];
  warnings: { line: number | null; message: string }[];
}
