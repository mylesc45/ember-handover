// M2 "Done when": 100% Layer 1 accuracy against Playwright ground truth on seeded elements.
//
// Each seed is measured through the real path (Dev Mode on, click the element,
// bridge measures, overlay receives the spec) and compared with ground truth read
// independently through the Chrome DevTools Protocol.
import type { RawSpec } from "@ember-handover/bridge";
import { contrastRatio, normalizeSpec, parseColor } from "@ember-handover/tokens";
import { chromium, type Browser, type CDPSession, type Frame, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startStack } from "../security/lib/servers.js";
import { seededHandler } from "./lib/seeded.js";

const SEEDS = Array.from({ length: 50 }, (_, i) => i + 1);
const TRANSFORMED = new Set([10]); // box quads are scaled; size is checked against the rendered box only

let stack: Awaited<ReturnType<typeof startStack>>;
let browser: Browser;
let page: Page;
let overlay: Frame;
let cdp: CDPSession;
const measured = new Map<number, RawSpec>();
const mismatches: string[] = [];
let checks = 0;

async function overlayFrame(p: Page): Promise<Frame> {
  for (let i = 0; i < 200; i++) {
    const f = p.frames().find((fr) => fr.url().startsWith(stack.overlayUrl));
    if (f && (await f.$("[data-handoff-pill], [data-handoff-panel]"))) return f;
    await p.waitForTimeout(50);
  }
  throw new Error("overlay never appeared");
}

beforeAll(async () => {
  stack = await startStack(seededHandler);
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(stack.proxyUrl);
  await page.evaluate(() => document.fonts.ready);
  overlay = await overlayFrame(page);
  // Record every pinned spec the overlay receives from the bridge.
  await overlay.evaluate(() => {
    (window as unknown as { __specs: unknown[] }).__specs = [];
    addEventListener("message", (e) => {
      const d = e.data as { type?: string; pinned?: boolean; spec?: unknown };
      if (d?.type === "spec" && d.pinned) (window as unknown as { __specs: unknown[] }).__specs.push(d.spec);
    });
  });
  await page.keyboard.press("d"); // open Dev Mode; Inspect is the default tab
  await overlay.waitForSelector("[data-handoff-panel]");
  cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  await cdp.send("Accessibility.enable");

  for (const n of SEEDS) {
    const el = page.locator(`[data-seed="${n}"]`);
    const box = await el.boundingBox();
    if (!box) throw new Error(`seed ${n} has no box`);
    const path = await el.evaluate((e) => {
      const parts: string[] = [];
      for (let x: Element | null = e; x; x = x.parentElement) {
        const i = x.parentElement ? [...x.parentElement.children].indexOf(x) + 1 : 1;
        parts.unshift(`${x.localName}:nth-child(${i})`);
      }
      return parts.join(" > ");
    });
    // Click just inside the top-left of the border box, where no child sits.
    const x = box.x + Math.min(2, box.width / 2);
    const y = box.y + Math.min(2, box.height / 2);
    const hit = await page.evaluate(([px, py]) => document.elementFromPoint(px!, py!)?.getAttribute("data-seed"), [x, y]);
    expect(hit, `seed ${n} is not the element at its click point`).toBe(String(n));
    await page.mouse.click(x, y);
    const spec = (await (
      await overlay.waitForFunction(
        (want) => {
          const s = (window as unknown as { __specs: { path: string }[] }).__specs;
          return s.findLast((v) => v.path === want) ?? false;
        },
        path,
      )
    ).jsonValue()) as RawSpec;
    measured.set(n, spec);
    await compare(n, spec);
  }
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await stack?.close();
});

async function nodeFor(n: number) {
  const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: `[data-seed="${n}"]` });
  return nodeId;
}

async function computed(nodeId: number): Promise<Record<string, string>> {
  const { computedStyle } = await cdp.send("CSS.getComputedStyleForNode", { nodeId });
  return Object.fromEntries(computedStyle.map((p) => [p.name, p.value]));
}

