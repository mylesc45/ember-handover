// S8 — Path traversal or symlink escape.
import { lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveInside } from "@ember-handover/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let root: string;
let outside: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "handoff-s8-"));
  outside = mkdtempSync(join(tmpdir(), "handoff-s8-out-"));
  mkdirSync(join(root, ".handoff", "fixtures"), { recursive: true });
  writeFileSync(join(root, ".handoff", "fixtures", "ok.json"), "{}");
  writeFileSync(join(outside, "secret.json"), "{}");
  try {
    symlinkSync(outside, join(root, ".handoff", "fixtures", "link"), "junction");
    symlinkSync(join(outside, "secret.json"), join(root, ".handoff", "fixtures", "file-link.json"));
  } catch {
    /* symlinks may need privileges on Windows; those cases are skipped below */
  }
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("S8 every file access stays inside the repo root or .handoff/", () => {
  it("allows normal paths, including ones that don't exist yet", () => {
    expect(resolveInside(root, ".handoff/fixtures/ok.json")).toMatch(/ok\.json$/);
    expect(resolveInside(root, ".handoff/cache/flows/a/1.png")).toMatch(/1\.png$/);
  });

  it.each(["../x", "../../etc/passwd", ".handoff/../../x", "/etc/passwd", "C:\\Windows\\win.ini", "\\\\server\\share", "a/\u0000b", ""])(
    "rejects %j",
    (p) => expect(() => resolveInside(root, p)).toThrow(expect.objectContaining({ code: "PATH_OUTSIDE" })),
  );

  it("rejects symlinks that lead outside the root", () => {
    if (!existsLink(join(root, ".handoff", "fixtures", "link"))) return;
    expect(() => resolveInside(root, ".handoff/fixtures/link/secret.json")).toThrow(expect.objectContaining({ code: "PATH_OUTSIDE" }));
    expect(() => resolveInside(root, ".handoff/fixtures/file-link.json")).toThrow(expect.objectContaining({ code: "PATH_OUTSIDE" }));
  });

  it.todo("M3: editor deep links only open guarded paths");
});

function existsLink(p: string) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}
