// Log hygiene: logs must never contain email content, credentials or personal details beyond what's
// needed to troubleshoot. Pure, so the rules are unit-tested.

/** Field names whose values are never written to logs. */
const SECRET_KEYS = /^(?:body|text|html|snippet|summary|draftReply|replyText|evidence|detail|password|pass|secret|token|accessToken|refreshToken|clientSecret|authorization|cookie|code|raw|source|content|message|asked|subject)$/i;

const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const LONG_TOKEN = /\b[A-Za-z0-9_-]{32,}\b/g;

/** Masks addresses (d***@studio.io), bearer credentials and long opaque tokens inside free text. */
export function scrubText(s: string): string {
  return s.replace(BEARER, '$1 [redacted]').replace(LONG_TOKEN, '[redacted]').replace(EMAIL, '$1***@$2');
}

/** Deep copy safe for logging: secret fields removed, strings scrubbed and shortened. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (typeof value === 'string') {
    const s = scrubText(value);
    return s.length > 300 ? `${s.slice(0, 300)}…` : s;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redact(value.message, depth + 1) };
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEYS.test(k) ? '[redacted]' : redact(v, depth + 1);
    return out;
  }
  return value;
}
