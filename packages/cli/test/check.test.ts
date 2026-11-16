import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const bin = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
const fixture = fileURLToPath(new URL("../../../fixtures/flows-app/", import.meta.url));
let work: string;

function check(cwd: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [bin, "check", ...args], { cwd, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" }, timeout: 90_000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "handoff-check-"));
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

function copy(name: string, edit?: (dir: string) => void): string {
  const d = join(work, name);
  cpSync(fixture, d, { recursive: true });
  edit?.(d);
  return d;
}

describe("handoff check", () => {
  it("replays every flow, reports the broken one, exits 1", () => {
    const r = check(copy("all"));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/✓ Checkout/);
    expect(r.out).toMatch(/✓ Home/);
    expect(r.out).toMatch(/✕ Broken on purpose/);
    expect(r.out).toMatch(/Couldn't find test ID "does-not-exist"/);
    expect(r.err + r.out).not.toMatch(/\n\s+at .+:\d+:\d+/);
  }, 120_000);

  it("passes (exit 0) when every flow replays and every route is covered", () => {
    const d = copy("ok", (dir) => {
      const y = readFileSync(join(dir, ".handoff/flows.yaml"), "utf8");
      writeFileSync(join(dir, ".handoff/flows.yaml"), y.slice(0, y.indexOf("  - id: broken")));
    });
    const r = check(d);
    expect(r.out).toMatch(/All checks passed/);
    expect(r.code).toBe(0);
  }, 120_000);

  it("--json gives a machine-readable report", () => {
    const r = check(copy("json"), "--json");
    const report = JSON.parse(r.out) as { ok: boolean; flows: { id: string; status: string }[] };
    expect(report.ok).toBe(false);
    expect(report.flows.find((f) => f.id === "broken")?.status).toBe("failing");
  }, 120_000);

  it("fails on schema errors with the line number, without starting the app", () => {
    const d = copy("schema", (dir) => writeFileSync(join(dir, ".handoff/flows.yaml"), "version: 1\nflows:\n  - id: a\n    name: A\n    steps:\n      - eval: x\n"));
    const r = check(d);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/flows\.yaml line 6/);
  });

  it("fails when .handoff/ contains something that looks like a secret", () => {
    const d = copy("secret", (dir) => writeFileSync(join(dir, ".handoff/fixtures/leak.json"), '{ "key": "AKIAIOSFODNN7EXAMPLE" }'));
    const r = check(d);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/leak\.json.*AWS access key/);
  }, 120_000);

  it("explains a missing flows file", () => {
    const d = copy("none", (dir) => rmSync(join(dir, ".handoff"), { recursive: true }));
    const r = check(d);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/Fix:/);
  });
});
