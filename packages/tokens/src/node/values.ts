/** Resolve simple CSS values to px without evaluating anything. Root font size is 16px. */
export const ROOT_PX = 16;

export function lengthPx(value: string): number | null {
  const m = /^(-?(?:\d+\.?\d*|\.\d+))(px|rem)?$/.exec(value.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (m[2] === "rem") return n * ROOT_PX;
  if (m[2] === "px" || n === 0) return n;
  return null;
}

export function emValue(value: string): number | null {
  const m = /^(-?(?:\d+\.?\d*|\.\d+))em$/.exec(value.trim());
  return m ? Number(m[1]) : null;
}

/** Unitless number (e.g. line-height 1.5), also `calc(a / b)` as Tailwind v4 writes it. */
export function ratio(value: string): number | null {
  const v = value.trim();
  if (/^(\d+\.?\d*|\.\d+)$/.test(v)) return Number(v);
  const m = /^calc\(\s*(\d+\.?\d*)\s*\/\s*(\d+\.?\d*)\s*\)$/.exec(v);
  return m && Number(m[2]) !== 0 ? Number(m[1]) / Number(m[2]) : null;
}

/** Replace var(--x[, fallback]) using `lookup`, up to a fixed depth. */
export function resolveVars(value: string, lookup: (name: string) => string | undefined, depth = 0): string {
  if (depth > 10 || !value.includes("var(")) return value;
  const out = value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (all, name: string, fallback?: string) => {
    const v = lookup(name);
    return v !== undefined ? v : fallback !== undefined ? fallback.trim() : all;
  });
  return out === value ? out : resolveVars(out, lookup, depth + 1);
}
