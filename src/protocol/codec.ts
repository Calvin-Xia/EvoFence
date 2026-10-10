/**
 * The codec: one validator driven by the frozen field table, plus typed business results.
 *
 * This is the **boundary** of the protocol layer. Everything an outside caller can hand in —
 * argv, YAML, a host receipt, a session projection — is validated here against `DEFS`, and a
 * failure comes back as a typed `ErrorEnvelope`, never as a thrown exception and never as a
 * stripped-down "best effort" object. Two rules are absolute:
 *
 *   - **unknown field → error** (`additionalProperties: false` on every object in the frozen
 *     document); never ignored, never removed (DoD 1);
 *   - **unknown version → `EFK_PROTOCOL_UNSUPPORTED`** (`decodeProtocolVersion`), never tolerated.
 *
 * The engine implements exactly `ASSERTION_KEYWORDS` from `defs.ts`. It is the only place these
 * invariants are checked: modules above it call `decode(...)` once and then trust the result, and
 * do not re-check the same field.
 */
import type { Def } from './defs.js';
import { fail, type ErrorCode, type ErrorEnvelope } from './errors.js';
import { DEFS, type DefName } from './objects/index.js';
import type { Decoded } from './types.js';
import { gateRuntimeVersion, type SchemaVersion } from './version.js';

/** A validated value or a typed failure. Business outcomes are results, not exceptions. */
export type Validated<K extends DefName> =
  | { readonly ok: true; readonly value: Decoded<K> }
  | { readonly ok: false; readonly error: ErrorEnvelope };

/** Which keyword rejected the value, and a message naming the exact location. */
interface Failure {
  readonly keyword: string;
  readonly message: string;
}

/** Human-readable rendering of an offending value for the error message. */
function show(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value === null) return 'null';
  if (typeof value === 'object') return 'object';
  return String(value);
}

/** Stable rendering for `uniqueItems`: key order in the input must not affect equality. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

/** `#/$defs/TaskContract` -> `TaskContract`. Every ref in the table is pinned by the drift test. */
function refName(ref: string): DefName {
  return ref.slice('#/$defs/'.length) as DefName;
}

/** The `$defs` lookup with the type telling the truth about a name that is not in the table. */
function resolveRef(ref: string): Def | undefined {
  return (DEFS as Readonly<Record<string, Def | undefined>>)[refName(ref)];
}

/**
 * Audit G21: recursion is bounded so a deeply nested value cannot exhaust the stack. The frozen
 * table has no recursive definition today, so this is a guard rail rather than a live limit.
 */
const MAX_VALIDATION_DEPTH = 64;

function validateObject(spec: Def, value: unknown, at: string, depth: number): Failure | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { keyword: 'type', message: `${at}: expected object, got ${show(value)}` };
  }
  const record = value as Record<string, unknown>;

  if (spec.required !== undefined) {
    for (const key of spec.required) {
      if (!Object.hasOwn(record, key)) return { keyword: 'required', message: `${at}: missing required field "${key}"` };
    }
  }
  if (spec.propertyNames !== undefined) {
    for (const key of Object.keys(record)) {
      const failure = validate(spec.propertyNames, key, `${at} property name "${key}"`, depth + 1);
      if (failure !== null) return failure;
    }
  }
  if (spec.properties !== undefined) {
    for (const [key, sub] of Object.entries(spec.properties)) {
      if (!Object.hasOwn(record, key)) continue;
      const failure = validate(sub, record[key], `${at}.${key}`, depth + 1);
      if (failure !== null) return failure;
    }
  }
  if (spec.additionalProperties === false) {
    const known = new Set(Object.keys(spec.properties ?? {}));
    for (const key of Object.keys(record)) {
      if (!known.has(key)) return { keyword: 'additionalProperties', message: `${at}: unknown field "${key}"` };
    }
  } else if (spec.additionalProperties !== undefined) {
    for (const [key, item] of Object.entries(record)) {
      const failure = validate(spec.additionalProperties, item, `${at}.${key}`, depth + 1);
      if (failure !== null) return failure;
    }
  }
  return null;
}

