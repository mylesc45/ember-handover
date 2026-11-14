import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
export const packagesDir = join(repoRoot, "packages");

export function workspacePackageDirs(): string[] {
  const pkgs = readdirSync(packagesDir)
    .map((d) => join(packagesDir, d))
    .filter((d) => statSync(d).isDirectory());
  return [repoRoot, ...pkgs, join(repoRoot, "security")];
}

export function readJson<T = Record<string, unknown>>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** All shipped source files (packages/<name>/src/**), excluding tests. */
export function shippedSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|mjs|cjs)$/.test(name) && !/\.test\./.test(name)) out.push(p);
    }
  };
  for (const pkg of readdirSync(packagesDir)) {
    const src = join(packagesDir, pkg, "src");
    try {
      if (statSync(src).isDirectory()) walk(src);
    } catch {
      /* package without src */
    }
  }
  return out;
}

export const rel = (p: string) => relative(repoRoot, p).split(sep).join("/");
