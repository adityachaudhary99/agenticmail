// Gmail-style bottom-right compose popup. Handles both new-message
// and reply flows. `wake` is the AgenticMail selective-wake hint.
//
// Draft autosave: every keystroke on the to / cc / subject / body
// fields schedules a 2s-debounced save to `/drafts`. First save
// POSTs and stores the returned id; subsequent saves PUT to that
// id. On Send, the draft (if any) is deleted after the send
// succeeds — otherwise it stays around so the user can find it
// in the Drafts folder.
import { state } from './state.js';
import { escapeHtml, toast } from './utils.js';
import { apiPost, apiPut, apiDelete } from './api.js';
import { loadList } from './list-view.js';

const AUTOSAVE_DEBOUNCE_MS = 2000;
let autosaveTimer = null;
let autosaveInFlight = false;

export function populateComposeFrom() {
  const sel = document.getElementById('compose-from');
  sel.innerHTML = state.agents
    .map(a => `<option value="${a.id}">${escapeHtml(a.name)} &lt;${escapeHtml(a.email)}&gt;</option>`)
    .join('');
}

export function openCompose() {
  state.composeReplyContext = null;
  state.composeDraftId = null;
  document.getElementById('compose-title').textContent = 'New message';
  if (state.selectedAgent) document.getElementById('compose-from').value = state.selectedAgent.id;
  ['compose-to', 'compose-cc', 'compose-wake', 'compose-subject', 'compose-body']
    .forEach(id => { document.getElementById(id).value = ''; });
  setComposeStatus('');
  showModal();
  wireAutosave();
  setTimeout(() => document.getElementById('compose-to').focus(), 50);
}

export function openReply(replyAll) {
  if (!state.currentMessage) return;
  const msg = state.currentMessage;
  state.composeReplyContext = { uid: msg.uid, agent: state.selectedAgent, replyAll };
  state.composeDraftId = null;
  document.getElementById('compose-title').textContent =
    `Reply${replyAll ? ' all' : ''}: ${msg.subject ?? '(no subject)'}`;
  document.getElementById('compose-from').value = state.selectedAgent.id;
  const fromAddr = msg.from?.[0]?.address ?? '';
  let toAddr = fromAddr;
  if (replyAll) {
    const all = [fromAddr, ...(msg.to ?? []).map(a => a.address), ...(msg.cc ?? []).map(a => a.address)]
      .filter(Boolean).filter((v, i, a) => a.indexOf(v) === i)
      .filter(addr => addr !== state.selectedAgent.email);
    toAddr = all.join(', ');
  }
  document.getElementById('compose-to').value = toAddr;
  document.getElementById('compose-cc').value = '';
  document.getElementById('compose-wake').value = '';
  document.getElementById('compose-subject').value =
    (msg.subject ?? '').startsWith('Re:') ? msg.subject : `Re: ${msg.subject ?? ''}`;
  const quoted = (msg.text ?? '').split('\n').map(l => `> ${l}`).join('\n');
  const stub = `\n\nOn ${msg.date}, ${fromAddr} wrote:\n${quoted}`;
  document.getElementById('compose-body').value = stub;
  setComposeStatus('');
  showModal();
  wireAutosave();
  setTimeout(() => document.getElementById('compose-body').focus(), 50);
}

export function closeCompose() {
  document.getElementById('compose-bg').style.display = 'none';
  // Flush a final save synchronously-ish on close so a quick
  // "type → close" doesn't lose work. We only fire if there's a
  // pending debounce — if the user already saved or never typed,
  // skip the network call.
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
    void runAutosave();
  }
}

function showModal() {
  document.getElementById('compose-bg').style.display = 'flex';
}

/**
 * Build the field set the drafts API expects from current modal
 * state. Returns null when the draft is empty (no point persisting
 * a blank shell).
 */
function readComposeFields() {
  const to = document.getElementById('compose-to').value.trim();
  const subject = document.getElementById('compose-subject').value.trim();
  const text = document.getElementById('compose-body').value;
  const cc = document.getElementById('compose-cc').value.trim();
  if (!to && !subject && !text.trim() && !cc) return null;
  return {
    to: to || null,
    subject: subject || null,
    text: text || null,
    cc: cc || null,
  };
}

/**
 * Wire the autosave debounce to every input/textarea in the modal.
 * Re-wires on every open() so removed/replaced DOM nodes don't
 * accumulate listeners.
 */
function wireAutosave() {
  ['compose-to', 'compose-cc', 'compose-subject', 'compose-body'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    // Marker prevents double-binding.
    if (el._autosaveBound) return;
    el._autosaveBound = true;
    el.addEventListener('input', scheduleAutosave);
  });
}

function scheduleAutosave() {
  setComposeStatus('Saving…');
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(runAutosave, AUTOSAVE_DEBOUNCE_MS);
}

async function runAutosave() {
  autosaveTimer = null;
  if (autosaveInFlight) {
    // Coalesce: re-schedule one more pass after the current
    // request lands so we don't lose the latest keystroke.
    autosaveTimer = setTimeout(runAutosave, AUTOSAVE_DEBOUNCE_MS);
    return;
  }
  const fields = readComposeFields();
  if (!fields) { setComposeStatus(''); return; }
  const agentId = document.getElementById('compose-from').value;
  const agent = state.agents.find(a => a.id === agentId) ?? state.selectedAgent;
  if (!agent) return;
  autosaveInFlight = true;
  try {
    if (state.composeDraftId) {
      await apiPut(`/drafts/${state.composeDraftId}`, fields, { agentKey: agent.apiKey });
    } else {
      const r = await apiPost('/drafts', fields, { agentKey: agent.apiKey });
      state.composeDraftId = r?.id ?? null;
    }
    setComposeStatus('Saved to Drafts');
  } catch (err) {
    setComposeStatus(`Save failed: ${err.message}`);
  } finally {
    autosaveInFlight = false;
  }
}

function setComposeStatus(text) {
  const el = document.getElementById('compose-status');
  if (el) el.textContent = text;
}

export async function sendCompose() {
  const agentId = document.getElementById('compose-from').value;
  const agent = state.agents.find(a => a.id === agentId);
  if (!agent) return toast('Pick an agent to send from.', true);
  const to = document.getElementById('compose-to').value.trim();
  const subject = document.getElementById('compose-subject').value.trim();
  const text = document.getElementById('compose-body').value;
  const cc = document.getElementById('compose-cc').value.trim();
  const wakeRaw = document.getElementById('compose-wake').value.trim();
  if (!to || !subject) return toast('To and Subject are required.', true);
  const body = { to, subject, text };
  if (cc) body.cc = cc;
  if (wakeRaw) body.wake = wakeRaw.split(',').map(s => s.trim()).filter(Boolean);
  try {
    await apiPost('/mail/send', body, { agentKey: agent.apiKey });
    // Clean up the autosaved draft (if any) — the message is in
    // the real Sent folder now, no need to keep a Drafts entry.
    if (state.composeDraftId) {
      try { await apiDelete(`/drafts/${state.composeDraftId}`, { agentKey: agent.apiKey }); } catch { /* ignore */ }
      state.composeDraftId = null;
    }
    closeCompose();
    toast('Sent.');
    if (state.selectedAgent?.id === agent.id) await loadList(agent, state.selectedFolder);
  } catch (err) {
    toast(`Send failed: ${err.message}`, true);
  }
}
