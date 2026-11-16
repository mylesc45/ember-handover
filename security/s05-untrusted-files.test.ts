// S5 — Untrusted PR files execute code during review.
// Flow files come from PRs: the parser must treat them strictly as data.
import { parseFlows, MAX_FLOWS_BYTES } from "@ember-handover/core";
import { parseFixture } from "@ember-handover/capture";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startStack } from "./lib/servers.js";

const wrap = (steps: string, extra = "") => `version: 1\n${extra}flows:\n  - id: a\n    name: A\n    steps:\n${steps}\n`;

describe("S5 flows.yaml is data, never code", () => {
  it.each([
    ["eval step", "      - eval: alert(1)"],
    ["script step", "      - script: { src: /x.js }"],
    ["shell step", "      - shell: rm -rf /"],
    ["run step", "      - run: npm test"],
    ["function value", "      - click: { testid: !!js/function 'function(){return 1}' }"],
    ["custom tag", "      - goto: !include /etc/passwd"],
    ["python tag", "      - goto: !!python/object/apply:os.system ['id']"],
  ])("rejects %s", (_n, step) => {
    const r = parseFlows(wrap(step));
    expect(r.file).toBeNull();
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it.each([
    "https://evil.example/",
    "//evil.example/",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "\\\\evil.example\\share",
    "/\\evil.example",
    "relative/path",
  ])("rejects absolute or non-path goto %s", (url) => {
    expect(parseFlows(wrap(`      - goto: ${JSON.stringify(url)}`)).file).toBeNull();
  });

  it.each(["https://evil.example/", "//evil.example", "javascript:x"])("rejects absolute baseUrl %s", (url) => {
    expect(parseFlows(wrap("      - goto: /", `baseUrl: ${JSON.stringify(url)}\n`)).file).toBeNull();
  });

  it.each(["../../etc/passwd", "/etc/passwd", "C:\\\\x", "..\\\\..\\\\x"])("rejects fixtures dir and fixture paths escaping the repo: %s", (p) => {
    expect(parseFlows(wrap("      - goto: /", `fixtures: ${JSON.stringify(p)}\n`)).file).toBeNull();
    const withState = `version: 1\nflows:\n  - id: a\n    name: A\n    steps: [{ goto: / }]\n    states: [{ id: s, fixture: ${JSON.stringify(p)}, at: 1 }]\n`;
    expect(parseFlows(withState).file).toBeNull();
  });

  it("rejects files over 1 MB without parsing them", () => {
    const big = wrap("      - goto: /") + "#" + "x".repeat(MAX_FLOWS_BYTES);
    const r = parseFlows(big);
    expect(r.file).toBeNull();
    expect(r.errors[0]?.message).toMatch(/1 MB/);
  });

  it("rejects alias bombs (more than 100 aliases)", () => {
    const lines = ["a: &a [x, x, x, x, x, x, x, x, x, x]"];
    for (let i = 1; i < 12; i++) lines.push(`${String.fromCharCode(97 + i)}: &${String.fromCharCode(97 + i)} [${Array(10).fill(`*${String.fromCharCode(96 + i)}`).join(", ")}]`);
    const start = performance.now();
    const r = parseFlows(lines.join("\n"));
    expect(r.file).toBeNull();
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it("does not pollute prototypes", () => {
    parseFlows(`version: 1\n__proto__: { polluted: true }\nflows:\n  - id: a\n    name: A\n    __proto__: { polluted: true }\n    steps: [{ goto: /, constructor: { prototype: { polluted: true } } }]\n`);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("caps sizes: flows, steps, string lengths", () => {
    const manySteps = Array.from({ length: 201 }, () => "      - goto: /").join("\n");
    expect(parseFlows(wrap(manySteps)).file).toBeNull();
    expect(parseFlows(wrap(`      - goto: /\n        intent: ${"x".repeat(600)}`)).file).toBeNull();
  });

  it("never throws on random input (fuzz, 3000 cases)", () => {
    const pieces = ["version: 1", "flows:", "  - ", "id: a", "name: A", "steps:", "- goto: /", "{", "}", "[", "]", "&a", "*a", "!!str", "'", '"', ":", "\n", "  ", "#", "|", ">", "?", "%YAML 1.2", "---", "...", "\t", "\u0000", "\uFFFF", "click:", "testid: x"];
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let i = 0; i < 3000; i++) {
      let s = "";
      const n = Math.floor(rand() * 40);
      for (let j = 0; j < n; j++) s += pieces[Math.floor(rand() * pieces.length)];
      const r = parseFlows(s);
      expect(r.file === null || r.errors.length === 0).toBe(true);
    }
  });
});

describe("S5 fixtures are data with same-origin routes only", () => {
  it("accepts a valid fixture", () => {
    expect(parseFixture(JSON.stringify({ routes: [{ url: "/api/pay", method: "POST", status: 402, json: { error: "declined" } }] }))).not.toBeNull();
  });
  it.each([
    { routes: [{ url: "https://evil.example/api" }] },
    { routes: [{ url: "//evil.example/api" }] },
    { routes: [{ url: "/api", status: 99 }] },
    { routes: [{ url: "/api", headers: { "set-cookie": "a=b" } }] },
    { routes: [{ url: "/api", script: "alert(1)" }] },
    { routes: Array.from({ length: 101 }, () => ({ url: "/a" })) },
    { evil: true },
  ])("rejects %j", (f) => expect(parseFixture(JSON.stringify(f))).toBeNull());
  it("rejects non-JSON and oversize input", () => {
    expect(parseFixture("{nope")).toBeNull();
    expect(parseFixture(JSON.stringify({ routes: [{ url: "/a", body: "x".repeat(1_100_000) }] }))).toBeNull();
  });
});

describe("S5 flow names, intents and steps render as plain text", () => {
  const XSS = [
    '<img src=x onerror="document.body.dataset.pwned=1">',
    "<script>document.body.dataset.pwned=1</script>",
    '"><svg onload="document.body.dataset.pwned=1">',
    "javascript:document.body.dataset.pwned=1",
    "{{constructor.constructor('document.body.dataset.pwned=1')()}}",
  ];
  let stack: Awaited<ReturnType<typeof startStack>>;
  let browser: Browser;
  beforeAll(async () => {
    const flows = XSS.map((x, i) => ({
      id: `f${i}`,
      name: x,
      intent: x,
      steps: [{ goto: "/", intent: x }, { expect: { text: x } }],
      states: [],
    }));
    stack = await startStack((_q, r) => r.writeHead(200, { "content-type": "text/html" }).end("<html><head></head><body>app</body></html>"), {
      flows: {
        list: async () => ({ exists: true, flows: flows.map((f) => ({ flow: f, status: "not-run", result: null, states: {} })), errors: [], warnings: [] }),
        replay: async () => ({ status: "passing", steps: [] }),
        shot: async () => null,
      },
    });
    browser = await chromium.launch();
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
    await stack?.close();
  });

  it("renders every payload as text in the list and player", async () => {
    const page = await browser.newPage();
    await page.goto(stack.proxyUrl);
    const frame = await (async () => {
      for (let i = 0; i < 100; i++) {
        const f = page.frames().find((x) => x.url().startsWith(stack.overlayUrl));
        if (f && (await f.$("[data-handoff-pill]"))) return f;
        await page.waitForTimeout(50);
      }
      throw new Error("no overlay");
    })();
    await page.keyboard.press("d");
    await frame.click('[role="tab"]:has-text("Flows")');
    await frame.waitForSelector("[data-handoff-flow]");
    for (const x of XSS) await frame.waitForFunction((t) => document.body.textContent?.includes(t), x);
    await frame.click("[data-handoff-flow]");
    await frame.waitForSelector("[data-handoff-player]");
    expect(await frame.evaluate(() => document.body.dataset.pwned ?? null)).toBeNull();
    expect(await frame.evaluate(() => document.querySelectorAll("[data-handoff-panel] img:not([data-handoff-shot]), [data-handoff-panel] script, [data-handoff-panel] svg[onload]").length)).toBe(0);
    await page.close();
  });
});
