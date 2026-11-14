/** Minimal, safe CSS block reader: no evaluation, bounded work, comments and strings respected. */

export interface Block {
  prelude: string;
  body: string;
  /** Offset of the body's first character in the original source. */
  bodyStart: number;
  children: Block[];
}

export interface Decl {
  name: string;
  value: string;
  line: number;
}

export const MAX_CSS_BYTES = 1_000_000;

/** Replace comments with spaces so offsets (and line numbers) stay valid. */
export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

export function lineAt(src: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < src.length; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

/** Parse nested `prelude { body }` blocks. Declarations at a level are left in `body`. */
export function parseBlocks(css: string, base = 0, depth = 0): Block[] {
  const blocks: Block[] = [];
  if (depth > 16) return blocks;
  let i = 0;
  let segStart = 0;
  let quote: string | null = null;
  while (i < css.length) {
    const ch = css.charAt(i);
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ";") segStart = i + 1;
    else if (ch === "}") segStart = i + 1;
    else if (ch === "{") {
      const prelude = css.slice(segStart, i).trim();
      const end = matchBrace(css, i);
      const body = css.slice(i + 1, end);
      blocks.push({ prelude, body, bodyStart: base + i + 1, children: parseBlocks(body, base + i + 1, depth + 1) });
      i = end;
      segStart = end + 1;
    }
    i++;
  }
  return blocks;
}

function matchBrace(css: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < css.length; i++) {
    const ch = css.charAt(i);
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return i;
  }
  return css.length;
}

/** Top-level custom-property declarations of a block body (nested blocks skipped). */
export function customProps(block: Block, src: string): Decl[] {
  // Blank out everything inside nested braces so only this level's declarations remain.
  let depth = 0;
  let flat = "";
  for (const ch of block.body) {
    if (ch === "{") depth++;
    flat += depth > 0 && ch !== "\n" ? " " : ch;
    if (ch === "}") depth = Math.max(0, depth - 1);
  }
  const out: Decl[] = [];
  const re = /(--[\w-]+(?:-\*)?)\s*:\s*([^;{}]*?)\s*(?:;|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(flat))) {
    out.push({ name: m[1] ?? "", value: (m[2] ?? "").replace(/\s+/g, " ").trim(), line: lineAt(src, block.bodyStart + m.index) });
  }
  return out;
}

export function walk(blocks: Block[], visit: (b: Block) => void) {
  for (const b of blocks) {
    visit(b);
    walk(b.children, visit);
  }
}
