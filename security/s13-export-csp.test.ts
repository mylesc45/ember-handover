// S13 — Shared export runs code when opened.
import { describe, it } from "vitest";

describe("S13 export is inert", () => {
  it.todo("M6: export has CSP default-src 'none' with scripts and styles by hash only");
  it.todo("M6: export contains no app JS and no external URLs");
  it.todo("M6: headless open with network blocked renders without errors");
});
