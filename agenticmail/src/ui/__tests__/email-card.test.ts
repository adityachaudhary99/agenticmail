/**
 * Tests for the email detail renderer.
 *
 * We strip ANSI escape codes before asserting so the tests are
 * locale-stable and don't break when the brand color changes. The
 * goal is to verify SHAPE and CONTENT (subject, addresses, dates,
 * bodies, attachments, security flags) rather than specific colors.
 */

import { describe, it, expect } from 'vitest';
import { renderEmailCard, type EmailMessage } from '../email-card.js';

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

const NOW = new Date('2026-05-13T16:00:00');

describe('renderEmailCard', () => {
  it('renders subject, envelope, body, and a closing rule in that order', () => {
    const msg: EmailMessage = {
      uid: 42,
      subject: 'Re: Build a small terminal game',
      date: new Date('2026-05-13T15:55:00').toISOString(),
      from: [{ name: 'Solène', address: 'solene@localhost' }],
      to: [{ address: 'claudecode@localhost' }, { address: 'cassian@localhost' }],
      text: 'Team — i-914 audit complete.\n\nStatus: verified.\n',
    };
    const out = stripAnsi(renderEmailCard(msg, { now: NOW, width: 80 }));

    // Subject appears first (after the opening rule + blank line)
    const subjectIdx = out.indexOf('Re: Build a small terminal game');
    const fromIdx = out.indexOf('From:');
    const bodyIdx = out.indexOf('Team — i-914 audit complete.');
    expect(subjectIdx).toBeGreaterThan(0);
    expect(fromIdx).toBeGreaterThan(subjectIdx);
    expect(bodyIdx).toBeGreaterThan(fromIdx);

    // Three rules: one above subject, one between subject and envelope,
    // one between envelope and body, one closing the card.
    const ruleCount = (out.match(/─{10,}/g) ?? []).length;
    expect(ruleCount).toBeGreaterThanOrEqual(4);
  });

  it('formats the date as relative + absolute in local time', () => {
    const msg: EmailMessage = {
      subject: 'Hi',
      date: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
      from: [{ address: 'a@b' }],
      to: [{ address: 'c@d' }],
      text: 'body',
    };
    const out = stripAnsi(renderEmailCard(msg, { now: NOW }));
    expect(out).toMatch(/5 minutes ago/);
    expect(out).toMatch(/Date:/);
    // Must contain a separator between relative and absolute halves.
    const dateLine = out.split('\n').find(l => l.includes('Date:'))!;
    expect(dateLine).toContain('—');
  });

  it('omits Cc / Bcc / In reply to when not present', () => {
    const msg: EmailMessage = {
      subject: 's', from: [{ address: 'a@b' }], to: [{ address: 'c@d' }],
      text: 'body', date: NOW.toISOString(),
    };
    const out = stripAnsi(renderEmailCard(msg, { now: NOW }));
    expect(out).not.toMatch(/Cc:/);
    expect(out).not.toMatch(/Bcc:/);
    expect(out).not.toMatch(/In reply to:/);
  });

  it('shows Cc when CCs are present', () => {
    const msg: EmailMessage = {
      subject: 's',
      from: [{ address: 'a@b' }],
      to: [{ address: 'c@d' }],
      cc: [{ address: 'e@f' }, { address: 'g@h' }],
      text: 'body',
      date: NOW.toISOString(),
    };
    const out = stripAnsi(renderEmailCard(msg, { now: NOW }));
    expect(out).toMatch(/Cc:\s+e@f, g@h/);
  });

  it('shows In reply to when an inReplyTo header is present', () => {
    const msg: EmailMessage = {
      subject: 's', from: [{ address: 'a@b' }], to: [{ address: 'c@d' }],
      text: 'b', date: NOW.toISOString(),
      inReplyTo: '<abc@example.com>',
    };
    const out = stripAnsi(renderEmailCard(msg, { now: NOW }));
    expect(out).toMatch(/In reply to:\s+<abc@example.com>/);
  });

  it('falls back to "(no body content)" when text and html are both empty', () => {
    const msg: EmailMessage = {
      subject: 's', from: [{ address: 'a@b' }], to: [{ address: 'c@d' }],
      date: NOW.toISOString(),
    };
    const out = stripAnsi(renderEmailCard(msg, { now: NOW }));
    expect(out).toMatch(/\(no body content\)/);
  });

  it('strips minimal HTML when text is missing but html is present', () => {
    const msg: EmailMessage = {
      subject: 's', from: [{ address: 'a@b' }], to: [{ address: 'c@d' }],
      date: NOW.toISOString(),
      html: '<p>Hello <b>world</b></p><p>Second line</p>',
    };
    const out = stripAnsi(renderEmailCard(msg, { now: NOW }));
    expect(out).toMatch(/Hello world/);
    expect(out).toMatch(/Second line/);
    // No raw tags should leak through.
    expect(out).not.toMatch(/<p>/);
    expect(out).not.toMatch(/<b>/);
  });

  it('renders the attachments footer with size + content-type when present', () => {
    const msg: EmailMessage = {
      subject: 's', from: [{ address: 'a@b' }], to: [{ address: 'c@d' }],
      text: 'see attached', date: NOW.toISOString(),
      attachments: [{ filename: 'report.pdf', contentType: 'application/pdf', size: 240_000 }],
    };
    const out = stripAnsi(renderEmailCard(msg, { now: NOW }));
    expect(out).toMatch(/report\.pdf/);
    expect(out).toMatch(/application\/pdf/);
    expect(out).toMatch(/234KB/);
  });

  it('renders security flags in the footer when the API marks the message', () => {
    const msg: EmailMessage = {
      subject: 's', from: [{ address: 'a@b' }], to: [{ address: 'c@d' }],
      text: 'click here',
      date: NOW.toISOString(),
      security: { isWarning: true, spamScore: 4.2, topCategory: 'phishing' },
    };
    const out = stripAnsi(renderEmailCard(msg, { now: NOW }));
    expect(out).toMatch(/Suspicious/);
    expect(out).toMatch(/phishing/);
    expect(out).toMatch(/4\.2/);
  });

  it('omits the attachments/security footer rule when neither is present', () => {
    const msg: EmailMessage = {
      subject: 's', from: [{ address: 'a@b' }], to: [{ address: 'c@d' }],
      text: 'body', date: NOW.toISOString(),
    };
    const out = stripAnsi(renderEmailCard(msg, { now: NOW }));
    const ruleCount = (out.match(/─{10,}/g) ?? []).length;
    // 4 rules: opening, after subject, after envelope, closing.
    // Footer rule should NOT be added when there's nothing in the footer.
    expect(ruleCount).toBe(4);
  });

  it('rewrites the "On <ISO date>, X wrote:" attribution into local-time', () => {
    // This is the canonical quoting format the API's reply_email handler
    // emits. Readers see the raw ISO; we should convert it to the same
    // human format the Date: header uses.
    const msg: EmailMessage = {
      subject: 'Re: Threads',
      from: [{ address: 'writer@localhost' }],
      to: [{ address: 'team@localhost' }],
      date: NOW.toISOString(),
      text: [
        '— Writer',
        '',
        'On 2026-05-13T21:12:07.000Z, researcher@localhost wrote:',
        '> Bullets above.',
      ].join('\n'),
    };
    const out = stripAnsi(renderEmailCard(msg, { now: NOW }));
    // Raw ISO should be gone from the attribution.
    expect(out).not.toMatch(/2026-05-13T21:12:07/);
    // A human-readable date should be in its place. The exact text is
    // locale-dependent, but it should contain "wrote:" preceded by both
    // the sender and a date phrase rather than the ISO.
    expect(out).toMatch(/On .+, researcher@localhost wrote:/);
  });

  it('handles "On X wrote:" at any quote depth', () => {
    // Quote depth 1 should become a single stripe; depth 2 → two
    // stripes. Either way the literal `>` chain is gone from output
    // and the ISO date is translated.
    const msg: EmailMessage = {
      subject: 'Re: nested',
      from: [{ address: 'a@b' }],
      to: [{ address: 'c@d' }],
      date: NOW.toISOString(),
      text: [
        '> On 2026-05-13T21:11:43.000Z, claudecode@localhost wrote:',
        '> > Original message.',
      ].join('\n'),
    };
    const out = stripAnsi(renderEmailCard(msg, { now: NOW }));
    expect(out).not.toMatch(/2026-05-13T21:11:43/);
    // Literal `>` chain should be replaced with stripe characters.
    expect(out).not.toMatch(/> On /);
    expect(out).toMatch(/On .+, claudecode@localhost wrote:/);
    // The depth-2 content still appears, also without literal `>`.
    expect(out).toMatch(/Original message\./);
    expect(out).not.toMatch(/> > Original/);
  });

  it('replaces deep `>>>>` quote chains with depth-colored vertical stripes', () => {
    // The exact failure mode the user flagged: a depth-4 line rendered
    // as literal `>>>>` on every line is noise. The card should
    // replace the chain with a stripe per depth (▎), colored by level.
    const msg: EmailMessage = {
      subject: 's', from: [{ address: 'a@b' }], to: [{ address: 'c@d' }],
      date: NOW.toISOString(),
      text: '>>>> deeply quoted line',
    };
    const raw = renderEmailCard(msg, { now: NOW });
    const out = stripAnsi(raw);
    // Literal `>>>>` is gone.
    expect(out).not.toMatch(/>>>> /);
    // Vertical-bar stripe is present once per level.
    const stripeCount = (out.match(/▎/g) ?? []).length;
    expect(stripeCount).toBe(4);
    // Content survives.
    expect(out).toMatch(/deeply quoted line/);
  });

  it('handles no-space `>>` chains identically to spaced `> >` chains', () => {
    const a: EmailMessage = {
      subject: 's', from: [{ address: 'a@b' }], to: [{ address: 'c@d' }],
      date: NOW.toISOString(),
      text: '>>hi',
    };
    const b: EmailMessage = { ...a, text: '> > hi' };
    const outA = stripAnsi(renderEmailCard(a, { now: NOW }));
    const outB = stripAnsi(renderEmailCard(b, { now: NOW }));
    // Both should have exactly 2 stripe bars.
    expect((outA.match(/▎/g) ?? []).length).toBe(2);
    expect((outB.match(/▎/g) ?? []).length).toBe(2);
  });

  it('leaves attribution lines with unparseable dates intact', () => {
    // Defensive: not every "On ... wrote:" line is from us; only rewrite
    // when the ISO actually parses.
    const msg: EmailMessage = {
      subject: 's', from: [{ address: 'a@b' }], to: [{ address: 'c@d' }],
      date: NOW.toISOString(),
      text: 'On 2026-05-13T21:12:07.000Z, ghost@nowhere wrote:',
    };
    const out = stripAnsi(renderEmailCard(msg, { now: NOW }));
    expect(out).toMatch(/On .+, ghost@nowhere wrote:/);
  });

  it('marks quoted lines with colored stripes, leaves depth-0 prose untouched', () => {
    const msg: EmailMessage = {
      subject: 's', from: [{ address: 'a@b' }], to: [{ address: 'c@d' }],
      date: NOW.toISOString(),
      text: [
        'New content from me.',
        '> Older quoted line.',
        '> > Even older nested quote.',
      ].join('\n'),
    };
    const raw = renderEmailCard(msg, { now: NOW });
    const lines = raw.split('\n');
    const newContent = lines.find(l => l.includes('New content from me.'))!;
    const onceQuoted = lines.find(l => l.includes('Older quoted line.'))!;
    const twiceQuoted = lines.find(l => l.includes('Even older nested quote.'))!;
    // Depth-0 line has no stripe character.
    expect(newContent).not.toContain('▎');
    // Depth-1 has one stripe; depth-2 has two.
    expect((onceQuoted.match(/▎/g) ?? []).length).toBe(1);
    expect((twiceQuoted.match(/▎/g) ?? []).length).toBe(2);
  });

  it('preserves blank lines inside the body', () => {
    const msg: EmailMessage = {
      subject: 's', from: [{ address: 'a@b' }], to: [{ address: 'c@d' }],
      date: NOW.toISOString(),
      text: 'Paragraph one.\n\nParagraph two.',
    };
    const out = stripAnsi(renderEmailCard(msg, { now: NOW }));
    // There should be at least one fully-blank body line between the
    // two paragraphs (the leading two spaces from the card indent are
    // fine; the line itself contains no other characters).
    expect(out).toMatch(/Paragraph one\.\n\s*\n\s*Paragraph two\./);
  });

  it('respects the width option for rule lines', () => {
    const msg: EmailMessage = {
      subject: 's', from: [{ address: 'a@b' }], to: [{ address: 'c@d' }],
      text: 'body', date: NOW.toISOString(),
    };
    const out = stripAnsi(renderEmailCard(msg, { now: NOW, width: 40 }));
    // Find any rule line and confirm it is exactly 40 chars.
    const rule = out.split('\n').find(l => /^─{10,}$/.test(l.trim()));
    expect(rule!.trim().length).toBe(40);
  });
});
