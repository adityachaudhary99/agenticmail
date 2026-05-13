// Agent identity + avatar helpers.
//
// The bridge agent (default name "claudecode") is the host's identity
// inside AgenticMail. We render it with a stylised Claude-asterisk
// mark and a green verified-tick so the host inbox is recognisable at
// a glance vs. teammate sub-agents.
//
// We deliberately do NOT embed Anthropic's actual trademarked Claude
// logo here — reproducing it pixel-for-pixel in third-party software
// has licensing implications. The stylised approximation conveys
// the same identity cue without the trademark concern.
import { escapeHtml } from './utils.js';
import { icon } from './icons.js';

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

const CLAUDE_MARK_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
  <path d="M12 1.5 L13.2 8.6 L19.5 6.6 L15 12 L19.5 17.4 L13.2 15.4 L12 22.5 L10.8 15.4 L4.5 17.4 L9 12 L4.5 6.6 L10.8 8.6 Z"/>
</svg>`;

export function avatarHtml(agent, size = '') {
  const cls = `avatar ${size}`.trim();
  if (isBridgeAgent(agent)) {
    return `<span class="${cls} avatar-host">${CLAUDE_MARK_SVG}<span class="avatar-check">${icon('check', { size: 10 })}</span></span>`;
  }
  const initial = (agent.name ?? '?').slice(0, 1).toUpperCase();
  const color = avatarColorFor(agent.name ?? '');
  return `<span class="${cls}" style="background:${color}">${escapeHtml(initial)}</span>`;
}
