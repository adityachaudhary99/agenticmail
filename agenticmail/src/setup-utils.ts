/**
 * Reusable interactive setup helpers — shared across `setup-email`,
 * `setup-phone`, `setup-telegram`, and any future `setup-*` subcommand.
 *
 * The shape of every connect-a-channel flow is the same:
 *
 *   1. Look up what's ALREADY configured for this channel — phone
 *      transport, Telegram bot token, OpenAI API key, etc. — so a
 *      second run doesn't make the user re-paste creds they already
 *      typed once.
 *   2. Print a summary of what's configured (secrets masked) so the
 *      user can see at a glance whether they need to add anything.
 *   3. Prompt for any MISSING required fields one by one with a
 *      labelled, hint-annotated prompt.
 *   4. If everything is already configured, offer to update any field
 *      they'd like to change (typical reason: token rotation).
 *
 * Two failure modes of the earlier per-command code that this util
 * fixes:
 *
 *   - "Missing required field(s)" errors at a TTY — the v0.9.65
 *     `setup-phone --provider twilio` would refuse to run if the
 *     user hadn't piped every flag, instead of guiding them through.
 *   - No re-entrancy. If the user ran `setup-phone` once and wanted
 *     to update just the auth token (rotated key, etc.), they had
 *     to re-paste every credential because there was no concept of
 *     "what's already set". Now `collectFields` shows existing
 *     values (masked), prompts only for the missing ones, and offers
 *     an explicit "update any?" step.
 */

import type { Interface as ReadlineInterface } from 'node:readline';

/** Single field definition the collector understands. */
export interface SetupField {
  /** Internal key — caller uses this to fetch the final value. */
  key: string;
  /** User-visible label, shown next to the prompt and in summary lines. */
  label: string;
  /**
   * Optional context lines shown ABOVE the prompt (the "where to find this")
   * hint that turns `Paste it:` into something a first-time user can answer.
   * Each entry renders as its own line in dim text.
   */
  hint?: string[];
  /**
   * Treat this field as a secret. Hidden (`*`-masked) input, never
   * echoed to stdout. Display mask for the "currently configured"
   * summary defaults to `(set)` — caller can override via `mask`.
   */
  secret?: boolean;
  /** Hard-fail when missing after the interactive pass. Default `true`. */
  required?: boolean;
  /**
   * Existing value for this field. Pass undefined / empty string for
   * "not yet configured". For secrets, pass the literal value (the
   * collector won't show it — it only checks truthy/falsy and renders
   * `mask?(current) ?? '(set)'` in the summary).
   */
  current?: string;
  /**
   * How to render the existing value in the summary line. Defaults:
   *   - non-secret → show the value as-is
   *   - secret with a current value → `(set, …<last 4>)` if value is
   *     ≥ 4 chars, else `(set)`
   */
  mask?: (value: string) => string;
  /**
   * Optional E.164 / format hint shown inline next to the prompt
   * label, e.g. `(e.g. +15555550100)`. Kept separate from `hint` so
   * the multi-line hint can read like documentation while the inline
   * placeholder stays compact.
   */
  placeholder?: string;
}

/** Shape returned to the caller. */
export interface CollectResult {
  /**
   * Final field values keyed by `field.key`. Includes both existing
   * values (unchanged) AND newly-entered values. Empty-string for any
   * field the user chose to skip (only possible for `required: false`).
   */
  values: Record<string, string>;
  /**
   * Keys whose value was just collected from the user (either missing
   * → freshly entered, or update flow → re-entered). Useful for the
   * caller to know which channel-side endpoints to PUT vs leave alone.
   */
  changedKeys: string[];
}

/** Injected prompt helpers — the cli has its own raw-mode `askSecret`. */
export interface PromptHelpers {
  ask(question: string): Promise<string>;
  askSecret(question: string): Promise<string>;
}

