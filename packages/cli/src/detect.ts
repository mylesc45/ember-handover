import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ErrorCode } from "@ember-handover/core";

export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

export interface Detection {
  framework: { id: string; name: string } | null;
  packageManager: PackageManager;
  devScript: string | null;
  port: number | null;
  problems: ErrorCode[];
}

interface Pkg {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  packageManager?: string;
}

// Order matters: meta-frameworks before the bundler they're built on.
const FRAMEWORKS: { id: string; name: string; deps: string[]; port: number }[] = [
  { id: "next", name: "Next.js", deps: ["next"], port: 3000 },
  { id: "nuxt", name: "Nuxt", deps: ["nuxt"], port: 3000 },
  { id: "sveltekit", name: "SvelteKit", deps: ["@sveltejs/kit"], port: 5173 },
  { id: "astro", name: "Astro", deps: ["astro"], port: 4321 },
  { id: "react-router", name: "React Router", deps: ["@react-router/dev"], port: 5173 },
  { id: "remix", name: "Remix", deps: ["@remix-run/dev"], port: 5173 },
  { id: "angular", name: "Angular", deps: ["@angular/core"], port: 4200 },
  { id: "vite", name: "Vite", deps: ["vite"], port: 5173 },
];

const DEV_SCRIPTS = ["dev", "start", "serve"];
const VITE_CONFIGS = ["vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs"];

/** Read-only look at the repo: framework, package manager, dev script and port. Never throws. */
export function detect(root: string): Detection {
  const problems: ErrorCode[] = [];
  let pkg: Pkg | null = null;
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) problems.push("NO_PACKAGE_JSON");
  else {
    try {
      const parsed: unknown = JSON.parse(readFileSync(pkgPath, "utf8"));
      pkg = parsed && typeof parsed === "object" ? (parsed as Pkg) : {};
    } catch {
      problems.push("BAD_PACKAGE_JSON");
    }
  }

  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  const fw = FRAMEWORKS.find((f) => f.deps.some((d) => Object.hasOwn(deps, d))) ?? null;
  const scripts = pkg?.scripts ?? {};
  const devScript = DEV_SCRIPTS.find((s) => typeof scripts[s] === "string") ?? null;
  if (pkg && !devScript) problems.push("NO_DEV_SCRIPT");

  const port =
    (devScript ? portFromScript(scripts[devScript] ?? "") : null) ??
    (fw?.id === "vite" || fw?.id === "react-router" || fw?.id === "sveltekit" ? portFromViteConfig(root) : null) ??
    fw?.port ??
    null;

  return {
    framework: fw ? { id: fw.id, name: fw.name } : null,
    packageManager: detectPackageManager(root, pkg),
    devScript,
    port,
    problems,
  };
}

function detectPackageManager(root: string, pkg: Pkg | null): PackageManager {
  const declared = /^(pnpm|npm|yarn|bun)@/.exec(pkg?.packageManager ?? "")?.[1] as PackageManager | undefined;
  if (declared) return declared;
  const locks: [string, PackageManager][] = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["package-lock.json", "npm"],
  ];
  return locks.find(([f]) => existsSync(join(root, f)))?.[1] ?? "npm";
}

const validPort = (n: number) => (Number.isInteger(n) && n > 0 && n < 65536 ? n : null);

export function portFromScript(script: string): number | null {
  const m = /(?:--port[=\s]+|(?:^|\s)-p\s*)(\d{1,5})\b/.exec(script) ?? /(?:^|\s)PORT=(\d{1,5})\b/.exec(script);
  return m?.[1] ? validPort(Number(m[1])) : null;
}

function portFromViteConfig(root: string): number | null {
  for (const f of VITE_CONFIGS) {
    const p = join(root, f);
    if (!existsSync(p)) continue;
    const m = /server\s*:\s*\{[^}]*?\bport\s*:\s*(\d{1,5})/s.exec(readFileSync(p, "utf8"));
    if (m?.[1]) return validPort(Number(m[1]));
  }
  return null;
}
