/**
 * Replays a flow in headless Chromium (the user's Chrome when installed).
 * Closed step vocabulary only; navigation is confined to the app's own loopback origin.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describeSelector, describeStep, HandoffError, isRelativePath, resolveInside, type Flow, type FlowState, type Selector, type Step } from "@ember-handover/core";
import type { Browser, Locator, Page } from "playwright-core";
import { HEADLESS_HEADER, launchBrowser } from "./browser.js";

export interface StepResult {
  index: number;
  ok: boolean;
  description: string;
  error?: string;
  /** What the page showed instead, for failed expectations. */
  actual?: string;
  /** File name inside outDir. */
  screenshot: string | null;
  url: string;
  ms: number;
}

export interface ReplayResult {
  flowId: string;
  state: string | null;
  status: "passing" | "failing";
  failedAt?: number;
  steps: StepResult[];
  at: string;
}

export interface ReplayOptions {
  /** App origin (+ optional base path), e.g. http://localhost:4000 */
  appUrl: string;
  flow: Flow;
  state?: FlowState | undefined;
  /** Screenshots and result.json go here. */
  outDir: string;
  stepTimeoutMs?: number;
}

export interface Replayer {
  replay(opts: ReplayOptions): Promise<ReplayResult>;
  close(): Promise<void>;
}

// --- fixtures ------------------------------------------------------------------------------
export interface FixtureRoute {
  url: string;
  method?: string;
  status?: number;
  json?: unknown;
  body?: string;
  headers?: { "content-type"?: string };
}
export interface Fixture {
  routes: FixtureRoute[];
}
const MAX_FIXTURE_BYTES = 1_000_000;
const ROUTE_KEYS = new Set(["url", "method", "status", "json", "body", "headers"]);
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

/** Fixtures are mock responses for same-origin requests. Data only; validated strictly. */
export function parseFixture(text: string): Fixture | null {
  if (text.length > MAX_FIXTURE_BYTES) return null;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (Object.keys(d).some((k) => k !== "routes") || !Array.isArray(d.routes) || d.routes.length > 100) return null;
  const routes: FixtureRoute[] = [];
  for (const r of d.routes as unknown[]) {
    if (typeof r !== "object" || r === null || Array.isArray(r)) return null;
    const o = r as Record<string, unknown>;
    if (Object.keys(o).some((k) => !ROUTE_KEYS.has(k))) return null;
    const url = typeof o.url === "string" ? o.url : "";
    if (!isRelativePath(url.replace(/\*$/, "") || "/")) return null;
    if (o.method !== undefined && (typeof o.method !== "string" || !METHODS.has(o.method.toUpperCase()))) return null;
    if (o.status !== undefined && (!Number.isInteger(o.status) || (o.status as number) < 100 || (o.status as number) > 599)) return null;
    if (o.body !== undefined && typeof o.body !== "string") return null;
    if (o.headers !== undefined) {
      const h = o.headers as Record<string, unknown>;
      if (typeof h !== "object" || h === null || Object.keys(h).some((k) => k.toLowerCase() !== "content-type") || Object.values(h).some((v) => typeof v !== "string"))
        return null;
    }
    routes.push(o as unknown as FixtureRoute);
  }
  return { routes };
}

// --- steps -------------------------------------------------------------------------------------
function locate(page: Page, s: Selector): Locator {
  if ("testid" in s) return page.getByTestId(s.testid).first();
  if ("role" in s) return page.getByRole(s.role as Parameters<Page["getByRole"]>[0], s.name ? { name: s.name } : {}).first();
  if ("text" in s) return page.getByText(s.text).first();
  if ("label" in s) return page.getByLabel(s.label).first();
  return page.locator(s.css).first();
}

class StepError extends Error {
  constructor(
    message: string,
    readonly actual?: string,
  ) {
    super(message);
  }
}

async function found(page: Page, s: Selector, timeout: number): Promise<Locator> {
  const l = locate(page, s);
  try {
    await l.waitFor({ state: "visible", timeout });
  } catch {
    throw new StepError(`Couldn't find ${describeSelector(s)} on the page.`);
  }
  return l;
}

const visibleText = (page: Page) =>
  page
    .evaluate(() => (document.body?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 500))
    .catch(() => "");

