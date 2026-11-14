import { describe, expect, it } from "vitest";
import { normalizeSpec } from "../src/index.js";
import { RAW, TOKENS } from "./fixtures.js";

describe("normalizeSpec", () => {
  const spec = normalizeSpec(RAW, TOKENS);

  it("keeps measured box values exactly", () => {
    expect(spec.box).toMatchObject({ width: 320, height: 412, padding: [24, 24, 24, 24], margin: [0, 0, 16, 0], gap: { row: 16, column: 16 } });
  });

  it("matches typography to tokens", () => {
    expect(spec.typography).toMatchObject({ family: "Inter", size: 16, weight: 600, lineHeight: 24 });
    expect(spec.typography.tokens.size).toMatchObject({ status: "match", token: { utility: "text-base" } });
    expect(spec.typography.tokens.weight).toMatchObject({ status: "match", token: { utility: "font-semibold" } });
  });

  it("normalises colours to hex and OKLCH with tokens", () => {
    expect(spec.colors.text).toMatchObject({ hex: "#18181b", token: { status: "match", token: { name: "zinc-900" } } });
    expect(spec.colors.text?.oklch).toMatch(/^oklch\(/);
    expect(spec.colors.background).toMatchObject({ hex: "#ffffff", token: { status: "match", token: { name: "white" } } });
    expect(spec.colors.border).toMatchObject({ hex: "#e4e4e7", token: { status: "match" } });
  });

  it("matches spacing with the v4 scale", () => {
    expect(spec.box.tokens.padding).toMatchObject({ status: "match", token: { utility: "6" } });
  });

  it("reports drift for near-token values (get_spec example)", () => {
    expect(spec.drift).toContainEqual({ prop: "borderRadius", value: 14, nearestToken: "rounded-xl", tokenValue: 12, delta: 2 });
  });

  it("computes contrast against the effective background", () => {
    expect(spec.a11y.contrast?.ratio).toBeGreaterThan(17);
    expect(spec.a11y.contrast?.aa).toBe(true);
  });

  it("transparent backgrounds normalise to null", () => {
    const s = normalizeSpec({ ...RAW, colors: { ...RAW.colors, background: "rgba(0, 0, 0, 0)" } }, TOKENS);
    expect(s.colors.background).toBeNull();
  });

  it("flags failing contrast", () => {
    const s = normalizeSpec({ ...RAW, colors: { ...RAW.colors, text: "rgb(200, 200, 200)" } }, TOKENS);
    expect(s.a11y.contrast).toMatchObject({ aa: false });
  });

  it("works with no tokens at all", () => {
    const s = normalizeSpec(RAW, { system: "none", sources: [], spacingBase: null, breakpoints: [], tokens: [] });
    expect(s.colors.text?.token).toEqual({ status: "none" });
    expect(s.drift).toEqual([]);
  });
});
