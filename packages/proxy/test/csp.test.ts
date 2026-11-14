import { describe, expect, it } from "vitest";
import { addScriptHash } from "../src/index.js";

const H = "'sha384-abc'";
const h = "sha384-abc";

describe("addScriptHash", () => {
  it("appends the hash to an existing script-src", () => {
    expect(addScriptHash("default-src 'self'; script-src 'self' https://cdn.example", h)).toBe(
      `default-src 'self'; script-src 'self' https://cdn.example ${H}`,
    );
  });

  it("derives script-src from default-src when script-src is absent", () => {
    expect(addScriptHash("default-src 'self' https://a.example; img-src *", h)).toBe(
      `default-src 'self' https://a.example; img-src *; script-src 'self' https://a.example ${H}`,
    );
  });

  it("replaces 'none' with the hash (only our script becomes allowed)", () => {
    expect(addScriptHash("script-src 'none'", h)).toBe(`script-src ${H}`);
  });

  it("also updates script-src-elem when present", () => {
    expect(addScriptHash("script-src 'self'; script-src-elem 'self'", h)).toBe(
      `script-src 'self' ${H}; script-src-elem 'self' ${H}`,
    );
  });

  it("leaves policies without script-src or default-src unchanged", () => {
    expect(addScriptHash("img-src *; frame-ancestors 'none'", h)).toBe("img-src *; frame-ancestors 'none'");
  });

  it("does not add a hash where it would disable the app's 'unsafe-inline'", () => {
    const p = "script-src 'self' 'unsafe-inline'";
    expect(addScriptHash(p, h)).toBe(p);
  });

  it("adds the hash when 'unsafe-inline' is already inert (nonce present)", () => {
    expect(addScriptHash("script-src 'unsafe-inline' 'nonce-xyz' 'strict-dynamic'", h)).toBe(
      `script-src 'unsafe-inline' 'nonce-xyz' 'strict-dynamic' ${H}`,
    );
  });

  it("handles multiple comma-separated policies independently", () => {
    expect(addScriptHash("script-src 'self', img-src *", h)).toBe(`script-src 'self' ${H}, img-src *`);
  });

  it("does not duplicate the hash", () => {
    expect(addScriptHash(`script-src 'self' ${H}`, h)).toBe(`script-src 'self' ${H}`);
  });
});