/** Colour helpers — the cli has its own `c` object; pass a subset. */
export interface ColorHelpers {
  bold(s: string): string;
  dim(s: string): string;
  cyan(s: string): string;
  green(s: string): string;
  yellow(s: string): string;
  magenta(s: string): string;
}

export interface LogHelpers {
  log(msg: string): void;
  ok(msg: string): void;
  info(msg: string): void;
  fail(msg: string): void;
}

/**
 * Default mask for a secret with a value: show `(set, …<last 4>)`.
 * Mirrors the convention email clients / GitHub UI use for displaying
 * a configured token without exposing it.
 */
function defaultSecretMask(value: string): string {
  if (!value) return '(not set)';
  const tail = value.length >= 4 ? value.slice(-4) : '';
  return tail ? `(set, ends …${tail})` : '(set)';
}

/** Format a single field's "current state" line for the summary header. */
function renderCurrent(f: SetupField, c: ColorHelpers): string {
  const set = f.current && f.current.length > 0;
  if (!set) return c.dim('(not set)');
  if (f.mask) return c.dim(f.mask(f.current!));
  if (f.secret) return c.dim(defaultSecretMask(f.current!));
  return c.dim(f.current!);
}

/**
 * Drive a single field's prompt — multi-line hint block first, then
 * the actual input call. Returns the trimmed value.
 */
async function promptOne(
  f: SetupField,
  step: number | null,
  prompts: PromptHelpers,
  c: ColorHelpers,
  log: (s: string) => void,
): Promise<string> {
  const heading = step !== null ? `${step}) ${f.label}` : f.label;
  log(`  ${c.bold(heading)}`);
  if (f.hint) for (const line of f.hint) log(`  ${c.dim('   ' + line)}`);
  const placeholder = f.placeholder ? ' ' + c.dim(f.placeholder) : '';
  const inputLine = `     ${c.cyan('Paste it:')}${placeholder} `;
  // Hidden input for secrets — auth tokens, bot tokens, OpenAI keys,
  // anything we wouldn't want sitting in the terminal scrollback or
  // a tmux logfile. Plain `ask` echoes for normal data like phone
  // numbers / SIDs (the SID isn't a secret on its own).
  const value = (f.secret ? await prompts.askSecret(inputLine) : await prompts.ask(inputLine)).trim();
  log('');
  return value;
}

/**
 * Collect a batch of fields, handling existing-value detection, ask-
 * for-missing, and the optional update-any flow.
 *
 * Caller passes the FULL list of fields (with their current values
 * pre-populated) and the helpers. Returns the merged final values
 * plus the list of keys that actually changed this run, so the caller
 * knows whether to re-PUT the config endpoint or skip the save.
 */
