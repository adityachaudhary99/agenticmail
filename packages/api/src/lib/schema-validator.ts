/**
 * Tiny JSON-Schema validator (draft-7 subset).
 *
 * Designed for one job: validate task `submit_result` payloads
 * against an assigner-supplied schema. We deliberately do NOT
 * pull in `ajv` here — it's 100+ KB for a feature this small.
 *
 * Supported keywords:
 *   - `type` (string | number | integer | boolean | null | object | array)
 *   - `required` (array of property names)
 *   - `properties` (object → sub-schema)
 *   - `items` (sub-schema; only homogeneous arrays)
 *   - `enum` (array of allowed primitive values)
 *   - `additionalProperties: false` (reject unknown keys)
 *   - `minLength` / `maxLength` (strings)
 *   - `minimum` / `maximum` (numbers)
 *
 * Anything else in the schema is ignored — so a richer schema
 * still validates against the supported subset rather than
 * crashing. The error list returned is a flat array of `{ path,
 * message }` so callers can surface a list of problems for the
 * worker to fix on retry.
 */

export interface Schema {
  type?: string | string[];
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  enum?: unknown[];
  additionalProperties?: boolean;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
}

export interface ValidationError {
  path: string;
  message: string;
}

export function validate(value: unknown, schema: Schema, path = ''): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!schema || typeof schema !== 'object') return errors;

  // Type check.
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some(t => matchesType(value, t))) {
      errors.push({ path: path || '(root)', message: `expected type ${types.join('|')}, got ${jsType(value)}` });
      return errors;  // bail early — downstream checks assume the type matched
    }
  }

  // Enum.
  if (schema.enum && Array.isArray(schema.enum)) {
    if (!schema.enum.some(e => deepEqual(e, value))) {
      errors.push({ path: path || '(root)', message: `value not in enum [${schema.enum.map(e => JSON.stringify(e)).join(', ')}]` });
    }
  }

  // String constraints.
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push({ path: path || '(root)', message: `string shorter than minLength ${schema.minLength}` });
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push({ path: path || '(root)', message: `string longer than maxLength ${schema.maxLength}` });
    }
  }

  // Number constraints.
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push({ path: path || '(root)', message: `value below minimum ${schema.minimum}` });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push({ path: path || '(root)', message: `value above maximum ${schema.maximum}` });
    }
  }

  // Object handling.
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in obj)) {
        errors.push({ path: childPath(path, key), message: 'required property is missing' });
      }
    }
    if (schema.properties) {
      for (const [key, subSchema] of Object.entries(schema.properties)) {
        if (key in obj) {
          errors.push(...validate(obj[key], subSchema, childPath(path, key)));
        }
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(obj)) {
          if (!(key in schema.properties)) {
            errors.push({ path: childPath(path, key), message: 'unknown property (additionalProperties: false)' });
          }
        }
      }
    }
  }

  // Array handling.
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, i) => {
      errors.push(...validate(item, schema.items!, `${path}[${i}]`));
    });
  }

  return errors;
}

function matchesType(value: unknown, t: string): boolean {
  switch (t) {
    case 'string':  return typeof value === 'string';
    case 'number':  return typeof value === 'number' && !Number.isNaN(value);
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'null':    return value === null;
    case 'object':  return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array':   return Array.isArray(value);
    default:        return true;
  }
}

function jsType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function childPath(parent: string, key: string): string {
  return parent ? `${parent}.${key}` : key;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      if (a.length !== (b as unknown[]).length) return false;
      return a.every((v, i) => deepEqual(v, (b as unknown[])[i]));
    }
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b as object);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(k => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}
