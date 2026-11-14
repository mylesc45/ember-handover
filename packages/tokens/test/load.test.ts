import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { loadTokens, parseThemeBlocks } from "../src/node/index.js";
import type { Token, TokenSet } from "../src/index.js";

const fixtures = fileURLToPath(new URL("../../../fixtures/tokens/", import.meta.url));
const byName = (set: TokenSet, name: string): Token | undefined => set.tokens.find((t) => t.name === name);

describe("parseThemeBlocks", () => {
  it("reads declarations inside @theme, skipping nested blocks and comments", () => {
    const css = `/* --color-x: red; */
@theme default {
  --font-sans:
    a, 'b c',
    sans-serif;
  --color-red-500: oklch(63.7% 0.237 25.331);
  @keyframes spin { to { transform: rotate(360deg); } }
  --animate-spin: spin 1s linear infinite;
}
.x { --color-not: blue; }
@theme inline { --color-y: #fff; }`;
    const decls = parseThemeBlocks(css);
    expect(decls.map((d) => d.name)).toEqual(["--font-sans", "--color-red-500", "--animate-spin", "--color-y"]);
    expect(decls[0]).toMatchObject({ value: "a, 'b c', sans-serif", line: 3 });
    expect(decls[1]).toMatchObject({ line: 6 });
  });
});

describe("Tailwind v4", () => {
  let set: TokenSet;
  beforeAll(async () => {
    set = await loadTokens(join(fixtures, "tw4"));
  });

  it("is detected", () => {
    expect(set.system).toBe("tailwind-v4");
  });

  it("includes the project's own @theme tokens with source location", () => {
    expect(byName(set, "brand")).toMatchObject({
      kind: "color",
      value: "#F64668",
      hex: "#f64668",
      utility: "brand",
      cssVar: "--color-brand",
      source: { file: "src/app.css", line: 4 },
    });
    expect(byName(set, "card")).toMatchObject({ kind: "radius", px: 14, utility: "rounded-card" });
    expect(byName(set, "hero")).toMatchObject({ kind: "fontSize", px: 48, utility: "text-hero" });
    expect(byName(set, "tightish")).toMatchObject({ kind: "letterSpacing", em: -0.01, utility: "tracking-tightish" });
    expect(byName(set, "card")?.kind).toBe("radius");
  });

  it("resolves var() references between theme tokens", () => {
    expect(byName(set, "brand-soft")).toMatchObject({ kind: "color", hex: "#f64668" });
  });

  it("includes Tailwind's default theme from the project's node_modules", () => {
    expect(byName(set, "red-500")).toMatchObject({ kind: "color", hex: "#fb2c36", source: { file: expect.stringContaining("theme.css") } });
    expect(byName(set, "md")).toBeDefined();
    expect(set.tokens.find((t) => t.kind === "radius" && t.name === "md")).toMatchObject({ px: 6, utility: "rounded-md" });
    expect(set.tokens.find((t) => t.kind === "fontWeight" && t.name === "bold")).toMatchObject({ value: "700", utility: "font-bold" });
  });

  it("honours `--color-lime-*: initial` resets", () => {
    expect(byName(set, "lime-500")).toBeUndefined();
    expect(byName(set, "green-500")).toBeDefined();
  });

  it("ignores custom properties outside @theme", () => {
    expect(byName(set, "ignored")).toBeUndefined();
  });

  it("exposes the spacing scale base and breakpoints", () => {
    expect(set.spacingBase).toBe(4);
    expect(set.breakpoints).toEqual(
      expect.arrayContaining([
        { name: "sm", px: 640 },
        { name: "md", px: 768 },
        { name: "tablet", px: 768 },
      ]),
    );
  });
});

describe("Tailwind v3", () => {
  let set: TokenSet;
  beforeAll(async () => {
    set = await loadTokens(join(fixtures, "tw3"));
  }, 30_000);

  it("is detected and resolved with the project's own tailwindcss", () => {
    expect(set.system).toBe("tailwind-v3");
    expect(set.sources).toContain("tailwind.config.js");
  });

  it("flattens nested colours, DEFAULT keys and extensions", () => {
    expect(byName(set, "brand")).toMatchObject({ kind: "color", hex: "#f64668", utility: "brand" });
    expect(byName(set, "brand-dark")).toMatchObject({ kind: "color", hex: "#984063" });
    expect(byName(set, "blue-500")).toMatchObject({ kind: "color", hex: "#3b82f6" });
  });

  it("includes spacing, radius, font sizes and screens", () => {
    expect(set.tokens.find((t) => t.kind === "spacing" && t.name === "4")).toMatchObject({ px: 16, utility: "4" });
    expect(set.tokens.find((t) => t.kind === "spacing" && t.name === "18")).toMatchObject({ px: 72 });
    expect(set.tokens.find((t) => t.kind === "radius" && t.name === "card")).toMatchObject({ px: 14, utility: "rounded-card" });
    expect(set.tokens.find((t) => t.kind === "radius" && t.name === "DEFAULT")).toMatchObject({ px: 4, utility: "rounded" });
    expect(set.tokens.find((t) => t.kind === "fontSize" && t.name === "lg")).toMatchObject({ px: 18, utility: "text-lg" });
    expect(set.breakpoints).toEqual(expect.arrayContaining([{ name: "md", px: 768 }, { name: "tablet", px: 900 }]));
  });
});

describe("plain CSS variables", () => {
  let set: TokenSet;
  beforeAll(async () => {
    const ignored = join(fixtures, "cssvars", "node_modules", "ignored");
    mkdirSync(ignored, { recursive: true });
    writeFileSync(join(ignored, "style.css"), ":root { --should-not-appear: red; }\n");
    set = await loadTokens(join(fixtures, "cssvars"));
  });

  it("is detected", () => {
    expect(set.system).toBe("css-vars");
  });

  it("collects :root, html and :host custom properties with inferred kinds", () => {
    expect(byName(set, "--brand")).toMatchObject({ kind: "color", hex: "#f64668", cssVar: "--brand", source: { file: "src/tokens.css", line: 2 } });
    expect(byName(set, "--brand-alpha")).toMatchObject({ kind: "color", hex: "#f6466880" });
    expect(byName(set, "--space-md")).toMatchObject({ kind: "length", px: 16 });
    expect(byName(set, "--space-lg")).toMatchObject({ kind: "length", px: 24 });
    expect(byName(set, "--radius")).toMatchObject({ kind: "length", px: 8 });
    expect(byName(set, "--ref")).toMatchObject({ kind: "color", hex: "#f64668" });
    expect(byName(set, "--line-tight")).toBeDefined();
    expect(byName(set, "--gap")).toMatchObject({ px: 8, source: { file: "src/nested/more.css" } });
  });

  it("skips scoped variables and node_modules", () => {
    expect(byName(set, "--local-only")).toBeUndefined();
    expect(byName(set, "--should-not-appear")).toBeUndefined();
  });

  it("falls back to default breakpoints", () => {
    expect(set.breakpoints.map((b) => b.px)).toEqual([375, 768, 1280]);
  });
});

describe("no token sources", () => {
  it("returns an empty set without throwing", async () => {
    const set = await loadTokens(join(fixtures, "does-not-exist"));
    expect(set.system).toBe("none");
    expect(set.tokens).toEqual([]);
  });
});
