// SPEC → Security model → Supply chain.
import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { packagesDir, readJson, rel, workspacePackageDirs } from "./lib/repo.js";

const INSTALL_HOOKS = ["preinstall", "install", "postinstall", "prepublish", "prepare"];

type Pkg = { name: string; scripts?: Record<string, string>; dependencies?: Record<string, string> };

/** Node-style lookup of node_modules/<name>/package.json, ignoring "exports". */
function findPackageJson(fromDir: string, name: string): string {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name, "package.json");
    if (existsSync(candidate)) return realpathSync(candidate);
    if (dirname(dir) === dir) throw new Error(`cannot resolve ${name} from ${fromDir}`);
  }
}

describe("supply chain", () => {
  it("no Handoff package defines install or postinstall scripts", () => {
    for (const dir of workspacePackageDirs()) {
      const pkg = readJson<Pkg>(join(dir, "package.json"));
      for (const hook of INSTALL_HOOKS) {
        expect(pkg.scripts?.[hook], `${rel(dir)} defines "${hook}"`).toBeUndefined();
      }
    }
  });

  it("the published CLI stays under 40 transitive runtime dependencies", () => {
    const cliDir = join(packagesDir, "cli");
    const seen = new Set<string>();
    const visit = (fromDir: string, deps: Record<string, string> | undefined) => {
      for (const name of Object.keys(deps ?? {})) {
        const pkgPath = findPackageJson(fromDir, name);
        const pkg = readJson<Pkg & { version: string }>(pkgPath);
        const key = `${pkg.name}@${pkg.version}`;
        if (seen.has(key)) continue;
        seen.add(key);
        visit(dirname(pkgPath), pkg.dependencies);
      }
    };
    visit(cliDir, readJson<Pkg>(join(cliDir, "package.json")).dependencies);
    expect(seen.size, [...seen].join(", ")).toBeLessThan(40);
  });

  it("only the CLI is publishable; internal packages are private", () => {
    for (const dir of workspacePackageDirs()) {
      const pkg = readJson<Pkg & { private?: boolean }>(join(dir, "package.json"));
      if (pkg.name === "ember-handover") continue;
      expect(pkg.private, `${pkg.name} must be private`).toBe(true);
    }
  });
});
