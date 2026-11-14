// M0 "Done when": the empty CLI is publishable. This test packs the CLI exactly
// as CI does before `npm publish --provenance`, then checks the tarball.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const cliDir = fileURLToPath(new URL("..", import.meta.url));
let work: string;
let pkgDir: string;

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "handoff-pack-"));
  // Run pnpm's JS entry with node directly (argument array, no shell).
  const pnpmJs = process.env.npm_execpath;
  const [cmd, pre] = pnpmJs ? [process.execPath, [pnpmJs]] : ["pnpm", []];
  const packed = spawnSync(cmd, [...pre, "pack", "--pack-destination", work], {
    cwd: cliDir,
    encoding: "utf8",
    shell: false,
  });
  expect(packed.status, packed.stderr).toBe(0);
  const tgz = readdirSync(work).find((f) => f.endsWith(".tgz"));
  if (!tgz) throw new Error(`pnpm pack produced no tarball in ${work}`);
  const untar = spawnSync("tar", ["-xzf", tgz, "-C", work], { cwd: work, encoding: "utf8" });
  expect(untar.status, untar.stderr).toBe(0);
  pkgDir = join(work, "package");
}, 60_000);

afterAll(() => rmSync(work, { recursive: true, force: true }));

describe("published tarball", () => {
  it("has the right name, bin and provenance config", () => {
    const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as Record<string, unknown>;
    expect(pkg.name).toBe("ember-handover");
    expect(pkg.license).toBe("MIT");
    expect(pkg.bin).toMatchObject({ handoff: "./dist/bin.js", "ember-handover": "./dist/bin.js" });
    expect(pkg.publishConfig).toMatchObject({ provenance: true, access: "public", tag: "next" });
  });

  it("has no install-time scripts and no runtime dependencies yet", () => {
    const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
    for (const s of ["preinstall", "install", "postinstall", "prepare"]) expect(pkg.scripts?.[s]).toBeUndefined();
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
    expect(JSON.stringify(pkg)).not.toContain("workspace:");
  });

  it("ships only dist, README and LICENSE", () => {
    const top = readdirSync(pkgDir).sort();
    expect(top).toEqual(["LICENSE", "README.md", "dist", "package.json"]);
    expect(readdirSync(join(pkgDir, "dist"))).toEqual(["bin.js"]);
  });

  it("runs from the tarball", () => {
    const r = spawnSync(process.execPath, [join(pkgDir, "dist", "bin.js"), "--version"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
