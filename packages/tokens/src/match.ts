import { type Color, deltaE, parseColor, toHex } from "./color.js";
import type { LengthKind, Token, TokenMatch, TokenSet } from "./types.js";

/** "Off by N" is reported up to 2 px (SPEC → Token drift). */
export const LENGTH_TOLERANCE_PX = 2;
/** …and up to ΔE 3 (CIEDE2000) for colours. */
export const COLOR_TOLERANCE_DE = 3;

const EPS = 1e-4;
const round2 = (n: number) => Math.round(n * 100) / 100;

function spacingToken(set: TokenSet, steps: number): Token {
  const name = String(steps);
  return {
    name,
    kind: "spacing",
    value: `calc(var(--spacing) * ${name})`,
    px: steps * (set.spacingBase ?? 0),
    utility: name,
    cssVar: "--spacing",
    source: { file: set.sources.find((s) => s.includes("theme.css")) ?? set.sources[0] ?? "", line: 0 },
  };
}

/** Exact lookup, else the nearest token within 2 px, else none. */
export function matchLength(set: TokenSet, kind: LengthKind, px: number): TokenMatch {
  const candidates = set.tokens.filter((t) => (t.kind === kind || t.kind === "length") && typeof t.px === "number");
  // Tailwind v4: every whole or half step of --spacing is a token (p-4, p-1.5, …).
  if (kind === "spacing" && set.spacingBase) {
    const steps = px / set.spacingBase;
    const half = Math.round(steps * 2) / 2;
    if (px >= 0 && Math.abs(steps - half) * set.spacingBase < EPS) return { status: "match", token: spacingToken(set, half) };
    const nearest = Math.round(steps);
    const delta = Math.abs(px - nearest * set.spacingBase);
    const named = best(candidates, px);
    if (named && named.delta < EPS) return { status: "match", token: named.token };
    if (delta <= LENGTH_TOLERANCE_PX) return { status: "near", token: spacingToken(set, nearest), delta: round2(delta) };
    return { status: "none" };
  }
  const b = best(candidates, px);
  if (!b) return { status: "none" };
  if (b.delta < EPS) return { status: "match", token: b.token };
  if (b.delta <= LENGTH_TOLERANCE_PX + EPS) return { status: "near", token: b.token, delta: round2(b.delta) };
  return { status: "none" };
}

function best(tokens: Token[], px: number) {
  let found: { token: Token; delta: number } | null = null;
  for (const t of tokens) {
    const d = Math.abs((t.px ?? Number.NaN) - px);
    if (found === null || d < found.delta) found = { token: t, delta: d };
  }
  return found;
}

/** Exact (same 8-bit sRGB and alpha), else nearest within ΔE 3 at the same alpha, else none. */
export function matchColor(set: TokenSet, color: Color): TokenMatch {
  const hex = toHex(color);
  let near: { token: Token; delta: number } | null = null;
  for (const t of set.tokens) {
    if (t.kind !== "color" || !t.hex) continue;
    if (t.hex === hex) return { status: "match", token: t };
    const tc = parseColor(t.hex);
    if (!tc || Math.abs(tc.alpha - color.alpha) > 0.002) continue;
    const d = deltaE(color, tc);
    if (d <= COLOR_TOLERANCE_DE && (near === null || d < near.delta)) near = { token: t, delta: d };
  }
  return near ? { status: "near", token: near.token, delta: Math.round(near.delta * 10) / 10 } : { status: "none" };
}

export function matchValue(set: TokenSet, kind: "fontWeight" | "fontFamily" | "shadow", value: string): TokenMatch {
  const norm = (s: string) => s.replace(/\s+/g, " ").replace(/['"]/g, "").trim().toLowerCase();
  const want = norm(value);
  const t = set.tokens.find((x) => x.kind === kind && norm(x.value) === want);
  if (t) return { status: "match", token: t };
  if (kind === "fontFamily") {
    // Match on the first family, the one that matters.
    const first = want.split(",")[0]?.trim();
    const f = set.tokens.find((x) => x.kind === kind && norm(x.value).split(",")[0]?.trim() === first);
    if (f) return { status: "match", token: f };
  }
  return { status: "none" };
}
