// S6 — PR install scripts run on the dev's machine.
import { describe, it } from "vitest";

describe("S6 review never runs PR install scripts", () => {
  it.todo("M5: seeded PR with malicious postinstall never executes it");
  it.todo("M5: review worktree lives in the OS temp folder and is removed on exit");
  it.todo("M5: --allow-scripts requires explicit per-repo confirmation");
});
