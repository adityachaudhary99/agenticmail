/**
 * Dispatcher worker-activity registry.
 *
 * # Why this exists
 *
 * Before this endpoint, the host (Claude Code) had no way to tell what
 * the dispatcher was doing. Send a mail → silence → eventually a reply
 * lands. If the reply takes 30 seconds, the host can't distinguish:
 *
 *   - "Vesper started working, normal think time"
 *   - "the wake fired but the worker is queued behind 9 others"
 *   - "the wake never fired, mail never landed"
 *   - "Vesper is stuck"
 *
 * Auto-acknowledgment emails would pollute the thread and cost a Claude
 * turn per ack. A live activity registry gives richer info with neither
 * cost. The dispatcher already knows who's running — it just needs to
 * tell someone who can answer questions about it. That someone is the
 * API (the dispatcher is a separate process; the API is the central
 * state hub that MCP queries).
 *
 * # Design
 *
 * Push-based: the dispatcher posts a `started` event on `spawnWorker`
 * entry and a `finished` event in the `finally` block. The API keeps
 * an in-memory `Map<workerId, WorkerInfo>`, serves `GET /dispatcher/
 * activity` from it, and broadcasts every event on `/system/events`
 * so push-based consumers don't need to poll.
 *
 * No persistence. If the API restarts, the live registry is empty
 * until the next worker fires. That is correct: workers are
 * dispatcher-owned, and if the dispatcher kept running across an API
 * restart, the next worker event repopulates the registry. The
 * registry has a hard TTL on each entry as defence-in-depth so a
 * crashed dispatcher can't leave orphan entries forever.
 */

import { Router } from 'express';
import { requireMaster } from '../middleware/auth.js';
import { pushSystemEvent } from './system-events.js';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * One row in the live registry. Mirrors what the dispatcher knows at
 * spawn time — agent identity, what triggered the wake, when it
 * started. `endedAt` and `ok` get filled in by the finished event.
 */
export interface WorkerInfo {
  workerId: string;
  agentName: string;
  agentEmail?: string;
  /** "new-mail" | "task" | something else the dispatcher invented */
  kind: string;
  /** Mail UID for new-mail wakes, taskId for task wakes (best-effort) */
  trigger?: { uid?: number; taskId?: string; subject?: string; from?: string };
  startedAtMs: number;
  /** Filled in by the finished event. */
  endedAtMs?: number;
  /** True if the worker exited cleanly, false if it threw. */
  ok?: boolean;
  /** Optional short message from the worker (final assistant text head). */
  resultPreview?: string;
  /** ms timestamp of last heartbeat from the dispatcher. Updated by the
   *  worker-heartbeat endpoint and by worker-finished. Read by the
   *  activity endpoint to compute a `stale` flag without ever auto-
   *  evicting long-running workers from the registry. */
  lastHeartbeatMs?: number;
  /** Most recent tool the worker invoked (e.g. "Bash", "Read",
   *  "mcp__agenticmail__reply_email"). For "what is it doing right
   *  now?" visibility. */
  lastTool?: string;
  /** How many tool calls the worker has made so far. Cheap progress
   *  signal — a worker that's bumping this every minute is making
   *  progress; one whose count is frozen for 10 minutes is stuck. */
  turnCount?: number;
}

/**
 * Heartbeat staleness threshold. A worker that hasn't checked in for
 * this long gets `stale: true` in `check_activity` output. We do NOT
 * auto-evict — workers are explicitly allowed to run for hours and
 * the host should still see them in the registry. Stale just means
 * "the dispatcher hasn't pinged in a bit, double-check it's alive".
 */
const STALE_HEARTBEAT_MS = 90 * 1000;

/**
 * Soft TTL for FINISHED entries. We keep them around briefly so the
 * host can see "Vesper just finished 4s ago — here's what she said"
 * without having to be already waiting on the SSE stream when the
 * event fired. Pruned at the head of every read.
 */
const RECENT_TTL_MS = 2 * 60 * 1000;

