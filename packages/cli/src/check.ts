/**
 * `npx ember-handover check`: for CI and agents. Fails if flows.yaml breaks the schema,
 * a route has no flow, .handoff/ contains something that looks like a secret, or a flow
 * step no longer resolves (replayed headlessly against the dev server).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { explain, HandoffError, resolveInside, scanSecrets, type SecretFinding } from "@ember-handover/core";
import { detect } from "./detect.js";
import { createFlowsService } from "./flows-service.js";
import type { Io } from "./main.js";
import { detectRoutes, routeMatches, type Route } from "./routes.js";
import { Supervisor } from "./supervisor.js";

export interface CheckReport {
  ok: boolean;
  schema: { line: number | null; message: string }[];
  uncovered: Route[];
  secrets: SecretFinding[];
  flows: { id: string; name: string; status: "passing" | "failing"; error?: string; step?: number }[];
}

function secretsIn(root: string): SecretFinding[] {
  const dir = resolveInside(root, ".handoff");
  const out: SecretFinding[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 8) return;
    for (const name of readdirSync(d)) {
      if (name === "cache" && d === dir) continue;
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p, depth + 1);
      else if (st.size <= 1_000_000 && !/\.(png|jpe?g|gif|webp|woff2?)$/i.test(name))
        out.push(...scanSecrets(relative(root, p).split(sep).join("/"), readFileSync(p, "utf8")));
    }
  };
  walk(dir, 0);
  return out;
}

export async function runCheck(opts: { cwd: string; io: Io; json: boolean; port: number | null }): Promise<number> {
  const { io } = opts;
  const service = createFlowsService(opts.cwd, () => appUrl);
  let appUrl = "";
  const parsed = service.load();
  if (!parsed.exists) throw new HandoffError("NO_FLOWS");

  const report: CheckReport = { ok: true, schema: [], uncovered: [], secrets: secretsIn(opts.cwd), flows: [] };
  report.schema = parsed.errors.map((e) => ({ line: e.line, message: e.message }));
  if (parsed.file) {
    const gotos = parsed.file.flows.flatMap((f) => f.steps.flatMap((s) => ("goto" in s ? [s.goto] : [])));
    report.uncovered = detectRoutes(opts.cwd).filter((r) => !gotos.some((g) => routeMatches(r, g)));

    // Replay every flow against the dev server (started, or attached to if running).
    const found = detect(opts.cwd);
    const supervisor = new Supervisor({ cwd: opts.cwd, command: found.packageManager, args: ["run", found.devScript ?? "dev"], port: opts.port ?? found.port });
    try {
      if (!opts.json) io.stdout("Starting your app to replay flows…\n");
      const target = await supervisor.start();
      appUrl = `http://${target.host.includes(":") ? `[${target.host}]` : target.host}:${target.port}`;
      if (appUrl.includes("[::1]")) appUrl = `http://localhost:${target.port}`;
      for (const f of parsed.file.flows) {
        const r = await service.replay(f.id, null, 8000);
        const failed = r.failedAt !== undefined ? r.steps[r.failedAt] : undefined;
        report.flows.push({
          id: f.id,
          name: f.name,
          status: r.status,
          ...(failed ? { error: failed.error ?? "Step failed.", step: failed.index + 1 } : {}),
        });
      }
    } finally {
      await service.close();
      await supervisor.stop();
    }
  }
  report.ok = !report.schema.length && !report.uncovered.length && !report.secrets.length && report.flows.every((f) => f.status === "passing");

  if (opts.json) {
    io.stdout(`${JSON.stringify(report, null, 2)}\n`);
    return report.ok ? 0 : 1;
  }
  const lines: string[] = [];
  for (const e of report.schema) lines.push(`✕ ${explain("FLOWS_INVALID", { line: e.line ?? "?", message: e.message }).message}`);
  for (const r of report.uncovered) lines.push(`✕ Route ${r.path} has no flow${r.dynamic ? " (add one with an example URL)" : ""}.`);
  for (const s of report.secrets) lines.push(`✕ ${s.file} line ${s.line} looks like a secret (${s.rule}). Use fake data in .handoff/.`);
  for (const f of report.flows)
    lines.push(f.status === "passing" ? `✓ ${f.name}` : `✕ ${f.name}: step ${f.step} failed. ${f.error}`);
  lines.push(report.ok ? "\nAll checks passed." : "\nSome checks failed. Fix them (or ask your coding agent to), then run check again.");
  io.stdout(lines.join("\n") + "\n");
  return report.ok ? 0 : 1;
}
