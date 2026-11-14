import { Transform, type TransformCallback } from "node:stream";

const HEAD_CLOSE = /<\/head\s*>/i;
const CARRY = 16; // longer than any "</head   >" we need to see across a chunk boundary

/**
 * Streaming HTML rewriter: inserts `tag` once, before the first </head>.
 * Works on latin1 strings so every byte round-trips exactly, whatever the page's charset.
 * If the document has no </head>, the tag is appended at the end.
 */
export function createInjector(tag: string): Transform {
  let pending = "";
  let done = false;
  return new Transform({
    transform(chunk: Buffer, _enc, cb: TransformCallback) {
      if (done) return cb(null, chunk);
      const s = pending + chunk.toString("latin1");
      const m = HEAD_CLOSE.exec(s);
      if (m) {
        done = true;
        pending = "";
        return cb(null, Buffer.from(s.slice(0, m.index) + tag + s.slice(m.index), "latin1"));
      }
      const keep = Math.min(CARRY, s.length);
      pending = s.slice(s.length - keep);
      const out = s.slice(0, s.length - keep);
      cb(null, out ? Buffer.from(out, "latin1") : undefined);
    },
    flush(cb: TransformCallback) {
      if (done) return cb(null, pending ? Buffer.from(pending, "latin1") : undefined);
      cb(null, Buffer.from(pending + tag, "latin1"));
    },
  });
}