async function run(page: Page, origin: URL, step: Step, timeout: number) {
  if ("goto" in step) {
    const url = new URL(step.goto, origin);
    if (url.origin !== origin.origin) throw new StepError("Flows can only visit pages on your app.");
    await page.goto(url.href, { waitUntil: "load", timeout: Math.max(timeout, 30_000) });
    return;
  }
  if ("click" in step) return void (await (await found(page, step.click, timeout)).click({ timeout }));
  if ("hover" in step) return void (await (await found(page, step.hover, timeout)).hover({ timeout }));
  if ("fill" in step) return void (await (await found(page, step.fill, timeout)).fill(step.fill.value, { timeout }));
  if ("select" in step) {
    const l = await found(page, step.select, timeout);
    try {
      await l.selectOption(step.select.value, { timeout });
    } catch {
      throw new StepError(`Couldn't choose "${step.select.value}" in ${describeSelector(step.select)}.`);
    }
    return;
  }
  if ("press" in step) {
    if (typeof step.press === "string") return void (await page.keyboard.press(step.press));
    return void (await (await found(page, step.press, timeout)).press(step.press.key, { timeout }));
  }
  if ("scroll" in step) {
    if (step.scroll === "top" || step.scroll === "bottom") {
      const to = step.scroll;
      return void (await page.evaluate((t) => window.scrollTo(0, t === "top" ? 0 : document.documentElement.scrollHeight), to));
    }
    return void (await (await found(page, step.scroll, timeout)).scrollIntoViewIfNeeded({ timeout }));
  }
  if ("wait" in step) return void (await page.waitForTimeout(step.wait));
  const e = step.expect;
  if ("url" in e) {
    const want = new URL(e.url, origin);
    try {
      await page.waitForURL((u) => u.pathname === want.pathname && (!want.search || u.search === want.search), { timeout });
    } catch {
      throw new StepError(`Expected the URL ${e.url}, but the page is at ${new URL(page.url()).pathname}.`);
    }
    return;
  }
  try {
    await locate(page, e).waitFor({ state: "visible", timeout });
  } catch {
    throw new StepError(`Expected ${describeSelector(e)}, but it didn't appear.`, await visibleText(page));
  }
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function createReplayer(opts: { root: string; fixturesDir: string; launch?: () => Promise<{ browser: Browser }> }): Replayer {
  let browser: Promise<Browser> | null = null;
  const get = () =>
    (browser ??= (opts.launch ?? launchBrowser)()
      .then((b) => b.browser)
      .catch((e: unknown) => {
        browser = null;
        throw e;
      }));

  const loadFixture = (name: string): Fixture => {
    const p = resolveInside(opts.root, join(opts.fixturesDir, name));
    if (statSync(p, { throwIfNoEntry: false })?.isFile() !== true) throw new StepError(`The fixture ${name} doesn't exist in ${opts.fixturesDir}.`);
    const f = parseFixture(readFileSync(p, "utf8"));
    if (!f) throw new StepError(`The fixture ${name} isn't valid: it needs { "routes": [{ "url": "/api/…", "status": 200, "json": {…} }] }.`);
    return f;
  };

  return {
    async replay({ appUrl, flow, state, outDir, stepTimeoutMs = 10_000 }) {
      let origin: URL;
      try {
        origin = new URL(appUrl);
      } catch {
        throw new HandoffError("BAD_REPLAY_TARGET");
      }
      if (origin.protocol !== "http:" || !LOOPBACK.has(origin.hostname)) throw new HandoffError("BAD_REPLAY_TARGET");
      let b: Browser;
      try {
        b = await get();
      } catch {
        throw new HandoffError("BROWSER_MISSING");
      }
      mkdirSync(outDir, { recursive: true });
      const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, extraHTTPHeaders: { [HEADLESS_HEADER]: "1" } });
      const page = await ctx.newPage();
      const steps: StepResult[] = [];
      let failedAt: number | undefined;
      try {
        for (const [i, step] of flow.steps.entries()) {
          const started = Date.now();
          let error: StepError | null = null;
          try {
            if (state && i === state.at - 1) {
              for (const r of loadFixture(state.fixture).routes) {
                const target = new URL(r.url.replace(/\*$/, ""), origin).href;
                const prefix = r.url.endsWith("*");
                await page.route(
                  (u) => (prefix ? u.href.startsWith(target) : u.href.split("#")[0] === target),
                  (route) => {
                    if (r.method && route.request().method() !== r.method.toUpperCase()) return route.fallback();
                    return route.fulfill({
                      status: r.status ?? 200,
                      contentType: r.headers?.["content-type"] ?? (r.json !== undefined ? "application/json" : "text/plain"),
                      body: r.json !== undefined ? JSON.stringify(r.json) : (r.body ?? ""),
                    });
                  },
                );
              }
            }
            await run(page, origin, step, stepTimeoutMs);
          } catch (e) {
            error = e instanceof StepError ? e : new StepError(`This step failed: ${(e as Error).message.split("\n")[0]}`);
          }
          // A cold browser on a slow machine can take a while to paint; retry once.
          const shot = `${i + 1}.png`;
          const capture = () =>
            page
              .screenshot({ path: join(outDir, shot), timeout: 15_000 })
              .then(() => shot)
              .catch(() => null);
          const saved = (await capture()) ?? (await capture());
          steps.push({
            index: i,
            ok: !error,
            description: describeStep(step),
            ...(error ? { error: error.message } : {}),
            ...(error?.actual !== undefined ? { actual: error.actual } : {}),
            screenshot: saved,
            url: page.url(),
            ms: Date.now() - started,
          });
          if (error) {
            failedAt = i;
            break;
          }
        }
      } finally {
        await ctx.close().catch(() => undefined);
      }
      const result: ReplayResult = {
        flowId: flow.id,
        state: state?.id ?? null,
        status: failedAt === undefined ? "passing" : "failing",
        ...(failedAt !== undefined ? { failedAt } : {}),
        steps,
        at: new Date().toISOString(),
      };
      writeFileSync(join(outDir, "result.json"), JSON.stringify(result, null, 2));
      return result;
    },
    async close() {
      const p = browser;
      browser = null;
      if (p) await (await p.catch(() => null))?.close().catch(() => undefined);
    },
  };
}
