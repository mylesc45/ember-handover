// SPEC → Security model → Supply chain.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { packagesDir, readJson, rel, workspacePackageDirs } from "./lib/repo.js";

const INSTALL_HOOKS = ["preinstall", "install", "postinstall", "prepublish", "prepare"];

type Pkg = { name: string; scripts?: Record<string, string>; dependencies?: Record<string, string> };

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
        const req = createRequire(join(fromDir, "package.json"));
        const pkgPath = req.resolve(`${name}/package.json`);
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
