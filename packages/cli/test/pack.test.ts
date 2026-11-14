// M0 "Done when": the empty CLI is publishable. This test packs the CLI exactly
// as CI does before `npm publish --provenance`, then checks the tarball.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
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
  // Stand-in for `npm install`: link the one runtime dependency, offline.
  mkdirSync(join(pkgDir, "node_modules"));
  for (const dep of ["execa", "playwright-core", "yaml"]) {
    symlinkSync(realpathSync(join(cliDir, "node_modules", dep)), join(pkgDir, "node_modules", dep), "junction");
  }
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

  it("has no install-time scripts; only execa, playwright-core and yaml at runtime", () => {
    const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
    for (const s of ["preinstall", "install", "postinstall", "prepare"]) expect(pkg.scripts?.[s]).toBeUndefined();
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual(["execa", "playwright-core", "yaml"]);
    expect(JSON.stringify(pkg)).not.toContain("workspace:");
  });

  it("ships only dist, README and LICENSE", () => {
    const top = readdirSync(pkgDir).filter((f) => f !== "node_modules").sort();
    expect(top).toEqual(["LICENSE", "README.md", "dist", "package.json"]);
    expect(readdirSync(join(pkgDir, "dist")).sort()).toEqual(["assets", "bin.js"]);
    expect(readdirSync(join(pkgDir, "dist", "assets")).sort()).toEqual(["bridge.js", "measure.js", "overlay"]);
    expect(readdirSync(join(pkgDir, "dist", "assets", "overlay")).sort()).toEqual(["fonts", "overlay.css", "overlay.js"]);
  });

  it("ships no source maps and no Handoff code outside dist", () => {
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [e.name]));
    expect(walk(pkgDir).filter((f) => f.endsWith(".map"))).toEqual([]);
  });

  it("runs from the tarball", () => {
    const r = spawnSync(process.execPath, [join(pkgDir, "dist", "bin.js"), "--version"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
