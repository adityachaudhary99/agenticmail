/**
 * Unit tests for the typed-task-contract JSON Schema validator.
 *
 * The validator's job is to reject submit_result payloads that
 * don't match the assigner's schema. We cover the subset of
 * draft-7 we actually support — anything else in the schema is
 * deliberately ignored so callers don't crash on unsupported
 * keywords.
 */
import { describe, it, expect } from 'vitest';
import { validate, type Schema } from '../lib/schema-validator.js';

describe('schema validator — happy paths', () => {
  it('accepts a matching object', () => {
    const schema: Schema = {
      type: 'object',
      required: ['summary', 'recommendation'],
      properties: {
        summary: { type: 'string' },
        recommendation: { type: 'string', enum: ['proceed', 'block'] },
      },
    };
    const ok = { summary: 'all clear', recommendation: 'proceed' };
    expect(validate(ok, schema)).toEqual([]);
  });

  it('accepts a matching array of objects', () => {
    const schema: Schema = {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'count'],
        properties: { name: { type: 'string' }, count: { type: 'integer' } },
      },
    };
    expect(validate([{ name: 'a', count: 1 }, { name: 'b', count: 7 }], schema)).toEqual([]);
  });
});

describe('schema validator — rejections', () => {
  it('reports missing required properties', () => {
    const schema: Schema = {
      type: 'object',
      required: ['summary', 'findings'],
      properties: { summary: { type: 'string' }, findings: { type: 'array' } },
    };
    const errors = validate({ summary: 'x' }, schema);
    expect(errors).toEqual([{ path: 'findings', message: 'required property is missing' }]);
  });

  it('reports wrong type at root', () => {
    const errors = validate('not an object', { type: 'object' });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/expected type object/);
  });

  it('reports enum violations', () => {
    const schema: Schema = { type: 'string', enum: ['a', 'b', 'c'] };
    const errors = validate('d', schema);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/not in enum/);
  });

  it('reports additionalProperties: false violations', () => {
    const schema: Schema = {
      type: 'object',
      properties: { ok: { type: 'string' } },
      additionalProperties: false,
    };
    const errors = validate({ ok: 'x', unknown: 1 }, schema);
    expect(errors).toEqual([{ path: 'unknown', message: 'unknown property (additionalProperties: false)' }]);
  });

  it('reports nested errors with dotted paths', () => {
    const schema: Schema = {
      type: 'object',
      properties: {
        nested: {
          type: 'object',
          required: ['x'],
          properties: { x: { type: 'integer' } },
        },
      },
    };
    const errors = validate({ nested: { x: 'not an int' } }, schema);
    expect(errors).toEqual([{ path: 'nested.x', message: 'expected type integer, got string' }]);
  });

  it('reports array-index paths', () => {
    const schema: Schema = {
      type: 'array',
      items: { type: 'object', required: ['k'], properties: { k: { type: 'string' } } },
    };
    const errors = validate([{ k: 'ok' }, { k: 5 }, {}], schema);
    expect(errors).toContainEqual({ path: '[1].k', message: 'expected type string, got number' });
    expect(errors).toContainEqual({ path: '[2].k', message: 'required property is missing' });
  });
});

describe('schema validator — string/number constraints', () => {
  it('enforces minLength and maxLength on strings', () => {
    const schema: Schema = { type: 'string', minLength: 2, maxLength: 5 };
    expect(validate('hi', schema)).toEqual([]);
    expect(validate('h', schema)[0].message).toMatch(/shorter than minLength/);
    expect(validate('toolong', schema)[0].message).toMatch(/longer than maxLength/);
  });

  it('enforces minimum and maximum on numbers', () => {
    const schema: Schema = { type: 'number', minimum: 0, maximum: 10 };
    expect(validate(5, schema)).toEqual([]);
    expect(validate(-1, schema)[0].message).toMatch(/below minimum/);
    expect(validate(11, schema)[0].message).toMatch(/above maximum/);
  });
});

describe('schema validator — leniency', () => {
  it('ignores unsupported keywords without crashing', () => {
    const schema = {
      type: 'object',
      pattern: '^x$',          // unsupported — should be ignored
      format: 'date-time',     // unsupported — should be ignored
      properties: { a: { type: 'string' } },
    } as Schema;
    expect(validate({ a: 'ok' }, schema)).toEqual([]);
  });

  it('returns no errors for null schema (back-compat: tasks without outputSchema)', () => {
    expect(validate({ anything: 'goes' }, undefined as unknown as Schema)).toEqual([]);
  });
});
