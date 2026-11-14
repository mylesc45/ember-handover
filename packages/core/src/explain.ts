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
    message: (d) => `Handoff needs Node 20 or newer, but this is Node ${v(d.version)}.`,
    fix: () => "Install Node 20 or later from nodejs.org, or switch with your version manager (for example `nvm use 20`).",
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
