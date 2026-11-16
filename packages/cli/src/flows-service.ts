import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createReplayer, type ReplayResult } from "@ember-handover/capture";
import { HandoffError, parseFlows, resolveInside, type Flow, type ParsedFlows } from "@ember-handover/core";

export const FLOWS_FILE = ".handoff/flows.yaml";
const CACHE = ".handoff/cache/flows";

export type FlowStatus = "passing" | "failing" | "stale" | "not-run";
export interface FlowListing {
  flows: { flow: Flow; status: FlowStatus; result: ReplayResult | null; states: Record<string, ReplayResult | null> }[];
  errors: ParsedFlows["errors"];
  warnings: ParsedFlows["warnings"];
  exists: boolean;
}

const hash = (f: Flow) => createHash("sha256").update(JSON.stringify(f)).digest("hex").slice(0, 16);

/** Reads flows.yaml, replays flows headlessly, and serves their screenshots from .handoff/cache. */
export function createFlowsService(root: string, appUrl: () => string) {
  const load = (): ParsedFlows & { exists: boolean } => {
    const p = resolveInside(root, FLOWS_FILE);
    if (!existsSync(p)) return { file: null, errors: [], warnings: [], exists: false };
    return { ...parseFlows(readFileSync(p, "utf8")), exists: true };
  };
  let replayer: ReturnType<typeof createReplayer> | null = null;
  const dirFor = (id: string, state: string | null) => `${CACHE}/${id}${state ? `--${state}` : ""}`;
  const readResult = (id: string, state: string | null): (ReplayResult & { hash?: string }) | null => {
    try {
      return JSON.parse(readFileSync(resolveInside(root, `${dirFor(id, state)}/result.json`), "utf8")) as ReplayResult & { hash?: string };
    } catch {
      return null;
    }
  };

  return {
    load,
    async list(): Promise<FlowListing> {
      const parsed = load();
      const flows = (parsed.file?.flows ?? []).map((flow) => {
        const result = readResult(flow.id, null);
        const status: FlowStatus = !result ? "not-run" : result.hash !== hash(flow) ? "stale" : result.status;
        const states = Object.fromEntries(flow.states.map((s) => [s.id, readResult(flow.id, s.id)]));
        return { flow, status, result, states };
      });
      return { flows, errors: parsed.errors, warnings: parsed.warnings, exists: parsed.exists };
    },
    async replay(id: string, stateId: string | null, stepTimeoutMs?: number): Promise<ReplayResult> {
      const parsed = load();
      const flow = parsed.file?.flows.find((f) => f.id === id);
      if (!parsed.file || !flow) throw new HandoffError("FLOW_NOT_FOUND", { id });
      const state = stateId ? flow.states.find((s) => s.id === stateId) : undefined;
      if (stateId && !state) throw new HandoffError("FLOW_NOT_FOUND", { id: `${id} (${stateId})` });
      replayer ??= createReplayer({ root, fixturesDir: parsed.file.fixtures });
      const outDir = resolveInside(root, dirFor(id, stateId));
      const base = new URL(parsed.file.baseUrl, appUrl()).href.replace(/\/$/, "");
      const result = await replayer.replay({ appUrl: base, flow, state, outDir, ...(stepTimeoutMs ? { stepTimeoutMs } : {}) });
      const withHash = { ...result, hash: hash(flow) };
      writeFileSync(join(outDir, "result.json"), JSON.stringify(withHash, null, 2));
      return withHash;
    },
    async shot(id: string, state: string | null, step: number): Promise<Buffer | null> {
      try {
        return readFileSync(resolveInside(root, `${dirFor(id, state)}/${step}.png`));
      } catch {
        return null;
      }
    },
    async close() {
      await replayer?.close();
      replayer = null;
    },
  };
}
export type FlowsService = ReturnType<typeof createFlowsService>;
