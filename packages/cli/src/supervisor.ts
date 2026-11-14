import { EventEmitter } from "node:events";
import net from "node:net";
import { execa } from "execa";
import { HandoffError, type AppStatus } from "@ember-handover/core";

export interface Target {
  host: string;
  port: number;
}

export interface SupervisorOptions {
  cwd: string;
  command: string;
  /** Always an argument array: no shell, ever (SPEC S7). */
  args: string[];
  /** Expected port; null if unknown (we then follow the URL the server prints). */
  port: number | null;
  env?: Record<string, string>;
  startTimeoutMs?: number;
  restartDelayMs?: number;
  maxRestarts?: number;
}

const LOOPBACK = ["127.0.0.1", "::1"];

function runDevServer(opts: SupervisorOptions) {
  return execa(opts.command, opts.args, {
    cwd: opts.cwd,
    env: { FORCE_COLOR: "1", ...opts.env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    reject: false,
    cleanup: true,
    windowsHide: true,
    // Own process group on POSIX so stop() can take down the whole tree.
    detached: process.platform !== "win32",
  });
}
type Child = ReturnType<typeof runDevServer>;

/** Which loopback address (if any) accepts connections on this port. */
export async function probePort(port: number, timeoutMs = 400): Promise<string | null> {
  for (const host of LOOPBACK) {
    const ok = await new Promise<boolean>((resolve) => {
      const s = net.connect({ host, port, timeout: timeoutMs });
      s.once("connect", () => (s.destroy(), resolve(true)));
      s.once("error", () => resolve(false));
      s.once("timeout", () => (s.destroy(), resolve(false)));
    });
    if (ok) return host;
  }
  return null;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const URL_IN_LOG = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|\[::\]):(\d{2,5})/;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Starts the user's dev script (or attaches to a running one) and restarts it on crash. */
export class Supervisor extends EventEmitter {
  private child: Child | null = null;
  private state: AppStatus["state"] = "starting";
  private log: string[] = [];
  private stopping = false;
  private restarts: number[] = [];
  private seenPort: number | null = null;
  private target: Target | null = null;

  constructor(private readonly opts: SupervisorOptions) {
    super();
  }

  status(): AppStatus {
    return { state: this.state, lines: this.log.slice(-5) };
  }

  async start(): Promise<Target> {
    if (this.opts.port) {
      const host = await probePort(this.opts.port);
      if (host) {
        this.setState("attached");
        return (this.target = { host, port: this.opts.port });
      }
    }
    this.spawn();
    this.target = await this.waitReady(this.opts.startTimeoutMs ?? 90_000);
    this.setState("running");
    return this.target;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    this.child = null;
    if (!child) return;
    await killTree(child);
    this.setState("stopped");
  }

  private setState(s: AppStatus["state"]) {
    if (this.state === s) return;
    this.state = s;
    this.emit("status", this.status());
  }

  private spawn() {
    const child = runDevServer(this.opts);
    this.child = child;
    const onData = (buf: Buffer) => {
      for (const raw of buf.toString().split(/\r?\n/)) {
        const line = raw.replace(ANSI, "");
        if (!line.trim()) continue;
        this.log.push(line);
        if (this.log.length > 50) this.log.shift();
        const m = URL_IN_LOG.exec(line);
        if (m?.[1] && this.seenPort === null) this.seenPort = Number(m[1]);
        this.emit("log", raw);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    void child.then((r) => {
      if (this.child !== child) return;
      this.child = null;
      this.emit("exit", r.exitCode);
      if (!this.stopping && this.target) void this.restart();
    });
  }

  private async restart() {
    const now = Date.now();
    this.restarts = this.restarts.filter((t) => now - t < 60_000);
    if (this.restarts.length >= (this.opts.maxRestarts ?? 5)) return this.setState("stopped");
    this.restarts.push(now);
    this.setState("restarting");
    await sleep(this.opts.restartDelayMs ?? 1000);
    if (this.stopping) return;
    this.spawn();
    try {
      this.target = await this.waitReady(this.opts.startTimeoutMs ?? 90_000);
      this.setState("running");
    } catch {
      if (!this.stopping && !this.child) this.setState("stopped");
    }
  }

  private async waitReady(timeoutMs: number): Promise<Target> {
    const deadline = Date.now() + timeoutMs;
    const child = this.child;
    let exited: number | undefined;
    void child?.then((r) => (exited = r.exitCode ?? -1));
    while (Date.now() < deadline) {
      for (const port of new Set([this.opts.port, this.seenPort].filter((p): p is number => !!p))) {
        const host = await probePort(port, 200);
        if (host) return { host, port };
      }
      if (exited !== undefined) throw new HandoffError("APP_EXITED", { exitCode: exited });
      await sleep(150);
    }
    if (child) await killTree(child);
    throw new HandoffError("APP_START_TIMEOUT", {
      port: this.seenPort ?? this.opts.port ?? "?",
      seconds: Math.round(timeoutMs / 1000),
    });
  }
}

async function killTree(child: Child): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) return;
  const done = child.then(() => undefined).catch(() => undefined);
  if (process.platform === "win32") {
    await execa("taskkill", ["/pid", String(pid), "/T", "/F"], { reject: false, windowsHide: true });
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
    const timer = setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }, 3000);
    await done;
    clearTimeout(timer);
    return;
  }
  await Promise.race([done, sleep(5000)]);
}
