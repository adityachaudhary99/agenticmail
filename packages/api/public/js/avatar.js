// Agent identity + avatar helpers.
//
// The bridge agent (default name "claudecode") is the host's identity
// inside AgenticMail. We render it with the OFFICIAL Claude starburst
// mark (sourced from the public Wikipedia SVG, served as a static
// asset under /branding/claude-mark.svg) and a green verified-tick so
// the host inbox is recognisable at a glance vs. teammate sub-agents.
import { escapeHtml } from './utils.js';
import { icon } from './icons.js';

// Official Claude mark, served as a static asset under /branding/.
// Using <img src=...> rather than inlining the path keeps the SVG
// out of every avatar render and lets the browser cache the asset.
const CLAUDE_MARK_URL = '/branding/claude-mark.svg';

export function isBridgeAgent(agent) {
  if (!agent) return false;
  const name = (agent.name ?? '').toLowerCase();
  const role = (agent.role ?? '').toLowerCase();
  return name === 'claudecode' || name === 'claude' || role === 'bridge';
}

// Deterministic colour per agent name — keeps teammate colours stable
// across sessions and reloads.
const AVATAR_PALETTE = [
  '#ec4899', '#8b5cf6', '#3b82f6', '#06b6d4',
  '#10b981', '#f59e0b', '#ef4444', '#84cc16',
];
function avatarColorFor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

export function avatarHtml(agent, size = '') {
  const cls = `avatar ${size}`.trim();
  if (isBridgeAgent(agent)) {
    return `<span class="${cls} avatar-host"><img src="${CLAUDE_MARK_URL}" alt="Claude" class="avatar-img" /><span class="avatar-check">${icon('check', { size: 10 })}</span></span>`;
  }
  const initial = (agent.name ?? '?').slice(0, 1).toUpperCase();
  const color = avatarColorFor(agent.name ?? '');
  return `<span class="${cls}" style="background:${color}">${escapeHtml(initial)}</span>`;
}
