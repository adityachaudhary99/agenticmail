/**
 * Secret-redaction helpers for log lines and diagnostic output.
 *
 * # Why this exists
 *
 * AgenticMail keeps three kinds of long-lived secrets in memory:
 *
 *   1. The master key (`mk_…`) — full admin scope on the local API.
 *   2. Per-agent API keys (`ak_…`) — scoped to one agent's mailbox.
 *   3. Stalwart's admin password and per-agent IMAP/SMTP passwords.
 *
 * All three flow through config objects, install results, and the
 * MCP-server env block. Several of those objects get logged for
 * diagnostic purposes (install completion summary, dispatcher
 * startup, error stacks). CodeQL's `js/clear-text-logging` query
 * flagged eight call sites where a secret could plausibly reach a
 * log line. This module is the canonical sanitizer for those spots.
 *
 * # API
 *
 *   - `redactSecret(value)` collapses a string secret to a
 *     fixed-shape redaction marker (`mk_***`, `ak_***`, `***`)
 *     while preserving the prefix so the log reader can still tell
 *     the kind of secret it was.
 *   - `redactObject(obj)` walks an object and replaces every value
 *     under a "sensitive-looking" key with REDACTED.
 *   - `REDACTED` constant for cases where the caller wants to
 *     compose their own log line.
 *
 * # Conservative match
 *
 * The "sensitive-looking" key detection is deliberately broad —
 * it's better to over-redact a harmless `name` field that happens
 * to contain "key" than to leak a secret. The currently-matched
 * key names (case-insensitive substring): `key`, `secret`,
 * `password`, `token`, `apikey`, `masterkey`, `authorization`,
 * `bearer`.
 */

/** Returned in place of any redacted secret. */
export const REDACTED = '***';

/**
 * Redact a string secret to a fixed-shape marker. Preserves the
 * known prefixes (`mk_`, `ak_`) so log readers can still tell what
 * kind of secret was elided.
 *
 * Non-string inputs return REDACTED unchanged.
 */
export function redactSecret(value: unknown): string {
  if (typeof value !== 'string') return REDACTED;
  if (value.length === 0) return REDACTED;
  // Preserve our known key prefixes so diagnostic context survives
  // redaction. `mk_abc123…` → `mk_***`.
  for (const prefix of ['mk_', 'ak_', 'sk-', 'pk_', 'tok_']) {
    if (value.startsWith(prefix)) return `${prefix}${REDACTED}`;
  }
  return REDACTED;
}

const SENSITIVE_KEY_PATTERNS = [
  /key$/i,
  /secret/i,
  /password/i,
  /passwd/i,
  /token/i,
  /authorization/i,
  /bearer/i,
  /\bapikey\b/i,
  /\bapi_key\b/i,
  /\bmasterkey\b/i,
  /\bmaster_key\b/i,
];

function looksSensitive(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some(p => p.test(key));
}

/**
 * Walk an object recursively. Any value under a key that looks
 * sensitive (see SENSITIVE_KEY_PATTERNS above) is replaced with
 * `REDACTED`. Arrays are walked too. The original object is NOT
 * mutated — returns a shallow-cloned tree with the same shape.
 *
 * Use this when you want to pass a whole config object into a log
 * line via JSON.stringify, e.g.:
 *
 * ```ts
 * log.info('install complete', redactObject(result));
 * ```
 *
 * Edge cases:
 *   - Cycles are NOT supported; pass tree-shaped data only.
 *   - Non-plain objects (Map, Set, Buffer, Date, Error) are returned
 *     by reference unchanged — redaction is for plain config dicts.
 *   - Symbols are skipped.
 */
export function redactObject<T>(input: T, _depth = 0): T {
  if (_depth > 12) return input;  // safety bound against accidental cycles
  if (input === null || input === undefined) return input;
  if (typeof input !== 'object') return input;
  if (Array.isArray(input)) {
    return (input.map(v => redactObject(v, _depth + 1)) as unknown) as T;
  }
  // Skip exotic objects — redaction is only meaningful for plain
  // config dictionaries.
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) return input;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (looksSensitive(k)) {
      // For string values, preserve prefix; for objects, stamp REDACTED.
      out[k] = typeof v === 'string' ? redactSecret(v) : REDACTED;
    } else {
      out[k] = redactObject(v, _depth + 1);
    }
  }
  return out as T;
}
