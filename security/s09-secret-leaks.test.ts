// S9 — Secrets leak via exports, screenshots or logs.
import { describe, it } from "vitest";

describe("S9 secrets never enter logs or exports", () => {
  it.todo("M6: network log drops Authorization, Cookie, Set-Cookie and token-like query params");
  it.todo("M6: exports exclude .env* files");
  it.todo("M6: seeded secrets in .handoff/ fail `check` and are absent from exports");
});
