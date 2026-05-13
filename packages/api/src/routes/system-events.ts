/**
 * System-level SSE event bus.
 *
 * # Why this exists
 *
 * `routes/events.ts` is per-account: each agent's SSE stream pushes mail /
 * task / spam events to THAT agent's listeners. That works great for
 * agent-scoped state but cannot carry account-lifecycle events ("a new
 * account named Lyra was just created"), which need to fan out to
 * master-key holders — typically the @agenticmail/claudecode dispatcher,
 * which wants to open a new per-account SSE the moment a new agent
 * appears, NOT after the next polling tick.
 *
 * Before this bus existed the dispatcher polled `GET /accounts` every 5s
 * (was 60s) and any agent created during the gap stayed inert: mail sent
 * to lyra@localhost between t=0 (create_account returned) and t=5s (poll
 * fires) would land in her inbox with nobody listening. With this bus the
 * dispatcher opens her SSE channel within milliseconds of POST /accounts
 * returning, so wake-on-mail is effectively instant.
 *
 * # API surface
 *
 *   GET /system/events             SSE stream, master-auth only
 *   pushSystemEvent(event)         in-process broadcast helper
 *
 * # Event shapes
 *
 *   { type: "connected" }
 *   { type: "account_created", account: { id, name, email, role, apiKey, ... } }
 *   { type: "account_deleted", accountId, name }
 *
 * The `account_created` payload deliberately includes the full account
 * record (incl. apiKey) so the dispatcher can open the per-account SSE
 * without an extra HTTP round-trip. This is OK because the system-events
 * endpoint already requires master-key auth — anyone reading the stream
 * already has the keys to do anything they want.
 */

import { Router } from 'express';
import type { Response } from 'express';
import { requireMaster } from '../middleware/auth.js';

interface ListenerEntry {
  res: Response;
  /** Cleanup: clear keep-alive timer when the connection drops. */
  cleanup: () => void;
}

/**
 * In-process set of active system-event listeners. Cleared on server
 * shutdown (see closeAllSystemEventListeners). Multiple listeners are
 * supported — e.g. dispatcher + a debug tail at the same time.
 */
const listeners = new Set<ListenerEntry>();

/** Push an event to every active system-event listener. */
export function pushSystemEvent(event: Record<string, unknown>): void {
  if (listeners.size === 0) return;
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const entry of listeners) {
    try {
      entry.res.write(data);
    } catch {
      /* listener disconnected mid-write — cleaned up by req 'close' */
    }
  }
}

/** Tear down all listeners on server shutdown. */
export function closeAllSystemEventListeners(): void {
  for (const entry of listeners) {
    try { entry.cleanup(); } catch { /* ignore */ }
    try { entry.res.end(); } catch { /* ignore */ }
  }
  listeners.clear();
}

export function createSystemEventRoutes(): Router {
  const router = Router();

  router.get('/system/events', requireMaster, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

    // Keep-alive comment every 30s so intermediaries don't drop the conn.
    const pingTimer = setInterval(() => {
      try { res.write(`: ping\n\n`); } catch { /* ignore */ }
    }, 30_000);

    const entry: ListenerEntry = {
      res,
      cleanup: () => { clearInterval(pingTimer); },
    };
    listeners.add(entry);

    req.on('close', () => {
      entry.cleanup();
      listeners.delete(entry);
    });
  });

  return router;
}
