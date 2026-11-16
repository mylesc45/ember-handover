import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { detect } from "./detect.js";

export interface Route {
  /** e.g. "/", "/about", "/blog/[slug]" */
  path: string;
  /** Has a dynamic segment, so a flow needs an example URL. */
  dynamic: boolean;
  /** Repo-relative file that defines the route. */
  file: string;
}

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", ".nuxt", ".svelte-kit", "dist", "build", "out", ".output", ".handoff"]);
const rel = (root: string, p: string) => relative(root, p).split(sep).join("/");

function walk(dir: string, visit: (file: string) => void, depth = 0) {
  if (depth > 12 || !existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walk(p, visit, depth + 1);
    else visit(p);
  }
}

const isDynamic = (seg: string) => /^\[.*\]$/.test(seg) || seg.startsWith(":") || seg === "*";
const toPath = (segs: string[]) => "/" + segs.filter(Boolean).join("/");
const firstExisting = (root: string, dirs: string[]) => dirs.map((d) => join(root, d)).find((d) => existsSync(d));

/** Next.js App Router: page files; (groups), @slots and _private folders don't add segments. */
function nextApp(root: string, dir: string): Route[] {
  const out: Route[] = [];
  walk(dir, (file) => {
    if (!/[\\/]page\.(tsx|jsx|ts|js|mdx)$/.test(file)) return;
    const segs = relative(dir, file).split(sep).slice(0, -1);
    if (segs.some((s) => s.startsWith("_") || s.startsWith("@") || s.startsWith("(."))) return;
    const kept = segs.filter((s) => !/^\(.*\)$/.test(s));
    out.push({ path: toPath(kept), dynamic: kept.some(isDynamic), file: rel(root, file) });
  });
  return out;
}

/** File routes where `index` is the folder itself (Next pages, Nuxt, Astro). */
function fileRoutes(root: string, dir: string, ext: RegExp, skip: (segs: string[]) => boolean): Route[] {
  const out: Route[] = [];
  walk(dir, (file) => {
    if (!ext.test(file)) return;
    const segs = relative(dir, file).split(sep);
    segs[segs.length - 1] = (segs.at(-1) ?? "").replace(ext, "");
    if (skip(segs)) return;
    if (segs.at(-1) === "index") segs.pop();
    out.push({ path: toPath(segs), dynamic: segs.some(isDynamic), file: rel(root, file) });
  });
  return out;
}

function sveltekit(root: string): Route[] {
  const dir = join(root, "src", "routes");
  const out: Route[] = [];
  walk(dir, (file) => {
    if (!/[\\/]\+page\.svelte$/.test(file)) return;
    const segs = relative(dir, file).split(sep).slice(0, -1).filter((s) => !/^\(.*\)$/.test(s));
    out.push({ path: toPath(segs), dynamic: segs.some(isDynamic), file: rel(root, file) });
  });
  return out;
}

const ROUTER_DEPS = ["react-router", "react-router-dom", "vue-router", "@solidjs/router", "@tanstack/react-router", "svelte-routing", "wouter"];
const PATH_IN_CONFIG = /\bpath\s*(?::|=)\s*\{?\s*["'`](\/[^"'`\s]*)["'`]/g;

/** Client-side routers: static `path` values in route config or <Route path="…">. Read as text, never run. */
function spa(root: string): Route[] {
  const out: Route[] = [];
  walk(join(root, "src"), (file) => {
    if (!/\.(tsx|jsx|ts|js|vue|svelte)$/.test(file)) return;
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(PATH_IN_CONFIG)) {
      const path = m[1] ?? "/";
      out.push({ path, dynamic: /[:*]/.test(path), file: rel(root, file) });
    }
  });
  return out;
}

export function detectRoutes(root: string): Route[] {
  const fw = detect(root).framework?.id;
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
  try {
    pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as typeof pkg;
  } catch {
    /* no package.json: plain HTML */
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  let routes: Route[] = [];

  if (fw === "next") {
    const app = firstExisting(root, ["app", "src/app"]);
    const pages = firstExisting(root, ["pages", "src/pages"]);
    if (app) routes.push(...nextApp(root, app));
    if (pages) routes.push(...fileRoutes(root, pages, /\.(tsx|jsx|ts|js|mdx)$/, (s) => s[0] === "api" || s.some((x) => x.startsWith("_"))));
  } else if (fw === "sveltekit") routes = sveltekit(root);
  else if (fw === "nuxt") {
    const pages = firstExisting(root, ["pages", "app/pages"]);
    if (pages) routes = fileRoutes(root, pages, /\.vue$/, () => false);
  } else if (fw === "astro") {
    const pages = join(root, "src", "pages");
    routes = fileRoutes(root, pages, /\.(astro|md|mdx|html)$/, (s) => s.some((x) => x.startsWith("_")));
  } else if (ROUTER_DEPS.some((d) => Object.hasOwn(deps, d))) routes = spa(root);

  if (!routes.length) routes = [{ path: "/", dynamic: false, file: existsSync(join(root, "index.html")) ? "index.html" : "" }];
  const byPath = new Map<string, Route>();
  for (const r of routes) if (!byPath.has(r.path)) byPath.set(r.path, r);
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/** Does a concrete URL path match a route pattern ([x], :x, * match one or more segments)? */
export function routeMatches(route: Route, path: string): boolean {
  const clean = (p: string) => (p.split(/[?#]/)[0] ?? "/").replace(/\/+$/, "") || "/";
  const a = clean(route.path).split("/");
  const b = clean(path).split("/");
  for (let i = 0; i < a.length; i++) {
    const seg = a[i] ?? "";
    if (/^\[\[?\.\.\./.test(seg) || seg === "*") return true;
    if (b[i] === undefined) return false;
    if (!isDynamic(seg) && seg !== b[i]) return false;
  }
  return a.length === b.length;
}
