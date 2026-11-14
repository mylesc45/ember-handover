import { parseArgs } from "node:util";
import { explain, HandoffError, isHandoffError, type Explanation } from "@ember-handover/core";
import { start } from "./start.js";

declare const __HANDOFF_VERSION__: string;
const VERSION = typeof __HANDOFF_VERSION__ === "string" ? __HANDOFF_VERSION__ : "0.0.0-dev";

export interface Io {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

const COMMANDS = {
  start: "Start Dev Mode on your running app (default)",
  review: "Review a pull request's UI changes        review <pr>",
  share: "Write one self-contained HTML file to share",
  check: "Validate flows and scan .handoff/ (for CI)",
  mcp: "Serve specs and flows to your coding agent",
  doctor: "Diagnose problems and suggest fixes",
  remove: "Remove everything Handoff added",
} as const;

type Command = keyof typeof COMMANDS;

const HELP = `Handoff ${VERSION}: Dev Mode for your app's dev server.

Usage
  npx ember-handover [command] [options]

Commands
${Object.entries(COMMANDS)
  .map(([name, desc]) => `  ${name.padEnd(8)} ${desc}`)
  .join("\n")}

Options
  --port <n>        Your dev server's port (detected automatically)
  --base <branch>   Branch to compare against (default: main)
  --sandbox         Run review in Docker when available
  --allow-scripts   Allow install scripts during review (asks first)
  --precise         Use the dev-only build plugin for exact source links
  --json            Machine-readable output
  -h, --help        Show this help
  -v, --version     Show the version
`;

/** Exit codes: 0 ok, 1 command failed, 2 usage error. */
export async function main(argv: string[], io: Io): Promise<number> {
  const json = argv.includes("--json");
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
        json: { type: "boolean" },
        port: { type: "string" },
        base: { type: "string" },
        sandbox: { type: "boolean" },
        "allow-scripts": { type: "boolean" },
        precise: { type: "boolean" },
      },
    });

    if (values.version) {
      io.stdout(`${VERSION}\n`);
      return 0;
    }
    if (values.help) {
      io.stdout(HELP);
      return 0;
    }

    const name = positionals[0] ?? "start";
    if (!Object.hasOwn(COMMANDS, name)) throw new UsageError("UNKNOWN_COMMAND", { command: name });
    let port: number | null = null;
    if (typeof values.port === "string") {
      port = Number(values.port);
      if (!/^\d{1,5}$/.test(values.port) || port < 1 || port > 65535) throw new UsageError("BAD_PORT", { port: values.port });
    }
    return await run(name as Command, { port, io });
  } catch (err) {
    return report(err, io, json);
  }
}

class UsageError extends HandoffError {}

async function run(command: Command, ctx: { port: number | null; io: Io }): Promise<number> {
  if (command === "start") return start({ cwd: process.cwd(), port: ctx.port, version: VERSION, io: ctx.io });
  // Later milestones replace these stubs one at a time.
  throw new HandoffError("NOT_IMPLEMENTED", { command });
}

function toExplanation(err: unknown): Explanation {
  if (isHandoffError(err)) return err.explanation;
  // node:util parseArgs errors carry a code; translate the ones users can hit.
  const code = (err as { code?: unknown } | null)?.code;
  if (code === "ERR_PARSE_ARGS_UNKNOWN_OPTION" || code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE") {
    const flag = /'([^']+)'/.exec(String((err as Error).message))?.[1] ?? "that option";
    return explain("UNKNOWN_FLAG", { flag });
  }
  return explain("UNKNOWN");
}

function isUsage(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return err instanceof UsageError || (typeof code === "string" && code.startsWith("ERR_PARSE_ARGS_"));
}

function report(err: unknown, io: Io, json: boolean): number {
  const e = toExplanation(err);
  if (json) io.stderr(`${JSON.stringify({ error: e })}\n`);
  else io.stderr(`${e.message}\nFix: ${e.fix}\n`);
  return isUsage(err) ? 2 : 1;
}
