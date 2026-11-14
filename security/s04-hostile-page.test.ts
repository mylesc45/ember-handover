// S4 — App or third-party scripts in the page abuse Handoff.
// A hostile script runs in the page *before* the bridge and tries everything it can.
import { chromium, type Browser, type Frame, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startStack } from "./lib/servers.js";

const HOSTILE = `
  window.__baseline = new Set(Object.getOwnPropertyNames(window));
  window.__muts = [];
  window.__seen = [];
  new MutationObserver((records) => {
    for (const r of records) {
      if (document.readyState === "loading") continue; // parser work, not script work
      window.__muts.push({ type: r.type, target: r.target.nodeName, added: [...r.addedNodes].map((n) => n.nodeName), removed: r.removedNodes.length, attr: r.attributeName });
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  addEventListener("message", (e) => window.__seen.push(JSON.stringify(e.data)), true);
`;

const PAGE = `<!doctype html><html><head><title>Hostile</title><script>${HOSTILE}</script></head>
<body><h1 id="app">app</h1><input id="field"></body></html>`;

let stack: Awaited<ReturnType<typeof startStack>>;
let browser: Browser;
let page: Page;

async function overlayFrame(): Promise<Frame> {
  for (let i = 0; i < 100; i++) {
    const f = page.frames().find((fr) => fr.url().startsWith(stack.overlayUrl));
    if (f) {
      await f.waitForSelector("[data-handoff-pill], [data-handoff-panel]", { timeout: 5000 });
      return f;
    }
    await page.waitForTimeout(50);
  }
  throw new Error("overlay frame never appeared");
}

const frameSize = (f: Frame) => f.evaluate(() => [innerWidth, innerHeight]);

beforeAll(async () => {
  stack = await startStack((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(PAGE);
  });
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.goto(stack.proxyUrl);
  await overlayFrame();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await stack?.close();
});

describe("S4 hostile page cannot reach the token or drive the bridge", () => {
  it("page console stays clean (no Handoff errors or warnings)", async () => {
    const fresh = await browser.newPage();
    const noise: string[] = [];
    fresh.on("console", (m) => (m.type() === "error" || m.type() === "warning") && noise.push(m.text()));
    await fresh.goto(stack.proxyUrl);
    await fresh.waitForTimeout(1000);
    await fresh.keyboard.press("d");
    await fresh.waitForTimeout(500);
    await fresh.close();
    expect(noise).toEqual([]);
  });

  it("bridge exposes no globals on window", async () => {
    const added = await page.evaluate(() =>
      Object.getOwnPropertyNames(window).filter(
        (k) => !(window as unknown as { __baseline: Set<string> }).__baseline.has(k) && !/^\d+$/.test(k) && !k.startsWith("__"),
      ),
    );
    expect(added).toEqual([]);
  });

  it("overlay lives in a closed shadow root", async () => {
    const r = await page.evaluate(() => {
      const host = document.querySelector("handoff-overlay");
      return { exists: !!host, shadow: host?.shadowRoot ?? null, iframes: document.querySelectorAll("iframe").length };
    });
    expect(r).toEqual({ exists: true, shadow: null, iframes: 0 });
  });

  it("bridge's only DOM write outside its shadow root is appending its host", async () => {
    const muts = await page.evaluate(() => (window as unknown as { __muts: unknown[] }).__muts);
    expect(muts).toEqual([{ type: "childList", target: "BODY", added: ["HANDOFF-OVERLAY"], removed: 0, attr: null }]);
  });

  it("page cannot read the session token by any route", async () => {
    const result = await page.evaluate(async (coreUrl) => {
      const attempts: string[] = [];
      const tryIt = async (name: string, fn: () => Promise<string> | string) => {
        try {
          attempts.push(`${name}:${await fn()}`);
        } catch (e) {
          attempts.push(`${name}:blocked:${(e as Error).name}`);
        }
      };
      await tryIt("fetch-page", async () => (await fetch(coreUrl)).text());
      await tryIt("fetch-api", async () => (await fetch(coreUrl + "api/session")).text());
      await tryIt("fetch-no-cors", async () => (await fetch(coreUrl, { mode: "no-cors" })).text());
      await tryIt("frame-doc", () => (window.frames[0] as Window).document.documentElement.outerHTML);
      return { attempts, html: document.documentElement.outerHTML, seen: (window as unknown as { __seen: string[] }).__seen };
    }, stack.overlayUrl);
    const everything = JSON.stringify(result);
    expect(everything).not.toContain(stack.token);
    // Inside a closed shadow root the frame isn't even listed in window.frames (TypeError);
    // if it were, cross-origin access would throw SecurityError. Either way: blocked.
    expect(result.attempts.find((a) => a.startsWith("frame-doc"))).toMatch(/blocked:(SecurityError|TypeError)/);
    expect(result.attempts.find((a) => a.startsWith("fetch-page"))).toMatch(/blocked:TypeError/);
    // Cross-Origin-Resource-Policy: same-origin blocks even opaque no-cors reads.
    expect(result.attempts.find((a) => a.startsWith("fetch-no-cors"))).toBe("fetch-no-cors:blocked:TypeError");
  });

  it("forged commands posted in the page do not drive the bridge", async () => {
    const frame = await overlayFrame();
    const before = await frameSize(frame);
    await page.evaluate(() => {
      for (const target of ["*", location.origin]) {
        window.postMessage({ v: 1, type: "layout", mode: "panel" }, target);
      }
      document.dispatchEvent(new MessageEvent("message", { data: { v: 1, type: "layout", mode: "panel" } }));
      window.dispatchEvent(new MessageEvent("message", { data: { v: 1, type: "layout", mode: "panel" }, origin: "http://127.0.0.1:1" }));
    });
    await page.waitForTimeout(300);
    expect(await frameSize(frame)).toEqual(before);
  });

  it("text the page sends the overlay renders as plain text", async () => {
    const frame = await overlayFrame();
    await page.evaluate(() => {
      document.title = '<img src=x onerror="document.body.dataset.pwned=1">';
    });
    await page.keyboard.press("d");
    await frame.waitForSelector("[data-handoff-panel]");
    await frame.waitForFunction(() => document.body.textContent?.includes("<img src=x"), null, { timeout: 5000 });
    expect(await frame.evaluate(() => document.body.dataset.pwned ?? null)).toBeNull();
    expect(await frame.evaluate(() => document.querySelectorAll("[data-handoff-panel] img").length)).toBe(0);
  });

  it("D opens the panel and Esc closes it, with no DOM writes outside the shadow root", async () => {
    const frame = await overlayFrame();
    await page.click("#app");
    await page.keyboard.press("Escape");
    await frame.waitForSelector("[data-handoff-panel]", { state: "detached" });
    await page.keyboard.press("d");
    await frame.waitForSelector("[data-handoff-panel]");
    expect((await frameSize(frame))[0]).toBe(360);
    const muts = await page.evaluate(() => (window as unknown as { __muts: { target: string }[] }).__muts);
    // Only the bridge's host append; the TITLE change above was the hostile script's own.
    expect(muts.filter((m) => m.target !== "TITLE")).toHaveLength(1);
  });

  it("typing D into an input does not toggle Dev Mode", async () => {
    const frame = await overlayFrame();
    const open = async () => (await frame.$("[data-handoff-panel]")) !== null;
    const before = await open();
    await page.click("#field");
    await page.keyboard.type("dd");
    await page.waitForTimeout(200);
    expect(await open()).toBe(before);
  });
});
