// Small, sufficient markdown renderer for agent emails. Handles
// headings, lists (incl. tasks), tables, code fences, blockquotes,
// links/auto-links, and inline emphasis. Inputs are HTML-escaped
// before re-introducing safe tags, so this is XSS-safe.
import { escapeHtml } from './utils.js';

export function renderMarkdown(src) {
  if (!src) return '<div class="empty">(no body)</div>';
  const lines = src.split('\n');
  let out = '';
  let codeFence = false;
  let codeBuf = [];
  let listBuf = null;
  let blockquoteDepth = 0;
  function flushList() {
    if (!listBuf) return;
    out += `<${listBuf.type}>${listBuf.items.map(i => `<li>${i}</li>`).join('')}</${listBuf.type}>`;
    listBuf = null;
  }
  function setBlockquote(depth) {
    while (blockquoteDepth < depth) { out += '<blockquote>'; blockquoteDepth++; }
    while (blockquoteDepth > depth) { out += '</blockquote>'; blockquoteDepth--; }
  }
  for (const rawLine of lines) {
    const fence = rawLine.match(/^\s*```([\w+-]*)\s*$/);
    if (fence) {
      if (codeFence) {
        out += `<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`;
        codeBuf = []; codeFence = false;
      } else {
        flushList();
        codeFence = true;
      }
      continue;
    }
    if (codeFence) { codeBuf.push(rawLine); continue; }
    let line = rawLine, depth = 0;
    while (/^>/.test(line)) { depth++; line = line.replace(/^>\s?/, ''); }
    if (depth !== blockquoteDepth) { flushList(); setBlockquote(depth); }
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flushList();
      const level = Math.min(heading[1].length, 6);
      out += `<h${level}>${inlineMd(heading[2])}</h${level}>`;
      continue;
    }
    if (/^\s*(?:-{3,}|_{3,}|\*{3,})\s*$/.test(line)) { flushList(); out += '<hr>'; continue; }
    const task = line.match(/^(\s*)([-*+])\s+\[([ xX])\]\s+(.*)$/);
    if (task) {
      const checked = task[3] !== ' ';
      const item = `<input type="checkbox" disabled ${checked ? 'checked' : ''}> ${inlineMd(task[4])}`;
      if (!listBuf || listBuf.type !== 'ul') { flushList(); listBuf = { type: 'ul', items: [] }; }
      listBuf.items.push(item);
      continue;
    }
    const bullet = line.match(/^(\s*)([-*+])\s+(.*)$/);
    if (bullet) {
      if (!listBuf || listBuf.type !== 'ul') { flushList(); listBuf = { type: 'ul', items: [] }; }
      listBuf.items.push(inlineMd(bullet[3]));
      continue;
    }
    const numbered = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
    if (numbered) {
      if (!listBuf || listBuf.type !== 'ol') { flushList(); listBuf = { type: 'ol', items: [] }; }
      listBuf.items.push(inlineMd(numbered[3]));
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushList();
      const cells = line.trim().slice(1, -1).split('|').map(c => inlineMd(c.trim()));
      if (/^\s*\|?(\s*:?-{3,}:?\s*\|)+/.test(line)) continue;
      out += `<table><tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr></table>`;
      continue;
    }
    if (line.trim() === '') { flushList(); out += '<br>'; continue; }
    flushList();
    out += `<div>${inlineMd(line)}</div>`;
  }
  flushList();
  setBlockquote(0);
  return out;
}

function inlineMd(text) {
  let s = escapeHtml(text);
  s = s.replace(/`([^`\n]+)`/g, (_, c) => `<code>${c}</code>`);
  s = s.replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/___([^_\n]+)___/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^\w*])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w_])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/&lt;(https?:\/\/[^&\s]+)&gt;/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  return s;
}