export async function collectFields(opts: {
  title: string;
  fields: SetupField[];
  isTTY: boolean;
  prompts: PromptHelpers;
  c: ColorHelpers;
  logger: LogHelpers;
}): Promise<CollectResult> {
  const { title, fields, isTTY, prompts, c, logger } = opts;
  const { log, ok, info, fail } = logger;

  // Build initial value map from the `current` field on each definition.
  const values: Record<string, string> = {};
  for (const f of fields) values[f.key] = f.current ?? '';

  const changedKeys: string[] = [];

  // Title block.
  log('');
  log(`  ${c.bold('🎀 ' + title)}`);
  log('');

  // Summary of what's already configured. Drives the user's decision
  // on whether they need to add / update anything, and makes the
  // upcoming prompts feel like a delta on real state instead of a
  // restart-from-scratch.
  const anyConfigured = fields.some((f) => (f.current ?? '') !== '');
  if (anyConfigured) {
    log(`  ${c.dim('Currently configured:')}`);
    for (const f of fields) {
      const labelCol = `   ${f.label}`.padEnd(36);
      log(`  ${labelCol} ${renderCurrent(f, c)}`);
    }
    log('');
  }

  if (!isTTY) {
    // Caller is scripted / piped — return what we have. The cli's
    // own validation will surface a hard error for any required field
    // that's still empty. No prompts here because blocking on stdin
    // would hang forever.
    return { values, changedKeys };
  }

  // Phase 1: prompt for every MISSING field (current === '').
  const missing = fields.filter((f) => (values[f.key] ?? '') === '');
  if (missing.length > 0) {
    if (anyConfigured) {
      // Re-entrant case — we're filling in gaps. Make that explicit so
      // the user doesn't think we're about to re-prompt everything.
      log(`  ${c.bold('Adding missing values')} ${c.dim('— ' + missing.length + (missing.length === 1 ? ' field' : ' fields') + ' still needed:')}`);
      log('');
    }
    for (let i = 0; i < missing.length; i++) {
      const f = missing[i];
      const step = anyConfigured ? null : i + 1; // first-run gets numbered steps
      const v = await promptOne(f, step, prompts, c, log);
      if (v) { values[f.key] = v; changedKeys.push(f.key); }
    }
  }

  // Phase 2: offer to update any already-configured field. Skipped on
  // a true-first-run (nothing configured before this command started)
  // because the just-entered values ARE the config.
  if (anyConfigured) {
    const existingFields = fields.filter((f) => (f.current ?? '') !== '');
    if (existingFields.length > 0) {
      const reply = (await prompts.ask(`  ${c.bold('Update any of the already-configured values?')} ${c.dim('(y/N)')} `)).trim();
      if (reply.toLowerCase().startsWith('y')) {
        log('');
        // Numbered picker — the user types one or more numbers (comma
        // or space separated) to pick which fields to re-enter. `0` /
        // empty / Enter exits.
        for (let i = 0; i < existingFields.length; i++) {
          log(`    ${c.cyan(String(i + 1) + '.')} ${existingFields[i].label}  ${renderCurrent(existingFields[i], c)}`);
        }
        log(`    ${c.dim('Enter numbers (e.g. 1,3) — or just Enter to keep everything as-is.')}`);
        const picksRaw = (await prompts.ask(`    ${c.magenta('>')} `)).trim();
        log('');
        if (picksRaw) {
          const picks = picksRaw
            .split(/[\s,]+/)
            .map((s) => parseInt(s, 10))
            .filter((n) => Number.isInteger(n) && n >= 1 && n <= existingFields.length);
          const unique = Array.from(new Set(picks));
          if (unique.length === 0) {
            info('No valid numbers — leaving everything as-is.');
            log('');
          } else {
            for (const pickNumber of unique) {
              const f = existingFields[pickNumber - 1];
              const v = await promptOne(f, null, prompts, c, log);
              if (v) { values[f.key] = v; changedKeys.push(f.key); }
              // Empty input on a re-prompt explicitly keeps the
              // existing value — that's the common "oh wait, I
              // changed my mind, leave it" affordance.
            }
          }
        }
      }
    }
  }

  // Phase 3: validate required fields. Empty-string for a required
  // field after the interactive pass means the user picked the field
  // for update and then hit Enter without typing — we treat that as
  // "keep the existing value if there was one, otherwise fail".
  const stillMissing: string[] = [];
  for (const f of fields) {
    if ((f.required ?? true) === false) continue;
    if ((values[f.key] ?? '') === '') stillMissing.push(f.label);
  }
  if (stillMissing.length > 0) {
    log('');
    fail(`Still missing required field(s): ${stillMissing.join(', ')}`);
    log('');
    // Don't `process.exit` — let the caller decide. Returning empty
    // values would mask the failure; instead surface as a thrown
    // error the caller catches and converts to its own exit.
    throw new SetupError(`missing required fields: ${stillMissing.join(', ')}`);
  }

  if (changedKeys.length === 0) {
    ok('No changes — existing configuration kept.');
  }
  return { values, changedKeys };
}

/** Thrown by `collectFields` on hard validation failure. */
export class SetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SetupError';
  }
}

// Re-export the readline type so callers don't have to import it
// from node:readline themselves when they wrap the helpers.
export type { ReadlineInterface };
