import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { detectRoutes } from "../src/routes.js";
import { draftFlows } from "../src/init.js";
import { parseFlows } from "@ember-handover/core";

const templates = fileURLToPath(new URL("../../../fixtures/templates/", import.meta.url));
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
function app(deps: Record<string, string>, files: string[]): string {
  const d = mkdtempSync(join(tmpdir(), "handoff-routes-"));
  dirs.push(d);
  writeFileSync(join(d, "package.json"), JSON.stringify({ dependencies: deps }));
  for (const f of files) {
    const [path, content = "export default 1"] = f.split("::");
    mkdirSync(join(d, path!, ".."), { recursive: true });
    writeFileSync(join(d, path!), content);
  }
  return d;
}
const paths = (d: string) => detectRoutes(d).map((r) => `${r.path}${r.dynamic ? " (dynamic)" : ""}`);

describe("detectRoutes", () => {
  it.each(["vite-react", "vite-vue", "vite-svelte", "vite-solid", "next-app", "next-pages"])("%s template has /", (t) => {
    expect(paths(join(templates, t))).toEqual(["/"]);
  });

  it("Next App Router: groups, private folders, dynamic segments", () => {
    const d = app({ next: "16" }, ["app/page.tsx", "app/about/page.tsx", "app/(marketing)/pricing/page.tsx", "app/_lib/page.tsx", "app/blog/[slug]/page.tsx", "app/api/x/route.ts", "src/app/ignored-when-app-exists/page.tsx"]);
    expect(paths(d)).toEqual(["/", "/about", "/blog/[slug] (dynamic)", "/pricing"]);
  });

  it("Next Pages Router: skips _app, _document and api", () => {
    const d = app({ next: "16" }, ["pages/index.tsx", "pages/_app.tsx", "pages/_document.tsx", "pages/api/hello.ts", "pages/docs/index.tsx", "pages/docs/[id].tsx"]);
    expect(paths(d)).toEqual(["/", "/docs", "/docs/[id] (dynamic)"]);
  });

  it("SvelteKit, Nuxt and Astro file routes", () => {
    expect(paths(app({ "@sveltejs/kit": "2" }, ["src/routes/+page.svelte", "src/routes/about/+page.svelte", "src/routes/(app)/settings/+page.svelte"]))).toEqual(["/", "/about", "/settings"]);
    expect(paths(app({ nuxt: "4" }, ["pages/index.vue", "pages/team.vue", "pages/users/[id].vue"]))).toEqual(["/", "/team", "/users/[id] (dynamic)"]);
    expect(paths(app({ astro: "5" }, ["src/pages/index.astro", "src/pages/blog.md", "src/pages/rss.xml.ts"]))).toEqual(["/", "/blog"]);
  });

  it("SPA routers: static paths from route config", () => {
    const d = app({ vite: "8", "react-router": "7" }, [
      'src/main.tsx::createBrowserRouter([{ path: "/", element: x }, { path: "/settings", element: y }, { path: "/users/:id" }])',
      'src/Other.tsx::<Route path="/help" element={<Help/>} />',
    ]);
    expect(paths(d)).toEqual(["/", "/help", "/settings", "/users/:id (dynamic)"]);
  });

  it("plain SPA without a router has just /", () => {
    expect(paths(app({ vite: "8" }, ["src/main.ts"]))).toEqual(["/"]);
  });
});

describe("draftFlows", () => {
  it("drafts one valid flow per static route and notes dynamic ones", () => {
    const yaml = draftFlows([
      { path: "/", dynamic: false, file: "app/page.tsx" },
      { path: "/about", dynamic: false, file: "app/about/page.tsx" },
      { path: "/blog/[slug]", dynamic: true, file: "app/blog/[slug]/page.tsx" },
    ]);
    const r = parseFlows(yaml);
    expect(r.errors).toEqual([]);
    expect(r.file?.flows.map((f) => [f.id, f.steps[0]])).toEqual([
      ["home", { goto: "/" }],
      ["about", { goto: "/about" }],
    ]);
    expect(yaml).toContain("# /blog/[slug]");
  });
});
