import type { RawSpec } from "@ember-handover/bridge";
import { HandoffError } from "@ember-handover/core";
import { chromium, type Browser } from "playwright-core";

export type MeasureState = "default" | "hover" | "focus" | "active" | "disabled";

export interface MeasureRequest {
  url: string;
  path: string;
  width?: number;
  state?: MeasureState;
}

export interface BrowserInfo {
  available: boolean;
  kind: "chrome" | "chromium" | null;
}

export interface Measurer {
  browser(): Promise<BrowserInfo>;
  measure(req: MeasureRequest): Promise<RawSpec>;
  close(): Promise<void>;
}

/** Header the proxy honours to skip bridge injection in Handoff's own headless pages. */
export const HEADLESS_HEADER = "x-handoff-headless";

/**
 * Pseudo-classes forced for each state. "Active" means pressed, which in a real browser is
 * hover + active + focus at once (a button takes focus on mouse-down).
 */
const FORCED: Record<Exclude<MeasureState, "default" | "disabled">, string[]> = {
  hover: ["hover"],
  focus: ["focus"],
  active: ["hover", "active", "focus"],
};

interface Options {
  /** Contents of the bridge's dist/measure.js. */
  measureScript: string;
  /** Override for tests. */
  launch?: () => Promise<{ browser: Browser; kind: BrowserInfo["kind"] }>;
}

/**
 * Prefer the Chrome the user already has; fall back to a Playwright-managed Chromium if one
 * is installed. Never downloads anything (see DECISIONS.md: browser install).
 */
async function defaultLaunch(): Promise<{ browser: Browser; kind: BrowserInfo["kind"] }> {
  try {
    return { browser: await chromium.launch({ channel: "chrome", headless: true }), kind: "chrome" };
  } catch {
    return { browser: await chromium.launch({ headless: true }), kind: "chromium" };
  }
}

export function createMeasurer(opts: Options): Measurer {
  let launched: Promise<{ browser: Browser; kind: BrowserInfo["kind"] }> | null = null;
  const get = () => {
    launched ??= (opts.launch ?? defaultLaunch)().catch((e: unknown) => {
      launched = null;
      throw e;
    });
    return launched;
  };

  return {
    async browser() {
      try {
        return { available: true, kind: (await get()).kind };
      } catch {
        return { available: false, kind: null };
      }
    },

    async measure(req) {
      let b: Browser;
      try {
        b = (await get()).browser;
      } catch {
        throw new HandoffError("BROWSER_MISSING");
      }
      const ctx = await b.newContext({
        viewport: { width: req.width ?? 1280, height: 900 },
        deviceScaleFactor: 1,
        extraHTTPHeaders: { [HEADLESS_HEADER]: "1" },
      });
      try {
        await ctx.addInitScript({ content: opts.measureScript });
        const page = await ctx.newPage();
        try {
          await page.goto(req.url, { waitUntil: "load", timeout: 30_000 });
        } catch {
          throw new HandoffError("APP_UNREACHABLE", { port: new URL(req.url).port });
        }
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        const handle = await page.$(req.path);
        if (!handle) throw new HandoffError("ELEMENT_NOT_FOUND");

        const state = req.state ?? "default";
        if (state === "disabled") {
          await handle.evaluate((el) => el.setAttribute("disabled", ""));
        } else if (state !== "default") {
          const cdp = await ctx.newCDPSession(page);
          await cdp.send("DOM.enable");
          await cdp.send("CSS.enable");
          const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
          const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: req.path });
          await cdp.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: FORCED[state] });
        }
        // Jump any CSS transitions/animations to their end state: never measure mid-transition.
        return await handle.evaluate((el) => {
          for (const a of document.getAnimations()) {
            try {
              a.finish();
            } catch {
              /* infinite animations can't finish; leave them */
            }
          }
          return (globalThis as unknown as { __handoffMeasure: (e: Element) => RawSpec }).__handoffMeasure(el);
        });
      } catch (e) {
        if (e instanceof HandoffError) throw e;
        throw new HandoffError("MEASURE_FAILED");
      } finally {
        await ctx.close().catch(() => undefined);
      }
    },

    async close() {
      const l = launched;
      launched = null;
      if (l) await (await l.catch(() => null))?.browser.close().catch(() => undefined);
    },
  };
}
