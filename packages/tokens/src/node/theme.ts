import { customProps, parseBlocks, stripComments, walk, type Decl } from "./css.js";

/** Declarations inside every `@theme [default|inline|static|…] { … }` block, in order. */
export function parseThemeBlocks(css: string): Decl[] {
  const src = stripComments(css);
  const out: Decl[] = [];
  walk(parseBlocks(src), (b) => {
    if (/^@theme\b/.test(b.prelude)) out.push(...customProps(b, src));
  });
  return out;
}

const ROOT_SELECTOR = /^(?::root|html|:host)(?:\s*,\s*(?::root|html|:host))*$/;

/** Custom properties declared on :root / html / :host (also inside @layer). Not inside @media. */
export function parseRootVars(css: string): Decl[] {
  const src = stripComments(css);
  const out: Decl[] = [];
  const visit = (blocks: ReturnType<typeof parseBlocks>) => {
    for (const b of blocks) {
      if (ROOT_SELECTOR.test(b.prelude)) out.push(...customProps(b, src));
      else if (/^@layer\b/.test(b.prelude)) visit(b.children);
    }
  };
  visit(parseBlocks(src));
  return out;
}
