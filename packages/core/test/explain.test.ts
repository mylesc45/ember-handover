import { describe, expect, it } from "vitest";
import { ERROR_CODES, explain, HandoffError, isHandoffError } from "../src/index.js";

describe("explain(code)", () => {
  it("returns a plain sentence and a fix for every known code", () => {
    for (const code of ERROR_CODES) {
      const e = explain(code);
      expect(e.code).toBe(code);
      expect(e.message.length, code).toBeGreaterThan(10);
      expect(e.fix.length, code).toBeGreaterThan(5);
      // Plain sentences: start with a capital, end with a full stop.
      expect(e.message, code).toMatch(/^[A-Z].*\.$/s);
      expect(e.fix, code).toMatch(/^[A-Z`].*\.$/s);
      // No stack-trace-looking content.
      expect(e.message, code).not.toMatch(/\n\s+at /);
    }
  });

  it("falls back to an UNKNOWN explanation for an unrecognised code", () => {
    const e = explain("NOT_A_REAL_CODE" as never);
    expect(e.code).toBe("UNKNOWN");
    expect(e.fix).toMatch(/doctor/);
  });

  it("interpolates detail values as plain text", () => {
    const e = explain("UNKNOWN_COMMAND", { command: "<script>" });
    expect(e.message).toContain("<script>");
  });

  it("HandoffError carries a code and is detectable", () => {
    const err = new HandoffError("UNKNOWN_COMMAND", { command: "frob" });
    expect(isHandoffError(err)).toBe(true);
    expect(isHandoffError(new Error("x"))).toBe(false);
    expect(err.explanation.message).toContain("frob");
  });
});
