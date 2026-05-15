/**
 * Headless bridge-wake — resume the operator's Claude Code session
 * against bridge-inbox mail without requiring a live interactive
 * session.
 *
 * # Why
 *
 * Bridges (`claudecode@localhost`) are the operator's host session's
 * inbox proxy. The dispatcher historically skipped them because
 * waking the bridge requires spawning a session under the operator's
 * OAuth — and there was no way to do that headlessly.
 *
 * The mail-hook now persists the operator's latest `session_id` on
 * every fire (see `packages/core/src/host-sessions.ts`). With that,
 * the dispatcher CAN spawn a headless turn against the saved
 * session via the Claude Agent SDK's `resume` option. The turn:
 *
 *   - Sees the bridge inbox via the same MCP toolbelt the interactive
 *     session uses.
 *   - Decides whether to reply, route, or just mark-read.
 *   - Updates `session_id` again on completion (so the chain stays
 *     fresh).
 *
 * # When this fires
 *
 * The dispatcher's `shouldWatch` returns true for the bridge if a
 * fresh `host-sessions.json` entry exists. New mail in the bridge
 * inbox routes here instead of to the normal `spawnWorker` path.
 *
 * # Failure modes (and fallbacks)
 *
 *   - SDK throws "session not found" / "resume token expired" →
 *     forget the session record and return ok:false. The dispatcher
 *     escalates to the SMS path (if configured) or surfaces a
 *     system-event for the web UI's notification badge.
 *   - SDK times out → same fallback.
 *   - CLI isn't installed (operator only uses Codex) → no session
 *     was ever saved; `loadHostSession` returns null upstream and
 *     this function is never called.
 *
 * Tests live in `__tests__/bridge-wake.test.ts` with the SDK stubbed.
 */

import type { AgenticMailAccount } from './types.js';
import type { QueryFn } from './dispatcher.js';

/** Input the dispatcher hands the resolver. */
export interface BridgeWakeInput {
  /** The bridge account (claudecode@localhost). */
  bridge: AgenticMailAccount;
  /** Saved host session_id to resume against. */
  sessionId: string;
  /** cwd the operator last had open — preserves project context. */
  cwd?: string;
  /** Composed prompt summarising the new bridge mail. */
  prompt: string;
  /** MCP toolbelt env block, same one the interactive session uses. */
  mcpEnv: Record<string, string>;
  /** Wall-clock cap for the headless turn. */
  timeoutMs?: number;
}

export interface BridgeWakeResult {
  ok: boolean;
  /** Captured assistant text (for logs / system-event preview). */
  text?: string;
  /** Error class — drives fallback routing. */
  error?: 'session-expired' | 'sdk-missing' | 'timeout' | 'other';
  errorMessage?: string;
  /** Duration in ms — surfaces in dispatcher activity. */
  durationMs?: number;
}

/**
 * Run a headless resume of the operator's Claude Code session.
 *
 * The `query` function is the same one the dispatcher already uses
 * for normal worker spawns — we pass `options.resume = sessionId` so
 * the SDK targets the existing conversation instead of starting a
 * new one. Everything else (mcpServers, permissions, cwd) mirrors
 * what the operator's interactive session sees.
 */
