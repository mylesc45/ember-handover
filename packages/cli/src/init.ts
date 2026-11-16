/**
 * First-run agent setup and `remove` (SPEC → First run, S14).
 * Writes exactly three things, after showing a diff:
 *   1. a marked block in AGENTS.md (and CLAUDE.md / .cursor/rules/handoff.mdc if those apply),
 *   2. an MCP entry in .mcp.json (and .cursor/mcp.json if .cursor/ exists),
 *   3. the .handoff/ folder (flows.yaml drafted from routes, .gitignore for cache/).
 * `remove` restores files byte-for-byte when they haven't changed since, and otherwise
 * removes only Handoff's own additions.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveInside } from "@ember-handover/core";
import type { Route } from "./routes.js";

export interface Change {
  /** Repo-relative path. */
  path: string;
  before: string | null;
  /** null = delete. */
  after: string | null;
  /** Whole directory (only `.handoff`, on remove). */
  dir?: boolean;
}

const START = "<!-- handoff:start -->";
const END = "<!-- handoff:end -->";
export const AGENTS_BLOCK = [
  START,
  "## Handoff notes",
  "When you add or change UI:",
  "1. Update `.handoff/flows.yaml` so every user-facing flow you touched has accurate steps.",
  "2. Add a one-line `intent` to any step whose purpose is not obvious from the UI.",
  "3. Add `data-testid` to interactive elements you create.",
  "4. Run `npx ember-handover check` and fix any failures before finishing.",
  "Do not put secrets, real customer data or credentials in `.handoff/`.",
  END,
].join("\n");
const CURSOR_RULE = `---\ndescription: Keep Handoff flows and notes current when changing UI\nalwaysApply: true\n---\n${AGENTS_BLOCK}\n`;
export const MCP_ENTRY = { command: "npx", args: ["-y", "ember-handover", "mcp"] };
const RECORD = ".handoff/cache/install.json";
const BLOCK_RE = new RegExp(`(\\r?\\n)?${START}[\\s\\S]*?${END}(\\r?\\n)?`);

const read = (root: string, rel: string): string | null => {
  const p = resolveInside(root, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
};
const eol = (s: string | null) => (s?.includes("\r\n") ? "\r\n" : "\n");

function withBlock(before: string | null): string {
  const nl = eol(before);
  const block = AGENTS_BLOCK.replace(/\n/g, nl);
  if (before === null || before.trim() === "") return block + nl;
  if (before.includes(START) && before.includes(END)) return before.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block);
  const sep = before.endsWith(nl + nl) ? "" : before.endsWith(nl) ? nl : nl + nl;
  return before + sep + block + nl;
}

function withoutBlock(text: string): string {
  return text.replace(BLOCK_RE, (_m, lead?: string, trail?: string) => (lead && trail ? (/\r?\n$/.test(text.slice(0, text.indexOf(START) - (lead?.length ?? 0))) ? "" : lead) : ""));
}

function indentOf(json: string): number {
  return /\n( +)"/.exec(json)?.[1]?.length ?? 2;
}

function withMcp(before: string | null): string | null {
  let obj: Record<string, unknown> = {};
  if (before !== null) {
    try {
      const parsed: unknown = JSON.parse(before);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
      obj = parsed as Record<string, unknown>;
    } catch {
      return null; // never clobber a file we can't parse
    }
  }
  const servers = (typeof obj.mcpServers === "object" && obj.mcpServers !== null ? obj.mcpServers : {}) as Record<string, unknown>;
  if (JSON.stringify(servers.handoff) === JSON.stringify(MCP_ENTRY)) return before;
  const next = { ...obj, mcpServers: { ...servers, handoff: MCP_ENTRY } };
  return JSON.stringify(next, null, before ? indentOf(before) : 2) + "\n";
}

function withoutMcp(text: string): string | null {
  try {
    const obj = JSON.parse(text) as Record<string, unknown>;
    const servers = obj.mcpServers as Record<string, unknown> | undefined;
    if (!servers || !Object.hasOwn(servers, "handoff")) return text;
    const rest = Object.fromEntries(Object.entries(servers).filter(([k]) => k !== "handoff"));
    return JSON.stringify({ ...obj, mcpServers: rest }, null, indentOf(text)) + "\n";
  } catch {
    return text;
  }
}

// --- flows draft ------------------------------------------------------------------------
const slug = (path: string) =>
  path === "/"
    ? "home"
    : path
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "page";
const title = (path: string) => {
  if (path === "/") return "Home";
  const last = path.split("/").filter(Boolean).join(" ").replace(/[-_]+/g, " ");
  return last.charAt(0).toUpperCase() + last.slice(1);
};

export function draftFlows(routes: Route[]): string {
  const lines = [
    "# Handoff flows: the user journeys a developer should see and test.",
    "# Your coding agent keeps this file current (see AGENTS.md). Run `npx ember-handover check` to verify.",
    "version: 1",
    "baseUrl: /",
  ];
  const ids = new Set<string>();
  const flows: string[] = [];
  for (const r of routes.filter((x) => !x.dynamic)) {
    let id = slug(r.path);
    for (let i = 2; ids.has(id); i++) id = `${slug(r.path)}-${i}`;
    ids.add(id);
    flows.push(`  - id: ${id}`, `    name: ${JSON.stringify(title(r.path))}`, "    steps:", `      - goto: ${JSON.stringify(r.path)}`);
  }
  lines.push(flows.length ? "flows:" : "flows: []", ...flows);
  const dynamic = routes.filter((x) => x.dynamic);
  if (dynamic.length) {
    lines.push("# These routes need an example URL before they can have a flow:");
    for (const r of dynamic) lines.push(`# ${r.path}${r.file ? `  (${r.file})` : ""}`);
  }
  return lines.join("\n") + "\n";
}

