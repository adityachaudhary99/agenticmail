/**
 * Read / write / patch ~/.claude/settings.json — the file where Claude
 * Code stores user-level configuration including the hooks registry.
 *
 * This is a DIFFERENT file from ~/.claude.json (which `claude-config.ts`
 * handles). The split is Claude Code's design:
 *
 *   ~/.claude.json            → OAuth state, MCP servers, project list
 *   ~/.claude/settings.json   → user preferences, theme, hooks
 *
 * We touch exactly two keys here, and only inside the `hooks` block:
 *
 *   hooks.UserPromptSubmit  → the AgenticMail mail-hook registration
 *
 * Everything else in the file is preserved verbatim.
 *
 * # Hook config schema (Claude Code's format)
 *
 *   {
 *     "hooks": {
 *       "UserPromptSubmit": [
 *         {
 *           "matcher": "",
 *           "hooks": [
 *             { "type": "command", "command": "agenticmail-mail-hook" }
 *           ]
 *         }
 *       ]
 *     }
 *   }
 *
 * The outer array is "rules" — each rule has a matcher and one or more
 * commands. We add our own rule with a stable identifying marker so we
 * can find and replace (or remove) it without disturbing other hooks
 * the user may have installed (e.g. a typescript-lsp hook).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

/** Stable identifying marker for the hook entry we own. */
const AGENTICMAIL_HOOK_MARKER = 'agenticmail-mail-hook';

interface ClaudeHookCommand {
  type: 'command';
  command: string;
}

interface ClaudeHookRule {
  matcher?: string;
  hooks: ClaudeHookCommand[];
}

interface ClaudeSettingsShape {
  hooks?: {
    UserPromptSubmit?: ClaudeHookRule[];
    PreToolUse?: ClaudeHookRule[];
    [event: string]: ClaudeHookRule[] | undefined;
  };
  [key: string]: unknown;
}

/**
 * Hook events the AgenticMail mail-hook is registered on.
 *
 * We only register on **UserPromptSubmit** because that is the only
 * Claude Code hook event whose output schema accepts
 * `hookSpecificOutput.additionalContext` for context injection.
 *
 * # Why not PreToolUse too?
 *
 * Earlier (0.8.22) we tried to register on `PreToolUse` as well — the
 * idea being to wake Claude during autonomous runs (where there are
 * no user prompts for hours, just tool calls). The intent was right
 * but the implementation was wrong: `PreToolUse`'s output schema
 * expects `permissionDecision` / `permissionDecisionReason`, not
 * `additionalContext`. Claude Code accordingly logged
 * `PreToolUse:Read hook error` on every tool call. Functional but
 * noisy and ugly.
 *
 * Autonomous-mode awareness is a real and worthwhile feature, but it
 * needs a different mechanism than re-using the UserPromptSubmit
 * hook. Until that's designed properly, we only register on the one
 * event whose schema matches what we're trying to do.
 *
 * # Why HOOK_EVENTS_TO_REMOVE is a superset
 *
 * Anyone who installed 0.8.22 has a PreToolUse entry already in
 * their settings.json — we need `removeMailHook` to clean that up
 * during upgrade, even though we no longer add it. So the remove
 * walker iterates a superset that includes the historical events.
 */
const HOOK_EVENTS_TO_REGISTER = ['UserPromptSubmit'] as const;
const HOOK_EVENTS_TO_REMOVE = ['UserPromptSubmit', 'PreToolUse'] as const;
type HookEvent =
  | typeof HOOK_EVENTS_TO_REGISTER[number]
  | typeof HOOK_EVENTS_TO_REMOVE[number];

function readSettings(path: string): ClaudeSettingsShape {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, 'utf-8');
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as ClaudeSettingsShape;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    return {};
  } catch (err) {
    throw new Error(
      `Could not parse Claude Code settings at ${path}: ${(err as Error).message}. ` +
      `Refusing to overwrite — please fix the file by hand and retry.`,
    );
  }
}

function writeSettings(path: string, settings: ClaudeSettingsShape): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const text = JSON.stringify(settings, null, 2) + '\n';
  const tmp = `${path}.agenticmail-tmp`;
  writeFileSync(tmp, text, 'utf-8');
  // Atomic POSIX rename → never leaves a half-written settings file.
  // A corrupted settings.json doesn't log you out, but it CAN crash
  // Claude Code on startup until you fix it by hand, so we're careful.
  renameSync(tmp, path);
}

