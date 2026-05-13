/**
 * LLM-tolerant input coercion for MCP tool params.
 *
 * # Why this exists
 *
 * Host LLMs (Claude Code, ChatGPT, Cursor, Grok, Gemini…) routinely
 * serialise structured inputs as strings when calling tools. The most
 * common mistakes we see in the wild:
 *
 *   batch_mark_read({ uids: "[1,2,3,4]" })       <- array as JSON string
 *   batch_mark_read({ uids: "1,2,3,4" })         <- bare CSV
 *   send_email({ attachments: '[{"x":1}]' })     <- array of objects, JSON string
 *   manage_drafts({ where: '{"id":"abc"}' })     <- object as JSON string
 *   send_email({ subject: 42 })                  <- correct, but number as string is also common
 *   wait_for_email({ timeout: "120" })           <- number as string
 *   manage_pending({ allowSensitive: "true" })   <- boolean as string
 *
 * Without coercion, zod rejects every one of these with a confusing
 * `expected X, received Y` error, costing the LLM a retry turn for a
 * mistake that has exactly one correct interpretation. We accept all
 * the common shapes here, then hand zod the canonical form.
 *
 * The cost is tiny (one JSON.parse + a couple of type checks per
 * coerced field). The UX win is large — every batch_* tool, every
 * array param, every numeric/boolean field becomes forgiving.
 *
 * # Pass-through guarantee
 *
 * All four helpers are pass-through when the input is already correct.
 * The schema-derived zod validator runs after coercion, so a correctly-
 * typed input never sees any transformation.
 */

/**
 * Coerce a value an LLM passed for an array param into an actual array.
 *
 * Accepted shapes:
 *   - Real array              → returned unchanged
 *   - JSON-string array       → JSON.parse-d ("[1,2,3]" → [1,2,3])
 *   - Comma-separated string  → split + trim + (if primitive) coerced
 *   - Anything else           → passed through for zod to reject normally
 *
 * `itemKind` is the JSON-schema `type` of the array element. We use it
 * to decide whether CSV-style splitting makes sense (yes for primitives,
 * no for objects — `[{...}]` has no sensible split).
 */
export function coerceToArray(value: unknown, itemKind: string | undefined): unknown {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return value;

  // 1. Try to parse as JSON — covers "[1,2,3]" and '[{"x":1}]'.
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // The user clearly tried to write a JSON array. Don't silently
      // CSV-split a broken one — that produces surprising tokens like
      // `["[1", "2", "broken"]`. Hand the raw string back so zod
      // produces a clean "expected array" error.
      return value;
    }
  }

  // 2. Comma-split for primitive item types. Skip empty entries so
  //    "1, 2, , 3" doesn't produce a stray NaN.
  if (itemKind === 'number' || itemKind === 'integer' || itemKind === 'string') {
    const parts = trimmed.split(',').map(s => s.trim()).filter(s => s.length > 0);
    if (itemKind === 'number' || itemKind === 'integer') {
      return parts.map(s => {
        const n = Number(s);
        return Number.isNaN(n) ? s : n; // leave non-numeric strings for zod to reject
      });
    }
    return parts;
  }

  return value;
}

/**
 * Coerce a value an LLM passed for an object param into an actual object.
 *
 *   manage_drafts({ where: '{"id":"abc"}' })   → { id: "abc" }
 *
 * Pass-through for real objects. Rejects arrays (an array is not an
 * object in JSON-schema terms — coerceToArray handles those).
 */
export function coerceToObject(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{')) return value;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch { /* fall through */ }
  return value;
}

/**
 * Coerce numeric strings to numbers.
 *
 *   wait_for_email({ timeout: "120" })   → 120
 *
 * Many LLMs (especially via JSON tool-call surfaces that stringify
 * every scalar) send `"42"` when the schema asks for `42`. Strict zod
 * rejects this. We accept it.
 *
 * Empty strings are passed through so zod produces a clearer error
 * than a confusing `0` would.
 */
export function coerceToNumber(value: unknown): unknown {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return value;
    const n = Number(trimmed);
    if (!Number.isNaN(n)) return n;
  }
  return value;
}

/**
 * Coerce boolean-shaped values to actual booleans.
 *
 * Tolerates: true / "true" / "True" / "yes" / "1" / 1 → true
 *            false / "false" / "False" / "no" / "0" / 0 → false
 *
 * Anything else is passed through unchanged so zod can reject it with
 * a clear "expected boolean" message.
 */
export function coerceToBoolean(value: unknown): unknown {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'true' || v === 'yes' || v === '1') return true;
    if (v === 'false' || v === 'no' || v === '0') return false;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return value;
}