const px = (v: string | undefined) => (v === undefined || v === "normal" || v === "none" ? null : Number.parseFloat(v));
const quadSides = (outer: number[], inner: number[]) => [inner[1]! - outer[1]!, outer[2]! - inner[2]!, outer[5]! - inner[5]!, inner[0]! - outer[0]!];
const same = (a: unknown, b: unknown): boolean => {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-3;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  return JSON.stringify(a) === JSON.stringify(b);
};

function check(n: number, prop: string, got: unknown, want: unknown) {
  checks++;
  if (!same(got, want)) mismatches.push(`seed ${n} ${prop}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

/** Ground truth for one seed, read through CDP at the same moment the bridge measured it. */
async function compare(n: number, s: RawSpec) {
  const nodeId = await nodeFor(n);
  const cs = await computed(nodeId);

  // Size and position: Playwright's rendered box.
  const bb = (await page.locator(`[data-seed="${n}"]`).boundingBox())!;
  check(n, "rect.x", s.rect.x, bb.x);
  check(n, "rect.y", s.rect.y, bb.y);
  check(n, "rect.width", s.rect.width, bb.width);
  check(n, "rect.height", s.rect.height, bb.height);

  // Box model: CDP quads.
  if (!TRANSFORMED.has(n)) {
    const { model } = await cdp.send("DOM.getBoxModel", { nodeId });
    check(n, "padding", s.box.padding, quadSides(model.padding, model.content));
    check(n, "border", s.box.border, quadSides(model.border, model.padding));
    if (cs.display !== "inline") check(n, "margin", s.box.margin, quadSides(model.margin, model.border));
  }
  check(n, "box.borderStyle", s.box.borderStyle, cs["border-top-style"]);

  // Computed styles: CDP.
  const layout: [keyof RawSpec["layout"], string][] = [
    ["display", "display"],
    ["position", "position"],
    ["boxSizing", "box-sizing"],
    ["flexDirection", "flex-direction"],
    ["flexWrap", "flex-wrap"],
    ["justifyContent", "justify-content"],
    ["alignItems", "align-items"],
    ["gridTemplateColumns", "grid-template-columns"],
    ["gridTemplateRows", "grid-template-rows"],
  ];
  for (const [k, css] of layout) check(n, `layout.${k}`, s.layout[k], cs[css]);
  check(n, "layout.rowGap", s.layout.rowGap, px(cs["row-gap"]));
  check(n, "layout.columnGap", s.layout.columnGap, px(cs["column-gap"]));

  check(n, "typography.family", s.typography.family, cs["font-family"]);
  check(n, "typography.size", s.typography.size, px(cs["font-size"]));
  check(n, "typography.weight", s.typography.weight, Number(cs["font-weight"]));
  check(n, "typography.lineHeight", s.typography.lineHeight, px(cs["line-height"]));
  check(n, "typography.letterSpacing", s.typography.letterSpacing, px(cs["letter-spacing"]));
  check(n, "typography.textAlign", s.typography.textAlign, cs["text-align"]);
  check(n, "typography.textTransform", s.typography.textTransform, cs["text-transform"]);
  check(n, "typography.fontStyle", s.typography.fontStyle, cs["font-style"]);

  check(n, "colors.text", s.colors.text, cs.color);
  check(n, "colors.background", s.colors.background, cs["background-color"]);
  check(n, "colors.border", s.colors.border, ["top", "right", "bottom", "left"].map((side) => cs[`border-${side}-color`]));
  const corner = (v: string | undefined) => {
    const first = (v ?? "0").split(" ")[0]!;
    return first.endsWith("%") ? (Number.parseFloat(first) / 100) * bb.width : Number.parseFloat(first);
  };
  check(n, "effects.radius", s.effects.radius, ["top-left", "top-right", "bottom-right", "bottom-left"].map((c) => corner(cs[`border-${c}-radius`])));
  check(n, "effects.shadow", s.effects.shadow, cs["box-shadow"]);
  check(n, "effects.opacity", s.effects.opacity, Number(cs.opacity));
  const items = (k: string) => (cs[k] ?? "").split(/,(?![^(]*\))/).map((x) => x.trim());
  const [tp, td, tt, tdl] = ["transition-property", "transition-duration", "transition-timing-function", "transition-delay"].map(items) as [string[], string[], string[], string[]];
  check(n, "effects.transition", s.effects.transition, tp.map((p, i) => `${p} ${td[i % td.length]} ${tt[i % tt.length]} ${tdl[i % tdl.length]}`).join(", "));
  check(n, "effects.transform", s.effects.transform, cs.transform);

  // Rendered font face: CDP platform fonts (web fonts only; system fallbacks are reported as null).
  const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
  const custom = fonts.find((f) => f.isCustomFont);
  if (custom && fonts.length === 1) check(n, "typography.rendered", s.typography.rendered, custom.familyName);

  // Accessibility: CDP AX tree.
  const { node } = await cdp.send("DOM.describeNode", { nodeId });
  const { nodes } = await cdp.send("Accessibility.getPartialAXTree", { backendNodeId: node.backendNodeId, fetchRelatives: false });
  const ax = nodes[0];
  if (ax && !ax.ignored) {
    check(n, "a11y.role", s.a11y.role, ax.role?.value);
    check(n, "a11y.name", s.a11y.name, ax.name?.value ?? "");
  }
}

describe("Layer 1 accuracy on 50 seeded elements", () => {
  it("measured every seed through the overlay channel", () => {
    expect([...measured.keys()]).toEqual(SEEDS);
  });

  it("matches ground truth for every property of every seed (100%)", () => {
    expect(mismatches).toEqual([]);
    expect(checks).toBeGreaterThan(50 * 30);
  });

  it("normalised colours match what Chrome paints (canvas pixel readback)", async () => {
    const mismatches: string[] = [];
    for (const n of SEEDS) {
      const raw = measured.get(n)!;
      for (const c of [raw.colors.text, raw.colors.background]) {
        const parsed = parseColor(c);
        if (!parsed || parsed.alpha !== 1) continue;
        const ours = normalizeSpec({ ...raw, colors: { ...raw.colors, background: c } }, { system: "none", sources: [], spacingBase: null, breakpoints: [], tokens: [] })
          .colors.background?.hex;
        const painted = await page.evaluate((color) => {
          const cv = document.createElement("canvas");
          cv.width = cv.height = 1;
          const ctx = cv.getContext("2d", { colorSpace: "srgb" })!;
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 1, 1);
          const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
          return "#" + [r, g, b].map((v) => v!.toString(16).padStart(2, "0")).join("");
        }, c);
        if (ours !== painted) mismatches.push(`seed ${n} ${c}: ours ${ours}, painted ${painted}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("contrast ratios match the SPEC's measured pairs", async () => {
    const pairs = await page.$$eval("[data-contrast]", (els) =>
      els.map((el) => {
        const cs = getComputedStyle(el);
        let bg = cs.backgroundColor;
        for (let p = el.parentElement; p && bg === "rgba(0, 0, 0, 0)"; p = p.parentElement) bg = getComputedStyle(p).backgroundColor;
        return { want: Number(el.getAttribute("data-contrast")), fg: cs.color, bg };
      }),
    );
    for (const p of pairs) {
      expect(Math.abs(contrastRatio(parseColor(p.fg)!, parseColor(p.bg)!) - p.want), `${p.fg} on ${p.bg}`).toBeLessThan(0.01);
    }
  });

  it("the Inspect panel shows the pinned element's size", async () => {
    await page.mouse.click(...(await clickPoint(1)));
    await overlay.waitForFunction(() => document.body.textContent?.includes("100 × 40"));
  });
});

async function clickPoint(n: number): Promise<[number, number]> {
  const b = (await page.locator(`[data-seed="${n}"]`).boundingBox())!;
  return [b.x + 2, b.y + 2];
}
