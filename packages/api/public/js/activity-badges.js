// Real-time worker activity badges in the topbar.
//
// The dispatcher posts worker_started / worker_heartbeat /
// worker_finished events to /system/events. This module
// subscribes (master-key auth), maintains a map of active
// workers, and paints a small badge per active worker
// between the search bar and the notification bell.
//
// Each badge shows: agent avatar/initial · friendly status
// derived from the last tool the worker invoked. Updates
// arrive at the heartbeat cadence (30 s) so the badge text
// reflects what the agent is doing right now.

import { state, API_URL } from './state.js';

const BADGE_CONTAINER_ID = 'activity-badges';

/**
 * Map of workerId → { agentName, kind, lastTool, turnCount,
 * startedAtMs }. Maintained off the SSE stream; rendered into
 * the badge container on every event.
 */
const workers = new Map();
let sseController = null;

/**
 * Map an SDK tool name (or the truncated head we capture in
 * dispatcher logs) to a short verb. Falls back to "working"
 * when we don't recognise the tool. The mapping is intentionally
 * generic — exotic tools default to "working" rather than
 * leaking the raw tool name to a user-facing badge.
 */
function statusFor(lastTool) {
  if (!lastTool) return 'starting';
  const t = lastTool.toLowerCase();
  if (t.startsWith('read'))         return 'reading';
  if (t.startsWith('write'))        return 'writing code';
  if (t.startsWith('edit'))         return 'editing code';
  if (t.startsWith('bash'))         return 'running shell';
  if (t.startsWith('grep'))         return 'searching';
  if (t.startsWith('glob'))         return 'searching';
  if (t.startsWith('webfetch'))     return 'fetching web';
  if (t.startsWith('websearch'))    return 'searching web';
  if (t.startsWith('notebookedit')) return 'editing notebook';
  if (t.includes('send_email'))     return 'sending mail';
  if (t.includes('reply_email'))    return 'replying';
  if (t.includes('read_email'))     return 'reading mail';
  if (t.includes('list_inbox'))     return 'checking inbox';
  if (t.includes('search_emails'))  return 'searching mail';
  if (t.includes('call_agent'))     return 'delegating';
  if (t.includes('submit_result'))  return 'finishing';
  if (t.includes('save_thread_memory')) return 'saving memory';
  if (t.startsWith('mcp__'))        return 'using tool';
  return 'working';
}

function render() {
  const root = document.getElementById(BADGE_CONTAINER_ID);
  if (!root) return;
  const list = Array.from(workers.values()).sort((a, b) => (a.startedAtMs ?? 0) - (b.startedAtMs ?? 0));
  if (list.length === 0) { root.innerHTML = ''; return; }
  root.innerHTML = list.map(w => {
    const initial = (w.agentName ?? '?').slice(0, 1).toUpperCase();
    const status = statusFor(w.lastTool);
    const tooltip = `${w.agentName} — ${status}${w.turnCount ? ` · ${w.turnCount} tool calls` : ''}${w.lastTool ? `\nlast tool: ${w.lastTool}` : ''}`;
    return `
      <div class="activity-badge" title="${escapeAttr(tooltip)}" data-worker-id="${escapeAttr(w.workerId ?? '')}">
        <span class="badge-dot"></span>
        <span class="badge-initial">${escapeHtml(initial)}</span>
        <span class="badge-name">${escapeHtml(w.agentName ?? '?')}</span>
        <span class="badge-status">${escapeHtml(status)}</span>
      </div>
    `;
  }).join('');
}

function handleEvent(event) {
  if (!event || typeof event !== 'object') return;
  const w = event.worker;
  if (!w?.workerId) return;
  if (event.type === 'worker_started' || event.type === 'worker_heartbeat') {
    // Merge so a heartbeat-after-started preserves the start
    // metadata without re-fetching.
    const existing = workers.get(w.workerId) ?? {};
    workers.set(w.workerId, { ...existing, ...w });
    render();
  } else if (event.type === 'worker_finished') {
    workers.delete(w.workerId);
    render();
  }
}

/**
 * Subscribe to /system/events with the master key. The web UI
 * already holds the master key in state.masterKey (set on
 * sign-in). Re-subscribes idempotently — safe to call after
 * agent-list refresh.
 */
export function subscribeToActivity() {
  if (sseController) { try { sseController.abort(); } catch {} }
  sseController = new AbortController();
  fetch(`${API_URL}/api/agenticmail/system/events`, {
    headers: { Authorization: `Bearer ${state.masterKey}`, Accept: 'text/event-stream' },
    signal: sseController.signal,
  }).then(async res => {
    if (!res.ok || !res.body) return;
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (!sseController.signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, i); buf = buf.slice(i + 2);
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try { handleEvent(JSON.parse(line.slice(6))); } catch {}
        }
      }
    }
  }).catch(() => { /* dropped — user can refresh to reconnect */ });
}

// Tiny HTML escapers (kept local to avoid an import cycle).
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(s) { return escapeHtml(s); }
