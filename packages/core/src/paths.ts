import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { HandoffError } from "./explain.js";

/**
 * Resolve `rel` inside `root`, following symlinks with realpath (SPEC S8).
 * Throws PATH_OUTSIDE for absolute paths, "..", drive letters, NUL bytes, or any symlink
 * that leads outside the root. Paths that don't exist yet are checked via their nearest
 * existing parent.
 */
export function resolveInside(root: string, rel: string): string {
  if (!rel || rel.includes("\u0000") || isAbsolute(rel) || /^[a-zA-Z]:/.test(rel) || rel.startsWith("\\\\") || rel.split(/[\\/]/).includes(".."))
    throw new HandoffError("PATH_OUTSIDE", { path: rel.split(String.fromCharCode(0)).join("") });
  const realRoot = realpathSync(root);
  const target = resolve(realRoot, rel);
  let existing = target;
  while (!existsSync(existing) && dirname(existing) !== existing) existing = dirname(existing);
  const real = join(realpathSync(existing), relative(existing, target));
  const r = relative(realRoot, real);
  if (r === "" || r.startsWith("..") || isAbsolute(r) || r.split(sep).includes("..")) {
    if (r !== "") throw new HandoffError("PATH_OUTSIDE", { path: rel });
  }
  return real;
}
