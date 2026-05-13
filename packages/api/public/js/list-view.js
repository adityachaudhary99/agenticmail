// Gmail-style message-list view. One row per email; click to open in
// the message view. Search filters and inline highlighting run here.
import { state } from './state.js';
import { escapeHtml, toast } from './utils.js';
import { formatDate } from './time.js';
import { parseSearch, matchesSearch, highlightTerm } from './search.js';
import { apiGet } from './api.js';
import { FOLDERS } from './sidebar.js';
import { icon } from './icons.js';

/**
 * Defensive flag check. The API's IMAP layer returns `flags` as an
 * array of strings most of the time (`['\\Seen', '\\Flagged']`) but
 * some envelopes come back with a Set-like serialisation or even an
 * object map. Without this guard, calling `.includes()` on a non-
 * array crashed the list with "(m.flags ?? []).includes is not a
 * function". Coerce everything we don't recognise to an empty list.
 */
function flagsHas(flags, name) {
  if (Array.isArray(flags)) return flags.includes(name);
  if (flags && typeof flags === 'object') {
    // `{Seen: true, Flagged: false}` shape — try both with and
    // without the leading backslash since callers can mean either.
    const key = name.replace(/^\\/, '');
    return flags[name] === true || flags[key] === true;
  }
  return false;
}

// Map sidebar folder ids to the actual IMAP folder names the API
// expects on `/mail/folders/:folder`. `inbox` is special — the API
// has a dedicated `/mail/inbox` endpoint with extra enrichment, so
// we use that. Other folders go through the generic listing.
//
// Stalwart uses the standard IMAP names: INBOX, Sent, Drafts, Junk
// Mail (a.k.a. "Spam"), Trash. We use the canonical IMAP capitalisation.
const FOLDER_TO_IMAP = {
  inbox:   { endpoint: '/mail/inbox' },
  sent:    { endpoint: '/mail/folders/Sent' },
  drafts:  { endpoint: '/mail/folders/Drafts' },
  spam:    { endpoint: '/mail/folders/Junk%20Mail' },
  trash:   { endpoint: '/mail/folders/Trash' },
  all:     { endpoint: '/mail/folders/All%20Mail' },
  // Starred is not a folder — it's the IMAP \Flagged flag, surfaced
  // by client-side filtering over the inbox listing (Gmail-style).
  starred: { endpoint: '/mail/inbox', clientFilter: 'flagged' },
};

export async function loadList(agent, folder) {
  const root = document.getElementById('content');
  root.innerHTML = `
    <div class="list-header">
      <span class="folder-title">${escapeHtml(folderTitle(folder))}</span>
      <span class="count-text" id="list-count"></span>
    </div>
    <div class="list-rows" id="list-rows"><div class="empty">Loading…</div></div>
  `;
  const route = FOLDER_TO_IMAP[folder] ?? FOLDER_TO_IMAP.inbox;
  try {
    const sep = route.endpoint.includes('?') ? '&' : '?';
    const data = await apiGet(`${route.endpoint}${sep}limit=50&offset=0`, { agentKey: agent.apiKey });
    state.messages = data.messages ?? [];
    renderList();
  } catch (err) {
    // Empty folder is a normal state; "no such folder" lands here
    // too. Show a friendly empty message rather than a raw HTTP error.
    const msg = String(err.message ?? err);
    document.getElementById('list-rows').innerHTML = msg.includes('404')
      ? `<div class="empty">${escapeHtml(folderTitle(folder))} is empty.</div>`
      : `<div class="empty">Failed to load: ${escapeHtml(msg)}</div>`;
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
  // Flags may come back as an array OR an object map ({Seen: true})
  // depending on the IMAP path — always coerce before .includes().
  if (state.selectedFolder === 'starred') {
    filtered = filtered.filter(m => flagsHas(m.flags, '\\Flagged'));
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
    const unread = !flagsHas(m.flags, '\\Seen');
    const starred = flagsHas(m.flags, '\\Flagged');
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
