// Tiny shared utilities: HTML escape, strip HTML, toast.
// Kept in their own module so view modules don't each redefine them.

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function stripHtml(s) {
  return (s ?? '').replace(/<[^>]*>/g, '');
}

export function toast(msg, error = false) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.toggle('error', error);
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2500);
}
