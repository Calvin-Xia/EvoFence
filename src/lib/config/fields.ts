/**
 * Structural walker for the v2 config schemas.
 *
 * DOMAIN: config (L2 io domain, node `l2_config`).
 *
 * Division of labour with `validate.ts`:
 *   - THIS module answers "which paths are present / absent / unknown", applies the two
 *     declared code defaults, and returns a normalized copy of the document.
 *   - `validate.ts` answers "is each present value legal".
 *
 * An array field that declares `items` is walked item by item, so an unknown key inside an entry
 * is reported as `field[index].key` just like an unknown top-level key; an array without `items`
 * stays opaque (the value rules still check the array itself).
 *
 * A field that is absent is therefore reported once as `missing` (never as `rejected`), and a
 * field that is present is reported once as `rejected` when its value is illegal (never as
 * `missing`). That split is what keeps the audit lists unambiguous.
 */
import type { FieldSpec } from './schema.js';

export interface ShapeWalk {
  /** Dotted paths present in the document (defaulted fields count as present). */
  present: string[];
  /** Dotted paths the schema requires but the document does not contain. */
  missing: string[];
  /** Dotted paths not declared by a closed object schema. */
  unknown: string[];
  /** Deep copy of the document with the declared defaults filled in. */
  normalized: Record<string, unknown>;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep clone of parsed-YAML data; unknown/opaque nodes are passed through by reference. */
function cloneJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJson(item)]));
  }
  return value;
}

function normalizeNode(spec: FieldSpec, value: unknown, prefix: string, out: ShapeWalk): unknown {
  if (value === undefined) {
    if (spec.defaultValue !== undefined) {
      if (prefix) out.present.push(prefix);
      return spec.defaultValue;
    }
    if (spec.required && prefix) out.missing.push(prefix);
    return undefined;
  }

  if (Array.isArray(value)) {
    if (prefix) out.present.push(prefix);
    if (!spec.items) return cloneJson(value);
    const items = spec.items;
    return value.map((item, index) => normalizeNode(items, item, `${prefix}[${index}]`, out));
  }

  if (isPlainObject(value)) {
    if (spec.kind === 'object') {
      if (prefix) out.present.push(prefix);
      return normalizeObject(spec, value, prefix, out);
    }
    // An object where a scalar/array was expected: keep it so the value rules can reject it
    // with the real reason instead of a generic shape error.
    if (prefix) out.present.push(prefix);
    return cloneJson(value);
  }

  if (prefix) out.present.push(prefix);
  return cloneJson(value);
}

function normalizeObject(spec: FieldSpec, value: Record<string, unknown>, prefix: string, out: ShapeWalk): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, childSpec] of Object.entries(spec.fields ?? {})) {
    const childPath = prefix ? `${prefix}.${key}` : key;
    const normalized = normalizeNode(childSpec, Object.hasOwn(value, key) ? value[key] : undefined, childPath, out);
    if (normalized !== undefined) result[key] = normalized;
  }
  for (const [key, childValue] of Object.entries(value)) {
    if (spec.fields && Object.hasOwn(spec.fields, key)) continue;
    const childPath = prefix ? `${prefix}.${key}` : key;
    if (!spec.open) {
      out.unknown.push(childPath);
      continue;
    }
    result[key] = cloneJson(childValue);
    out.present.push(childPath);
  }
  return result;
}

/** Walk a parsed document against its schema. Non-object roots yield an empty walk. */
export function walkShape(spec: FieldSpec, value: unknown): ShapeWalk {
  const out: ShapeWalk = { present: [], missing: [], unknown: [], normalized: {} };
  if (!isPlainObject(value)) return out;
  out.normalized = normalizeObject(spec, value, '', out);
  return out;
}
