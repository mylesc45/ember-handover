export type TokenKind =
  | "color"
  | "spacing"
  | "radius"
  | "fontSize"
  | "fontWeight"
  | "lineHeight"
  | "letterSpacing"
  | "fontFamily"
  | "shadow"
  /** Plain CSS variable holding a length: matches any length property. */
  | "length"
  | "other";

export type LengthKind = "spacing" | "radius" | "fontSize" | "lineHeight" | "letterSpacing";

export interface Token {
  /** Name as the design system spells it: `brand`, `red-500`, `md`, or `--brand` for plain CSS variables. */
  name: string;
  kind: TokenKind;
  /** Value as written in the source. */
  value: string;
  /** Resolved colour (#rrggbb[aa]) for colour tokens. */
  hex?: string;
  /** Resolved length in px (rem at 16 px) for length tokens. */
  px?: number;
  /** Letter spacing in em, when authored in em. */
  em?: number;
  /** Tailwind utility (or stem for colours/spacing), e.g. `rounded-md`, `text-base`, `brand`, `4`. */
  utility?: string;
  /** CSS custom property that carries the token at runtime, e.g. `--color-brand`. */
  cssVar?: string;
  source: { file: string; line: number };
}

export interface TokenSet {
  system: "tailwind-v4" | "tailwind-v3" | "css-vars" | "none";
  /** Repo-relative files the tokens came from. */
  sources: string[];
  /** Tailwind v4 `--spacing` base in px: p-N = N × base. */
  spacingBase: number | null;
  breakpoints: { name: string; px: number }[];
  tokens: Token[];
}

export type TokenMatch =
  | { status: "match"; token: Token }
  | { status: "near"; token: Token; delta: number }
  | { status: "none" };

export const EMPTY_TOKENS: TokenSet = { system: "none", sources: [], spacingBase: null, breakpoints: [], tokens: [] };
export const DEFAULT_BREAKPOINTS = [
  { name: "mobile", px: 375 },
  { name: "tablet", px: 768 },
  { name: "desktop", px: 1280 },
];