// --- plan / apply ---------------------------------------------------------------------------
function changed(c: Change): boolean {
  return c.before !== c.after;
}

export function planInit(root: string, routes: Route[]): Change[] {
  const out: Change[] = [];
  const md = (path: string) => {
    const before = read(root, path);
    out.push({ path, before, after: withBlock(before) });
  };
  md("AGENTS.md");
  if (read(root, "CLAUDE.md") !== null) md("CLAUDE.md");
  const cursor = existsSync(join(root, ".cursor"));
  if (cursor) {
    const before = read(root, ".cursor/rules/handoff.mdc");
    out.push({ path: ".cursor/rules/handoff.mdc", before, after: before?.includes(START) ? before : CURSOR_RULE });
  }
  for (const path of [".mcp.json", ...(cursor ? [".cursor/mcp.json"] : [])]) {
    const before = read(root, path);
    const after = withMcp(before);
    if (after !== null) out.push({ path, before, after });
  }
  const flows = read(root, ".handoff/flows.yaml");
  if (flows === null) out.push({ path: ".handoff/flows.yaml", before: null, after: draftFlows(routes) });
  const ignore = read(root, ".handoff/.gitignore");
  if (ignore === null) out.push({ path: ".handoff/.gitignore", before: null, after: "cache/\n" });
  return out.filter(changed);
}

function write(root: string, c: Change) {
  const p = resolveInside(root, c.path);
  if (c.dir) return rmSync(p, { recursive: true, force: true });
  if (c.after === null) return rmSync(p, { force: true });
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, c.after);
}

type InstallRecord = { version: 1; changes: { path: string; before: string | null; after: string | null }[] };

export function applyInit(root: string, changes: Change[]): void {
  for (const c of changes) write(root, c);
  // Remember exactly what we changed so `remove` can restore it byte-for-byte.
  const prev = readRecord(root);
  const merged = new Map(prev?.changes.map((c) => [c.path, c]) ?? []);
  for (const c of changes) merged.set(c.path, { path: c.path, before: merged.get(c.path)?.before ?? c.before, after: c.after });
  const p = resolveInside(root, RECORD);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ version: 1, changes: [...merged.values()] } satisfies InstallRecord, null, 2));
}

function readRecord(root: string): InstallRecord | null {
  try {
    const r = JSON.parse(read(root, RECORD) ?? "null") as InstallRecord | null;
    return r?.version === 1 && Array.isArray(r.changes) ? r : null;
  } catch {
    return null;
  }
}

export function planRemove(root: string): Change[] {
  const record = readRecord(root);
  const out: Change[] = [];
  for (const path of ["AGENTS.md", "CLAUDE.md", ".cursor/rules/handoff.mdc", ".mcp.json", ".cursor/mcp.json"]) {
    const current = read(root, path);
    if (current === null) continue;
    const rec = record?.changes.find((c) => c.path === path);
    if (rec && rec.after === current) {
      out.push({ path, before: current, after: rec.before });
      continue;
    }
    // Edited since (or no record, e.g. a teammate's clone): remove only our additions.
    let after: string | null = path.endsWith(".json") ? withoutMcp(current) : withoutBlock(current);
    if (after !== null && path.endsWith(".mdc") && after.replace(/^---[\s\S]*?---\s*/, "").trim() === "") after = null;
    if (after !== null && !path.endsWith(".json") && after.trim() === "") after = null;
    out.push({ path, before: current, after });
  }
  if (existsSync(join(root, ".handoff"))) out.push({ path: ".handoff", before: null, after: null, dir: true });
  return out.filter((c) => c.dir || changed(c));
}

export function applyRemove(root: string, changes: Change[]): void {
  // Files first, then the .handoff folder (which holds the install record).
  for (const c of [...changes].sort((a, b) => Number(!!a.dir) - Number(!!b.dir))) write(root, c);
}

// --- diff -------------------------------------------------------------------------------------
/** Small line diff (LCS), enough to show the user exactly what will change. */
export function renderDiff(changes: Change[]): string {
  const out: string[] = [];
  for (const c of changes) {
    if (c.dir) {
      out.push(`--- ${c.path}/ (folder deleted)`);
      continue;
    }
    out.push(c.before === null ? `+++ ${c.path} (new file)` : c.after === null ? `--- ${c.path} (deleted)` : `*** ${c.path}`);
    const a = (c.before ?? "").split(/\r?\n/);
    const b = (c.after ?? "").split(/\r?\n/);
    if (c.before === null) b.forEach((l) => out.push(`+${l}`));
    else if (c.after === null) a.forEach((l) => out.push(`-${l}`));
    else out.push(...lineDiff(a, b));
  }
  return out.join("\n");
}

function lineDiff(a: string[], b: string[]): string[] {
  const n = a.length;
  const m = b.length;
  // Flat (n+1)×(m+1) LCS table; at(i, j) reads it with a default of 0.
  const lcs = new Array<number>((n + 1) * (m + 1)).fill(0);
  const at = (i: number, j: number) => lcs[i * (m + 1) + j] ?? 0;
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i * (m + 1) + j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      out.push(` ${a[i]}`);
      i++;
      j++;
    } else if (j < m && (i >= n || at(i, j + 1) >= at(i + 1, j))) out.push(`+${b[j++]}`);
    else out.push(`-${a[i++]}`);
  }
  // Keep 2 lines of context around changes.
  return out.filter((l, k) => l[0] !== " " || out.slice(Math.max(0, k - 2), k + 3).some((x) => x[0] !== " "));
}
