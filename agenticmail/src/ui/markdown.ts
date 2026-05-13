/**
 * Terminal markdown renderer for email bodies.
 *
 * # Why this exists
 *
 * AgenticMail agents (and humans replying to them) write in markdown.
 * Plain-text terminal output of `**bold**`, `*italic*`, `` `code` ``,
 * fenced code blocks, headers, and bullet lists is ugly and hard to
 * scan. This module turns those markdown shapes into ANSI-styled text
 * the terminal can render cleanly.
 *
 * # What it covers
 *
 *   Inline:    **bold**, __bold__, *italic*, _italic_, `code`, ~~strike~~,
 *              [link](https://url), and the `<https://url>` auto-link form.
 *
 *   Block:     # / ## / ### headings, - / * / 1. lists, ```fenced code
 *              blocks```, horizontal rules (---), and indented blockquotes.
 *
 * # Compositional ANSI
 *
 * Inline helpers use **targeted resets** (`\x1b[22m`, `\x1b[23m`, etc.)
 * instead of the universal `\x1b[0m`. That way an outer wrapper (the
 * email card's quote-dim, for example) can wrap a line of mixed
 * markdown without one inner reset blowing away the outer style. The
 * trade-off is that very old terminals may render targeted resets as
 * full resets; on those the inner styles still look right, the outer
 * dim just stops at the first reset. Acceptable degradation.
 *
 * # Code blocks
 *
 * Fenced code blocks are stateful: a line of ``` toggles "inside code"
 * mode, and lines inside are not run through inline markdown. The
 * renderer returns an object with a `renderLine(line)` method so the
 * caller can stream the body line-by-line without losing the toggle.
 */

const ESC = '\x1b[';
const RESET = `${ESC}0m`;

// Targeted resets — see file header for why these aren't `\x1b[0m`.
const BOLD_OFF = `${ESC}22m`;
const ITALIC_OFF = `${ESC}23m`;
const STRIKE_OFF = `${ESC}29m`;
const FG_OFF = `${ESC}39m`;
const BG_OFF = `${ESC}49m`;

/** Inline ANSI wrappers used by both inline and block renderers. */
const md = {
  bold: (s: string) => `${ESC}1m${s}${BOLD_OFF}`,
  italic: (s: string) => `${ESC}3m${s}${ITALIC_OFF}`,
  // Bold + italic combo for ***text*** — apply both, reset both targeted.
  boldItalic: (s: string) => `${ESC}1m${ESC}3m${s}${ITALIC_OFF}${BOLD_OFF}`,
  strike: (s: string) => `${ESC}9m${s}${STRIKE_OFF}`,
  dim: (s: string) => `${ESC}2m${s}${ESC}22m`,
  underline: (s: string) => `${ESC}4m${s}${ESC}24m`,
  // Inline code: subtle dark background + orange foreground, surrounded
  // by thin-space padding so it visually pops as a token.
  code: (s: string) => `${ESC}48;5;236m${ESC}38;5;208m ${s} ${BG_OFF}${FG_OFF}`,
  // Block code: cyan foreground, no background — keeps multi-line
  // indentation legible and doesn't paint the whole screen on long
  // snippets the way a background would.
  blockCode: (s: string) => `${ESC}38;5;39m${s}${FG_OFF}`,
  // Headings: brand pink, bold. We use the same `38;5;205` we use for
  // the project logo so the whole shell stays on one accent color.
  heading: (s: string) => `${ESC}1m${ESC}38;5;205m${s}${FG_OFF}${BOLD_OFF}`,
  // Highlight: yellow background. Used for ==text== (GFM-ish).
  highlight: (s: string) => `${ESC}48;5;226m${ESC}30m${s}${BG_OFF}${FG_OFF}`,
  // Link URL: dim parens. The visible text stays at normal weight so
  // the eye still reads it as link copy.
  link: (text: string, url: string) => `${text} ${md.dim('(' + url + ')')}`,
};

/**
 * Decode the small set of HTML entities that show up in mixed
 * markdown/HTML mail bodies. Doing this here keeps `&amp;` from
 * leaking through into the terminal as literal `&amp;`.
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&hellip;/g, '…')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–');
}

/**
 * Render the inline markdown shapes on a single line.
 *
 * Order matters:
 *   1. Inline code first — its contents must NOT be touched by any
 *      other replace (so backticked `**stars**` stays literal).
 *   2. Bold (**) before italic (*) — both use `*`, and a greedy italic
 *      regex would chew up the bold markers.
 *   3. The bold-underscore form (__) before italic-underscore (_).
 *   4. Strikethrough (~~).
 *   5. Links: explicit [text](url) form, then auto-links <https://...>.
 *
 * We mask code spans with sentinel tokens before running the other
 * passes so the markdown grammar inside them never fires.
 */
