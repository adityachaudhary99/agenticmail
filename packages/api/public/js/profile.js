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
    // Host-ownership badge — shows which LLM the agent rides on.
    // Populated by the MCP server's create_account from
    // AGENTICMAIL_MCP_HOST in the host install's MCP env block.
    // Bridges already show "Host" so we skip the extra chip there.
    const hostTag = !isBridgeAgent(agent) ? hostBadge(agent) : '';
    const check = selected ? `<span class="selected-check">${icon('check', { size: 20 })}</span>` : '';
    const unread = state.unread?.[agent.id] ?? 0;
    const unreadDot = unread > 0
      ? `<span class="role-badge" style="background:var(--pink);color:white;">${unread} new</span>`
      : '';
    return `
      <div class="profile-menu-item" data-id="${agent.id}">
        ${avatarHtml(agent, 'avatar-md')}
        <div class="meta">
          <div class="name">${escapeHtml(agent.name)} ${badge} ${hostTag} ${unreadDot}</div>
          <div class="email">${escapeHtml(agent.email ?? '')}</div>
        </div>
        ${check}
      </div>
    `;
  }).join('');
}

/**
 * Render a host-ownership badge for an agent. The host name comes from
 * `metadata.host` on the account. Three states:
 *
 *   - "Claude" (purple) — owned by the Claude Code dispatcher
 *   - "Codex" (orange) — owned by the OpenAI Codex dispatcher
 *   - "Unclaimed" (gray) — no host tag yet; legacy or pre-MCP-tagging.
 *     Both dispatchers (if both running) will wake on this account.
 *     User can claim with `agenticmail-<host> claim <name>`.
 *
 * Returns an empty string when metadata is genuinely absent and we
 * don't want to clutter the row (e.g. the bridge account itself,
 * which already shows "Host").
 */
function hostBadge(agent) {
  const meta = agent.metadata ?? {};
  const host = typeof meta.host === 'string' ? meta.host.toLowerCase() : '';
  if (host === 'claudecode' || host === 'claude') {
    return '<span class="role-badge role-badge-claude" title="Owned by the Claude Code dispatcher (runs on Anthropic via @anthropic-ai/claude-agent-sdk)">Claude</span>';
  }
  if (host === 'codex') {
    return '<span class="role-badge role-badge-codex" title="Owned by the OpenAI Codex dispatcher (runs on OpenAI via @openai/codex-sdk)">Codex</span>';
  }
  if (host) {
    // Unknown host (forward-compat with Grok / Hermes when they land).
    return `<span class="role-badge role-badge-host-other" title="Owned by the ${escapeHtml(host)} dispatcher">${escapeHtml(host)}</span>`;
  }
  // No host tag — surface the "unclaimed" state explicitly so the user
  // notices and runs `agenticmail-<host> claim` if they have multiple
  // dispatchers running.
  return '<span class="role-badge role-badge-unclaimed" title="No host owner — any dispatcher will wake on this account. Run `agenticmail-<host> claim <name>` to settle ownership.">Unclaimed</span>';
}

export function toggleProfileMenu(e) {
  if (e) e.stopPropagation();
  document.getElementById('profile-menu').classList.toggle('open');
}
export function closeProfileMenu() {
  document.getElementById('profile-menu').classList.remove('open');
}
