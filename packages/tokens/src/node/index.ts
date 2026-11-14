import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseColor, toHex } from "../color.js";
import { DEFAULT_BREAKPOINTS, EMPTY_TOKENS, type Token, type TokenSet } from "../types.js";
import { cssFiles, findInNodeModules, readSmall, rel } from "./files.js";
import { mergeTheme, themeToTokens } from "./tailwind4.js";
import { resolveV3Theme, v3ThemeToTokens } from "./tailwind3.js";
import { parseRootVars, parseThemeBlocks } from "./theme.js";
import { lengthPx, resolveVars } from "./values.js";

export { parseRootVars, parseThemeBlocks } from "./theme.js";

const V3_CONFIGS = ["tailwind.config.js", "tailwind.config.cjs", "tailwind.config.mjs", "tailwind.config.ts", "tailwind.config.cts", "tailwind.config.mts"];
const IMPORTS_TAILWIND = /@import\s+(?:url\()?\s*["']tailwindcss(?:\/[^"']*)?["']/;

/** Read the repo's design tokens. Read-only, never throws; returns an empty set if there are none. */
export async function loadTokens(root: string): Promise<TokenSet> {
  try {
    return await load(root);
  } catch {
    return { ...EMPTY_TOKENS, breakpoints: DEFAULT_BREAKPOINTS };
  }
}

async function load(root: string): Promise<TokenSet> {
  if (!existsSync(root)) return { ...EMPTY_TOKENS, breakpoints: DEFAULT_BREAKPOINTS };
  const files = cssFiles(root).map((p) => ({ path: p, file: rel(root, p), css: readSmall(p) ?? "" }));
  const sources = new Set<string>();
  const tokens: Token[] = [];
  let system: TokenSet["system"] = "none";
  let spacingBase: number | null = null;
  let breakpoints: TokenSet["breakpoints"] = [];

  // Tailwind v4: @theme blocks, plus the default theme if tailwindcss is imported.
  const v4Files = files.filter((f) => IMPORTS_TAILWIND.test(f.css) || /@theme\b/.test(f.css));
  if (v4Files.length) {
    system = "tailwind-v4";
    const decls: Parameters<typeof mergeTheme>[0] = [];
    const defaults = v4Files.some((f) => IMPORTS_TAILWIND.test(f.css)) ? findInNodeModules(root, "tailwindcss", "theme.css") : null;
    if (defaults) {
      const file = rel(root, defaults);
      decls.push(...parseThemeBlocks(readSmall(defaults) ?? "").map((d) => ({ ...d, file })));
      sources.add(file);
    }
    for (const f of v4Files) {
      const found = parseThemeBlocks(f.css);
      if (found.length) sources.add(f.file);
      decls.push(...found.map((d) => ({ ...d, file: f.file })));
    }
    const t = themeToTokens(mergeTheme(decls));
    tokens.push(...t.tokens);
    spacingBase = t.spacingBase;
    breakpoints = t.breakpoints;
  } else {
    // Tailwind v3: a config file and tailwindcss 3 installed.
    const config = V3_CONFIGS.map((c) => join(root, c)).find(existsSync);
    const pkg = findInNodeModules(root, "tailwindcss", "package.json");
    const major = pkg ? Number(/"version"\s*:\s*"(\d+)/.exec(readSmall(pkg) ?? "")?.[1]) : null;
    if (config && major === 3) {
      const theme = await resolveV3Theme(root, config);
      const file = rel(root, config);
      const t = v3ThemeToTokens(theme, file);
      tokens.push(...t.tokens);
      breakpoints = t.breakpoints;
      sources.add(file);
      system = "tailwind-v3";
    }
  }

  // Plain CSS variables on :root / html / :host, in any project.
  const rootDecls = files.flatMap((f) => parseRootVars(f.css).map((d) => ({ ...d, file: f.file })));
  const vars = new Map(rootDecls.map((d) => [d.name, d.value]));
  for (const d of rootDecls) {
    if (tokens.some((t) => t.cssVar === d.name)) continue;
    const value = resolveVars(d.value, (n) => vars.get(n));
    const t: Token = { name: d.name, kind: "other", value: d.value, cssVar: d.name, source: { file: d.file, line: d.line } };
    const c = parseColor(value);
    const px = lengthPx(value);
    if (c) Object.assign(t, { kind: "color", hex: toHex(c) });
    else if (px !== null) Object.assign(t, { kind: "length", px });
    tokens.push(t);
    sources.add(d.file);
  }
  if (system === "none" && rootDecls.length) system = "css-vars";

  return {
    system,
    sources: [...sources],
    spacingBase,
    breakpoints: (breakpoints.length ? breakpoints : DEFAULT_BREAKPOINTS).sort((a, b) => a.px - b.px),
    tokens,
  };
}
