/**
 * postMessage protocol between the in-page bridge and the overlay iframe.
 *
 * Trust model (SPEC S4):
 * - The bridge accepts commands only from the overlay iframe's window and origin.
 * - The overlay accepts events only from window.parent at an app origin, but must
 *   still treat them as untrusted *data*: any script in the app page can forge them.
 * - Nothing secret (the API token) ever crosses this channel.
 *
 * Every message is validated against an exact shape; unknown keys are rejected.
 */

export const PROTOCOL_VERSION = 1;
export const MAX_URL = 2048;
export const MAX_TITLE = 512;
export const MAX_ANCESTORS = 24;
export const MAX_PATH = 4096;

export type LayoutMode = "pill" | "panel";
export type Quad = [number, number, number, number];

/** Raw Layer 1 measurement of one element: computed values exactly as the browser reports them. */
export interface RawSpec {
  /** Strict `tag:nth-child(n) > …` path from <html>, used to find the element again headlessly. */
  path: string;
  tag: string;
  id: string;
  testid: string;
  classes: string;
  text: string;
  /** Nearest first. */
  ancestors: { tag: string; id: string; testid: string }[];
  /** Rendered border box, viewport coordinates (getBoundingClientRect). */
  rect: { x: number; y: number; width: number; height: number };
  /** [top, right, bottom, left] in px. */
  box: { margin: Quad; border: Quad; padding: Quad; borderStyle: string };
  layout: {
    display: string;
    position: string;
    boxSizing: string;
    flexDirection: string;
    flexWrap: string;
    justifyContent: string;
    alignItems: string;
    rowGap: number | null;
    columnGap: number | null;
    gridTemplateColumns: string;
    gridTemplateRows: string;
    parentDisplay: string;
  };
  typography: {
    /** Computed font-family stack. */
    family: string;
    /** The web font actually rendering the text, if one is loaded; null for system fonts. */
    rendered: string | null;
    size: number;
    weight: number;
    lineHeight: number | null;
    letterSpacing: number | null;
    textAlign: string;
    textTransform: string;
    fontStyle: string;
  };
  colors: { text: string; background: string; border: [string, string, string, string] };
  effects: {
    /** [top-left, top-right, bottom-right, bottom-left] in px. */
    radius: Quad;
    shadow: string;
    opacity: number;
    transition: string;
    transform: string;
  };
  a11y: {
    role: string;
    name: string;
    /** Background colours from the element outward, up to the first opaque one. */
    backgrounds: string[];
  };
  /** Interaction states active at measure time (e.g. the pointer is over it, so :hover applies). */
  live: { hover: boolean; focus: boolean; active: boolean };
}

export type SelectTarget = "parent" | "child" | "ancestor" | "none";

export type OverlayCommand =
  | { v: 1; type: "hello" }
  | { v: 1; type: "layout"; mode: LayoutMode }
  | { v: 1; type: "inspect"; on: boolean }
  | { v: 1; type: "select"; to: Exclude<SelectTarget, "ancestor"> }
  | { v: 1; type: "select"; to: "ancestor"; index: number }
  /** Flows Live mode: open a page of the app in this tab. Same-origin paths only. */
  | { v: 1; type: "navigate"; path: string };

export type BridgeEvent =
  | { v: 1; type: "page"; url: string; title: string }
  | { v: 1; type: "key"; key: "toggle" | "escape" | "inspect" | "flows" | "changes" }
  | { v: 1; type: "spec"; pinned: boolean; spec: RawSpec | null };

// --- tiny schema combinators -------------------------------------------------------
type Check = (x: unknown) => boolean;

const str =
  (max: number): Check =>
  (x) =>
    typeof x === "string" && x.length <= max;
const num: Check = (x) => typeof x === "number" && Number.isFinite(x);
const bool: Check = (x) => typeof x === "boolean";
const int =
  (min: number, max: number): Check =>
  (x) =>
    Number.isInteger(x) && (x as number) >= min && (x as number) <= max;
const nullable =
  (c: Check): Check =>
  (x) =>
    x === null || c(x);
const oneOf =
  (...vals: unknown[]): Check =>
  (x) =>
    vals.includes(x);