/** Cap so the registry can't grow unbounded between prunes. */
const HARD_CAP = 256;

const active = new Map<string, WorkerInfo>();
const recent = new Map<string, WorkerInfo>();

function prune(nowMs: number): void {
  // NB: we deliberately do NOT auto-evict long-running workers from
  // `active` here any more (the old 30-minute TTL was wrong — workers
  // should be allowed to run for hours / overnight). Stuck-worker
  // detection is now heartbeat-based: see the `stale` flag on the
  // activity endpoint. The only `active` eviction path left is the
  // hard cap below, which only ever triggers under absurd fan-out.
  for (const [id, w] of recent) {
    const t = w.endedAtMs ?? w.startedAtMs;
    if (nowMs - t > RECENT_TTL_MS) recent.delete(id);
  }
  while (active.size > HARD_CAP) {
    const first = active.keys().next().value;
    if (!first) break;
    active.delete(first);
  }
  while (recent.size > HARD_CAP) {
    const first = recent.keys().next().value;
    if (!first) break;
    recent.delete(first);
  }
}

/** Test-only hook to clear state between assertions. */
export function _resetActivityRegistry(): void {
  active.clear();
  recent.clear();
}

export function createDispatcherActivityRoutes(): Router {
  const router = Router();

  /** Dispatcher → API: a worker just started. */
  router.post('/dispatcher/worker-started', requireMaster, (req, res) => {
    const body = req.body ?? {};
    if (typeof body.workerId !== 'string' || typeof body.agentName !== 'string') {
      res.status(400).json({ error: 'workerId and agentName are required' });
      return;
    }
    const info: WorkerInfo = {
      workerId: body.workerId,
      agentName: body.agentName,
      agentEmail: typeof body.agentEmail === 'string' ? body.agentEmail : undefined,
      kind: typeof body.kind === 'string' ? body.kind : 'unknown',
      trigger: body.trigger && typeof body.trigger === 'object' ? body.trigger : undefined,
      startedAtMs: Date.now(),
      lastHeartbeatMs: Date.now(),
      turnCount: 0,
    };
    prune(info.startedAtMs);
    active.set(info.workerId, info);
    // Fan out to /system/events listeners so push-based consumers (the
    // host's wait_for_email, future dashboards) don't need to poll.
    try {
      pushSystemEvent({
        type: 'worker_started',
        worker: { ...info },
      });
    } catch { /* listener failures must not block the dispatcher */ }
    res.status(201).json({ ok: true });
  });

  /** Dispatcher → API: a worker just finished (cleanly or with an error). */
  router.post('/dispatcher/worker-finished', requireMaster, (req, res) => {
    const body = req.body ?? {};
    if (typeof body.workerId !== 'string') {
      res.status(400).json({ error: 'workerId is required' });
      return;
    }
    const existing = active.get(body.workerId);
    const nowMs = Date.now();
    const info: WorkerInfo = {
      ...(existing ?? {
        workerId: body.workerId,
        agentName: typeof body.agentName === 'string' ? body.agentName : 'unknown',
        kind: 'unknown',
        startedAtMs: nowMs,
      }),
      endedAtMs: nowMs,
      ok: body.ok === false ? false : true,
      resultPreview: typeof body.resultPreview === 'string' ? body.resultPreview.slice(0, 240) : undefined,
      turnCount: typeof body.turnCount === 'number' ? body.turnCount : existing?.turnCount,
    };
    active.delete(body.workerId);
    recent.set(body.workerId, info);
    prune(nowMs);
    try {
      pushSystemEvent({
        type: 'worker_finished',
        worker: { ...info },
      });
    } catch { /* ignore */ }
    res.json({ ok: true });
  });

  /**
   * Dispatcher → API: a worker is still alive, here's its last
   * tool / turn count. Sent every ~30s by the dispatcher. We use
   * these to compute the `stale` flag in the activity response — a
   * worker whose heartbeat hasn't moved in 90s is probably hung
   * (but still kept in the registry so the host can see it).
   */
  router.post('/dispatcher/worker-heartbeat', requireMaster, (req, res) => {
    const body = req.body ?? {};
    if (typeof body.workerId !== 'string') {
      res.status(400).json({ error: 'workerId is required' });
      return;
    }
    const existing = active.get(body.workerId);
    if (!existing) {
      // Heartbeat for an unknown worker — could be a race after
      // worker-finished. Ignore quietly.
      res.json({ ok: true, ignored: 'unknown worker' });
      return;
    }
    existing.lastHeartbeatMs = Date.now();
    if (typeof body.lastTool === 'string') existing.lastTool = body.lastTool;
    if (typeof body.turnCount === 'number') existing.turnCount = body.turnCount;
    res.json({ ok: true });
  });

  /**
   * Host → API: what's happening right now?
   *
   * Returns active workers (currently running) plus recently-finished
   * ones (within the last 2 minutes) so the host can see the state of
   * the world without having to be subscribed to SSE.
   *
   * Each active entry includes a `stale` flag derived from the most
   * recent heartbeat — true means "the dispatcher hasn't pinged this
   * worker in 90s+, it may be stuck". Workers are NOT auto-evicted on
   * staleness; long-running tasks (overnight builds, multi-hour
   * research) should stay visible in the registry until they
   * genuinely finish.
   */
  router.get('/dispatcher/activity', requireMaster, (_req, res) => {
    const nowMs = Date.now();
    prune(nowMs);
    res.json({
      now: nowMs,
      active: Array.from(active.values()).map(w => ({
        ...w,
        durationMs: nowMs - w.startedAtMs,
        stale: w.lastHeartbeatMs !== undefined && (nowMs - w.lastHeartbeatMs) > STALE_HEARTBEAT_MS,
        heartbeatAgeMs: w.lastHeartbeatMs !== undefined ? nowMs - w.lastHeartbeatMs : undefined,
      })),
      recent: Array.from(recent.values()).map(w => ({
        ...w,
        durationMs: (w.endedAtMs ?? nowMs) - w.startedAtMs,
      })),
    });
  });

  /**
   * Host → API: tail of a worker's log file.
   *
   * Logs live at `~/.agenticmail/worker-logs/<sanitized-id>.log` and
   * are written by the dispatcher's per-worker observer (every SDK
   * message lands as a one-liner). This endpoint reads the tail so
   * the host can see what a long-running worker is actually doing —
   * the answer to "Vesper has been running 20 min, what's she
   * currently stuck on?".
   *
   * Query params:
   *   - lines (default 80, max 1000): how many trailing lines to return
   *
   * Master-key only. Worker logs may contain agent persona contents,
   * email previews, and tool args; not data we hand out to per-agent
   * tokens.
   */
  router.get('/dispatcher/worker-log/:workerId', requireMaster, (req, res) => {
    const rawId = String(req.params.workerId ?? '');
    if (!rawId) {
      res.status(400).json({ error: 'workerId is required' });
      return;
    }
    const lines = Math.min(Math.max(Number(req.query.lines ?? 80), 1), 1000);
    // Same sanitisation rule as the dispatcher uses when it picks the
    // file name. Kept in sync intentionally — must match
    // packages/claudecode/src/dispatcher.ts:sanitizeId().
    const safe = rawId.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = join(homedir(), '.agenticmail', 'worker-logs', `${safe}.log`);
    if (!existsSync(path)) {
      res.status(404).json({ error: 'no log file for that workerId' });
      return;
    }
    try {
      // Naive tail — read whole file, slice. Worker logs are bounded
      // by the lifetime of the worker; even a 30-min worker fires
      // ~maybe 200 KB of log. Streaming would be premature here.
      const raw = readFileSync(path, 'utf-8');
      const stat = statSync(path);
      const all = raw.split(/\r?\n/);
      const tail = all.filter(Boolean).slice(-lines);
      res.json({
        workerId: rawId,
        path,
        bytes: stat.size,
        lines: tail.length,
        tail,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
