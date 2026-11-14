// S1 — Handoff code reaches a production build. Control lands in M1 (proxy) and M7 (precise plugins).
import { describe, it } from "vitest";

describe("S1 production build has zero Handoff footprint", () => {
  it.todo("M1: prod build of every matrix template contains no `__handoff` marker");
  it.todo("M7: precise plugin uses Vite apply:'serve' / Next PHASE_DEVELOPMENT_SERVER / Angular dev builder only");
  it.todo("M7: precise plugin throws when NODE_ENV=production");
});
