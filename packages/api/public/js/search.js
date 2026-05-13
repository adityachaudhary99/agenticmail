// Gmail-style search query parser + match predicate + visual highlighter.
//
//   "from:vesper"       → only mail from vesper
//   "subject:audit"     → only mail with "audit" in the subject
//   "audit from:vesper" → both must match
//   "build small game"  → free-text match across from + subject + preview
import { escapeHtml } from './utils.js';

export function parseSearch(query) {
  const filters = { from: '', subject: '', text: '' };
  const remaining = [];
  const tokenRe = /(\w+):("([^"]*)"|(\S+))|("([^"]*)"|(\S+))/g;
  let m;
  while ((m = tokenRe.exec(query)) !== null) {
    const op = m[1]?.toLowerCase();
    const opVal = (m[3] ?? m[4] ?? '').toLowerCase();
    const free = (m[6] ?? m[7] ?? '').toLowerCase();
    if (op === 'from') filters.from = opVal;
    else if (op === 'subject') filters.subject = opVal;
    else if (free) remaining.push(free);
  }
  filters.text = remaining.join(' ');
  return filters;
}

export function matchesSearch(msg, filters) {
  const fromAddr = (msg.from?.[0]?.address ?? '').toLowerCase();
  const fromName = (msg.from?.[0]?.name ?? '').toLowerCase();
  const subject = (msg.subject ?? '').toLowerCase();
  const preview = (msg.preview ?? '').toLowerCase();
  if (filters.from && !fromAddr.includes(filters.from) && !fromName.includes(filters.from)) return false;
  if (filters.subject && !subject.includes(filters.subject)) return false;
  if (filters.text) {
    const hay = `${fromAddr} ${fromName} ${subject} ${preview}`;
    if (!hay.includes(filters.text)) return false;
  }
  return true;
}

export function highlightTerm(text, term) {
  const safe = escapeHtml(text ?? '');
  if (!term) return safe;
  const escaped = term.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  return safe.replace(new RegExp(`(${escaped})`, 'ig'), '<mark class="search-hl">$1</mark>');
}
