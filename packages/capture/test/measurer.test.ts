// States (forced via CDP) and breakpoints (headless viewport) must match a real
// browser doing the same thing: real hover, real focus, real mouse-down, a real
// disabled attribute, a real narrow viewport.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { RawSpec } from "@ember-handover/bridge";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startStack } from "../../../security/lib/servers.js";
import { seededHandler } from "../../../e2e/lib/seeded.js";
import { createMeasurer, type Measurer } from "../src/index.js";

const measureScript = readFileSync(fileURLToPath(new URL("../../bridge/dist/measure.js", import.meta.url)), "utf8");

let stack: Awaited<ReturnType<typeof startStack>>;
let measurer: Measurer;
let browser: Browser;

const PATH_48 = async (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector('[data-seed="48"]')!;
    const parts: string[] = [];
    for (let e: Element | null = el; e; e = e.parentElement) {
      const i = e.parentElement ? [...e.parentElement.children].indexOf(e) + 1 : 1;
      parts.unshift(`${e.tagName.toLowerCase()}:nth-child(${i})`);
    }
    return parts.join(" > ");
  });

async function truth(page: Page, selector: string): Promise<RawSpec> {
  await page.addScriptTag({ content: measureScript });
  return page.evaluate((sel) => (globalThis as unknown as { __handoffMeasure: (e: Element) => RawSpec }).__handoffMeasure(document.querySelector(sel)!), selector);
}

const pick = (s: RawSpec) => ({ colors: s.colors, shadow: s.effects.shadow, box: s.box, rect: s.rect, typography: s.typography });

beforeAll(async () => {
  stack = await startStack(seededHandler);
  measurer = createMeasurer({ measureScript });
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await measurer?.close();
  await browser?.close();
  await stack?.close();
});

async function freshPage(width = 1280) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(stack.proxyUrl);
  await page.evaluate(() => document.fonts.ready);
  return page;
}

describe("headless measurer", () => {
  it("reports which browser it will use", async () => {
    const info = await measurer.browser();
    expect(info.available).toBe(true);
  });

  it("default state matches the live page", async () => {
    const page = await freshPage();
    const path = await PATH_48(page);
    const got = await measurer.measure({ url: stack.proxyUrl, path });
    expect(pick(got)).toEqual(pick(await truth(page, '[data-seed="48"]')));
    await page.close();
  });

  it.each(["hover", "focus", "active"] as const)("forced :%s matches a real %s", async (state) => {
    const page = await freshPage();
    const path = await PATH_48(page);
    const sel = '[data-seed="48"]';
    if (state === "hover") await page.hover(sel);
    if (state === "focus") await page.focus(sel);
    if (state === "active") {
      await page.hover(sel);
      await page.mouse.down();
    }
    const want = await truth(page, sel);
    if (state === "active") await page.mouse.up();
    const got = await measurer.measure({ url: stack.proxyUrl, path, state });
    expect(pick(got)).toEqual(pick(want));
    if (state === "hover") {
      const plain = await measurer.measure({ url: stack.proxyUrl, path });
      expect(got.colors.background).not.toBe(plain.colors.background); // the state really applied
    }
    await page.close();
  });

  it("disabled matches a real disabled attribute", async () => {
    const page = await freshPage();
    const path = await PATH_48(page);
    await page.evaluate(() => document.querySelector('[data-seed="48"]')!.setAttribute("disabled", ""));
    const want = await truth(page, '[data-seed="48"]');
    const got = await measurer.measure({ url: stack.proxyUrl, path, state: "disabled" });
    expect(pick(got)).toEqual(pick(want));
    await page.close();
  });

  it("breakpoint re-measure matches a real narrow viewport", async () => {
    const page = await freshPage(375);
    const path = await page.evaluate(() => {
      const el = document.querySelector('[data-seed="50"]')!;
      const parts: string[] = [];
      for (let e: Element | null = el; e; e = e.parentElement) {
        const i = e.parentElement ? [...e.parentElement.children].indexOf(e) + 1 : 1;
        parts.unshift(`${e.tagName.toLowerCase()}:nth-child(${i})`);
      }
      return parts.join(" > ");
    });
    const want = await truth(page, '[data-seed="50"]');
    const got = await measurer.measure({ url: stack.proxyUrl, path, width: 375 });
    expect(pick(got)).toEqual(pick(want));
    expect(got.box.padding).toEqual([4, 4, 4, 4]);
    expect(got.typography.size).toBe(12);
    await page.close();
  });

  it("explains when the element doesn't exist in a fresh browser", async () => {
    await expect(measurer.measure({ url: stack.proxyUrl, path: "html:nth-child(1) > body:nth-child(2) > div:nth-child(99)" })).rejects.toMatchObject({
      code: "ELEMENT_NOT_FOUND",
    });
  });
});
