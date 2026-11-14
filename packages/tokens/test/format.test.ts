import { describe, expect, it } from "vitest";
import { normalizeSpec, toCss, toPrompt, toTailwind, toTokenCss } from "../src/index.js";
import { RAW, TOKENS } from "./fixtures.js";

const spec = normalizeSpec(RAW, TOKENS);

describe("copy formats", () => {
  it("CSS: measured values, shorthand where all sides match", () => {
    expect(toCss(spec)).toBe(
      [
        "display: flex;",
        "flex-direction: column;",
        "align-items: center;",
        "gap: 16px;",
        "width: 320px;",
        "height: 412px;",
        "padding: 24px;",
        "margin: 0 0 16px 0;",
        "border: 1px solid #e4e4e7;",
        "border-radius: 14px;",
        "background-color: #ffffff;",
        "color: #18181b;",
        'font-family: "Inter", sans-serif;',
        "font-size: 16px;",
        "font-weight: 600;",
        "line-height: 24px;",
      ].join("\n"),
    );
  });

  it("Tokens: CSS with var() wherever a token matches exactly", () => {
    const css = toTokenCss(spec);
    expect(css).toContain("background-color: var(--color-white);");
    expect(css).toContain("color: var(--color-zinc-900);");
    expect(css).toContain("font-size: var(--text-base);");
    expect(css).toContain("padding: calc(var(--spacing) * 6);");
    expect(css).toContain("border-radius: 14px; /* off by 2px from var(--radius-xl) */");
  });

  it("Tailwind: token utilities, arbitrary values otherwise", () => {
    expect(toTailwind(spec)).toBe(
      "flex flex-col items-center gap-4 w-[320px] h-[412px] p-6 mb-4 border border-zinc-200 rounded-[14px] bg-white text-zinc-900 text-base font-semibold leading-[24px]",
    );
  });

  it("Prompt for agent: structured, labelled, and marks page text untrusted", () => {
    const p = toPrompt(spec, { route: "/pricing" });
    expect(p).toContain("Element: <div> data-testid=\"plan-pro\" on /pricing");
    expect(p).toContain("Size: 320 × 412 px");
    expect(p).toContain("Tailwind: flex flex-col");
    expect(p).toContain("Drift: borderRadius 14px is 2px off rounded-xl (12px)");
    expect(p).toMatch(/untrusted/i);
  });
});
