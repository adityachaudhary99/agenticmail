// Top-right Gmail-style account switcher. Lists every AgenticMail
// agent the master key can see; clicking switches the active inbox.
// The bridge agent (host) gets a green checkmark + "Host" badge so
// it's distinguishable from sub-agent inboxes.
import { state } from './state.js';
import { escapeHtml } from './utils.js';
import { avatarHtml, isBridgeAgent } from './avatar.js';
import { icon } from './icons.js';

export function renderProfile() {
  const a = state.selectedAgent;
  const totalOtherUnread = Object.entries(state.unread ?? {})
    .filter(([id]) => id !== a?.id)
    .reduce((sum, [, n]) => sum + n, 0);

  const avatarEl = document.getElementById('profile-avatar');
  if (avatarEl) {
    avatarEl.innerHTML = a
      ? avatarHtml(a) + (totalOtherUnread > 0 ? `<span class="avatar-check" style="background:#dc2626">${icon('dot', { size: 8 })}</span>` : '')
      : '';
  }

  const list = document.getElementById('profile-menu-list');
  if (!list) return;
  list.innerHTML = state.agents.map(agent => {
    const selected = state.selectedAgent?.id === agent.id;
    const badge = isBridgeAgent(agent)
      ? '<span class="role-badge role-badge-host">Host</span>'
      : '<span class="role-badge role-badge-sub">Sub-agent</span>';
    const check = selected ? `<span class="selected-check">${icon('check', { size: 20 })}</span>` : '';
    const unread = state.unread?.[agent.id] ?? 0;
    const unreadDot = unread > 0
      ? `<span class="role-badge" style="background:var(--pink);color:white;">${unread} new</span>`
      : '';
    return `
      <div class="profile-menu-item" data-id="${agent.id}">
        ${avatarHtml(agent, 'avatar-md')}
        <div class="meta">
          <div class="name">${escapeHtml(agent.name)} ${badge} ${unreadDot}</div>
          <div class="email">${escapeHtml(agent.email ?? '')}</div>
        </div>
        ${check}
      </div>
    `;
  }).join('');
}

export function toggleProfileMenu(e) {
  if (e) e.stopPropagation();
  document.getElementById('profile-menu').classList.toggle('open');
}
export function closeProfileMenu() {
  document.getElementById('profile-menu').classList.remove('open');
}
