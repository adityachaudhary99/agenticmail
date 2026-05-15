// Agent identity + avatar helpers.
//
// Each host integration (Claude Code, Codex, …) gets its own branded
// avatar in the web UI so multiple co-installed bridges can be told
// apart at a glance. The HOST_BRANDING table below registers one entry
// per known host integration. Adding a new host = add one row + drop
// the SVG into /branding/.
import { escapeHtml } from './utils.js';
import { icon } from './icons.js';

/**
 * Registry of host integrations → branding.
 *
 *   key            metadata.host value (lowercased)
 *   logoUrl        path under /branding/, served as a static asset
 *   altText        alt= text on the <img>
 *   aliases        legacy / alternate names that should map to this host
 *                  (some bridges historically used the host's product
 *                  name instead of the host id)
 *
 * The lookup picks an entry by, in order:
 *   1. agent.metadata.host
 *   2. agent.name (so a bridge with name 'codex' but no metadata.host
 *      still renders correctly during the upgrade window)
 *   3. any alias listed under a host
 */
const HOST_BRANDING = {
  claudecode: {
    logoUrl: '/branding/claude-color.svg',
    altText: 'Claude',
    aliases: ['claude'],
  },
  codex: {
    logoUrl: '/branding/openai-mark.svg',
    altText: 'OpenAI Codex',
    aliases: ['openai', 'chatgpt'],
  },
};

// Fallback when we know an account is a bridge but can't identify which
// host owns it (legacy account with no host tag, unknown host name).
// Better than mis-attributing — a generic host badge plus a verified
// tick still reads as "this is a host, not a teammate".
const GENERIC_HOST_LOGO = '/branding/agenticmail-logo.png';

export function isBridgeAgent(agent) {
  if (!agent) return false;
  const name = (agent.name ?? '').toLowerCase();
  const role = (agent.role ?? '').toLowerCase();
  const meta = agent.metadata ?? {};
  if (role === 'bridge') return true;
  if (meta && meta.bridge === true) return true;
  // Name-based fallback for pre-0.9.3 bridges that still use role='assistant'.
  if (HOST_BRANDING[name]) return true;
  for (const entry of Object.values(HOST_BRANDING)) {
    if (entry.aliases?.includes(name)) return true;
  }
  return false;
}

/**
 * Resolve the host branding entry for an agent. Returns null when the
 * agent isn't a bridge or can't be matched to a known host.
 */
function brandingFor(agent) {
  if (!agent) return null;
  const name = (agent.name ?? '').toLowerCase();
  const metaHost = (agent.metadata?.host ?? '').toString().toLowerCase();

  // 1. Trust the host tag first — it's the canonical source of truth.
  if (metaHost && HOST_BRANDING[metaHost]) return HOST_BRANDING[metaHost];

  // 2. Fall back to matching the bridge name itself.
  if (HOST_BRANDING[name]) return HOST_BRANDING[name];

  // 3. Check aliases (e.g. a bridge literally named 'claude').
  for (const entry of Object.values(HOST_BRANDING)) {
    if (entry.aliases?.includes(name)) return entry;
    if (entry.aliases?.includes(metaHost)) return entry;
  }
  return null;
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
    const brand = brandingFor(agent);
    const url = brand?.logoUrl ?? GENERIC_HOST_LOGO;
    const alt = brand?.altText ?? 'Host';
    return `<span class="${cls} avatar-host"><img src="${url}" alt="${escapeHtml(alt)}" class="avatar-img" /><span class="avatar-check">${icon('check', { size: 10 })}</span></span>`;
  }
  const initial = (agent.name ?? '?').slice(0, 1).toUpperCase();
  const color = avatarColorFor(agent.name ?? '');
  return `<span class="${cls}" style="background:${color}">${escapeHtml(initial)}</span>`;
}