const tuple =
  (...items: Check[]): Check =>
  (x) =>
    Array.isArray(x) && x.length === items.length && items.every((c, i) => c(x[i]));
const list =
  (item: Check, max: number): Check =>
  (x) =>
    Array.isArray(x) && x.length <= max && x.every(item);

function isPlain(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
}

const obj =
  (shape: Record<string, Check>): Check =>
  (x) => {
    if (!isPlain(x)) return false;
    const keys = Object.keys(x);
    const want = Object.keys(shape);
    return keys.length === want.length && want.every((k) => Object.hasOwn(x, k) && shape[k]?.(x[k]) === true);
  };

const S = str(256);
const quad = tuple(num, num, num, num);

const RAW_SPEC = obj({
  path: str(MAX_PATH),
  tag: str(64),
  id: S,
  testid: S,
  classes: str(2048),
  text: str(200),
  ancestors: list(obj({ tag: str(64), id: S, testid: S }), MAX_ANCESTORS),
  rect: obj({ x: num, y: num, width: num, height: num }),
  box: obj({ margin: quad, border: quad, padding: quad, borderStyle: S }),
  layout: obj({
    display: S,
    position: S,
    boxSizing: S,
    flexDirection: S,
    flexWrap: S,
    justifyContent: S,
    alignItems: S,
    rowGap: nullable(num),
    columnGap: nullable(num),
    gridTemplateColumns: str(1024),
    gridTemplateRows: str(1024),
    parentDisplay: S,
  }),
  typography: obj({
    family: str(1024),
    rendered: nullable(S),
    size: num,
    weight: num,
    lineHeight: nullable(num),
    letterSpacing: nullable(num),
    textAlign: S,
    textTransform: S,
    fontStyle: S,
  }),
  colors: obj({ text: S, background: S, border: tuple(S, S, S, S) }),
  effects: obj({ radius: quad, shadow: str(2048), opacity: num, transition: str(2048), transform: str(1024) }),
  a11y: obj({ role: str(64), name: str(1024), backgrounds: list(S, 32) }),
  live: obj({ hover: bool, focus: bool, active: bool }),
});

const v = oneOf(PROTOCOL_VERSION);
/** "/path?query#hash" on this origin: never "//host", "/\\host" or a scheme. */
const sameOriginPath: Check = (x) => typeof x === "string" && x.length <= MAX_URL && /^\/(?![/\\])[^\s\\]*$/.test(x);

const COMMANDS: Record<string, Check[]> = {
  hello: [obj({ v, type: oneOf("hello") })],
  layout: [obj({ v, type: oneOf("layout"), mode: oneOf("pill", "panel") })],
  inspect: [obj({ v, type: oneOf("inspect"), on: bool })],
  navigate: [obj({ v, type: oneOf("navigate"), path: sameOriginPath })],
  select: [
    obj({ v, type: oneOf("select"), to: oneOf("parent", "child", "none") }),
    obj({ v, type: oneOf("select"), to: oneOf("ancestor"), index: int(0, MAX_ANCESTORS - 1) }),
  ],
};

const EVENTS: Record<string, Check[]> = {
  page: [obj({ v, type: oneOf("page"), url: str(MAX_URL), title: str(MAX_TITLE) })],
  key: [obj({ v, type: oneOf("key"), key: oneOf("toggle", "escape", "inspect", "flows", "changes") })],
  spec: [obj({ v, type: oneOf("spec"), pinned: bool, spec: nullable(RAW_SPEC) })],
};

function parse<T>(data: unknown, table: Record<string, Check[]>): T | null {
  if (!isPlain(data)) return null;
  const type = data.type;
  const checks = typeof type === "string" && Object.hasOwn(table, type) ? table[type] : undefined;
  if (!checks?.some((c) => c(data))) return null;
  // Deep copy so later mutation by the sender can't affect us.
  return structuredClone(data) as T;
}

export const parseOverlayCommand = (data: unknown) => parse<OverlayCommand>(data, COMMANDS);
export const parseBridgeEvent = (data: unknown) => parse<BridgeEvent>(data, EVENTS);
export const isRawSpec = (x: unknown): x is RawSpec => RAW_SPEC(x);
