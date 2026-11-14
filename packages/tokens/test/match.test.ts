import { describe, expect, it } from "vitest";
import { parseColor } from "../src/color.js";
import { matchColor, matchLength, type Token, type TokenSet } from "../src/index.js";

const t = (p: Partial<Token> & Pick<Token, "name" | "kind">): Token => ({ value: "", source: { file: "x.css", line: 1 }, ...p });

const SET: TokenSet = {
  system: "tailwind-v4",
  sources: [],
  spacingBase: 4,
  breakpoints: [],
  tokens: [
    t({ name: "brand", kind: "color", hex: "#f64668", utility: "brand", cssVar: "--color-brand" }),
    t({ name: "zinc-200", kind: "color", hex: "#e4e4e7", utility: "zinc-200" }),
    t({ name: "white", kind: "color", hex: "#ffffff", utility: "white" }),
    t({ name: "xl", kind: "radius", px: 12, utility: "rounded-xl" }),
    t({ name: "lg", kind: "radius", px: 8, utility: "rounded-lg" }),
    t({ name: "base", kind: "fontSize", px: 16, utility: "text-base" }),
    t({ name: "--gap", kind: "length", px: 8, cssVar: "--gap" }),
  ],
};

describe("matchLength", () => {
  it("exact match", () => {
    expect(matchLength(SET, "radius", 12)).toMatchObject({ status: "match", token: { name: "xl" } });
  });
  it("off by N px within 2 px", () => {
    expect(matchLength(SET, "radius", 14)).toMatchObject({ status: "near", token: { name: "xl" }, delta: 2 });
    expect(matchLength(SET, "radius", 9)).toMatchObject({ status: "near", token: { name: "lg" }, delta: 1 });
  });
  it("no token beyond 2 px", () => {
    expect(matchLength(SET, "radius", 20)).toEqual({ status: "none" });
  });
  it("v4 spacing: whole and half steps of the base are tokens", () => {
    expect(matchLength(SET, "spacing", 16)).toMatchObject({ status: "match", token: { name: "4", utility: "4", px: 16 } });
    expect(matchLength(SET, "spacing", 6)).toMatchObject({ status: "match", token: { name: "1.5" } });
    expect(matchLength(SET, "spacing", 0)).toMatchObject({ status: "match", token: { name: "0" } });
    expect(matchLength(SET, "spacing", 13)).toMatchObject({ status: "near", token: { name: "3" }, delta: 1 });
  });
  it("plain CSS length variables match any length kind", () => {
    expect(matchLength({ ...SET, spacingBase: null, system: "css-vars" }, "spacing", 8)).toMatchObject({ status: "match", token: { name: "--gap" } });
  });
  it("ignores fractional float noise", () => {
    expect(matchLength(SET, "fontSize", 16.0000001)).toMatchObject({ status: "match" });
  });
});

describe("matchColor", () => {
  it("exact match on hex", () => {
    expect(matchColor(SET, parseColor("rgb(246, 70, 104)")!)).toMatchObject({ status: "match", token: { name: "brand" } });
  });
  it("near within ΔE 3", () => {
    const r = matchColor(SET, parseColor("#f54769")!);
    expect(r).toMatchObject({ status: "near", token: { name: "brand" } });
    expect(r.status === "near" && r.delta).toBeGreaterThan(0);
    expect(r.status === "near" && r.delta).toBeLessThanOrEqual(3);
  });
  it("no token beyond ΔE 3", () => {
    expect(matchColor(SET, parseColor("#00ff00")!)).toEqual({ status: "none" });
  });
  it("alpha must match for an exact match", () => {
    expect(matchColor(SET, parseColor("rgba(246, 70, 104, 0.5)")!).status).not.toBe("match");
  });
});