export function renderInlineMarkdown(text: string): string {
  // Decode common HTML entities before any other pass so `&amp;` does
  // not leak through and so `&lt;` does not get caught by the auto-link
  // grammar as `<https://...>`.
  let masked = decodeEntities(text);

  // Pull out inline code spans so their contents are inert.
  const codeSpans: string[] = [];
  masked = masked.replace(/`([^`\n]+)`/g, (_match, code) => {
    codeSpans.push(code);
    return `\u0000CODE${codeSpans.length - 1}\u0000`;
  });

  // Bold + italic combo: ***text*** or ___text___. Must come BEFORE
  // plain bold so the triple markers don't get half-consumed.
  masked = masked.replace(/\*\*\*([^*\n]+)\*\*\*/g, (_m, s: string) => md.boldItalic(s));
  masked = masked.replace(/___([^_\n]+)___/g, (_m, s: string) => md.boldItalic(s));

  // Bold next (longer marker wins over italic).
  masked = masked.replace(/\*\*([^*\n]+)\*\*/g, (_m, s: string) => md.bold(s));
  masked = masked.replace(/__([^_\n]+)__/g, (_m, s: string) => md.bold(s));

  // Italic: only when the markers aren't pressed up against a word
  // character on the outside. `foo*bar*baz` stays plain; `foo *bar* baz`
  // renders bar italic.
  masked = masked.replace(/(^|[^\w*])\*([^*\n]+)\*(?!\w)/g, (_m, lead: string, s: string) => `${lead}${md.italic(s)}`);
  masked = masked.replace(/(^|[^\w_])_([^_\n]+)_(?!\w)/g, (_m, lead: string, s: string) => `${lead}${md.italic(s)}`);

  // Strikethrough.
  masked = masked.replace(/~~([^~\n]+)~~/g, (_m, s: string) => md.strike(s));

  // GFM-style highlight: ==text==. Yellow background.
  masked = masked.replace(/==([^=\n]+)==/g, (_m, s: string) => md.highlight(s));

  // Images: ![alt](url) → [🖼 alt] (url). Terminals can't render
  // images, so we surface the alt text and dim the URL.
  masked = masked.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (_m, alt: string, u: string) => {
    const label = alt ? `🖼 ${alt}` : '🖼 image';
    return `[${label}] ${md.dim('(' + u + ')')}`;
  });

  // Explicit links: [text](url). Comes after the image pattern so we
  // don't double-match on `![alt](url)`. Comes before auto-links so
  // the URL inside the parens does not also get auto-linked.
  masked = masked.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, t: string, u: string) => md.link(t, u));

  // Bare auto-link inside angle brackets: <https://...>.
  masked = masked.replace(/<(https?:\/\/[^>\s]+)>/g, (_m, u: string) => md.dim(u));

  // Restore code spans.
  masked = masked.replace(/\u0000CODE(\d+)\u0000/g, (_m, idx: string) => md.code(codeSpans[Number(idx)] ?? ''));

  return masked;
}

/**
 * Stateful line-by-line renderer. The state lives in the object the
 * factory returns so the caller can stream lines from the email body
 * without losing the open/close state of a fenced code block.
 *
 * Usage:
 *   const r = createMarkdownLineRenderer();
 *   for (const line of body.split('\n')) {
 *     console.log(r.renderLine(line));
 *   }
 */
export interface MarkdownLineRenderer {
  /**
   * Render one body line and return its terminal-styled form. Maintains
   * fenced-code-block state across calls.
   */
  renderLine(line: string): string;
}

/**
 * A GFM-style table needs at least two consecutive lines to identify:
 *
 *   | col a | col b |
 *   | --- | --- |
 *   | val | val |
 *
 * Our streaming renderer can't easily look two lines ahead, but the
 * separator line itself is unmistakable — `| --- | --- |` with only
 * dashes, colons, pipes, and whitespace. So we recognise the separator
 * line specifically (rendered as a dim divider) and let the data rows
 * fall through to a generic `|`-prefixed render (cyan pipes, plain
 * cells). This is "good enough" for terminal — agents who care about
 * perfect tables can paste them as code blocks.
 */
const TABLE_SEPARATOR_RE = /^\s*\|?(\s*:?-{3,}:?\s*\|)+(\s*:?-{3,}:?\s*)?\s*$/;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;

export function createMarkdownLineRenderer(): MarkdownLineRenderer {
  let inCodeBlock = false;
  let inIndentedCode = false;
  // Buffer the previous line so we can detect Setext headings on the
  // fly: any line followed by an all-= or all-- line is a heading.
  // We render lazily — the buffered line is emitted next time renderLine
  // is called (or implicitly when the body finishes; we accept that the
  // very last line of the body won't be detected as setext, which is a
  // rare edge case in mail).
  return {
    renderLine(line: string): string {
      // Fenced code block toggle: ``` (possibly with a language tag).
      const fence = line.match(/^\s*```([\w+-]*)\s*$/);
      if (fence) {
        // Don't render the fence line itself — return a small dim
        // header that signals "code block" without taking visual space.
        inCodeBlock = !inCodeBlock;
        return md.dim(fence[1] ? `▾ ${fence[1]}` : '▾ code');
      }

      // Inside a fence: cyan, untouched by other markdown rules.
      if (inCodeBlock) {
        return md.blockCode(line);
      }

      // Indented code block: a line of at least 4 leading spaces (or a
      // tab) that is NOT part of a list item (those have their own
      // indentation). We detect indented code only when the line is
      // also not a bullet/numbered marker.
      if (/^( {4,}|\t)/.test(line) && !/^(?:\s{4,}|\t)(?:[-*+]|\d+[.)])\s/.test(line)) {
        // Toggle into indented-code mode on first hit. Pure-blank lines
        // don't break the block (matches CommonMark).
        inIndentedCode = true;
        return md.blockCode(line.replace(/^( {4}|\t)/, ''));
      }
      // Any non-empty non-indented line closes the indented block.
      if (inIndentedCode && line.trim() !== '') {
        inIndentedCode = false;
      }

      // GFM-style table separator: render as a dim horizontal rule
      // confined to the row width so we don't span a full 80 cols.
      if (TABLE_SEPARATOR_RE.test(line) && line.includes('|')) {
        // Approximate: replace every dash run with `─`, every `|` with
        // a dim pipe. Keeps column alignment from the original.
        const rendered = line
          .replace(/-{3,}/g, m => '─'.repeat(m.length))
          .replace(/\|/g, md.dim('│'))
          .replace(/:/g, md.dim(':'));
        return rendered;
      }

      // Data row of a GFM table: cyan pipes, plain cells (with inline
      // markdown applied per cell).
      if (TABLE_ROW_RE.test(line)) {
        const cells = line.trim().slice(1, -1).split('|').map(c => renderInlineMarkdown(c.trim()));
        return `${md.dim('│')} ${cells.join(` ${md.dim('│')} `)} ${md.dim('│')}`;
      }

      // Horizontal rule: a line containing only ---, ___, or ***.
      if (/^\s*(?:-{3,}|_{3,}|\*{3,})\s*$/.test(line)) {
        return md.dim('─'.repeat(40));
      }

      // Heading: # / ## / ### / #### / ##### / ######.
      const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (heading) {
        const level = heading[1].length;
        const text = renderInlineMarkdown(heading[2]);
        // Visual scale: bigger header → bolder + more accent. We don't
        // try to mimic font size with characters; just a clean line.
        if (level === 1) return md.heading(`▌ ${text}`);
        if (level === 2) return md.heading(`▌ ${text}`);
        return md.heading(text);
      }

      // Task list: `- [ ] task` or `- [x] task`. Comes BEFORE the
      // plain bullet pattern so the `[ ]` doesn't get treated as a
      // literal cell of body content.
      const task = line.match(/^(\s*)([-*+])\s+\[([ xX])\]\s+(.*)$/);
      if (task) {
        const indent = task[1];
        const checked = task[3] !== ' ';
        const content = renderInlineMarkdown(task[4]);
        const box = checked ? md.dim('☑') : '☐';
        // Strikethrough completed items so the eye sees progress at a glance.
        return checked
          ? `${indent}${box} ${md.dim(md.strike(content))}`
          : `${indent}${box} ${content}`;
      }

      // Bullet list: -, *, or + at the start of a line (after optional
      // whitespace for nesting). Replace the marker with a real bullet.
      const bullet = line.match(/^(\s*)([-*+])\s+(.*)$/);
      if (bullet) {
        const indent = bullet[1];
        const content = renderInlineMarkdown(bullet[3]);
        return `${indent}${md.dim('•')} ${content}`;
      }

      // Numbered list: keep the number but render with a tight ANSI dot.
      const numbered = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
      if (numbered) {
        const indent = numbered[1];
        const num = numbered[2];
        const content = renderInlineMarkdown(numbered[3]);
        return `${indent}${md.dim(num + '.')} ${content}`;
      }

      // Everything else — inline-render whatever shapes are on the line.
      return renderInlineMarkdown(line);
    },
  };
}

/**
 * Convenience: render a whole markdown body at once. Splits on `\n`,
 * runs each line through a fresh stateful renderer, joins with `\n`.
 *
 * Use the stateful renderer instead when the caller is already
 * iterating line-by-line for other reasons (the email card's
 * quote-depth path does that).
 */
export function renderMarkdownBody(body: string): string {
  const r = createMarkdownLineRenderer();
  return body.split('\n').map(line => r.renderLine(line)).join('\n');
}

// --- For tests / external composition: re-export the bare ANSI helpers
//     so other modules don't have to redeclare them. -------------------
export const _ansi = { RESET, ESC };
