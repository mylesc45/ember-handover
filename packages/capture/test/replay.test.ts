import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFlows, type Flow } from "@ember-handover/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { flowsAppDir, flowsAppHandler } from "../../../e2e/lib/flows-app.js";
import { startStack } from "../../../security/lib/servers.js";
import { createReplayer, type Replayer } from "../src/index.js";

let stack: Awaited<ReturnType<typeof startStack>>;
let replayer: Replayer;
let out: string;
const file = parseFlows(readFileSync(join(flowsAppDir, ".handoff/flows.yaml"), "utf8")).file!;
const flow = (id: string): Flow => file.flows.find((f) => f.id === id)!;

beforeAll(async () => {
  stack = await startStack(flowsAppHandler);
  replayer = createReplayer({ root: flowsAppDir, fixturesDir: file.fixtures });
  out = mkdtempSync(join(tmpdir(), "handoff-replay-"));
}, 60_000);
afterAll(async () => {
  await replayer?.close();
  await stack?.close();
  rmSync(out, { recursive: true, force: true });
});

describe("flow replay", () => {
  it("replays every verb and passes", async () => {
    const r = await replayer.replay({ appUrl: stack.proxyUrl, flow: flow("checkout"), outDir: out });
    expect(r.status).toBe("passing");
    expect(r.steps.map((s) => s.ok)).toEqual([true, true, true, true, true, true]);
    for (const s of r.steps) expect(existsSync(join(out, s.screenshot!))).toBe(true);
    expect(r.steps[0]?.url).toBe(`${stack.proxyUrl}/pricing`);
  }, 60_000);

  it("applies a fixture from step `at` onward: card declined", async () => {
    const f = flow("checkout");
    const r = await replayer.replay({ appUrl: stack.proxyUrl, flow: f, state: f.states[0], outDir: out });
    // The final expect ("Payment") must fail, because the mocked API declines the card.
    expect(r.status).toBe("failing");
    expect(r.failedAt).toBe(5);
    expect(r.steps[5]?.error).toMatch(/Payment/);
    expect(r.steps[5]?.actual).toMatch(/Card declined: insufficient funds/);
  }, 60_000);

  it("follows links and checks URLs", async () => {
    const r = await replayer.replay({ appUrl: stack.proxyUrl, flow: flow("home"), outDir: out });
    expect(r.status).toBe("passing");
  }, 60_000);

  it("a step that no longer resolves fails fast with a plain explanation and a screenshot", async () => {
    const start = Date.now();
    const r = await replayer.replay({ appUrl: stack.proxyUrl, flow: flow("broken"), outDir: out, stepTimeoutMs: 2000 });
    expect(r.status).toBe("failing");
    expect(r.failedAt).toBe(1);
    expect(r.steps[1]?.error).toMatch(/Couldn't find test ID "does-not-exist"/);
    expect(r.steps[1]?.screenshot).toBeTruthy();
    expect(Date.now() - start).toBeLessThan(15_000);
  }, 60_000);

  it("never navigates off the app's origin", async () => {
    const evil: Flow = { id: "x", name: "x", steps: [{ goto: "/" }], states: [] };
    await expect(replayer.replay({ appUrl: "https://example.com", flow: evil, outDir: out })).rejects.toMatchObject({ code: "BAD_REPLAY_TARGET" });
  });
});