function validateArray(spec: Def, value: unknown, at: string, depth: number): Failure | null {
  if (!Array.isArray(value)) return { keyword: 'type', message: `${at}: expected array, got ${show(value)}` };
  if (spec.minItems !== undefined && value.length < spec.minItems) {
    return { keyword: 'minItems', message: `${at}: needs at least ${spec.minItems} item(s), got ${value.length}` };
  }
  if (spec.items !== undefined) {
    for (let index = 0; index < value.length; index += 1) {
      const failure = validate(spec.items, value[index], `${at}[${index}]`, depth + 1);
      if (failure !== null) return failure;
    }
  }
  if (spec.uniqueItems === true) {
    const seen = new Set<string>();
    for (const item of value) {
      const key = canonical(item);
      if (seen.has(key)) return { keyword: 'uniqueItems', message: `${at}: duplicate item (${key})` };
      seen.add(key);
    }
  }
  return null;
}

function validateDeclaredType(spec: Def, value: unknown, at: string): Failure | null {
  switch (spec.type) {
    case 'string':
      return typeof value === 'string' ? null : { keyword: 'type', message: `${at}: expected string, got ${show(value)}` };
    case 'integer':
      return typeof value === 'number' && Number.isSafeInteger(value)
        ? null
        : { keyword: 'type', message: `${at}: expected safe integer, got ${show(value)}` };
    case 'boolean':
      return typeof value === 'boolean' ? null : { keyword: 'type', message: `${at}: expected boolean, got ${show(value)}` };
    case 'null':
      return value === null ? null : { keyword: 'type', message: `${at}: expected null, got ${show(value)}` };
    default:
      return null;
  }
}

/**
 * Bound keywords apply by instance type, the way JSON Schema applies them. This is not decoration:
 * `BudgetBound.usdMicros` is `{"$ref": "UsdMicros", "minimum": 1}`, so a `$ref` sibling carries a real
 * assertion that an early return on `$ref` would drop.
 */
function validateBounds(spec: Def, value: unknown, at: string): Failure | null {
  if (typeof value === 'string') {
    if (spec.minLength !== undefined && value.length < spec.minLength) {
      return { keyword: 'minLength', message: `${at}: shorter than ${spec.minLength}` };
    }
    if (spec.pattern !== undefined && !new RegExp(spec.pattern).test(value)) {
      return { keyword: 'pattern', message: `${at}: ${JSON.stringify(value)} does not match ${spec.pattern}` };
    }
  }
  if (typeof value === 'number') {
    if (spec.minimum !== undefined && value < spec.minimum) {
      return { keyword: 'minimum', message: `${at}: below minimum ${spec.minimum}` };
    }
    if (spec.maximum !== undefined && value > spec.maximum) {
      return { keyword: 'maximum', message: `${at}: above maximum ${spec.maximum}` };
    }
  }
  return null;
}

/** Validate `value` against one schema node. Returns the first failure, or `null`. */
function validate(spec: Def, value: unknown, at: string, depth = 0): Failure | null {
  if (depth > MAX_VALIDATION_DEPTH) {
    return { keyword: 'maxDepth', message: `${at}: nesting deeper than ${MAX_VALIDATION_DEPTH}` };
  }
  if (spec.$ref !== undefined) {
    const target = resolveRef(spec.$ref);
    if (target === undefined) {
      // Audit G21: a dangling `$ref` is a codec failure — and therefore an `ErrorEnvelope` — never a
      // TypeError from indexing a definition that is not in the frozen table.
      return { keyword: '$ref', message: `${at}: unknown definition ${JSON.stringify(refName(spec.$ref))}` };
    }
    const failure = validate(target, value, at, depth + 1);
    if (failure !== null) return failure;
  }
  if (spec.enum !== undefined && !spec.enum.includes(value as string | number | boolean)) {
    return { keyword: 'enum', message: `${at}: ${show(value)} is not one of ${spec.enum.join(' / ')}` };
  }
  if (spec.const !== undefined && value !== spec.const) {
    return { keyword: 'const', message: `${at}: expected ${JSON.stringify(spec.const)}, got ${show(value)}` };
  }
  const bounds = validateBounds(spec, value, at);
  if (bounds !== null) return bounds;

  // Shape before composition: a node that carries both (DecisionRecord, CommandPayload, LoopSpec)
  // should report "missing required field kind" rather than a downstream `then` mismatch.
  const objectShaped =
    spec.type === 'object' ||
    spec.properties !== undefined ||
    spec.required !== undefined ||
    spec.additionalProperties !== undefined ||
    spec.propertyNames !== undefined;
  if (objectShaped) {
    const failure = validateObject(spec, value, at, depth);
    if (failure !== null) return failure;
  } else if (spec.type === 'array') {
    const failure = validateArray(spec, value, at, depth);
    if (failure !== null) return failure;
  } else {
    const failure = validateDeclaredType(spec, value, at);
    if (failure !== null) return failure;
  }

  if (spec.anyOf !== undefined) {
    const failures = spec.anyOf.map((branch) => validate(branch, value, at, depth + 1));
    const first = failures[0];
    if (first !== undefined && first !== null && failures.every((failure) => failure !== null)) {
      return { keyword: 'anyOf', message: `${at}: no anyOf branch matched (${first.message})` };
    }
  }
  if (spec.allOf !== undefined) {
    for (const branch of spec.allOf) {
      const failure = validate(branch, value, at, depth + 1);
      if (failure !== null) return failure;
    }
  }
  if (spec.if !== undefined) {
    if (validate(spec.if, value, at, depth + 1) === null && spec.then !== undefined) {
      const failure = validate(spec.then, value, at, depth + 1);
      if (failure !== null) return failure;
    }
  }
  if (spec.not !== undefined && validate(spec.not, value, at, depth + 1) === null) {
    return { keyword: 'not', message: `${at}: value matches a forbidden shape` };
  }
  return null;
}

