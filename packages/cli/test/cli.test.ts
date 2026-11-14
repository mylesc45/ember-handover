import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const bin = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};

function run(...args: string[]) {
  // Argument array, no shell.
  const r = spawnSync(process.execPath, [bin, ...args], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const noStack = (s: string) => expect(s).not.toMatch(/\n\s+at .+:\d+:\d+/);

describe("handoff CLI (M0 shell)", () => {
  it("--version prints the package version", () => {
    const r = run("--version");
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe(pkg.version);
  });

  it("--help lists all seven commands", () => {
    const r = run("--help");
    expect(r.code).toBe(0);
    for (const c of ["review", "share", "check", "mcp", "doctor", "remove"]) expect(r.out).toContain(c);
  });

  it("unknown command explains itself with a fix and exits 2", () => {
    const r = run("frobnicate");
    expect(r.code).toBe(2);
    expect(r.err).toContain("frobnicate");
    expect(r.err).toMatch(/Fix:/);
    noStack(r.err);
  });

  it("not-yet-built commands explain instead of crashing", () => {
    for (const c of ["review", "share", "mcp", "doctor"]) {
      const r = run(c);
      expect(r.code, c).toBe(1);
      expect(r.err, c).toMatch(/Fix:/);
      noStack(r.err);
    }
  });

  it("unknown flag explains itself and exits 2", () => {
    const r = run("--host", "0.0.0.0");
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/Fix:/);
    noStack(r.err);
  });

  it("--json makes errors machine-readable", () => {
    const r = run("frobnicate", "--json");
    expect(r.code).toBe(2);
    const parsed = JSON.parse(r.err) as { error: { code: string; fix: string } };
    expect(parsed.error.code).toBe("UNKNOWN_COMMAND");
  });
});
