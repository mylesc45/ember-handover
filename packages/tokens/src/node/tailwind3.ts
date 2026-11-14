import { execa } from "execa";
import { parseColor, toHex } from "../color.js";
import type { Token, TokenSet } from "../types.js";
import { emValue, lengthPx, ratio } from "./values.js";

/**
 * Resolve a Tailwind v3 config with the project's own tailwindcss, in a child process.
 * This runs the project's config file, exactly as its dev server already does; it never
 * runs inside Handoff's process, and is argument-array only (SPEC S7).
 */
const RESOLVE = `
const { createRequire } = require("node:module");
const path = require("node:path");
const [configPath, root] = process.argv.slice(1);
const req = createRequire(path.join(root, "package.json"));
let config;
try { config = req("tailwindcss/loadConfig")(configPath); } catch { config = req(configPath); }
const theme = req("tailwindcss/resolveConfig")(config).theme;
process.stdout.write(JSON.stringify(theme, (k, v) => (typeof v === "function" ? undefined : v)));
`;

export async function resolveV3Theme(root: string, configPath: string): Promise<Record<string, unknown>> {
  const r = await execa(process.execPath, ["-e", RESOLVE, configPath, root], {
    cwd: root,
    timeout: 15_000,
    reject: false,
    maxBuffer: 8_000_000,
    env: { NODE_OPTIONS: "" },
  });
  if (r.exitCode !== 0) throw new Error("tailwind v3 resolve failed");
  return JSON.parse(r.stdout) as Record<string, unknown>;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

function flatten(obj: Record<string, unknown>, prefix = ""): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(obj)) {
    const name = k === "DEFAULT" ? prefix.replace(/-$/, "") : `${prefix}${k}`;
    if (typeof v === "string") out.push([name, v]);
    else if (isObj(v)) out.push(...flatten(v, `${name}-`));
  }
  return out;
}

export function v3ThemeToTokens(theme: Record<string, unknown>, file: string): Pick<TokenSet, "tokens" | "breakpoints"> {
  const source = { file, line: 0 };
  const tokens: Token[] = [];
  const section = (k: string) => (isObj(theme[k]) ? (theme[k] as Record<string, unknown>) : {});

  for (const [name, value] of flatten(section("colors"))) {
    const c = parseColor(value);
    tokens.push({ name, kind: "color", value, ...(c ? { hex: toHex(c) } : {}), utility: name, source });
  }
  for (const [name, value] of Object.entries(section("spacing"))) {
    if (typeof value !== "string") continue;
    const px = lengthPx(value);
    tokens.push({ name, kind: "spacing", value, ...(px !== null ? { px } : {}), utility: name, source });
  }
  for (const [name, value] of Object.entries(section("borderRadius"))) {
    if (typeof value !== "string") continue;
    const px = lengthPx(value);
    tokens.push({ name, kind: "radius", value, ...(px !== null ? { px } : {}), utility: name === "DEFAULT" ? "rounded" : `rounded-${name}`, source });
  }
  for (const [name, raw] of Object.entries(section("fontSize"))) {
    const value = typeof raw === "string" ? raw : Array.isArray(raw) && typeof raw[0] === "string" ? raw[0] : null;
    if (!value) continue;
    const px = lengthPx(value);
    tokens.push({ name, kind: "fontSize", value, ...(px !== null ? { px } : {}), utility: `text-${name}`, source });
  }
  for (const [name, value] of Object.entries(section("fontWeight"))) {
    if (typeof value === "string") tokens.push({ name, kind: "fontWeight", value, utility: `font-${name}`, source });
  }
  for (const [name, value] of Object.entries(section("lineHeight"))) {
    if (typeof value !== "string") continue;
    const px = lengthPx(value);
    const r = ratio(value);
    tokens.push({ name, kind: "lineHeight", value, ...(px !== null ? { px } : {}), ...(r !== null ? { em: r } : {}), utility: `leading-${name}`, source });
  }
  for (const [name, value] of Object.entries(section("letterSpacing"))) {
    if (typeof value !== "string") continue;
    const em = emValue(value);
    tokens.push({ name, kind: "letterSpacing", value, ...(em !== null ? { em } : {}), utility: `tracking-${name}`, source });
  }
  for (const [name, value] of Object.entries(section("fontFamily"))) {
    const v = Array.isArray(value) ? value.filter((x) => typeof x === "string").join(", ") : typeof value === "string" ? value : null;
    if (v) tokens.push({ name, kind: "fontFamily", value: v, utility: `font-${name}`, source });
  }
  for (const [name, value] of Object.entries(section("boxShadow"))) {
    if (typeof value === "string") tokens.push({ name, kind: "shadow", value, utility: name === "DEFAULT" ? "shadow" : `shadow-${name}`, source });
  }
  const breakpoints: TokenSet["breakpoints"] = [];
  for (const [name, value] of Object.entries(section("screens"))) {
    const v = typeof value === "string" ? value : isObj(value) && typeof value.min === "string" ? value.min : null;
    const px = v ? lengthPx(v) : null;
    if (px !== null) breakpoints.push({ name, px });
  }
  return { tokens, breakpoints };
}
