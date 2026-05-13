import { describe, it, expect } from 'vitest';
import { renderSubagentMarkdown, MANAGED_BY_MARKER } from '../subagent-template.js';
import type { AgenticMailAccount } from '../types.js';

const FOLA: AgenticMailAccount = {
  id: '06b312c0-dde7-4729-a83e-d3bdc6c87e3b',
  name: 'Fola',
  email: 'fola@localhost',
  apiKey: 'ak_test',
  role: 'secretary',
  metadata: { ownerName: 'Ope' },
};

describe('renderSubagentMarkdown', () => {
  it('opens with YAML frontmatter', () => {
    const md = renderSubagentMarkdown({ name: 'agenticmail-fola', agent: FOLA, mcpServerName: 'agenticmail' });
    expect(md.startsWith('---\n')).toBe(true);
    const close = md.indexOf('\n---\n', 4);
    expect(close).toBeGreaterThan(0);
  });

  it('embeds the managed-by marker in frontmatter', () => {
    const md = renderSubagentMarkdown({ name: 'agenticmail-fola', agent: FOLA, mcpServerName: 'agenticmail' });
    expect(md).toContain(MANAGED_BY_MARKER);
  });

  it('does NOT pin a tools: frontmatter whitelist (subagent inherits host toolset)', () => {
    // Earlier versions of the template pinned `tools:` to an MCP-only
    // whitelist so the subagent couldn't reach Read/Write/Bash/etc.
    // That was the wrong design — AgenticMail agents run under the
    // host's OAuth and need the full native toolset to actually do
    // delegated work (write files, run code, fetch URLs). Omitting
    // `tools:` from the frontmatter is what makes Claude Code grant
    // the subagent every tool the host has.
    const md = renderSubagentMarkdown({ name: 'agenticmail-fola', agent: FOLA, mcpServerName: 'agenticmail' });
    const lines = md.split('\n');
    const dashIdx: number[] = [];
    for (let i = 0; i < lines.length && dashIdx.length < 2; i++) {
      if (lines[i] === '---') dashIdx.push(i);
    }
    expect(dashIdx.length).toBe(2);
    const frontmatter = lines.slice(dashIdx[0] + 1, dashIdx[1]).join('\n');
    const toolsLine = frontmatter.split('\n').find(l => l.startsWith('tools:'));
    expect(toolsLine).toBeUndefined();
  });

  it('mentions request_tools and invoke in the body so the subagent knows how to reach unloaded tools', () => {
    const md = renderSubagentMarkdown({ name: 'agenticmail-fola', agent: FOLA, mcpServerName: 'agenticmail' });
    expect(md).toMatch(/request_tools/);
    expect(md).toMatch(/invoke/);
  });

  it('uses the supplied MCP server name when building example tool calls', () => {
    const md = renderSubagentMarkdown({ name: 'agenticmail-fola', agent: FOLA, mcpServerName: 'pony' });
    expect(md).toContain('mcp__pony__list_inbox');
    expect(md).toContain('mcp__pony__request_tools');
    expect(md).toContain('mcp__pony__invoke');
    expect(md).not.toContain('mcp__agenticmail__list_inbox');
  });

  it('instructs the subagent to pass _account on every call', () => {
    const md = renderSubagentMarkdown({ name: 'agenticmail-fola', agent: FOLA, mcpServerName: 'agenticmail' });
    expect(md).toMatch(/_account: "Fola"/);
    expect(md).toMatch(/MUST pass.*_account/i);
  });

  it('embodies the persona (does not pretend to be a relay)', () => {
    const md = renderSubagentMarkdown({ name: 'agenticmail-fola', agent: FOLA, mcpServerName: 'agenticmail' });
    expect(md).toMatch(/You are \*\*Fola\*\*/);
    // Old relay-style language should be gone.
    expect(md).not.toMatch(/return that text verbatim/);
    expect(md).not.toMatch(/thin bridge/);
  });

  it('encourages real work with native tools (do not just paste code into email)', () => {
    // Inverse of the old "forbids generic Claude Code tools" rule. The
    // subagent should be told to USE Read/Write/Edit/Bash for the actual
    // work and reserve email for coordination — pasting source code as
    // an email body and calling it shipped is exactly the anti-pattern
    // that motivated this change.
    const md = renderSubagentMarkdown({ name: 'agenticmail-fola', agent: FOLA, mcpServerName: 'agenticmail' });
    expect(md).toMatch(/Read.*Write.*Edit.*Bash/);
    expect(md).toMatch(/Do real work/i);
    // Old restrictive rule must be gone.
    expect(md).not.toMatch(/Do NOT use generic Claude Code tools/);
  });

  it('quotes description safely (no stray quotes)', () => {
    const trickyAgent = { ...FOLA, name: 'rude"agent', email: 'rude"agent@localhost' };
    const md = renderSubagentMarkdown({ name: 'agenticmail-rude', agent: trickyAgent, mcpServerName: 'agenticmail' });
    const fm = md.split('\n---')[0];
    // description must contain the escaped quote
    expect(fm).toMatch(/description: ".*\\".*"/);
  });

  it('declares the agent identity prominently in the body', () => {
    const md = renderSubagentMarkdown({ name: 'agenticmail-fola', agent: FOLA, mcpServerName: 'agenticmail' });
    expect(md).toContain('# You are Fola');
    expect(md).toContain('fola@localhost');
  });

  it('embeds the AgenticMail agent id in frontmatter as a comment', () => {
    const md = renderSubagentMarkdown({ name: 'agenticmail-fola', agent: FOLA, mcpServerName: 'agenticmail' });
    expect(md).toContain(FOLA.id);
  });
});
