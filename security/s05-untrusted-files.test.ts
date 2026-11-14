// S5 — Untrusted PR files execute code during review.
import { describe, it } from "vitest";

describe("S5 flow and notes parsers treat input as data", () => {
  it.todo("M4: flows.yaml rejects any step verb outside the closed vocabulary");
  it.todo("M4: YAML parsed with core schema, no custom tags");
  it.todo("M4: files over 1 MB rejected; more than 100 aliases rejected");
  it.todo("M4: absolute baseUrl and goto URLs rejected");
  it.todo("M4: XSS payload corpus in notes and flow names renders as plain text");
});
