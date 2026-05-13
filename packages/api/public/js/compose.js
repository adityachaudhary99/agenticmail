// Gmail-style bottom-right compose popup. Handles both new-message
// and reply flows. `wake` is the AgenticMail selective-wake hint.
import { state } from './state.js';
import { escapeHtml, toast } from './utils.js';
import { apiPost } from './api.js';
import { loadList } from './list-view.js';

export function populateComposeFrom() {
  const sel = document.getElementById('compose-from');
  sel.innerHTML = state.agents
    .map(a => `<option value="${a.id}">${escapeHtml(a.name)} &lt;${escapeHtml(a.email)}&gt;</option>`)
    .join('');
}

export function openCompose() {
  state.composeReplyContext = null;
  document.getElementById('compose-title').textContent = 'New message';
  if (state.selectedAgent) document.getElementById('compose-from').value = state.selectedAgent.id;
  ['compose-to', 'compose-cc', 'compose-wake', 'compose-subject', 'compose-body']
    .forEach(id => { document.getElementById(id).value = ''; });
  showModal();
  setTimeout(() => document.getElementById('compose-to').focus(), 50);
}

export function openReply(replyAll) {
  if (!state.currentMessage) return;
  const msg = state.currentMessage;
  state.composeReplyContext = { uid: msg.uid, agent: state.selectedAgent, replyAll };
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
  showModal();
  setTimeout(() => document.getElementById('compose-body').focus(), 50);
}

export function closeCompose() {
  document.getElementById('compose-bg').style.display = 'none';
}

function showModal() {
  document.getElementById('compose-bg').style.display = 'flex';
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
    closeCompose();
    toast('Sent.');
    if (state.selectedAgent?.id === agent.id) await loadList(agent, state.selectedFolder);
  } catch (err) {
    toast(`Send failed: ${err.message}`, true);
  }
}
