/** Flow types and plain-language descriptions. Browser-safe: no YAML parser here. */

export type Selector = { testid: string } | { role: string; name?: string } | { text: string } | { label: string } | { css: string };
export const VERBS = ["goto", "click", "fill", "select", "hover", "press", "scroll", "wait", "expect"] as const;
export type Verb = (typeof VERBS)[number];

export type Meta = { intent?: string; state?: string };
export type Step = Meta &
  (
    | { goto: string }
    | { click: Selector }
    | { fill: Selector & { value: string } }
    | { select: Selector & { value: string } }
    | { hover: Selector }
    | { press: string | (Selector & { key: string }) }
    | { scroll: Selector | "top" | "bottom" }
    | { wait: number }
    | { expect: Selector | { url: string } }
  );

export interface FlowState {
  id: string;
  name?: string;
  /** Path inside the fixtures folder. */
  fixture: string;
  /** 1-based step number from which the fixture applies. */
  at: number;
}
export interface Flow {
  id: string;
  name: string;
  intent?: string;
  steps: Step[];
  states: FlowState[];
}
export interface FlowFile {
  version: 1;
  baseUrl: string;
  fixtures: string;
  flows: Flow[];
}
/** A same-origin path: "/..." but never "//host", "/\\host", or anything with a scheme. */
export function isRelativePath(s: unknown): s is string {
  return typeof s === "string" && s.length <= 2048 && /^\/(?![/\\])/.test(s) && !/[\s\\]/.test(s.split(/[?#]/)[0] ?? "") && !s.includes("\u0000");
}

/** A path inside the repo: relative, no "..", no drive letters or backslashes. */
export function isRepoPath(s: unknown): s is string {
  return (
    typeof s === "string" &&
    s.length > 0 &&
    s.length <= 512 &&
    !s.startsWith("/") &&
    !/^[a-zA-Z]:/.test(s) &&
    !s.includes("\\") &&
    !s.includes("\u0000") &&
    !s.split("/").some((p) => p === ".." || p === "")
  );
}

// --- plain-language descriptions ------------------------------------------------------------
export function describeSelector(s: Selector): string {
  if ("testid" in s) return `test ID "${s.testid}"`;
  if ("role" in s) return s.name ? `${s.role} "${s.name}"` : s.role;
  if ("text" in s) return `text "${s.text}"`;
  if ("label" in s) return `label "${s.label}"`;
  return `CSS "${s.css}"`;
}

export function stepVerb(s: Step): Verb {
  return VERBS.find((v) => Object.hasOwn(s, v)) ?? "goto";
}

export function describeStep(s: Step): string {
  if ("goto" in s) return `Go to ${s.goto}`;
  if ("click" in s) return `Click ${describeSelector(s.click)}`;
  if ("hover" in s) return `Hover ${describeSelector(s.hover)}`;
  if ("fill" in s) return `Type "${s.fill.value}" into ${describeSelector(s.fill)}`;
  if ("select" in s) return `Choose "${s.select.value}" in ${describeSelector(s.select)}`;
  if ("press" in s) return typeof s.press === "string" ? `Press ${s.press}` : `Press ${s.press.key} in ${describeSelector(s.press)}`;
  if ("scroll" in s) return typeof s.scroll === "string" ? `Scroll to the ${s.scroll}` : `Scroll to ${describeSelector(s.scroll)}`;
  if ("wait" in s) return `Wait ${+(s.wait / 1000).toFixed(2)} s`;
  const e = s.expect;
  return "url" in e ? `Expect the URL ${e.url}` : `Expect ${describeSelector(e)}`;
}
