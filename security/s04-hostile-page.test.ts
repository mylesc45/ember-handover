// S4 — App or third-party scripts in the page abuse Handoff.
// A hostile script runs in the page *before* the bridge and tries everything it can.
import { chromium, type Browser, type Frame, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startStack } from "./lib/servers.js";

const HOSTILE = `
  window.__baseline = new Set(Object.getOwnPropertyNames(window));
  window.__muts = [];
  window.__seen = [];
  // Record only script-made DOM changes. Parsing ends with readyState "interactive";
  // deferred scripts (the bridge) run after that, so drop every record queued until then.
  let recording = false;
  const record = (records) => {
    if (!recording) return;
    for (const r of records) {
      window.__muts.push({ type: r.type, target: r.target.nodeName, added: [...r.addedNodes].map((n) => n.nodeName), removed: r.removedNodes.length, attr: r.attributeName });
    }
  };
  const mo = new MutationObserver(record);
  mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  document.addEventListener("readystatechange", () => {
    if (document.readyState !== "interactive") return;
    mo.takeRecords();
    recording = true;
  });
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
    expect(muts, JSON.stringify(muts)).toEqual([{ type: "childList", target: "BODY", added: ["HANDOFF-OVERLAY"], removed: 0, attr: null }]);
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

  it("forged inspect commands from the page don't make the bridge measure or intercept clicks", async () => {
    const frame = await overlayFrame();
    await frame.evaluate(() => {
      (window as unknown as { __forged: number }).__forged = 0;
      addEventListener("message", (e) => {
        if ((e.data as { type?: string })?.type === "spec") (window as unknown as { __forged: number }).__forged++;
      });
    });
    await page.evaluate(() => {
      for (const t of ["*", location.origin]) {
        window.postMessage({ v: 1, type: "inspect", on: true }, t);
        window.postMessage({ v: 1, type: "select", to: "parent" }, t);
        window.postMessage({ v: 1, type: "navigate", path: "/hijacked" }, t);
      }
    });
    let clicks = 0;
    await page.exposeFunction("__countClick", () => clicks++);
    await page.evaluate(() => document.getElementById("app")!.addEventListener("click", () => (window as unknown as { __countClick: () => void }).__countClick()));
    await page.click("#app");
    await page.waitForTimeout(300);
    expect(await frame.evaluate(() => (window as unknown as { __forged: number }).__forged)).toBe(0);
    expect(clicks).toBe(1); // the app's own click handler still ran: inspect mode is off
    expect(new URL(page.url()).pathname).toBe("/"); // forged navigate ignored
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
    await page.click("#app"); // in Inspect mode this pins #app
    await page.keyboard.press("Escape"); // first Esc unpins…
    await page.keyboard.press("Escape"); // …the next closes Dev Mode
    await frame.waitForSelector("[data-handoff-panel]", { state: "detached" });
    await page.keyboard.press("d");
    await frame.waitForSelector("[data-handoff-panel]");
    // The bridge resizes the iframe when the overlay's layout message arrives.
    await frame.waitForFunction(() => innerWidth === 360, null, { timeout: 5000 });
    const muts = await page.evaluate(() => (window as unknown as { __muts: { target: string }[] }).__muts);
    // Only the bridge's host append; the TITLE change above was the hostile script's own.
    const ours = muts.filter((m) => m.target !== "TITLE");
    expect(ours, JSON.stringify(ours)).toHaveLength(1);
  });

  it("typing D into an input does not toggle Dev Mode", async () => {
    const frame = await overlayFrame();
    const open = async () => (await frame.$("[data-handoff-panel]")) !== null;
    // Close Dev Mode first so clicks reach the page (Inspect mode would pin instead).
    for (let i = 0; i < 3 && (await open()); i++) {
      await page.keyboard.press("Escape");
      await frame.waitForSelector("[data-handoff-panel]", { state: "detached", timeout: 1000 }).catch(() => undefined);
    }
    expect(await open()).toBe(false);
    await page.click("#field");
    await page.keyboard.type("d");
    await page.waitForTimeout(200);
    expect(await open()).toBe(false);
    expect(await page.inputValue("#field")).toBe("d");
  });
});
