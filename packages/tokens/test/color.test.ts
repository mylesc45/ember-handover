import { describe, expect, it } from "vitest";
import { composite, contrastRatio, deltaE2000Lab, formatOklch, parseColor, toHex } from "../src/color.js";

const hex = (s: string) => {
  const c = parseColor(s);
  if (!c) throw new Error(`unparsed: ${s}`);
  return toHex(c);
};

describe("parseColor + toHex", () => {
  it.each([
    ["#f64668", "#f64668"],
    ["#F46", "#ff4466"],
    ["#f468", "#ff446688"],
    ["#F6466880", "#f6466880"],
    ["rgb(246, 70, 104)", "#f64668"],
    ["rgba(246, 70, 104, 0.5)", "#f6466880"],
    ["rgb(246 70 104 / 50%)", "#f6466880"],
    ["rgb(100% 0% 50%)", "#ff0080"],
    ["hsl(348 91% 62%)", "#f64669"],
    ["hsla(0, 100%, 50%, 1)", "#ff0000"],
    ["white", "#ffffff"],
    ["RebeccaPurple", "#663399"],
    ["transparent", "#00000000"],
    ["color(srgb 1 0 0)", "#ff0000"],
    ["color(srgb 0.5 0.5 0.5 / 0.25)", "#80808040"],
    ["oklch(62.8% 0.2577 29.23)", "#ff0000"],
    ["oklch(0.628 0.2577 29.23)", "#ff0000"],
    ["oklab(0.628 0.2249 0.1258)", "#ff0000"],
    ["oklch(100% 0 0)", "#ffffff"],
    ["oklch(0% 0 none)", "#000000"],
    ["lab(54.29 80.8 69.89)", "#ff0000"],
    ["lch(54.29 106.84 40.85)", "#ff0000"],
  ])("%s → %s", (input, expected) => {
    expect(hex(input)).toBe(expected);
  });

  it.each(["", "red;", "rgb(1,2)", "#12", "#12345", "url(x)", "var(--x)", "currentColor", "oklch(", "color(rec2020 1 0 0)"])(
    "rejects %j",
    (s) => expect(parseColor(s)).toBeNull(),
  );

  it("clamps out-of-gamut colours when formatting hex", () => {
    expect(hex("color(display-p3 1 0 0)")).toBe("#ff0000");
  });
});

describe("formatOklch", () => {
  it("formats in CSS syntax", () => {
    expect(formatOklch(parseColor("#ff0000")!)).toBe("oklch(62.8% 0.258 29.23)");
    expect(formatOklch(parseColor("rgba(255,255,255,0.5)")!)).toBe("oklch(100% 0 0 / 0.5)");
  });
});

describe("CIEDE2000 (Sharma, Wu & Dalal reference pairs)", () => {
  it.each([
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
    [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
  ])("%j vs %j = %d", (a, b, want) => {
    expect(deltaE2000Lab(a as [number, number, number], b as [number, number, number])).toBeCloseTo(want, 4);
  });
});

describe("WCAG contrast (values from SPEC → UI design system)", () => {
  it.each([
    ["#FFFFFF", "#41436A", 9.39],
    ["#FFFFFF", "#984063", 6.46],
    ["#0F1420", "#F64668", 5.25],
    ["#F64668", "#1E2638", 4.31],
    ["#FE9677", "#1E2638", 7.08],
    ["#FFFFFF", "#1E2638", 15.11],
    ["#B8BDD0", "#1E2638", 8.08],
    ["#7E86A3", "#1E2638", 4.19],
    ["#FFFFFF", "#F64668", 3.5],
  ])("%s on %s = %d", (fg, bg, ratio) => {
    expect(contrastRatio(parseColor(fg)!, parseColor(bg)!)).toBeCloseTo(ratio, 1);
    expect(Math.abs(contrastRatio(parseColor(fg)!, parseColor(bg)!) - ratio)).toBeLessThan(0.01);
  });

  it("composites translucent text over its background first", () => {
    const fg = parseColor("rgba(255,255,255,0.5)")!;
    const bg = parseColor("#000")!;
    expect(toHex(composite(fg, bg))).toBe("#808080");
    expect(contrastRatio(fg, bg)).toBeCloseTo(contrastRatio(parseColor("#808080")!, bg), 2);
  });
});
