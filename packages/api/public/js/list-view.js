// Gmail-style message-list view. One row per email; click to open in
// the message view. Search filters and inline highlighting run here.
import { state } from './state.js';
import { escapeHtml, toast } from './utils.js';
import { formatDate } from './time.js';
import { parseSearch, matchesSearch, highlightTerm } from './search.js';
import { apiGet } from './api.js';
import { FOLDERS } from './sidebar.js';
import { icon } from './icons.js';

export async function loadList(agent, folder) {
  const root = document.getElementById('content');
  root.innerHTML = `
    <div class="list-header">
      <span class="folder-title">${escapeHtml(folderTitle(folder))}</span>
      <span class="count-text" id="list-count"></span>
    </div>
    <div class="list-rows" id="list-rows"><div class="empty">Loading…</div></div>
  `;
  try {
    // Public API today only exposes the inbox listing. Other folders
    // fall through to the inbox endpoint and apply a client-side
    // shape (e.g. starred = flag filter). When the API grows
    // per-mailbox listing we'll route based on `folder` here.
    const data = await apiGet('/mail/inbox?limit=50&offset=0', { agentKey: agent.apiKey });
    state.messages = data.messages ?? [];
    renderList();
  } catch (err) {
    document.getElementById('list-rows').innerHTML =
      `<div class="empty">Failed to load: ${escapeHtml(err.message)}</div>`;
  }
}

function folderTitle(folder) {
  const f = FOLDERS.find(x => x.id === folder);
  return f ? f.label : 'Inbox';
}

export function renderList() {
  const root = document.getElementById('list-rows');
  if (!root) return;
  const q = state.searchQuery.trim();
  const filters = q ? parseSearch(q) : null;
  let filtered = filters ? state.messages.filter(m => matchesSearch(m, filters)) : state.messages;

  // Client-side folder filtering for the folders the API doesn't
  // distinguish for us yet. Starred uses the IMAP \Flagged flag.
  if (state.selectedFolder === 'starred') {
    filtered = filtered.filter(m => (m.flags ?? []).includes('\\Flagged'));
  }

  const hlTerm = filters?.subject || filters?.from || filters?.text || '';

  // Footer count + search hint
  const hintEl = document.getElementById('search-hint');
  if (q && hintEl) {
    hintEl.textContent = `${filtered.length}/${state.messages.length}`;
    hintEl.classList.add('show');
  } else if (hintEl) {
    hintEl.classList.remove('show');
  }
  const countEl = document.getElementById('list-count');
  if (countEl) countEl.textContent = `${filtered.length} of ${state.messages.length}`;

  if (filtered.length === 0) {
    root.innerHTML = q
      ? `<div class="empty">No messages match "${escapeHtml(q)}".</div>`
      : `<div class="empty"><div class="big">${icon('inbox', { size: 48 })}</div>Nothing here yet.</div>`;
    return;
  }

  root.innerHTML = filtered.map(m => {
    const unread = !(m.flags ?? []).includes('\\Seen');
    const starred = (m.flags ?? []).includes('\\Flagged');
    const fromAddr = m.from?.[0]?.address ?? '?';
    const fromName = m.from?.[0]?.name || fromAddr;
    const subject = m.subject ?? '(no subject)';
    const date = formatDate(m.date);
    const starIcon = icon(starred ? 'starFilled' : 'starOutline', { size: 18 });
    return `
      <div class="list-row ${unread ? 'unread' : ''}" data-uid="${m.uid}">
        <span class="star ${starred ? 'starred' : ''}" data-action="star">${starIcon}</span>
        <span class="dot"></span>
        <span class="from">${highlightTerm(fromName, hlTerm)}</span>
        <span class="subject-cell">
          <span class="subject">${highlightTerm(subject, hlTerm)}</span>
          <span class="preview">${highlightTerm((m.preview ?? '').slice(0, 160), hlTerm)}</span>
        </span>
        <span class="date">${escapeHtml(date)}</span>
      </div>
    `;
  }).join('');

  root.querySelectorAll('.list-row').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="star"]')) {
        e.stopPropagation();
        toast('Starring not wired through API yet.');
        return;
      }
      const uid = Number(el.dataset.uid);
      location.hash = `#/m/${uid}`;
    });
  });
}

export function clearSearch() {
  const input = document.getElementById('search-input');
  if (input) {
    input.value = '';
    input.classList.remove('has-query');
  }
  state.searchQuery = '';
  document.getElementById('search-clear')?.classList.remove('show');
  document.getElementById('search-hint')?.classList.remove('show');
  renderList();
  input?.focus();
}
