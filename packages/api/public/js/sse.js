// Real-time mail delivery via Server-Sent Events. Every agent gets
// its own subscription; the dispatcher pushes a `new` event per
// arrived message. We fan that out to:
//   1. List view — silent in-place refresh (no flicker, no scroll
//      jump, no bulk-selection wipe) if it's the active inbox
//   2. Profile dropdown — bump the per-agent unread counter
//   3. Browser notification — system ping when the tab is in the background
//   4. Soft chime (toggleable) when sound is enabled
import { state, API_URL } from './state.js';
import { toast } from './utils.js';
import { renderProfile } from './profile.js';
import { silentRefresh } from './list-view.js';
import { playNotificationSound } from './sound.js';

export function subscribeToAllAgents() {
  // Tear down previous controllers (called on agent-list refresh).
  for (const c of state.sseControllers) { try { c.abort(); } catch {} }
  state.sseControllers = [];
  for (const agent of state.agents) {
    const ctrl = new AbortController();
    state.sseControllers.push(ctrl);
    fetch(`${API_URL}/api/agenticmail/events`, {
      headers: { Authorization: `Bearer ${agent.apiKey}`, Accept: 'text/event-stream' },
      signal: ctrl.signal,
    }).then(async res => {
      if (!res.ok || !res.body) return;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (!ctrl.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, i); buf = buf.slice(i + 2);
          for (const line of frame.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            try { handleSseEvent(agent, JSON.parse(line.slice(6))); } catch {}
          }
        }
      }
    }).catch(() => {});
  }
}

async function handleSseEvent(agent, event) {
  if (event.type !== 'new') return;
  state.unread = state.unread ?? {};
  state.unread[agent.id] = (state.unread[agent.id] ?? 0) + 1;
  renderProfile();

  const isOpen = state.selectedAgent?.id === agent.id;
  if (isOpen) {
    // Silent in-place refresh — re-fetches the list digest and
    // re-renders ONLY the rows div. Toolbar (select-all, refresh,
    // bulk-actions) is untouched; existing row checkboxes survive;
    // scroll position is preserved by the browser since we replace
    // only the inner content. No "Loading…" flicker.
    await silentRefresh(agent, state.selectedFolder);
    state.unread[agent.id] = 0;   // user is looking — clear badge
    renderProfile();
  }

  // Soft chime — respects the user's sound toggle. Plays for every
  // arrival regardless of whether the tab is focused, because that
  // is the whole point of the chime (a foregrounded tab still
  // benefits from the audible ping when the user's attention is
  // elsewhere on screen).
  playNotificationSound();

  fireBrowserNotification(agent, event, isOpen);

  if (!isOpen) {
    const fromAddr = event.from?.address ?? event.from ?? 'someone';
    const subject = event.subject ?? '(no subject)';
    toast(`${agent.name}: ${subject} — from ${fromAddr}`);
  }
}

export function maybeRequestNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted' || Notification.permission === 'denied') return;
  if (localStorage.getItem('agenticmail.notif.asked')) return;
  setTimeout(() => {
    Notification.requestPermission().finally(() => {
      localStorage.setItem('agenticmail.notif.asked', '1');
    });
  }, 2000);
}

function fireBrowserNotification(agent, event, isOpen) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (isOpen && document.visibilityState === 'visible') return;
  const fromAddr = event.from?.address ?? event.from ?? 'unknown sender';
  const subject = event.subject ?? '(no subject)';
  try {
    const n = new Notification(subject, {
      body: `${agent.name} — from ${fromAddr}`,
      icon: '/favicon.ico',
      tag: `agenticmail-${agent.id}-${event.uid}`,
      silent: false,
    });
    n.onclick = () => {
      window.focus();
      // Switching agent here requires the router; let the user click
      // through manually so we don't tightly couple sse → router.
      if (event.uid) location.hash = `#/m/${event.uid}`;
      n.close();
    };
  } catch {}
}
