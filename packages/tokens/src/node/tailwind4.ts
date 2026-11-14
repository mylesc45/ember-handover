import { parseColor, toHex } from "../color.js";
import type { Token, TokenSet } from "../types.js";
import type { Decl } from "./css.js";
import { emValue, lengthPx, ratio, resolveVars } from "./values.js";

interface Sourced extends Decl {
  file: string;
}

/** Apply `--ns-*: initial` resets in order, then later declarations override earlier ones. */
export function mergeTheme(decls: Sourced[]): Map<string, Sourced> {
  const map = new Map<string, Sourced>();
  for (const d of decls) {
    if (d.name.endsWith("-*") && d.value === "initial") {
      const prefix = d.name.slice(0, -1);
      for (const k of [...map.keys()]) if (prefix === "--*" ? true : k.startsWith(prefix)) map.delete(k);
      continue;
    }
    map.set(d.name, d);
  }
  return map;
}

const NS: [RegExp, Token["kind"], (n: string) => string][] = [
  [/^--color-(.+)$/, "color", (n) => n],
  [/^--spacing-(.+)$/, "spacing", (n) => n],
  [/^--radius-(.+)$/, "radius", (n) => `rounded-${n}`],
  [/^--text-([^-].*?)$/, "fontSize", (n) => `text-${n}`],
  [/^--font-weight-(.+)$/, "fontWeight", (n) => `font-${n}`],
  [/^--font-(.+)$/, "fontFamily", (n) => `font-${n}`],
  [/^--leading-(.+)$/, "lineHeight", (n) => `leading-${n}`],
  [/^--tracking-(.+)$/, "letterSpacing", (n) => `tracking-${n}`],
  [/^--shadow-(.+)$/, "shadow", (n) => `shadow-${n}`],
];

export function themeToTokens(theme: Map<string, Sourced>): Pick<TokenSet, "tokens" | "spacingBase" | "breakpoints"> {
  const lookup = (n: string) => theme.get(n)?.value;
  const tokens: Token[] = [];
  const breakpoints: TokenSet["breakpoints"] = [];
  let spacingBase: number | null = null;

  for (const [name, d] of theme) {
    const value = resolveVars(d.value, lookup);
    const source = { file: d.file, line: d.line };
    if (name === "--spacing") {
      spacingBase = lengthPx(value);
      continue;
    }
    const bp = /^--breakpoint-(.+)$/.exec(name);
    if (bp) {
      const px = lengthPx(value);
      if (px !== null && bp[1]) breakpoints.push({ name: bp[1], px });
      continue;
    }
    if (name.includes("--", 2)) continue; // sub-properties like --text-base--line-height
    for (const [re, kind, util] of NS) {
      const m = re.exec(name);
      const short = m?.[1];
      if (!short) continue;
      const t: Token = { name: short, kind, value: d.value, utility: util(short), cssVar: name, source };
      if (kind === "color") {
        const c = parseColor(value);
        if (c) t.hex = toHex(c);
      } else if (kind === "letterSpacing") {
        const em = emValue(value);
        if (em !== null) t.em = em;
        const px = lengthPx(value);
        if (px !== null) t.px = px;
      } else if (kind === "lineHeight") {
        const r = ratio(value);
        if (r !== null) t.em = r;
        const px = lengthPx(value);
        if (px !== null) t.px = px;
      } else if (kind === "spacing" || kind === "radius" || kind === "fontSize") {
        const px = lengthPx(value);
        if (px !== null) t.px = px;
      }
      tokens.push(t);
      break;
    }
  }
  return { tokens, spacingBase, breakpoints };
}
