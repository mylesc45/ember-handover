// S7 — Command injection.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rel, shippedSourceFiles } from "./lib/repo.js";

describe("S7 no shell strings anywhere", () => {
  it("shipped source starts processes only through execa with argument arrays", () => {
    for (const file of shippedSourceFiles()) {
      const src = readFileSync(file, "utf8");
      // node:child_process is off limits; execa is the only process API.
      expect(src, rel(file)).not.toMatch(/["'](node:)?child_process["']/);
      expect(src, rel(file)).not.toMatch(/\bshell\s*:\s*(true|["'])/);
      // execa's template-string and command-string forms parse a shell-like string.
      expect(src, rel(file)).not.toMatch(/\$\s*`|\$\(\s*\{[^}]*\}\s*\)\s*`|execaCommand/);
    }
  });
  it.todo("M5: non-integer PR numbers rejected");
  it.todo("M5: branch names validated against git ref rules; injection corpus rejected");
});
