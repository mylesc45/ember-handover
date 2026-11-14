import type { Quad, RawSpec } from "@ember-handover/bridge";
import { type Color, composite, contrastRatio, formatOklch, parseColor, toHex } from "./color.js";
import { matchColor, matchLength, matchValue } from "./match.js";
import type { LengthKind, Token, TokenMatch, TokenSet } from "./types.js";

export interface ColorValue {
  raw: string;
  hex: string;
  oklch: string;
  alpha: number;
  token: TokenMatch;
}

export interface Drift {
  prop: string;
  value: number | string;
  nearestToken: string;
  tokenValue: number | string;
  delta: number;
}

export interface Spec {
  element: Pick<RawSpec, "tag" | "id" | "testid" | "classes" | "text" | "path" | "ancestors">;
  box: {
    x: number;
    y: number;
    width: number;
    height: number;
    padding: Quad;
    margin: Quad;
    border: Quad;
    borderStyle: string;
    gap: { row: number; column: number } | null;
    tokens: {
      padding: TokenMatch;
      paddingSides: TokenMatch[];
      marginSides: TokenMatch[];
      gap: TokenMatch;
    };
  };
  layout: RawSpec["layout"];
  typography: Omit<RawSpec["typography"], "family"> & {
    family: string;
    stack: string;
    tokens: { size: TokenMatch; weight: TokenMatch; lineHeight: TokenMatch; letterSpacing: TokenMatch; family: TokenMatch };
  };
  colors: { text: ColorValue | null; background: ColorValue | null; border: ColorValue | null };
  effects: RawSpec["effects"] & { tokens: { radius: TokenMatch; shadow: TokenMatch } };
  a11y: {
    role: string;
    name: string;
    contrast: { ratio: number; aa: boolean; large: boolean; background: string } | null;
  };
  live: RawSpec["live"];
  drift: Drift[];
}

const NONE: TokenMatch = { status: "none" };
const allSame = (q: readonly number[]) => q.every((v) => v === q[0]);

function color(raw: string, set: TokenSet): ColorValue | null {
  const c = parseColor(raw);
  if (!c || c.alpha === 0) return null;
  return { raw, hex: toHex(c), oklch: formatOklch(c), alpha: Math.round(c.alpha * 1000) / 1000, token: matchColor(set, c) };
}

/** Name to show for a token in a given property: the Tailwind utility when there is one. */
export function tokenLabel(prop: string, t: Token): string {
  if (!t.utility) return t.cssVar ? `var(${t.cssVar})` : t.name;
  const prefix: Record<string, string> = {
    color: "text-",
    backgroundColor: "bg-",
    borderColor: "border-",
    padding: "p-",
    paddingTop: "pt-",
    paddingRight: "pr-",
    paddingBottom: "pb-",
    paddingLeft: "pl-",
    marginTop: "mt-",
    marginRight: "mr-",
    marginBottom: "mb-",
    marginLeft: "ml-",
    gap: "gap-",
  };
  const p = prefix[prop];
  return p && (t.kind === "color" || t.kind === "spacing") ? p + t.utility : t.utility;
}

const SIDES = ["Top", "Right", "Bottom", "Left"];

