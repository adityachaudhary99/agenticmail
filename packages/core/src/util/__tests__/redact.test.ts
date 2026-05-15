import { describe, it, expect } from 'vitest';
import { redactSecret, redactObject, REDACTED } from '../redact.js';

describe('redactSecret', () => {
  it('preserves the mk_ prefix for master keys', () => {
    expect(redactSecret('mk_abc123def456')).toBe('mk_***');
  });

  it('preserves the ak_ prefix for agent API keys', () => {
    expect(redactSecret('ak_xyz789abc')).toBe('ak_***');
  });

  it('preserves the sk- prefix for OpenAI-style keys', () => {
    expect(redactSecret('sk-abcdef')).toBe('sk-***');
  });

  it('collapses unknown-prefix strings to bare ***', () => {
    expect(redactSecret('totally-some-secret')).toBe(REDACTED);
  });

  it('returns *** for empty string', () => {
    expect(redactSecret('')).toBe(REDACTED);
  });

  it('returns *** for non-string input', () => {
    expect(redactSecret(undefined)).toBe(REDACTED);
    expect(redactSecret(42)).toBe(REDACTED);
    expect(redactSecret(null)).toBe(REDACTED);
  });
});

describe('redactObject', () => {
  it('redacts every key matching the sensitive list', () => {
    const out = redactObject({
      apiKey: 'ak_abc',
      masterKey: 'mk_xyz',
      password: 'hunter2',
      authToken: 'tok_xx',
      authorization: 'Bearer abc',
      name: 'fola',  // not redacted — public
    });
    expect(out.apiKey).toBe('ak_***');
    expect(out.masterKey).toBe('mk_***');
    expect(out.password).toBe(REDACTED);
    // `tok_xx` keeps its prefix per the known-prefix list — useful for
    // diagnostic context, the secret material is still hidden.
    expect(out.authToken).toBe('tok_***');
    expect(out.authorization).toBe(REDACTED);
    expect(out.name).toBe('fola');
  });

  it('recurses into nested config objects', () => {
    const out = redactObject({
      api: { url: 'http://localhost', masterKey: 'mk_xxx' },
      stalwart: { adminPassword: 'h2', url: 'http://localhost:8080' },
    });
    expect(out.api.masterKey).toBe('mk_***');
    expect(out.api.url).toBe('http://localhost');
    expect(out.stalwart.adminPassword).toBe(REDACTED);
    expect(out.stalwart.url).toBe('http://localhost:8080');
  });

  it('redacts strings inside an MCP-server env block', () => {
    const out = redactObject({
      command: 'agenticmail-mcp',
      env: {
        AGENTICMAIL_API_KEY: 'ak_xxx',
        AGENTICMAIL_MASTER_KEY: 'mk_yyy',
        AGENTICMAIL_API_URL: 'http://127.0.0.1:3829',
      },
    });
    expect(out.env.AGENTICMAIL_API_KEY).toBe('ak_***');
    expect(out.env.AGENTICMAIL_MASTER_KEY).toBe('mk_***');
    expect(out.env.AGENTICMAIL_API_URL).toBe('http://127.0.0.1:3829');
  });

  it('walks arrays', () => {
    const out = redactObject([{ apiKey: 'ak_a' }, { apiKey: 'ak_b' }]);
    expect(out[0].apiKey).toBe('ak_***');
    expect(out[1].apiKey).toBe('ak_***');
  });

  it('leaves non-plain objects (Date, Error) alone', () => {
    const d = new Date();
    const out = redactObject({ when: d, name: 'x' });
    expect(out.when).toBe(d);  // reference equality
    expect(out.name).toBe('x');
  });

  it('does not mutate the original object', () => {
    const original = { apiKey: 'ak_abc', name: 'fola' };
    redactObject(original);
    expect(original.apiKey).toBe('ak_abc');
  });

  it('caps recursion depth (no infinite loop on accidental cycles)', () => {
    const a: any = { apiKey: 'ak_x' };
    // not a cycle, but a deep chain — should not throw
    let cur = a;
    for (let i = 0; i < 25; i++) { cur.next = { apiKey: 'ak_x' }; cur = cur.next; }
    const out = redactObject(a);
    expect(out.apiKey).toBe('ak_***');
  });
});
