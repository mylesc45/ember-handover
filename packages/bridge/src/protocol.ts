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

export type LayoutMode = "pill" | "panel";

export type OverlayCommand =
  | { v: 1; type: "hello" }
  | { v: 1; type: "layout"; mode: LayoutMode };

export type BridgeEvent =
  | { v: 1; type: "page"; url: string; title: string }
  | { v: 1; type: "key"; key: "toggle" | "escape" };

type Shape = Record<string, (x: unknown) => boolean>;

const str = (max: number) => (x: unknown) => typeof x === "string" && x.length <= max;
const oneOf =
  (...vals: string[]) =>
  (x: unknown) =>
    typeof x === "string" && vals.includes(x);

function matches(data: unknown, shape: Shape): boolean {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  if (Object.getPrototypeOf(data) !== Object.prototype) return false;
  const keys = Object.keys(data);
  const want = Object.keys(shape);
  if (keys.length !== want.length) return false;
  const rec = data as Record<string, unknown>;
  return want.every((k) => Object.hasOwn(rec, k) && shape[k]?.(rec[k]) === true);
}

const base = { v: (x: unknown) => x === PROTOCOL_VERSION };

const COMMANDS: Record<OverlayCommand["type"], Shape> = {
  hello: { ...base, type: oneOf("hello") },
  layout: { ...base, type: oneOf("layout"), mode: oneOf("pill", "panel") },
};

const EVENTS: Record<BridgeEvent["type"], Shape> = {
  page: { ...base, type: oneOf("page"), url: str(MAX_URL), title: str(MAX_TITLE) },
  key: { ...base, type: oneOf("key"), key: oneOf("toggle", "escape") },
};

function parse<T>(data: unknown, table: Record<string, Shape>): T | null {
  if (typeof data !== "object" || data === null) return null;
  const type = (data as { type?: unknown }).type;
  const shape = typeof type === "string" && Object.hasOwn(table, type) ? table[type] : undefined;
  if (!shape || !matches(data, shape)) return null;
  // Return a fresh plain copy so later mutation by the sender can't affect us.
  return { ...(data as object) } as T;
}

export const parseOverlayCommand = (data: unknown) => parse<OverlayCommand>(data, COMMANDS);
export const parseBridgeEvent = (data: unknown) => parse<BridgeEvent>(data, EVENTS);