export function firstFamily(stack: string): string {
  return (stack.split(",")[0] ?? "").trim().replace(/^["']|["']$/g, "");
}

/** Turn a raw browser measurement into the spec Handoff shows, with tokens and drift. */
export function normalizeSpec(raw: RawSpec, set: TokenSet): Spec {
  const drift: Drift[] = [];
  const len = (prop: string, kind: LengthKind, px: number): TokenMatch => {
    const m = matchLength(set, kind, px);
    if (m.status === "near")
      drift.push({ prop, value: px, nearestToken: tokenLabel(prop, m.token), tokenValue: m.token.px ?? 0, delta: m.delta });
    return m;
  };
  const col = (prop: string, raw: string): ColorValue | null => {
    const v = color(raw, set);
    if (v?.token.status === "near")
      drift.push({ prop, value: v.hex, nearestToken: tokenLabel(prop, v.token.token), tokenValue: v.token.token.hex ?? "", delta: v.token.delta });
    return v;
  };

  const p = raw.box.padding;
  const paddingSides = allSame(p) ? [len("padding", "spacing", p[0])] : p.map((v, i) => len(`padding${SIDES[i]}`, "spacing", v));
  const marginSides = raw.box.margin.map((v, i) => (v === 0 ? NONE : len(`margin${SIDES[i]}`, "spacing", Math.abs(v))));
  const isFlexOrGrid = /flex|grid/.test(raw.layout.display);
  const gap =
    isFlexOrGrid && raw.layout.rowGap !== null && raw.layout.columnGap !== null ? { row: raw.layout.rowGap, column: raw.layout.columnGap } : null;
  const gapMatch = gap && gap.row === gap.column && gap.row > 0 ? len("gap", "spacing", gap.row) : NONE;

  const t = raw.typography;
  const typography: Spec["typography"] = {
    ...t,
    family: firstFamily(t.family),
    stack: t.family,
    tokens: {
      size: len("fontSize", "fontSize", t.size),
      weight: matchValue(set, "fontWeight", String(t.weight)),
      lineHeight: t.lineHeight === null ? NONE : len("lineHeight", "lineHeight", t.lineHeight),
      letterSpacing: t.letterSpacing === null || t.letterSpacing === 0 ? NONE : len("letterSpacing", "letterSpacing", t.letterSpacing),
      family: matchValue(set, "fontFamily", t.family),
    },
  };

  const borderUniform = allSame(raw.box.border) && raw.box.border[0] > 0 && raw.colors.border.every((c) => c === raw.colors.border[0]);
  const colors = {
    text: col("color", raw.colors.text),
    background: col("backgroundColor", raw.colors.background),
    border: borderUniform ? col("borderColor", raw.colors.border[0]) : null,
  };

  const r = raw.effects.radius;
  const radius = allSame(r) && r[0] > 0 ? len("borderRadius", "radius", r[0]) : NONE;
  const shadow = raw.effects.shadow === "none" ? NONE : matchValue(set, "shadow", raw.effects.shadow);

  return {
    element: {
      tag: raw.tag,
      id: raw.id,
      testid: raw.testid,
      classes: raw.classes,
      text: raw.text,
      path: raw.path,
      ancestors: raw.ancestors,
    },
    box: {
      ...raw.rect,
      padding: raw.box.padding,
      margin: raw.box.margin,
      border: raw.box.border,
      borderStyle: raw.box.borderStyle,
      gap,
      tokens: { padding: paddingSides.length === 1 ? (paddingSides[0] ?? NONE) : NONE, paddingSides, marginSides, gap: gapMatch },
    },
    layout: raw.layout,
    typography,
    colors,
    effects: { ...raw.effects, tokens: { radius, shadow } },
    a11y: { role: raw.a11y.role, name: raw.a11y.name, contrast: contrast(raw) },
    live: raw.live,
    drift,
  };
}

const WHITE: Color = { r: 1, g: 1, b: 1, alpha: 1 };

function contrast(raw: RawSpec): Spec["a11y"]["contrast"] {
  const fg = parseColor(raw.colors.text);
  if (!fg || fg.alpha === 0 || !raw.text.trim()) return null;
  let bg = WHITE;
  for (const b of [...raw.a11y.backgrounds].reverse()) {
    const c = parseColor(b);
    if (!c) return null; // unknown layer: don't guess
    bg = composite(c, bg);
  }
  const ratio = Math.round(contrastRatio(fg, bg) * 100) / 100;
  const t = raw.typography;
  const large = t.size >= 24 || (t.size >= 18.66 && t.weight >= 700);
  return { ratio, aa: ratio >= (large ? 3 : 4.5), large, background: toHex(bg) };
}
