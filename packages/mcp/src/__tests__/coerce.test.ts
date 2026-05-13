/**
 * Tests for the LLM-tolerant input coercion layer.
 *
 * These all model real mistakes seen in production from Claude Code,
 * ChatGPT, and other host LLMs. Every "tolerant" case below is a wire
 * shape we have observed live; rejecting them with a confusing zod
 * error costs the LLM a retry turn for a mistake that has exactly one
 * correct interpretation, so we coerce.
 *
 * The pass-through cases ensure correct inputs are never mutated — the
 * downstream zod validator must see the canonical form unchanged.
 */

import { describe, it, expect } from 'vitest';
import { coerceToArray, coerceToObject, coerceToNumber, coerceToBoolean } from '../coerce.js';

describe('coerceToArray', () => {
  it('passes a real array through unchanged', () => {
    const input = [1, 2, 3];
    expect(coerceToArray(input, 'number')).toBe(input);
  });

  it('parses a JSON-string array of numbers — the canonical Claude Code mistake', () => {
    // batch_mark_read({ uids: "[1, 2, 3, 4]" }) — the exact shape the user reported.
    expect(coerceToArray('[1, 2, 3, 4]', 'number')).toEqual([1, 2, 3, 4]);
  });

  it('parses a JSON-string array of strings', () => {
    expect(coerceToArray('["a", "b", "c"]', 'string')).toEqual(['a', 'b', 'c']);
  });

  it('parses a JSON-string array of objects (no items type, no CSV)', () => {
    expect(coerceToArray('[{"filename":"x.txt","content":"hi"}]', 'object')).toEqual([
      { filename: 'x.txt', content: 'hi' },
    ]);
  });

  it('splits a bare CSV string of numbers', () => {
    expect(coerceToArray('1, 2, 3, 4', 'number')).toEqual([1, 2, 3, 4]);
  });

  it('splits a bare CSV string of strings', () => {
    expect(coerceToArray('alice, bob, carol', 'string')).toEqual(['alice', 'bob', 'carol']);
  });

  it('handles a single primitive as a one-element array', () => {
    expect(coerceToArray('42', 'number')).toEqual([42]);
    expect(coerceToArray('alice', 'string')).toEqual(['alice']);
  });

  it('skips empty entries in CSV so dangling commas do not produce NaN', () => {
    expect(coerceToArray('1, 2, , 3', 'number')).toEqual([1, 2, 3]);
  });

  it('leaves non-numeric strings in a numeric CSV alone so zod rejects them clearly', () => {
    // Mixed-shape CSV — we coerce what we can, leave the rest for zod.
    const result = coerceToArray('1, two, 3', 'number') as unknown[];
    expect(result).toEqual([1, 'two', 3]);
  });

  it('does not CSV-split arrays of objects (no sensible split)', () => {
    // A user-typed object-as-string with commas would be ambiguous.
    // We only run the JSON-parse path, never CSV, when items are objects.
    expect(coerceToArray('{not, json}', 'object')).toBe('{not, json}');
  });

  it('passes non-string non-array values through (numbers, null, undefined)', () => {
    expect(coerceToArray(null, 'number')).toBe(null);
    expect(coerceToArray(undefined, 'number')).toBe(undefined);
    expect(coerceToArray(42, 'number')).toBe(42);
  });

  it('passes through invalid JSON that starts with [ so zod produces a clear error', () => {
    // Broken JSON should NOT silently CSV-split. The user clearly tried to
    // write a JSON array; we shouldn't pretend they meant CSV and emit
    // surprising tokens like ["[1", "2", "broken"]. Return the raw string
    // so zod reports a clean "expected array" error.
    expect(coerceToArray('[1, 2, broken', 'number')).toBe('[1, 2, broken');
  });
});

describe('coerceToObject', () => {
  it('passes a real object through unchanged', () => {
    const input = { id: 'abc', count: 3 };
    expect(coerceToObject(input)).toBe(input);
  });

  it('parses a JSON-string object — common where filter/criteria/payload params live', () => {
    expect(coerceToObject('{"id":"abc","count":3}')).toEqual({ id: 'abc', count: 3 });
  });

  it('does NOT treat arrays as objects (they get caught by coerceToArray)', () => {
    expect(coerceToObject([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('passes invalid JSON through so zod reports a clear shape error', () => {
    expect(coerceToObject('{broken')).toBe('{broken');
  });

  it('passes non-object, non-string values through unchanged', () => {
    expect(coerceToObject(42)).toBe(42);
    expect(coerceToObject(null)).toBe(null);
    expect(coerceToObject(undefined)).toBe(undefined);
  });
});

describe('coerceToNumber', () => {
  it('passes real numbers through unchanged', () => {
    expect(coerceToNumber(42)).toBe(42);
    expect(coerceToNumber(0)).toBe(0);
    expect(coerceToNumber(-3.14)).toBe(-3.14);
  });

  it('parses numeric strings — wait_for_email({ timeout: "120" })', () => {
    expect(coerceToNumber('120')).toBe(120);
    expect(coerceToNumber('  42  ')).toBe(42); // whitespace trimmed
    expect(coerceToNumber('-3.14')).toBe(-3.14);
    expect(coerceToNumber('0')).toBe(0);
  });

  it('leaves non-numeric strings alone so zod reports the right error', () => {
    expect(coerceToNumber('alice')).toBe('alice');
    expect(coerceToNumber('12abc')).toBe('12abc');
  });

  it('treats an empty string as untouched so zod can produce "expected number"', () => {
    expect(coerceToNumber('')).toBe('');
    expect(coerceToNumber('   ')).toBe('   ');
  });
});

describe('coerceToBoolean', () => {
  it('passes real booleans through unchanged', () => {
    expect(coerceToBoolean(true)).toBe(true);
    expect(coerceToBoolean(false)).toBe(false);
  });

  it('parses the common LLM boolean strings', () => {
    expect(coerceToBoolean('true')).toBe(true);
    expect(coerceToBoolean('True')).toBe(true);
    expect(coerceToBoolean('TRUE')).toBe(true);
    expect(coerceToBoolean('yes')).toBe(true);
    expect(coerceToBoolean('1')).toBe(true);
    expect(coerceToBoolean('false')).toBe(false);
    expect(coerceToBoolean('False')).toBe(false);
    expect(coerceToBoolean('no')).toBe(false);
    expect(coerceToBoolean('0')).toBe(false);
  });

  it('parses 0 / 1 as integers', () => {
    expect(coerceToBoolean(1)).toBe(true);
    expect(coerceToBoolean(0)).toBe(false);
  });

  it('leaves ambiguous values alone so zod can produce "expected boolean"', () => {
    expect(coerceToBoolean('maybe')).toBe('maybe');
    expect(coerceToBoolean(2)).toBe(2);
    expect(coerceToBoolean(null)).toBe(null);
    expect(coerceToBoolean(undefined)).toBe(undefined);
  });
});