/**
 * Map a version-pair failure to its error: a **value** that mismatches the frozen namespace /
 * schemaVersion is S02 (`EFK_PROTOCOL_UNSUPPORTED`), anything else is a shape error. Shared by the
 * runtime gate and the asset gate so the two domains cannot drift apart.
 */
function versionError(specName: DefName, value: unknown, at: string): ErrorEnvelope | null {
  const failure = validate(DEFS[specName], value, at);
  if (failure === null) return null;
  const code: ErrorCode = failure.keyword === 'const' || failure.keyword === 'enum' ? 'EFK_PROTOCOL_UNSUPPORTED' : 'EFK_SCHEMA_INVALID';
  return fail(code, failure.message);
}

/** Decode one definition. Unknown fields and unknown enum/const values are rejected. */
export function decode<K extends DefName>(name: K, value: unknown): Validated<K> {
  // An envelope carries its version pair under `protocol`, and `SCHEMAS.md §3` S02 makes an unknown
  // pair a protocol error wherever it appears. Run that gate first so callers never have to
  // remember an ordering. The truth source is whatever definition the frozen document points
  // `protocol` at: runtime envelopes use `ProtocolVersion`, asset envelopes use
  // `AssetProtocolVersion` (`evofence.assets/1 @ 1.0.0`). Definitions that declare no `protocol`
  // are untouched.
  const declared = (DEFS[name] as Def).properties?.protocol;
  if (declared?.$ref !== undefined) {
    const protocol = value !== null && typeof value === 'object' ? (value as { protocol?: unknown }).protocol : undefined;
    if (protocol !== undefined) {
      const error = versionError(refName(declared.$ref) as DefName, protocol, `${name}.protocol`);
      if (error !== null) return { ok: false, error };
    }
  }
  const failure = validate(DEFS[name], value, name);
  if (failure === null) return { ok: true, value: value as Decoded<K> };
  return { ok: false, error: fail('EFK_SCHEMA_INVALID', failure.message) };
}

/**
 * Decode the runtime protocol envelope.
 *
 * `ProtocolVersion` expresses "which versions exist" as a `const` namespace plus an `enum`
 * schemaVersion, so on this node those two keywords *are* the S02 version gate: a **value** that
 * mismatches either one comes back as `EFK_PROTOCOL_UNSUPPORTED`, while a missing `namespace` or a
 * structurally wrong value stays `EFK_SCHEMA_INVALID`. That is why this is a separate entry point
 * instead of a second schema.
 */
export function decodeProtocolVersion(value: unknown, at = 'ProtocolVersion'): Validated<'ProtocolVersion'> {
  const error = versionError('ProtocolVersion', value, at);
  if (error === null) return { ok: true, value: value as Decoded<'ProtocolVersion'> };
  return { ok: false, error };
}

/**
 * Decode a value that claims namespace `evofence.runtime/1` and one of the accepted schemaVersions,
 * then hand back the concrete `SchemaVersion`.
 */
export function decodeRuntimeVersion(
  value: unknown,
): { readonly ok: true; readonly version: SchemaVersion } | { readonly ok: false; readonly error: ErrorEnvelope } {
  const decoded = decodeProtocolVersion(value);
  if (!decoded.ok) return decoded;
  const gate = gateRuntimeVersion(decoded.value);
  if (gate === 'unsupported') {
    return { ok: false, error: fail('EFK_PROTOCOL_UNSUPPORTED', `unsupported protocol pair ${decoded.value.namespace}@${decoded.value.schemaVersion}`) };
  }
  return { ok: true, version: decoded.value.schemaVersion };
}
