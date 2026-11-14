import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { MAX_CSS_BYTES } from "./css.js";

const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", ".svelte-kit", ".output", "coverage", ".handoff", ".turbo", ".vercel", ".cache"]);
const MAX_FILES = 2000;

export const rel = (root: string, p: string) => relative(root, p).split(sep).join("/");

/** CSS files in the repo (no symlinks, nothing outside root, bounded). */
export function cssFiles(root: string): string[] {
  const out: string[] = [];
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    return out;
  }
  const visit = (dir: string, depth: number) => {
    if (depth > 12 || out.length >= MAX_FILES) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (SKIP.has(name) || name.startsWith(".")) continue;
      const p = join(dir, name);
      const st = lstatSync(p);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) visit(p, depth + 1);
      else if (/\.(css|pcss|postcss)$/.test(name) && st.size <= MAX_CSS_BYTES) out.push(p);
    }
  };
  visit(realRoot, 0);
  return out.sort();
}

export function readSmall(p: string): string | null {
  try {
    if (statSync(p).size > MAX_CSS_BYTES) return null;
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

/** node_modules/<pkg>/<file>, looked up from root upwards (no code execution). */
export function findInNodeModules(root: string, pkg: string, file: string): string | null {
  for (let dir = root; ; dir = join(dir, "..")) {
    const p = join(dir, "node_modules", pkg, file);
    if (existsSync(p)) return p;
    if (join(dir, "..") === dir) return null;
  }
}
