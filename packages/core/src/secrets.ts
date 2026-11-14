/**
 * Secret scanner for .handoff/ and exports (SPEC S9). Rules follow gitleaks' common
 * detectors. Matches are reported by rule and line only; the secret itself is never echoed.
 */
export interface SecretFinding {
  file: string;
  line: number;
  rule: string;
}

const RULES: { rule: string; re: RegExp }[] = [
  { rule: "AWS access key", re: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA|AIPA)[0-9A-Z]{16}\b/ },
  { rule: "AWS secret key", re: /aws.{0,20}(?:secret|private).{0,20}["'\s:=]+[A-Za-z0-9/+=]{40}\b/i },
  { rule: "GitHub token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/ },
  { rule: "Slack token", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/ },
  { rule: "Stripe live key", re: /\b(?:sk|rk)_live_[0-9a-zA-Z]{20,}\b/ },
  { rule: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { rule: "OpenAI or Anthropic key", re: /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{32,})\b/ },
  { rule: "Private key", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/ },
  { rule: "JSON Web Token", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { rule: "Credential in URL", re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@"']+:[^\s/@"']{6,}@/i },
  {
    rule: "Hard-coded credential",
    re: /["']?(?:api[_-]?key|secret|token|passw(?:or)?d|auth)["']?\s*[:=]\s*["'](?!test|example|dummy|fake|xxx)[^"'\s]{12,}["']/i,
  },
];

export function scanSecrets(file: string, text: string): SecretFinding[] {
  const out: SecretFinding[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((l, i) => {
    for (const { rule, re } of RULES) if (re.test(l)) out.push({ file, line: i + 1, rule });
  });
  return out;
}
