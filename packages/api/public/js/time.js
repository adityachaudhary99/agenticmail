// Gmail-style relative date formatting.
//
// formatDate     → short label for list rows (e.g. "10:42 AM", "Mon", "Mar 4")
// formatDateFull → verbose label for the open-message header

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const days = Math.round((now - d) / (24 * 3600 * 1000));
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateFull(iso) {
  if (!iso) return '';
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const deltaMs = now - d;
  let rel = '';
  if (deltaMs < 45_000) rel = 'just now';
  else if (deltaMs < 60 * 60 * 1000) rel = `${Math.round(deltaMs / 60_000)} minutes ago`;
  else if (deltaMs < 24 * 60 * 60 * 1000) rel = `${Math.round(deltaMs / 3_600_000)} hours ago`;
  const abs = d.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
  return rel ? `${rel} — ${abs}` : abs;
}
