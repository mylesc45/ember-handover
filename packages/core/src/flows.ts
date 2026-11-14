/**
 * `.handoff/flows.yaml`: a closed, declarative step vocabulary (SPEC S5).
 * There is no eval, script or shell step, so a flow file from an untrusted PR can't run code.
 * Parsed with `yaml` in the core schema: no custom tags, 1 MB cap, 100-alias cap.
 */
import { isMap, isScalar, isSeq, LineCounter, parseDocument, type Document } from "yaml";
import { isRelativePath, isRepoPath, VERBS, type Flow, type FlowFile, type FlowState, type Meta, type Selector, type Step, type Verb } from "./flow-model.js";

export * from "./flow-model.js";

export const MAX_FLOWS_BYTES = 1_000_000;
export const MAX_ALIASES = 100;
const MAX_FLOWS = 200;
const MAX_STEPS = 200;
const MAX_STATES = 20;
const MAX_TEXT = 500;
const MAX_WAIT_MS = 10_000;

export interface FlowIssue {
  line: number | null;
  path: string;
  message: string;
}
export interface ParsedFlows {
  file: FlowFile | null;
  errors: FlowIssue[];
  warnings: FlowIssue[];
}

const SELECTOR_KEYS = ["testid", "role", "text", "label", "css"] as const;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const KEY = /^[A-Za-z0-9+]{1,32}$/;

