// S8 — Path traversal or symlink escape.
import { describe, it } from "vitest";

describe("S8 every file access stays inside the repo root or .handoff/", () => {
  it.todo("M4: ../ traversal corpus rejected by the path guard");
  it.todo("M4: symlink pointing outside the repo rejected after realpath");
  it.todo("M3: editor deep links only open guarded paths");
});
