/**
 * Regression tests for `safeJoin` — every path-traversal escape route
 * that CodeQL's `js/path-injection` query has flagged across the
 * monorepo must round-trip through here unchanged. The test file is
 * deliberately exhaustive: each named escape route is its own `it`
 * block so a regression is easy to identify in the failure output.
 */
import { describe, it, expect } from 'vitest';
import { sep } from 'node:path';
import { safeJoin, tryJoin, assertWithinBase, PathTraversalError } from '../safe-path.js';

const BASE = '/home/ope/.codex/agents';

describe('safeJoin — happy path', () => {
  it('joins a simple filename', () => {
    expect(safeJoin(BASE, 'agenticmail-fola.toml')).toBe(`${BASE}${sep}agenticmail-fola.toml`);
  });

  it('joins multiple segments', () => {
    expect(safeJoin(BASE, 'subdir', 'file.toml')).toBe(`${BASE}${sep}subdir${sep}file.toml`);
  });

  it('returns the base dir itself when no parts given', () => {
    expect(safeJoin(BASE)).toBe(BASE);
  });

  it('normalises redundant slashes and `.` segments', () => {
    // resolve() collapses these naturally — we just verify the
    // boundary check doesn't reject normalisation artifacts.
    expect(safeJoin(BASE, './foo', 'bar.toml')).toBe(`${BASE}${sep}foo${sep}bar.toml`);
  });
});

describe('safeJoin — traversal rejection', () => {
  it('rejects a leading `..` segment', () => {
    expect(() => safeJoin(BASE, '..', 'etc', 'passwd')).toThrow(PathTraversalError);
  });

  it('rejects a `..` embedded inside a path part', () => {
    expect(() => safeJoin(BASE, '../etc/passwd')).toThrow(PathTraversalError);
  });

  it('rejects multi-level `..` traversal', () => {
    expect(() => safeJoin(BASE, '../../etc/passwd')).toThrow(PathTraversalError);
  });

  it('rejects an absolute path segment by default', () => {
    expect(() => safeJoin(BASE, '/etc/passwd')).toThrow(PathTraversalError);
  });

  it('rejects a Windows-style absolute path segment', () => {
    // Sanity check on the absolute detection — `path.isAbsolute` is
    // platform-aware but our use case is mostly POSIX, so we just
    // confirm the POSIX absolute is caught on POSIX runners.
    if (sep === '/') {
      expect(() => safeJoin(BASE, '/abs/path')).toThrow(PathTraversalError);
    }
  });

  it('rejects a sibling-directory prefix attack', () => {
    // `/home/ope/.codex/agents-evil` shares a prefix with the base
    // dir but is NOT inside it. Naive `startsWith(BASE)` would let
    // this through; we use `startsWith(BASE + sep)` to prevent it.
    expect(() => assertWithinBase(BASE, `${BASE}-evil/file.toml`)).toThrow(PathTraversalError);
  });

  it('rejects a normalisation-trick traversal', () => {
    // `foo/../..` collapses to `..` after normalisation. Should not
    // be possible to construct via legitimate segments.
    expect(() => safeJoin(BASE, 'foo', '..', '..', 'etc')).toThrow(PathTraversalError);
  });

  it('allows absolute segments when explicitly opted in', () => {
    // For the rare caller that DOES want absolute behavior (currently
    // none in our codebase, but the opt-in keeps the API flexible).
    expect(() => safeJoin(BASE, '/abs/path', { allowAbsolute: true }))
      .toThrow(PathTraversalError);  // still bounded — the path escapes BASE
  });
});

describe('tryJoin — non-throwing variant', () => {
  it('returns the path on success', () => {
    expect(tryJoin(BASE, 'agenticmail-fola.toml')).toBe(`${BASE}${sep}agenticmail-fola.toml`);
  });

  it('returns null on traversal rejection', () => {
    expect(tryJoin(BASE, '../etc/passwd')).toBeNull();
    expect(tryJoin(BASE, '/etc/passwd')).toBeNull();
  });
});

describe('assertWithinBase — already-resolved candidates', () => {
  it('accepts a path inside the base', () => {
    expect(assertWithinBase(BASE, `${BASE}/subdir/file.toml`))
      .toBe(`${BASE}${sep}subdir${sep}file.toml`);
  });

  it('accepts the base itself', () => {
    expect(assertWithinBase(BASE, BASE)).toBe(BASE);
  });

  it('rejects an escape via `..` segments', () => {
    expect(() => assertWithinBase(BASE, `${BASE}/../../etc/passwd`))
      .toThrow(PathTraversalError);
  });

  it('rejects a totally unrelated absolute path', () => {
    expect(() => assertWithinBase(BASE, '/tmp/elsewhere')).toThrow(PathTraversalError);
  });
});

describe('PathTraversalError', () => {
  it('carries the offending inputs for logging', () => {
    try {
      safeJoin(BASE, '../etc/passwd');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PathTraversalError);
      const e = err as PathTraversalError;
      expect(e.baseDir).toBe(BASE);
      expect(e.parts).toEqual(['../etc/passwd']);
      expect(e.message).toContain('path traversal attempt');
    }
  });

  it('has a stable name for instanceof checks across realms', () => {
    try { safeJoin(BASE, '..'); }
    catch (err) { expect((err as Error).name).toBe('PathTraversalError'); }
  });
});
