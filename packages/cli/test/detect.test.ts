import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detect } from "../src/detect.js";

const dirs: string[] = [];
function repo(pkg: object | null, files: Record<string, string> = {}): string {
  const d = mkdtempSync(join(tmpdir(), "handoff-detect-"));
  dirs.push(d);
  if (pkg) writeFileSync(join(d, "package.json"), JSON.stringify(pkg));
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(join(d, f, ".."), { recursive: true });
    writeFileSync(join(d, f), c);
  }
  return d;
}
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("detect", () => {
  it.each([
    [{ next: "16" }, "next", 3000],
    [{ vite: "8", react: "19" }, "vite", 5173],
    [{ nuxt: "4" }, "nuxt", 3000],
    [{ "@sveltejs/kit": "2" }, "sveltekit", 5173],
    [{ "@angular/core": "19", "@angular/cli": "19" }, "angular", 4200],
    [{ astro: "5" }, "astro", 4321],
  ])("framework from %j", (deps, id, port) => {
    const d = detect(repo({ scripts: { dev: "x" }, devDependencies: deps }));
    expect(d.framework?.id).toBe(id);
    expect(d.port).toBe(port);
  });

  it.each([
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["package-lock.json", "npm"],
  ])("package manager from %s", (lock, pm) => {
    expect(detect(repo({ scripts: { dev: "vite" } }, { [lock]: "" })).packageManager).toBe(pm);
  });

  it("package manager from the packageManager field wins", () => {
    expect(detect(repo({ packageManager: "yarn@4.1.0", scripts: { dev: "vite" } }, { "package-lock.json": "" })).packageManager).toBe("yarn");
  });

  it("defaults to npm", () => {
    expect(detect(repo({ scripts: { dev: "vite" } })).packageManager).toBe("npm");
  });

  it("prefers the dev script, then start, then serve", () => {
    expect(detect(repo({ scripts: { start: "a", dev: "b" } })).devScript).toBe("dev");
    expect(detect(repo({ scripts: { start: "a", build: "b" } })).devScript).toBe("start");
    expect(detect(repo({ scripts: { serve: "a" } })).devScript).toBe("serve");
    expect(detect(repo({ scripts: { build: "a" } })).devScript).toBeNull();
  });

  it.each([
    ["vite --port 3001", 3001],
    ["vite --port=3002", 3002],
    ["next dev -p 3003", 3003],
    ["next dev --turbopack -p3004", 3004],
    ["ng serve --port 4300", 4300],
    ["PORT=3005 react-scripts start", 3005],
  ])("port from script %s", (script, port) => {
    expect(detect(repo({ scripts: { dev: script }, dependencies: { vite: "1" } })).port).toBe(port);
  });

  it("reads the Vite config's server.port", () => {
    const d = detect(repo({ scripts: { dev: "vite" }, devDependencies: { vite: "8" } }, { "vite.config.ts": "export default { server: { port: 5999 } }" }));
    expect(d.port).toBe(5999);
  });

  it("reports a missing package.json without throwing", () => {
    const d = detect(repo(null));
    expect(d.problems).toContain("NO_PACKAGE_JSON");
  });

  it("reports a missing dev script", () => {
    expect(detect(repo({ scripts: {} })).problems).toContain("NO_DEV_SCRIPT");
  });

  it("survives malformed package.json", () => {
    const d = repo(null, { "package.json": "{not json" });
    expect(detect(d).problems).toContain("BAD_PACKAGE_JSON");
  });
});
