// M1 "Done when": overlay appears on all Vite and Next templates, and HMR works through the proxy.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { chromium, type Browser, type Frame, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const bin = join(root, "packages/cli/dist/bin.js");

// file to edit, text in it, for each template
const TEMPLATES: Record<string, { file: string; text: string }> = {
  "vite-react": { file: "src/App.tsx", text: "Get started" },
  "vite-vue": { file: "src/components/HelloWorld.vue", text: "Get started" },
  "vite-svelte": { file: "src/lib/Counter.svelte", text: "Count is" },
  "vite-solid": { file: "src/App.tsx", text: "Get started" },
  "next-app": { file: "app/page.tsx", text: "To get started" },
  "next-pages": { file: "pages/index.tsx", text: "To get started" },
};

const only = process.env.HANDOFF_E2E_TEMPLATES?.split(",");
const names = Object.keys(TEMPLATES).filter((n) => !only || only.includes(n));

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => browser?.close());

async function startHandoff(cwd: string) {
  const proc = execa(process.execPath, [bin], {
    cwd,
    env: { HANDOFF_NO_OPEN: "1", NO_COLOR: "1" },
    reject: false,
    all: true,
    forceKillAfterDelay: 3000,
  });
  const url = await new Promise<string>((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`no URL after 90s:\n${out}`)), 90_000);
    proc.all?.on("data", (d: Buffer) => {
      out += d.toString();
      const m = /Handoff is running: (http:\/\/localhost:\d+)/.exec(out);
      if (m?.[1]) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    void proc.then((r) => reject(new Error(`handoff exited early (${r.exitCode}):\n${out}`)));
  });
  return { proc, url } as const;
}

async function overlay(page: Page): Promise<Frame> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    for (const f of page.frames()) {
      if (/^http:\/\/127\.0\.0\.1:\d+\/$/.test(f.url()) && (await f.$("[data-handoff-pill], [data-handoff-panel]").catch(() => null))) return f;
    }
    await page.waitForTimeout(100);
  }
  throw new Error("overlay never appeared");
}

describe.each(names)("%s", (name) => {
  const cwd = join(root, "fixtures/templates", name);
  const { file, text } = TEMPLATES[name]!;
  const path = join(cwd, file);
  let original: string;
  let handoff: Awaited<ReturnType<typeof startHandoff>>;
  let page: Page;

  beforeAll(async () => {
    original = readFileSync(path, "utf8");
    expect(original, `${file} should contain "${text}"`).toContain(text);
    handoff = await startHandoff(cwd);
    page = await browser.newPage();
  }, 120_000);

  afterAll(async () => {
    writeFileSync(path, original);
    await page?.close();
    if (process.platform === "win32" && handoff?.proc.pid) {
      // Windows has no SIGINT for child processes: stop the whole tree.
      await execa("taskkill", ["/pid", String(handoff.proc.pid), "/T", "/F"], { reject: false });
    } else {
      handoff?.proc.kill("SIGINT");
    }
    await handoff?.proc;
  }, 30_000);

  it("shows the overlay pill, and D opens the panel", async () => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(handoff.url, { waitUntil: "load", timeout: 90_000 });
    const frame = await overlay(page);
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("d");
    await frame.waitForSelector("[data-handoff-panel]");
    expect(await frame.textContent("[data-handoff-panel]")).toContain("Inspect");
    expect(await frame.textContent("[data-handoff-panel]")).toMatch(/Connected/);
    expect(errors).toEqual([]);
  }, 120_000);

  it("Inspect pins an element and shows its measured specs", async () => {
    const frame = await overlay(page);
    await page.getByText(text).first().click();
    await frame.waitForSelector("[data-handoff-inspect]");
    const panel = (await frame.textContent("[data-handoff-inspect]")) ?? "";
    expect(panel).toMatch(/Size\s*\d+(\.\d+)? × \d+/);
    expect(panel).toContain("Typography");
    expect(panel).toMatch(/Contrast|Role/);
    await page.keyboard.press("Escape"); // unpin
  }, 60_000);

  it("HMR updates the page through the proxy in under 2 s", async () => {
    const marker = `Handoff HMR ${Date.now()}`;
    await page.waitForTimeout(1000); // let the HMR socket settle after first load
    const start = Date.now();
    writeFileSync(path, original.replace(text, marker));
    await page.waitForFunction((m) => document.body.innerText.includes(m), marker, { timeout: 10_000 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000);
    await overlay(page); // overlay survives the update
  }, 60_000);
});