class Collector {
  errors: FlowIssue[] = [];
  warnings: FlowIssue[] = [];
  constructor(
    private doc: Document,
    private lines: LineCounter,
  ) {}
  line(path: (string | number)[]): number | null {
    const node = path.length ? this.doc.getIn(path, true) : this.doc.contents;
    const range = (node as { range?: [number, number, number] } | undefined)?.range;
    if (range) return this.lines.linePos(range[0]).line;
    // Fall back to the nearest parent that has a position.
    return path.length ? this.line(path.slice(0, -1)) : null;
  }
  error(path: (string | number)[], message: string) {
    this.errors.push({ line: this.line(path), path: path.join("."), message });
  }
  warn(path: (string | number)[], message: string) {
    this.warnings.push({ line: this.line(path), path: path.join("."), message });
  }
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const str = (x: unknown, max = MAX_TEXT): x is string => typeof x === "string" && x.length > 0 && x.length <= max;
const onlyKeys = (o: Record<string, unknown>, allowed: readonly string[]) => Object.keys(o).filter((k) => !allowed.includes(k));

function selector(c: Collector, path: (string | number)[], x: unknown, extra: string[] = []): Selector | null {
  if (!isObj(x)) return c.error(path, "Expected a selector like { testid: plan-pro } or { role: button, name: Continue }."), null;
  const kinds = SELECTOR_KEYS.filter((k) => Object.hasOwn(x, k));
  const unknown = onlyKeys(x, [...SELECTOR_KEYS, "name", ...extra]);
  const extraKey = unknown[0];
  if (extraKey !== undefined) return c.error([...path, extraKey], `"${extraKey}" isn't a selector field. Use testid, role (+ name), text, label or css.`), null;
  if (kinds.length !== 1) return c.error(path, "A selector needs exactly one of: testid, role, text, label or css."), null;
  const kind = kinds[0] ?? "testid";
  const v = x[kind];
  if (!str(v)) return c.error([...path, kind], `"${kind}" must be a non-empty string (up to ${MAX_TEXT} characters).`), null;
  if (x.name !== undefined && (kind !== "role" || !str(x.name))) return c.error([...path, "name"], '"name" goes with "role" and must be a string.'), null;
  if (kind === "css") c.warn(path, "CSS selectors are fragile; prefer testid, role or label.");
  return kind === "role" ? (x.name !== undefined ? { role: v, name: x.name as string } : { role: v }) : ({ [kind]: v } as Selector);
}

function waitMs(x: unknown): number | null {
  let ms: number | null = null;
  if (typeof x === "number") ms = x * 1000;
  else if (typeof x === "string") {
    const m = /^(\d+(?:\.\d+)?)\s*(ms|s)$/.exec(x.trim());
    if (m) ms = Number(m[1]) * (m[2] === "s" ? 1000 : 1);
  }
  return ms !== null && Number.isFinite(ms) && ms >= 0 && ms <= MAX_WAIT_MS ? Math.round(ms) : null;
}

function step(c: Collector, path: (string | number)[], x: unknown): Step | null {
  if (!isObj(x)) return c.error(path, "Each step must be a mapping like `- goto: /pricing`."), null;
  const verbs = Object.keys(x).filter((k) => !["intent", "state"].includes(k));
  if (verbs.length !== 1) {
    const unknown = verbs.find((k) => !(VERBS as readonly string[]).includes(k));
    if (unknown) return c.error([...path, unknown], `"${unknown}" isn't a step. Use one of: ${VERBS.join(", ")}.`), null;
    return c.error(path, `A step needs exactly one action (${VERBS.join(", ")}).`), null;
  }
  const verb = verbs[0] ?? "";
  if (!(VERBS as readonly string[]).includes(verb)) return c.error([...path, verb], `"${verb}" isn't a step. Use one of: ${VERBS.join(", ")}.`), null;
  const meta: Meta = {};
  if (x.intent !== undefined) {
    if (!str(x.intent)) return c.error([...path, "intent"], `"intent" must be one line of text, up to ${MAX_TEXT} characters.`), null;
    meta.intent = x.intent;
  }
  if (x.state !== undefined) {
    if (!str(x.state, 64)) return c.error([...path, "state"], '"state" must be a short label.'), null;
    meta.state = x.state;
  }
  const v = x[verb];
  const at = [...path, verb];
  switch (verb as Verb) {
    case "goto":
      if (!isRelativePath(v)) return c.error(at, "goto needs a path on your app, starting with / (absolute URLs aren't allowed)."), null;
      return { goto: v, ...meta };
    case "click":
    case "hover": {
      const s = selector(c, at, v);
      return s ? ({ [verb]: s, ...meta } as Step) : null;
    }
    case "fill":
    case "select": {
      const s = selector(c, at, v, ["value"]);
      if (!s) return null;
      const value = (v as Record<string, unknown>).value;
      if (typeof value !== "string" || value.length > 2000) return c.error(at, `${verb} needs a "value" (text, up to 2000 characters).`), null;
      return { [verb]: { ...s, value }, ...meta } as Step;
    }
    case "press": {
      if (typeof v === "string") return KEY.test(v) ? { press: v, ...meta } : (c.error(at, 'press needs a key name like "Enter" or "Shift+Tab".'), null);
      const s = selector(c, at, v, ["key"]);
      const key = isObj(v) ? v.key : undefined;
      if (!s || typeof key !== "string" || !KEY.test(key)) return c.error(at, 'press needs a key, e.g. { testid: email, key: Enter }.'), null;
      return { press: { ...s, key }, ...meta };
    }
    case "scroll": {
      if (v === "top" || v === "bottom") return { scroll: v, ...meta };
      const s = selector(c, at, v);
      return s ? { scroll: s, ...meta } : null;
    }
    case "wait": {
      const ms = waitMs(v);
      return ms === null ? (c.error(at, "wait takes seconds (up to 10), e.g. `wait: 2` or `wait: 500ms`."), null) : { wait: ms, ...meta };
    }
    case "expect": {
      if (isObj(v) && Object.hasOwn(v, "url")) {
        if (Object.keys(v).length !== 1 || !isRelativePath(v.url)) return c.error(at, "expect { url } needs a path on your app, starting with /."), null;
        return { expect: { url: v.url }, ...meta };
      }
      const s = selector(c, at, v);
      return s ? { expect: s, ...meta } : null;
    }
  }
}

function flow(c: Collector, path: (string | number)[], x: unknown): Flow | null {
  if (!isObj(x)) return c.error(path, "Each flow must be a mapping with id, name and steps."), null;
  const unknown = onlyKeys(x, ["id", "name", "intent", "steps", "states"]);
  const extraKey = unknown[0];
  if (extraKey !== undefined) return c.error([...path, extraKey], `"${extraKey}" isn't a flow field. Use id, name, intent, steps or states.`), null;
  if (typeof x.id !== "string" || !ID.test(x.id)) return c.error([...path, "id"], "Flow id must be lowercase letters, numbers and dashes (e.g. checkout)."), null;
  if (!str(x.name, 120)) return c.error([...path, "name"], "Flow name must be text, up to 120 characters."), null;
  if (x.intent !== undefined && !str(x.intent)) return c.error([...path, "intent"], `Flow intent must be one line of text, up to ${MAX_TEXT} characters.`), null;
  if (!Array.isArray(x.steps) || x.steps.length === 0 || x.steps.length > MAX_STEPS)
    return c.error([...path, "steps"], `A flow needs between 1 and ${MAX_STEPS} steps.`), null;
  const steps: Step[] = [];
  for (let i = 0; i < x.steps.length; i++) {
    const s = step(c, [...path, "steps", i], x.steps[i]);
    if (!s) return null;
    steps.push(s);
  }
  const states: FlowState[] = [];
  if (x.states !== undefined) {
    if (!Array.isArray(x.states) || x.states.length > MAX_STATES) return c.error([...path, "states"], `states must be a list of up to ${MAX_STATES}.`), null;
    for (let i = 0; i < x.states.length; i++) {
      const p = [...path, "states", i];
      const st = x.states[i];
      if (!isObj(st) || onlyKeys(st, ["id", "name", "fixture", "at"]).length) return c.error(p, "A state needs id, fixture and at (and optionally name)."), null;
      if (typeof st.id !== "string" || !ID.test(st.id)) return c.error([...p, "id"], "State id must be lowercase letters, numbers and dashes."), null;
      if (st.name !== undefined && !str(st.name, 120)) return c.error([...p, "name"], "State name must be text, up to 120 characters."), null;
      if (!isRepoPath(st.fixture)) return c.error([...p, "fixture"], "fixture must be a path inside the fixtures folder, like payments/declined.json."), null;
      if (!Number.isInteger(st.at) || (st.at as number) < 1 || (st.at as number) > steps.length)
        return c.error([...p, "at"], `"at" must be a step number between 1 and ${steps.length}.`), null;
      states.push({ id: st.id, ...(st.name !== undefined ? { name: st.name as string } : {}), fixture: st.fixture, at: st.at as number });
    }
  }
  return { id: x.id, name: x.name, ...(x.intent !== undefined ? { intent: x.intent as string } : {}), steps, states };
}

/** Parse and validate flows.yaml. Never throws; never executes anything. */
export function parseFlows(text: string): ParsedFlows {
  if (Buffer.byteLength(text, "utf8") > MAX_FLOWS_BYTES)
    return { file: null, errors: [{ line: null, path: "", message: "flows.yaml is larger than 1 MB; split it or remove unused flows." }], warnings: [] };
  const lines = new LineCounter();
  let doc: Document;
  try {
    doc = parseDocument(text, { schema: "core", customTags: [], uniqueKeys: true, lineCounter: lines, prettyErrors: false, strict: true });
  } catch {
    return { file: null, errors: [{ line: null, path: "", message: "flows.yaml couldn't be read as YAML." }], warnings: [] };
  }
  const c = new Collector(doc, lines);
  const fail = (): ParsedFlows => ({ file: null, errors: c.errors, warnings: c.warnings });
  for (const e of [...doc.errors, ...doc.warnings]) {
    const line = e.linePos?.[0]?.line ?? null;
    c.errors.push({ line, path: "", message: /tag/i.test(e.message) ? "Custom YAML tags (like !!js or !include) aren't allowed." : `YAML problem: ${e.message.split("\n")[0]}` });
  }
  if (c.errors.length) return fail();
  if (!hasNoTags(doc.contents)) return c.error([], "Custom YAML tags (like !!js or !include) aren't allowed."), fail();

  let data: unknown;
  try {
    data = doc.toJS({ maxAliasCount: MAX_ALIASES });
  } catch {
    return c.error([], `flows.yaml uses too many aliases (the limit is ${MAX_ALIASES}).`), fail();
  }
  if (!isObj(data)) return c.error([], "flows.yaml must start with `version: 1` and a `flows:` list."), fail();
  const unknown = onlyKeys(data, ["version", "baseUrl", "fixtures", "flows"]);
  const extraTop = unknown[0];
  if (extraTop !== undefined) return c.error([extraTop], `"${extraTop}" isn't a top-level field. Use version, baseUrl, fixtures and flows.`), fail();
  if (data.version !== 1) return c.error(["version"], "Set `version: 1` at the top of flows.yaml."), fail();
  const baseUrl = data.baseUrl ?? "/";
  if (!isRelativePath(baseUrl)) return c.error(["baseUrl"], "baseUrl must be a path starting with / (absolute URLs aren't allowed)."), fail();
  const fixtures = data.fixtures ?? ".handoff/fixtures";
  if (!isRepoPath(fixtures)) return c.error(["fixtures"], "fixtures must be a folder inside your repo, like .handoff/fixtures."), fail();
  if (!Array.isArray(data.flows) || data.flows.length > MAX_FLOWS) return c.error(["flows"], `flows must be a list of up to ${MAX_FLOWS} flows.`), fail();

  const flows: Flow[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < data.flows.length; i++) {
    const f = flow(c, ["flows", i], data.flows[i]);
    if (!f) return fail();
    if (seen.has(f.id)) return c.error(["flows", i, "id"], `Duplicate flow id "${f.id}"; each flow needs its own id.`), fail();
    seen.add(f.id);
    flows.push(f);
  }
  return { file: { version: 1, baseUrl, fixtures, flows }, errors: [], warnings: c.warnings };
}

function hasNoTags(node: unknown): boolean {
  if (!node || typeof node !== "object") return true;
  const tag = (node as { tag?: string }).tag;
  if (tag && !/^tag:yaml\.org,2002:(str|int|float|bool|null|map|seq)$/.test(tag)) return false;
  if (isMap(node)) return node.items.every((p) => hasNoTags(p.key) && hasNoTags(p.value));
  if (isSeq(node)) return node.items.every(hasNoTags);
  return isScalar(node) || true;
}

