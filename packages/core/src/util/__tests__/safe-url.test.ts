import { describe, it, expect } from 'vitest';
import { validateApiUrl, buildApiUrl, UnsafeApiUrlError } from '../safe-url.js';

describe('validateApiUrl — happy path', () => {
  it('accepts http://localhost:3829', () => {
    expect(validateApiUrl('http://localhost:3829')).toBe('http://localhost:3829');
  });

  it('accepts http://127.0.0.1:3829', () => {
    expect(validateApiUrl('http://127.0.0.1:3829')).toBe('http://127.0.0.1:3829');
  });

  it('accepts https:// origins', () => {
    expect(validateApiUrl('https://agenticmail.example.com')).toBe('https://agenticmail.example.com');
  });

  it('strips trailing slash to canonical origin', () => {
    expect(validateApiUrl('http://localhost:3829/')).toBe('http://localhost:3829');
  });
});

describe('validateApiUrl — rejection', () => {
  it('rejects file:// URLs', () => {
    expect(() => validateApiUrl('file:///etc/passwd')).toThrow(UnsafeApiUrlError);
  });

  it('rejects javascript: URLs', () => {
    expect(() => validateApiUrl('javascript:alert(1)')).toThrow(UnsafeApiUrlError);
  });

  it('rejects data: URLs', () => {
    expect(() => validateApiUrl('data:text/plain,hello')).toThrow(UnsafeApiUrlError);
  });

  it('rejects ftp:// URLs', () => {
    expect(() => validateApiUrl('ftp://example.com')).toThrow(UnsafeApiUrlError);
  });

  it('rejects the AWS / Azure / GCP IPv4 metadata host', () => {
    expect(() => validateApiUrl('http://169.254.169.254/latest/meta-data/')).toThrow(UnsafeApiUrlError);
  });

  it('rejects the GCP metadata DNS name', () => {
    expect(() => validateApiUrl('http://metadata.google.internal/')).toThrow(UnsafeApiUrlError);
  });

  it('rejects metadata host even with trailing dot', () => {
    expect(() => validateApiUrl('http://169.254.169.254./')).toThrow(UnsafeApiUrlError);
  });

  it('rejects empty / non-string input', () => {
    expect(() => validateApiUrl('')).toThrow(UnsafeApiUrlError);
    expect(() => validateApiUrl(undefined as any)).toThrow(UnsafeApiUrlError);
    expect(() => validateApiUrl(42 as any)).toThrow(UnsafeApiUrlError);
  });

  it('rejects URLs with embedded credentials', () => {
    expect(() => validateApiUrl('http://user:pass@localhost:3829')).toThrow(UnsafeApiUrlError);
  });

  it('rejects garbage', () => {
    expect(() => validateApiUrl('not a url')).toThrow(UnsafeApiUrlError);
  });
});

describe('buildApiUrl', () => {
  it('appends a leading-slash path correctly', () => {
    expect(buildApiUrl('http://localhost:3829', '/api/health')).toBe('http://localhost:3829/api/health');
  });

  it('appends a path without leading slash', () => {
    expect(buildApiUrl('http://localhost:3829', 'api/health')).toBe('http://localhost:3829/api/health');
  });

  it('escapes characters that would otherwise traverse', () => {
    // `..` in the path is collapsed by URL resolution; we deliberately
    // build via `new URL(path, baseOrigin)` so escaping is handled.
    const r = buildApiUrl('http://localhost:3829', '/api/../etc');
    expect(r).toBe('http://localhost:3829/etc');
  });
});
