/**
 * The single place every user-facing error is turned into words.
 * SPEC → Instructions for the implementing agent: "Every user-facing error goes
 * through one explain(code) function that returns a sentence and a fix."
 *
 * Messages are plain text. Detail values are interpolated verbatim and must be
 * rendered as plain text by every caller (never as HTML).
 */

type Detail = Record<string, string | number>;

/** Detail values are optional; never print "undefined" to a user. */
const v = (x: string | number | undefined): string => (x === undefined ? "?" : String(x));

interface Entry {
  message: (d: Detail) => string;
  fix: (d: Detail) => string;
}

const catalog = {
  UNKNOWN: {
    message: () => "Something unexpected went wrong inside Handoff.",
    fix: () => "Run `npx ember-handover doctor` and include its output if you report the problem.",
  },
  UNKNOWN_COMMAND: {
    message: (d) => `There's no Handoff command called "${v(d.command)}".`,
    fix: () => "Run `npx ember-handover --help` to see the available commands.",
  },
  UNKNOWN_FLAG: {
    message: (d) => `The option "${v(d.flag)}" isn't supported.`,
    fix: () => "Run `npx ember-handover --help` to see the supported options.",
  },
  NOT_IMPLEMENTED: {
    message: (d) => `The "${v(d.command)}" command isn't available in this early build yet.`,
    fix: () => "Watch the project's releases on GitHub, or run `npx ember-handover@next` for the latest preview.",
  },
  NODE_TOO_OLD: {
    message: (d) => `Handoff needs Node 22.13 or newer, but this is Node ${v(d.version)}.`,
    fix: () => "Install Node 22 or later from nodejs.org, or switch with your version manager (for example `nvm use 22`).",
  },
  NO_PACKAGE_JSON: {
    message: () => "There's no package.json in this folder, so Handoff can't find your app.",
    fix: () => "Run Handoff from your app's root folder (the one with package.json).",
  },
  BAD_PACKAGE_JSON: {
    message: () => "Your package.json couldn't be read because it isn't valid JSON.",
    fix: () => "Fix the syntax error in package.json (your editor will highlight it), then run Handoff again.",
  },
  NO_DEV_SCRIPT: {
    message: () => "Your package.json has no dev, start or serve script, so Handoff doesn't know how to start your app.",
    fix: () => "Start your dev server yourself, then run `npx ember-handover --port <its port>`.",
  },
  BAD_PORT: {
    message: (d) => `The port "${v(d.port)}" isn't a valid port number.`,
    fix: () => "Pass a number between 1 and 65535, for example `--port 5173`.",
  },
  APP_START_TIMEOUT: {
    message: (d) => `Your dev server didn't start listening on port ${v(d.port)} within ${v(d.seconds)} seconds.`,
    fix: () => "Check the app's log above for errors. If it uses a different port, run `npx ember-handover --port <port>`.",
  },
  APP_EXITED: {
    message: (d) => `Your dev server stopped before it was ready (exit code ${v(d.exitCode)}).`,
    fix: () => "Read the last lines of its log above, fix the error, then run Handoff again.",
  },
  APP_UNREACHABLE: {
    message: (d) => `Your app isn't responding on port ${v(d.port)} right now.`,
    fix: () => "Handoff restarts it automatically if it crashed; this page retries every 2 seconds.",
  },
  NO_FREE_PORT: {
    message: (d) => `Handoff couldn't find a free local port near ${v(d.port)}.`,
    fix: () => "Close other dev servers you aren't using, then run Handoff again.",
  },
  FORBIDDEN_HOST: {
    message: () => "This request didn't come from localhost, so Handoff refused it.",
    fix: () => "Open Handoff at http://localhost on this machine; it can't be reached from other hosts.",
  },
  FORBIDDEN_ORIGIN: {
    message: () => "A web page that isn't Handoff tried to use Handoff's local API, so it was blocked.",
    fix: () => "Nothing to do; this protects you from malicious websites.",
  },
  BAD_TOKEN: {
    message: () => "This Handoff session has ended or the request had no valid session token.",
    fix: () => "Reload the page. If you restarted Handoff, use the new URL it printed.",
  },
  METHOD_NOT_ALLOWED: {
    message: () => "Handoff's API only accepts GET for reads and POST for changes.",
    fix: () => "Send the request as POST with a JSON body.",
  },
  UNSUPPORTED_MEDIA_TYPE: {
    message: () => "Handoff's API only accepts JSON request bodies.",
    fix: () => "Send the request with `Content-Type: application/json`.",
  },
  NOT_FOUND: {
    message: () => "Handoff doesn't have anything at this address.",
    fix: () => "Reload the page; if this keeps happening, run `npx ember-handover doctor`.",
  },
  BROWSER_MISSING: {
    message: () => "States and breakpoints are measured in a headless browser, and Handoff couldn't find Chrome or Chromium on this machine.",
    fix: () => "Install Google Chrome, or run `npx playwright install chromium` once, then try again.",
  },
  ELEMENT_NOT_FOUND: {
    message: () => "Handoff couldn't find this element when it loaded the page in a fresh browser.",
    fix: () => "The element may need a signed-in session or a click to appear; reproduce it with a fixture, or measure it at the current size instead.",
  },
  MEASURE_FAILED: {
    message: () => "Handoff couldn't measure this element in the headless browser.",
    fix: () => "Try again; if it keeps failing, run `npx ember-handover doctor`.",
  },
  BAD_MEASURE_REQUEST: {
    message: () => "That measure request isn't valid, so Handoff ignored it.",
    fix: () => "Measure elements from the Dev Mode panel; requests must target your app on localhost.",
  },
  BODY_TOO_LARGE: {
    message: () => "That request was too large for Handoff's local API.",
    fix: () => "Send a smaller request body (16 KB or less).",
  },
} satisfies Record<string, Entry>;

export type ErrorCode = keyof typeof catalog;
export const ERROR_CODES = Object.keys(catalog) as ErrorCode[];

export interface Explanation {
  code: ErrorCode;
  message: string;
  fix: string;
}

export function explain(code: ErrorCode, detail: Detail = {}): Explanation {
  const known = Object.hasOwn(catalog, code);
  const key: ErrorCode = known ? code : "UNKNOWN";
  const entry: Entry = catalog[key];
  return { code: key, message: entry.message(detail), fix: entry.fix(detail) };
}

export class HandoffError extends Error {
  readonly code: ErrorCode;
  readonly explanation: Explanation;
  constructor(code: ErrorCode, detail: Detail = {}) {
    const explanation = explain(code, detail);
    super(explanation.message);
    this.name = "HandoffError";
    this.code = code;
    this.explanation = explanation;
  }
}

export function isHandoffError(e: unknown): e is HandoffError {
  return e instanceof HandoffError;
}