export async function resumeBridgeSession(
  query: QueryFn,
  input: BridgeWakeInput,
  log: (level: 'info' | 'warn' | 'error', msg: string) => void,
): Promise<BridgeWakeResult> {
  const startMs = Date.now();
  const timeoutMs = input.timeoutMs ?? 5 * 60 * 1000;  // 5 min default

  let result: BridgeWakeResult = { ok: false };
  try {
    log('info', `[bridge-wake] resuming Claude Code session ${input.sessionId.slice(0, 8)}… for ${input.bridge.name}`);

    // SDK call: pass `resume` so the underlying CLI runs as
    // `claude --resume <sid> -p <prompt>` rather than starting a
    // fresh session. The mcpServers + permissionMode match what
    // the operator's interactive session uses.
    const opts: Record<string, unknown> = {
      resume: input.sessionId,
      cwd: input.cwd,
      mcpServers: {
        agenticmail: {
          command: 'agenticmail-mcp',
          args: [],
          env: input.mcpEnv,
        },
      },
      permissionMode: 'bypassPermissions',
      // Headless mode — no stdin tty.
      includePartialMessages: false,
    };

    let assistantText = '';
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
    }, timeoutMs);
    (timeoutHandle as unknown as { unref?: () => void }).unref?.();

    try {
      const stream = query({ prompt: input.prompt, options: opts });
      for await (const event of stream as AsyncIterable<unknown>) {
        if (timedOut) break;
        const e = event as { type?: string; message?: { content?: unknown[] } };
        // Capture the final assistant message text for the log line.
        if (e.type === 'assistant' && Array.isArray(e.message?.content)) {
          for (const block of e.message!.content!) {
            const b = block as { type?: string; text?: string };
            if (b.type === 'text' && typeof b.text === 'string') {
              assistantText = b.text;
            }
          }
        }
      }
    } finally {
      clearTimeout(timeoutHandle);
    }

    if (timedOut) {
      log('warn', `[bridge-wake] timeout after ${timeoutMs}ms — bridge wake gave up`);
      return { ok: false, error: 'timeout', durationMs: Date.now() - startMs };
    }

    result = { ok: true, text: assistantText, durationMs: Date.now() - startMs };
    log('info', `[bridge-wake] resumed session ok (${result.durationMs}ms, ${assistantText.length} chars)`);
    return result;
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    // Heuristic error-class detection — both Anthropic and the CLI
    // surface "session not found" / "invalid session" / "session
    // expired" phrasing for an evicted session. Any of those means
    // "give up, forget the record, escalate via SMS".
    const m = msg.toLowerCase();
    const expired = m.includes('session not found')
      || m.includes('invalid session')
      || m.includes('session expired')
      || m.includes('no such session')
      || m.includes('unknown session');
    const sdkMissing = m.includes('cannot find module')
      || m.includes("could not be found")
      || m.includes('command not found');
    const error: BridgeWakeResult['error'] = expired
      ? 'session-expired'
      : sdkMissing
        ? 'sdk-missing'
        : 'other';
    log('warn', `[bridge-wake] resume failed (${error}): ${msg.slice(0, 200)}`);
    return { ok: false, error, errorMessage: msg, durationMs: Date.now() - startMs };
  }
}

/**
 * Build the prompt the resumed session sees on wake. The bridge
 * mail's metadata is interpolated into a short context block so
 * the resumed session can decide what to do without re-reading the
 * full thread.
 */
export function composeBridgeWakePrompt(args: {
  bridgeName: string;
  uid: number;
  subject?: string;
  from?: string;
  preview?: string;
}): string {
  const subject = args.subject ?? '(no subject)';
  const from = args.from ?? 'unknown';
  const preview = (args.preview ?? '').slice(0, 600);
  return [
    `🎀 Bridge mail arrived — headless wake.`,
    '',
    `You are being resumed against your last session because new mail landed in your bridge inbox (${args.bridgeName}@localhost) and you weren't actively at the keyboard.`,
    '',
    `Trigger:`,
    `  UID:     ${args.uid}`,
    `  From:    ${from}`,
    `  Subject: ${subject}`,
    `  Preview: ${preview}`,
    '',
    `Read it with mcp__agenticmail__read_email({ uid: ${args.uid} }) and decide:`,
    `  · Does it need a reply from YOU (the operator's session)? Reply via mcp__agenticmail__reply_email.`,
    `  · Does it need a teammate to act? Forward / re-route by replying with wake: ["<teammate>"].`,
    `  · Is it [NEEDS OPERATOR] / [BLOCKED]? Then it's actually for the human — mark it unread, and the operator will see it on their next keystroke.`,
    `  · Is it FYI noise? mark_read and exit.`,
    '',
    `Keep this turn SHORT. You're being resumed to handle ONE piece of mail, not to continue the prior conversation.`,
  ].join('\n');
}
