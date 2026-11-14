import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { probePort, Supervisor } from "../src/supervisor.js";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

function tmp() {
  const d = mkdtempSync(join(tmpdir(), "handoff-sup-"));
  cleanups.push(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

// A fake dev server: listens on PORT, prints its URL, optionally crashes once.
const SERVER = `
const http = require("node:http");
const fs = require("node:fs");
const port = Number(process.env.PORT);
const marker = process.env.CRASH_MARKER;
const s = http.createServer((q, r) => r.end("ok")).listen(port, "127.0.0.1", () => {
  console.log("  ➜  Local:   http://localhost:" + port + "/");
  if (marker && !fs.existsSync(marker)) { fs.writeFileSync(marker, "1"); setTimeout(() => process.exit(1), 200); }
});
`;

async function freePort(): Promise<number> {
  const s = http.createServer().listen(0, "127.0.0.1");
  await new Promise((r) => s.once("listening", r));
  const port = (s.address() as { port: number }).port;
  await new Promise((r) => s.close(r));
  return port;
}

describe("probePort", () => {
  it("finds a listening loopback port and reports closed ones", async () => {
    const s = http.createServer().listen(0, "127.0.0.1");
    await new Promise((r) => s.once("listening", r));
    const port = (s.address() as { port: number }).port;
    cleanups.push(() => new Promise<void>((r) => s.close(() => r())));
    expect(await probePort(port)).toBe("127.0.0.1");
    expect(await probePort(await freePort())).toBeNull();
  });
});

describe("Supervisor", () => {
  it("attaches to an already-running server without starting anything", async () => {
    const s = http.createServer().listen(0, "127.0.0.1");
    await new Promise((r) => s.once("listening", r));
    const port = (s.address() as { port: number }).port;
    cleanups.push(() => new Promise<void>((r) => s.close(() => r())));
    const sup = new Supervisor({ cwd: tmp(), command: process.execPath, args: ["-e", "process.exit(9)"], port });
    cleanups.push(() => sup.stop());
    const target = await sup.start();
    expect(target).toEqual({ host: "127.0.0.1", port });
    expect(sup.status().state).toBe("attached");
  });

  it("starts the dev server and waits for its port", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "server.cjs"), SERVER);
    const port = await freePort();
    const sup = new Supervisor({ cwd: dir, command: process.execPath, args: ["server.cjs"], port, env: { PORT: String(port) } });
    cleanups.push(() => sup.stop());
    expect(await sup.start()).toEqual({ host: "127.0.0.1", port });
    expect(sup.status().state).toBe("running");
    expect(sup.status().lines.join("\n")).toContain(`localhost:${port}`);
  });

  it("follows the URL the dev server prints when it picks another port", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "server.cjs"), SERVER);
    const actual = await freePort();
    const sup = new Supervisor({ cwd: dir, command: process.execPath, args: ["server.cjs"], port: 1, env: { PORT: String(actual) } });
    cleanups.push(() => sup.stop());
    expect(await sup.start()).toEqual({ host: "127.0.0.1", port: actual });
  });

  it("restarts after a crash and keeps the last log lines", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "server.cjs"), SERVER);
    const port = await freePort();
    const sup = new Supervisor({
      cwd: dir,
      command: process.execPath,
      args: ["server.cjs"],
      port,
      env: { PORT: String(port), CRASH_MARKER: join(dir, "crashed") },
      restartDelayMs: 100,
    });
    cleanups.push(() => sup.stop());
    await sup.start();
    const states: string[] = [];
    sup.on("status", (s: { state: string }) => states.push(s.state));
    await new Promise((r) => setTimeout(r, 3000));
    expect(states).toContain("restarting");
    expect(sup.status().state).toBe("running");
    expect(sup.status().lines.length).toBeLessThanOrEqual(5);
  });

  it("gives up with an explained error when the server never opens a port", async () => {
    const sup = new Supervisor({
      cwd: tmp(),
      command: process.execPath,
      args: ["-e", "setTimeout(()=>{}, 60000)"],
      port: await freePort(),
      startTimeoutMs: 500,
    });
    cleanups.push(() => sup.stop());
    await expect(sup.start()).rejects.toMatchObject({ code: "APP_START_TIMEOUT" });
  });

  it("stop() kills the whole process tree", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "server.cjs"), SERVER);
    // Wrapper spawns the real server as a grandchild, like `pnpm run dev` does.
    writeFileSync(
      join(dir, "wrap.cjs"),
      `require("node:child_process").spawn(process.execPath, ["server.cjs"], { stdio: "inherit" }); setInterval(()=>{}, 1000);`,
    );
    const port = await freePort();
    const sup = new Supervisor({ cwd: dir, command: process.execPath, args: ["wrap.cjs"], port, env: { PORT: String(port) } });
    await sup.start();
    await sup.stop();
    await new Promise((r) => setTimeout(r, 500));
    expect(await probePort(port)).toBeNull();
  });
});
