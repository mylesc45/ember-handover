// S3 — Malicious website calls the local API (CSRF, DNS rebinding).
import { describe, it } from "vitest";

describe("S3 local API rejects cross-site and rebinding requests", () => {
  it.todo("M1: Host header outside {localhost, 127.0.0.1, [::1]} → 403");
  it.todo("M1: foreign Origin → 403");
  it.todo("M1: missing or wrong 256-bit session token header → 401");
  it.todo("M1: responses carry no CORS headers");
  it.todo("M1: writes require POST + application/json");
});
