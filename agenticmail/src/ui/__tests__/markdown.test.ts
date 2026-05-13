/**
 * Tests for the terminal markdown renderer.
 *
 * We strip ANSI codes for content assertions, but keep them in a few
 * place-of-occurrence checks (the ones that prove a style was actually
 * applied). Targeted resets (`\x1b[22m`, etc.) matter for nesting; the
 * fenced-code-block toggle matters for streaming bodies.
 */

import { describe, it, expect } from 'vitest';
import {
  renderInlineMarkdown,
  renderMarkdownBody,
  createMarkdownLineRenderer,
} from '../markdown.js';

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');
const hasAnsi = (s: string, code: string): boolean => s.includes(`\x1b[${code}m`);

describe('renderInlineMarkdown', () => {
  it('renders **bold**', () => {
    const out = renderInlineMarkdown('Status: **verified — no bugs**.');
    expect(stripAnsi(out)).toBe('Status: verified — no bugs.');
    expect(hasAnsi(out, '1')).toBe(true); // bold on
    expect(hasAnsi(out, '22')).toBe(true); // bold-targeted reset
  });

  it('renders __bold__ underscores too', () => {
    const out = renderInlineMarkdown('__important__ change');
    expect(stripAnsi(out)).toBe('important change');
    expect(hasAnsi(out, '1')).toBe(true);
  });

  it('renders *italic* and _italic_', () => {
    const star = renderInlineMarkdown('this *matters* now');
    const under = renderInlineMarkdown('this _matters_ now');
    expect(stripAnsi(star)).toBe('this matters now');
    expect(stripAnsi(under)).toBe('this matters now');
    expect(hasAnsi(star, '3')).toBe(true); // italic
    expect(hasAnsi(under, '3')).toBe(true);
  });

  it('does NOT render * inside words as italic (foo*bar*baz stays literal)', () => {
    const out = renderInlineMarkdown('foo*bar*baz');
    expect(stripAnsi(out)).toBe('foo*bar*baz');
    expect(hasAnsi(out, '3')).toBe(false);
  });

  it('renders `inline code`', () => {
    const out = renderInlineMarkdown('Ran `inspect-fields.sh` to dump widgets.');
    expect(stripAnsi(out)).toMatch(/Ran .*inspect-fields\.sh.* to dump widgets\./);
    expect(hasAnsi(out, '48;5;236')).toBe(true); // code background
  });

  it('keeps markdown grammar INSIDE inline code spans literal', () => {
    // The `**stars**` should NOT become bold — it's inside a code span.
    const out = renderInlineMarkdown('use `**stars**` for bold');
    expect(stripAnsi(out)).toMatch(/use .*\*\*stars\*\*.* for bold/);
    // Should NOT have a bold-on ANSI anywhere.
    expect(hasAnsi(out, '1')).toBe(false);
  });

  it('renders ~~strikethrough~~', () => {
    const out = renderInlineMarkdown('~~deprecated~~ new path');
    expect(stripAnsi(out)).toBe('deprecated new path');
    expect(hasAnsi(out, '9')).toBe(true); // strikethrough on
    expect(hasAnsi(out, '29')).toBe(true); // strike-targeted reset
  });

  it('renders [text](url) as "text (url)"', () => {
    const out = renderInlineMarkdown('See [docs](https://example.com/d) for more.');
    const plain = stripAnsi(out);
    expect(plain).toContain('docs');
    expect(plain).toContain('https://example.com/d');
    expect(plain).toMatch(/docs.+\(https:\/\/example\.com\/d\)/);
  });

  it('renders <https://url> auto-links as dimmed URLs', () => {
    const out = renderInlineMarkdown('Read <https://example.com/x> first.');
    expect(stripAnsi(out)).toContain('https://example.com/x');
    expect(hasAnsi(out, '2')).toBe(true); // dim
  });

  it('does not break on plain text without any markdown', () => {
    expect(renderInlineMarkdown('hello world')).toBe('hello world');
  });

  it('handles mixed inline shapes in one line', () => {
    const out = renderInlineMarkdown('**Bold** with *italic* and `code` and ~~strike~~.');
    const plain = stripAnsi(out);
    expect(plain).toBe('Bold with italic and  code  and strike.');
    // All four ANSI families should be present.
    expect(hasAnsi(out, '1')).toBe(true);     // bold
    expect(hasAnsi(out, '3')).toBe(true);     // italic
    expect(hasAnsi(out, '9')).toBe(true);     // strike
    expect(out).toMatch(/\x1b\[48;5;236m/);   // code bg
  });
});

describe('createMarkdownLineRenderer (block-level)', () => {
  it('renders # / ## / ### headings', () => {
    const r = createMarkdownLineRenderer();
    expect(stripAnsi(r.renderLine('# Top'))).toMatch(/Top/);
    expect(stripAnsi(r.renderLine('## Sub'))).toMatch(/Sub/);
    expect(stripAnsi(r.renderLine('### Detail'))).toMatch(/Detail/);
  });

  it('does NOT match `#` inside a sentence as a heading', () => {
    const r = createMarkdownLineRenderer();
    expect(stripAnsi(r.renderLine('this is rule #1'))).toBe('this is rule #1');
  });

  it('converts -, *, + bullet lists to a real bullet character', () => {
    const r = createMarkdownLineRenderer();
    expect(stripAnsi(r.renderLine('- first item'))).toMatch(/• first item/);
    expect(stripAnsi(r.renderLine('* second item'))).toMatch(/• second item/);
    expect(stripAnsi(r.renderLine('+ third item'))).toMatch(/• third item/);
  });

  it('preserves indentation in nested bullets', () => {
    const r = createMarkdownLineRenderer();
    const out = stripAnsi(r.renderLine('  - nested'));
    expect(out).toMatch(/^ {2}• nested$/);
  });

  it('preserves numbered list numbers', () => {
    const r = createMarkdownLineRenderer();
    expect(stripAnsi(r.renderLine('1. first'))).toMatch(/1\. first/);
    expect(stripAnsi(r.renderLine('42. answer'))).toMatch(/42\. answer/);
  });

  it('renders horizontal rules (---, ___, ***) as a divider line', () => {
    const r = createMarkdownLineRenderer();
    expect(stripAnsi(r.renderLine('---'))).toMatch(/^─{40}$/);
    expect(stripAnsi(r.renderLine('___'))).toMatch(/^─{40}$/);
    expect(stripAnsi(r.renderLine('***'))).toMatch(/^─{40}$/);
  });

  it('toggles fenced code blocks: content inside is NOT processed as markdown', () => {
    const r = createMarkdownLineRenderer();
    r.renderLine('```python');
    // Inside the fence — **bold** should stay literal, no ANSI bold.
    const inside = r.renderLine('print("**not bold**")');
    expect(stripAnsi(inside)).toBe('print("**not bold**")');
    expect(hasAnsi(inside, '1')).toBe(false);
    // Close the fence.
    r.renderLine('```');
    // After the fence — back to normal markdown.
    const after = r.renderLine('**bold**');
    expect(hasAnsi(after, '1')).toBe(true);
  });

  it('renders the fence opening with the language tag as a dim header', () => {
    const r = createMarkdownLineRenderer();
    const out = r.renderLine('```python');
    expect(stripAnsi(out)).toMatch(/python/);
    expect(hasAnsi(out, '2')).toBe(true); // dim
  });

  it('still processes inline markdown on a regular line', () => {
    const r = createMarkdownLineRenderer();
    const out = r.renderLine('**bold** and *italic*');
    expect(stripAnsi(out)).toBe('bold and italic');
    expect(hasAnsi(out, '1')).toBe(true);
    expect(hasAnsi(out, '3')).toBe(true);
  });
});

describe('renderMarkdownBody (whole-body convenience)', () => {
  it('renders a realistic agent email body cleanly', () => {
    const body = [
      '# Audit summary',
      '',
      '**Status: verified**',
      '',
      '- 0 missing fields',
      '- 0 wrong exports',
      '',
      'Ran `inspect-fields.sh`. See `[docs](https://example.com/doc)`.',
      '',
      '```bash',
      'echo "code"',
      '```',
      '',
      '— Researcher',
    ].join('\n');
    const out = renderMarkdownBody(body);
    const plain = stripAnsi(out);
    expect(plain).toContain('Audit summary');
    expect(plain).toContain('Status: verified');
    expect(plain).toMatch(/• 0 missing fields/);
    expect(plain).toMatch(/• 0 wrong exports/);
    expect(plain).toMatch(/inspect-fields\.sh/);
    expect(plain).toContain('echo "code"');
    // The fence lines themselves should be replaced by a dim header,
    // not by raw ``` markers.
    expect(plain).not.toContain('```');
  });
});