/**
 * Insert (or replace) the AgenticMail mail-hook on every relevant
 * Claude Code event. Returns `true` if the file changed.
 *
 * The `command` parameter is the shell command to execute on each
 * fire — typically just the bin name `agenticmail-mail-hook` (which
 * resolves via $PATH after npm globally installs the package), but
 * can be a full path for tests or unusual setups.
 *
 * Each event gets its own rule with an empty `matcher` (matches all),
 * and the rule is identified for upsert/remove via the
 * `AGENTICMAIL_HOOK_MARKER` substring in the command. That way users
 * can add their own UserPromptSubmit / PreToolUse hooks alongside
 * ours and we don't disturb each other.
 */
export function upsertMailHook(path: string, command: string): boolean {
  const settings = readSettings(path);
  if (!settings.hooks) settings.hooks = {};

  let changed = false;

  // Add to the supported event(s).
  for (const event of HOOK_EVENTS_TO_REGISTER) {
    if (upsertOneEvent(settings.hooks, event, command)) changed = true;
  }

  // Clean up any historical event registrations that aren't in the
  // current supported set — this is what heals existing 0.8.22
  // installs when the user upgrades, removing their broken PreToolUse
  // entry without forcing a manual uninstall+reinstall.
  for (const event of HOOK_EVENTS_TO_REMOVE) {
    if ((HOOK_EVENTS_TO_REGISTER as readonly string[]).includes(event)) continue;
    if (removeOneEvent(settings.hooks, event)) changed = true;
  }

  if (changed) writeSettings(path, settings);
  return changed;
}

function removeOneEvent(
  hooks: NonNullable<ClaudeSettingsShape['hooks']>,
  event: HookEvent,
): boolean {
  const list = hooks[event] ?? [];
  if (list.length === 0) return false;
  const filtered = list.filter(rule =>
    !rule.hooks?.some(h => typeof h.command === 'string' && h.command.includes(AGENTICMAIL_HOOK_MARKER)),
  );
  if (filtered.length === list.length) return false;
  if (filtered.length === 0) delete hooks[event];
  else hooks[event] = filtered;
  return true;
}

function upsertOneEvent(
  hooks: NonNullable<ClaudeSettingsShape['hooks']>,
  event: HookEvent,
  command: string,
): boolean {
  const list = hooks[event] ?? [];

  const isOurs = (rule: ClaudeHookRule): boolean =>
    rule.hooks?.some(h => typeof h.command === 'string' && h.command.includes(AGENTICMAIL_HOOK_MARKER)) ?? false;

  const desired: ClaudeHookRule = {
    matcher: '',  // empty = match every fire of this event
    hooks: [{ type: 'command', command }],
  };

  const existingIdx = list.findIndex(isOurs);
  if (existingIdx >= 0) {
    const existing = list[existingIdx];
    if (
      existing.matcher === desired.matcher &&
      existing.hooks.length === desired.hooks.length &&
      existing.hooks.every((h, i) => h.command === desired.hooks[i].command)
    ) {
      return false;
    }
    list[existingIdx] = desired;
  } else {
    list.push(desired);
  }
  hooks[event] = list;
  return true;
}

/**
 * Remove the AgenticMail mail-hook from every Claude Code event we
 * registered it on. Only our rules are touched — any other hooks the
 * user has installed under the same events are preserved.
 *
 * Returns `true` if the file changed.
 */
export function removeMailHook(path: string): boolean {
  if (!existsSync(path)) return false;
  const settings = readSettings(path);
  if (!settings.hooks) return false;

  let changed = false;
  for (const event of HOOK_EVENTS_TO_REMOVE) {
    if (removeOneEvent(settings.hooks, event)) changed = true;
  }

  // Tidy up: drop the empty hooks key if nothing's left.
  if (settings.hooks && Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  if (changed) writeSettings(path, settings);
  return changed;
}

// Back-compat aliases so existing callers (install.ts, uninstall.ts)
// keep working without an import-site rename.
export const upsertUserPromptSubmitHook = upsertMailHook;
export const removeUserPromptSubmitHook = removeMailHook;
