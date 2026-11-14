import { once } from "node:events";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import {
  createCoreServer,
  generateToken,
  HandoffError,
  listenLoopback,
  loadOverlayAssets,
  loopbackOrigins,
  type AppStatus,
} from "@ember-handover/core";
import { createMeasurer } from "@ember-handover/capture";
import { attachProxy } from "@ember-handover/proxy";
import { loadTokens } from "@ember-handover/tokens/node";
import type { TokenSet } from "@ember-handover/tokens";
import { openBrowser } from "./browser.js";
import { detect } from "./detect.js";
import { maybeOfferAgentSetup } from "./first-run.js";
import { createFlowsService } from "./flows-service.js";
import { Supervisor } from "./supervisor.js";
import type { Io } from "./main.js";

const PROXY_PORT = 4000;
const CORE_PORT = 4001;

export interface StartOptions {
  cwd: string;
  port: number | null;
  version: string;
  io: Io;
  /** Resolves when the user asks to stop (Ctrl+C). Injected for tests. */
  untilStopped?: Promise<unknown>;
}

function assetsDir(): string {
  return fileURLToPath(new URL("./assets/", import.meta.url));
}

export async function start(opts: StartOptions): Promise<number> {
  const { io } = opts;
  const found = detect(opts.cwd);
  const fatal = found.problems.find((p) => p === "NO_PACKAGE_JSON" || p === "BAD_PACKAGE_JSON");
  if (fatal && !opts.port) throw new HandoffError(fatal);
  if (!found.devScript && !opts.port) throw new HandoffError("NO_DEV_SCRIPT");

  const pm = found.packageManager;
  const port = opts.port ?? found.port;
  const supervisor = new Supervisor({
    cwd: opts.cwd,
    command: pm,
    args: ["run", found.devScript ?? "dev"],
    port,
  });
  supervisor.on("log", (line: string) => io.stdout(`  app │ ${line}\n`));
  supervisor.on("status", (s: AppStatus) => {
    if (s.state === "restarting") io.stdout("Your app stopped. Restarting…\n");
    if (s.state === "stopped") io.stderr("Your app stopped and Handoff couldn't restart it. Check its log above.\n");
  });

  const cleanups: (() => Promise<void>)[] = [() => supervisor.stop()];
  const cleanup = async () => {
    for (const c of cleanups.splice(0).reverse()) await c().catch(() => undefined);
  };

  try {
    if (port && found.devScript) io.stdout(`Looking for your app on port ${port}…\n`);
    const target = await supervisor.start();
    if (supervisor.status().state !== "attached") io.stdout(`Started your app with \`${pm} run ${found.devScript}\`.\n`);

    const dir = assetsDir();
    const bridgeCode = readFileSync(join(dir, "bridge.js"));
    const assets = loadOverlayAssets(join(dir, "overlay"));
    const token = generateToken();
    const measurer = createMeasurer({ measureScript: readFileSync(join(dir, "measure.js"), "utf8") });
    cleanups.push(() => measurer.close());
    const tokens = cachedTokens(opts.cwd);
    let proxyUrl = "";
    const flows = createFlowsService(opts.cwd, () => proxyUrl);
    cleanups.push(() => flows.close());

    // Reserve the proxy port first: the overlay needs to know which origins may frame it.
    const proxy = await listenLoopback(() => http.createServer(), PROXY_PORT);
    cleanups.push(() => proxy.close());
    const appOrigins = loopbackOrigins(proxy.port);
    const appUrl = `http://${target.host.includes(":") ? `[${target.host}]` : target.host}:${target.port}`;

    const core = await listenLoopback(
      () =>
        createCoreServer({
          token,
          appOrigins,
          assets,
          session: () => ({ version: opts.version, framework: found.framework?.name ?? null, appUrl }),
          status: () => supervisor.status(),
          tokens,
          // Headless pages load the app through the proxy, exactly like the dev's browser.
          measure: (req) => measurer.measure(req),
          browser: () => measurer.browser(),
          // Replays run through the proxy, so they see exactly what the dev's browser sees.
          flows: { list: () => flows.list(), replay: (id, state) => flows.replay(id, state), shot: (id, state, step) => flows.shot(id, state, step) },
        }),
      proxy.port === CORE_PORT ? CORE_PORT + 1 : CORE_PORT,
    );
    cleanups.push(() => core.close());
    const overlayUrl = `http://127.0.0.1:${core.port}/`;
    for (const s of proxy.servers) attachProxy(s, { target, bridgeCode, overlayUrl });

    const url = `http://localhost:${proxy.port}`;
    proxyUrl = url;
    io.stdout(`\nHandoff is running: ${url}  (your app: ${appUrl})\nPress D in the page for Dev Mode. Ctrl+C to stop.\n\n`);
    void openBrowser(url);
    await maybeOfferAgentSetup(opts.cwd, io);

    await (opts.untilStopped ?? waitForSignal());
    io.stdout("\nStopping Handoff…\n");
    return 0;
  } finally {
    await cleanup();
  }
}

/** Tokens are re-read at most every 5 s, so edits to theme files show up without a restart. */
function cachedTokens(root: string): () => Promise<TokenSet> {
  let at = 0;
  let value: Promise<TokenSet> | null = null;
  return () => {
    if (!value || Date.now() - at > 5000) {
      at = Date.now();
      value = loadTokens(root);
    }
    return value;
  };
}

async function waitForSignal(): Promise<void> {
  await Promise.race([once(process, "SIGINT"), once(process, "SIGTERM")]);
}
