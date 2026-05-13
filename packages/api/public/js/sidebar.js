// Gmail-style folder sidebar.
//
// AgenticMail's mail store is IMAP-backed (Stalwart), so "folders"
// here are IMAP mailbox names. We expose the same shortlist Gmail's
// sidebar shows. The "All Mail" entry is a convenience that maps to
// the inbox endpoint until per-mailbox listing is wired through the
// public API.
import { state } from './state.js';
import { icon } from './icons.js';

export const FOLDERS = [
  { id: 'inbox',   label: 'Inbox',    icon: 'inbox' },
  { id: 'starred', label: 'Starred',  icon: 'starOutline' },
  { id: 'sent',    label: 'Sent',     icon: 'sent' },
  { id: 'drafts',  label: 'Drafts',   icon: 'drafts' },
  { id: 'all',     label: 'All Mail', icon: 'allMail' },
  { id: 'spam',    label: 'Spam',     icon: 'spam' },
  { id: 'trash',   label: 'Trash',    icon: 'trash' },
];

export function renderSidebar(onSelect) {
  const root = document.getElementById('folder-list');
  if (!root) return;
  const active = state.selectedFolder ?? 'inbox';
  const unread = state.unread?.[state.selectedAgent?.id] ?? 0;
  root.innerHTML = FOLDERS.map(f => {
    const isActive = f.id === active;
    const showCount = f.id === 'inbox' && unread > 0;
    return `
      <div class="folder-row ${isActive ? 'active' : ''}" data-folder="${f.id}">
        <span class="icon">${icon(f.icon, { size: 20 })}</span>
        <span class="label">${f.label}</span>
        <span class="count" ${showCount ? '' : 'data-zero'}>${showCount ? unread : ''}</span>
      </div>
    `;
  }).join('');
  root.querySelectorAll('.folder-row').forEach(el => {
    el.addEventListener('click', () => onSelect(el.dataset.folder));
  });
}
