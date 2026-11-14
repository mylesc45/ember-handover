/**
 * Adds the bridge script's hash to a CSP header value, and does nothing else (SPEC S11).
 *
 * - Never removes a directive or a source.
 * - 'none' is the only token replaced: a list containing 'none' plus anything is invalid,
 *   so 'none' becomes just our hash. That allows exactly one script: ours.
 * - If a list relies on 'unsafe-inline' (no nonce/hash present), adding a hash would make
 *   browsers ignore 'unsafe-inline' and break the app, so we leave that list unchanged.
 */
export function addScriptHash(header: string, integrity: string): string {
  const hash = `'${integrity}'`;
  return header
    .split(",")
    .map((policy) => addToPolicy(policy, hash))
    .join(",");
}

function addToPolicy(policy: string, hash: string): string {
  const leading = /^\s*/.exec(policy)?.[0] ?? "";
  const directives = policy
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => d.split(/\s+/));
  const find = (name: string) => directives.find((d) => d[0]?.toLowerCase() === name);

  const targets = ["script-src", "script-src-elem"].map(find).filter((d): d is string[] => !!d);
  if (targets.length === 0) {
    const fallback = find("default-src");
    if (!fallback) return policy;
    const derived = ["script-src", ...fallback.slice(1)];
    directives.push(derived);
    targets.push(derived);
  }
  for (const d of targets) addSource(d, hash);
  return leading + directives.map((d) => d.join(" ")).join("; ");
}

function addSource(directive: string[], hash: string) {
  const sources = directive.slice(1).map((s) => s.toLowerCase());
  if (sources.includes(hash.toLowerCase())) return;
  if (sources.includes("'none'")) {
    directive.splice(1, directive.length - 1, hash);
    return;
  }
  const hasNonceOrHash = sources.some((s) => /^'(nonce|sha256|sha384|sha512)-/.test(s));
  if (sources.includes("'unsafe-inline'") && !hasNonceOrHash) return;
  directive.push(hash);
}
