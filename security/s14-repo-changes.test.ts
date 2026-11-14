// S14 — Unwanted repo changes. Agent setup writes only three known things, shows a diff
// first, and `remove` restores the repo exactly (clean `git status`).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyInit, applyRemove, planInit, planRemove, renderDiff } from "../packages/cli/src/init.js";

const repos: string[] = [];
afterEach(() => repos.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function repo(files: Record<string, string>): string {
  const d = mkdtempSync(join(tmpdir(), "handoff-s14-"));
  repos.push(d);
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(join(d, f, ".."), { recursive: true });
    writeFileSync(join(d, f), c);
  }
  const git = (...a: string[]) => execFileSync("git", a, { cwd: d, stdio: "pipe" });
  git("init", "-q");
  git("-c", "user.email=t@t", "-c", "user.name=t", "add", "-A");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
  return d;
}
const status = (d: string) =>
  execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: d, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .map((l) => l.slice(3))
    .sort();

const ROUTES = [{ path: "/", dynamic: false, file: "src/App.tsx" }];
const PKG = JSON.stringify({ name: "app", scripts: { dev: "vite" } });

describe("S14 init writes only three known things and remove restores exactly", () => {
  it("fresh repo: creates AGENTS.md, .mcp.json and .handoff/ only", () => {
    const d = repo({ "package.json": PKG, "src/App.tsx": "export {}" });
    const plan = planInit(d, ROUTES);
    applyInit(d, plan);
    expect(status(d)).toEqual([".handoff/.gitignore", ".handoff/flows.yaml", ".mcp.json", "AGENTS.md"]);
    applyRemove(d, planRemove(d));
    expect(status(d)).toEqual([]);
    expect(existsSync(join(d, ".handoff"))).toBe(false);
  });

  it("existing files: adds marked blocks / one JSON key, and remove restores byte-for-byte", () => {
    const agents = "# Agents\n\nUse tabs.\n";
    const claude = "# Claude\r\nRules here.\r\n"; // CRLF must survive
    const mcp = '{\n    "mcpServers": {\n        "other": { "command": "x" }\n    },\n    "extra": [1,2]\n}\n';
    const d = repo({ "package.json": PKG, "AGENTS.md": agents, "CLAUDE.md": claude, ".mcp.json": mcp, ".cursor/mcp.json": "{}\n", ".cursor/rules/other.mdc": "x\n" });
    applyInit(d, planInit(d, ROUTES));
    expect(status(d)).toEqual([".cursor/mcp.json", ".cursor/rules/handoff.mdc", ".handoff/.gitignore", ".handoff/flows.yaml", ".mcp.json", "AGENTS.md", "CLAUDE.md"]);
    const a = readFileSync(join(d, "AGENTS.md"), "utf8");
    expect(a.startsWith(agents)).toBe(true);
    expect(a).toContain("<!-- handoff:start -->");
    expect(a).toContain("npx ember-handover check");
    const m = JSON.parse(readFileSync(join(d, ".mcp.json"), "utf8"));
    expect(m.mcpServers.other).toEqual({ command: "x" });
    expect(m.mcpServers.handoff).toEqual({ command: "npx", args: ["-y", "ember-handover", "mcp"] });
    expect(m.extra).toEqual([1, 2]);
    applyRemove(d, planRemove(d));
    expect(status(d)).toEqual([]);
    expect(readFileSync(join(d, "CLAUDE.md"), "utf8")).toBe(claude);
    expect(readFileSync(join(d, ".mcp.json"), "utf8")).toBe(mcp);
  });

  it("remove still works when the files were edited after init (surgical removal)", () => {
    const agents = "# Agents\n";
    const d = repo({ "package.json": PKG, "AGENTS.md": agents, ".mcp.json": '{ "mcpServers": {} }\n' });
    applyInit(d, planInit(d, ROUTES));
    rmSync(join(d, ".handoff", "cache"), { recursive: true, force: true }); // e.g. a teammate's clone: no install record
    writeFileSync(join(d, "AGENTS.md"), readFileSync(join(d, "AGENTS.md"), "utf8") + "\nLater note.\n");
    applyRemove(d, planRemove(d));
    expect(readFileSync(join(d, "AGENTS.md"), "utf8")).toBe("# Agents\n\nLater note.\n");
    expect(JSON.parse(readFileSync(join(d, ".mcp.json"), "utf8"))).toEqual({ mcpServers: {} });
  });

  it("the plan is shown as a diff before anything is written", () => {
    const d = repo({ "package.json": PKG, "AGENTS.md": "# Agents\n" });
    const plan = planInit(d, ROUTES);
    const diff = renderDiff(plan);
    expect(status(d)).toEqual([]); // planning writes nothing
    expect(diff).toContain("AGENTS.md");
    expect(diff).toContain("+<!-- handoff:start -->");
    expect(diff).toContain("+ .mcp.json (new file)".replace("+ ", "")); // header names every file
    expect(diff).toContain(".handoff/flows.yaml");
  });

  it("is idempotent: a second init changes nothing", () => {
    const d = repo({ "package.json": PKG });
    applyInit(d, planInit(d, ROUTES));
    execFileSync("git", ["add", "-A"], { cwd: d });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "setup"], { cwd: d });
    expect(planInit(d, ROUTES)).toEqual([]);
  });

  it("never touches source files or package.json", () => {
    const d = repo({ "package.json": PKG, "src/App.tsx": "export {}", "vite.config.ts": "export default {}" });
    const plan = planInit(d, ROUTES);
    const allowed = /^(AGENTS\.md|CLAUDE\.md|\.mcp\.json|\.cursor\/mcp\.json|\.cursor\/rules\/handoff\.mdc|\.handoff\/.*)$/;
    for (const c of plan) expect(c.path, c.path).toMatch(allowed);
  });
});
