/**
 * The failing check behind 决定 B: the frozen documents are the only source of truth.
 *
 * This test re-parses `SCHEMAS.md` §1 `$defs` and `ERRORS.md` from disk and compares them with the
 * tables `src/protocol/objects/*.ts` and `src/protocol/errors.ts` ship. Any drift — a renamed
 * field, a changed type, a new object, a dropped required entry, a new keyword, a re-classified
 * retry — fails here. The last test is a negative control proving the comparator itself is
 * falsifiable rather than a tautology.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ANNOTATION_KEYWORDS,
  ASSERTION_KEYWORDS,
  CURRENT_SCHEMA_VERSION,
  DEFS,
  ERROR_CODES,
  RETRY_POLICY,
  SUPPORTED_SCHEMA_VERSIONS,
} from '../dist/protocol/index.js';

const SCHEMAS_PATH = 'docs/evofence-harness-kernel/spec/contracts/SCHEMAS.md';
const ERRORS_PATH = 'docs/evofence-harness-kernel/spec/contracts/ERRORS.md';

const schemaDocument = readFileSync(SCHEMAS_PATH, 'utf8');
const schemaBundle = JSON.parse(schemaDocument.match(/```json\r?\n([\s\S]*?)\r?\n```/)[1]);
const frozen = schemaBundle.$defs;
const frozenNames = Object.keys(frozen).sort();

/** The frozen document's own type-expression rendering (what `SCHEMAS.md` §2 prints). */
function typeExpression(spec) {
  if (spec.$ref !== undefined) return spec.$ref.slice('#/$defs/'.length);
  if ('const' in spec) return JSON.stringify(spec.const);
  if (spec.enum !== undefined) return spec.enum.join(' / ');
  if (spec.anyOf !== undefined) return spec.anyOf.map(typeExpression).join(' / ');
  if (spec.type === 'array') return `array<${typeExpression(spec.items)}>`;
  if (spec.type === 'object' && spec.additionalProperties?.$ref !== undefined) {
    return `map<Id,${typeExpression(spec.additionalProperties)}>`;
  }
  return spec.type;
}

function objectDefs(defs) {
  return Object.fromEntries(Object.entries(defs).filter(([, spec]) => spec.type === 'object' && spec.properties !== undefined));
}

/** Stable key-order-insensitive rendering, so a reordered field is not reported as drift. */
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}

/** Every definition present in one side and not the other, plus every body that differs. */
function compare(defs, table) {
  const problems = [];
  for (const name of Object.keys(defs)) if (!(name in table)) problems.push(`definition ${name} is absent from the shipped table`);
  for (const name of Object.keys(table)) if (!(name in defs)) problems.push(`definition ${name} is absent from ${SCHEMAS_PATH}`);
  for (const name of Object.keys(defs)) {
    if (!(name in table)) continue;
    if (canonical(defs[name]) !== canonical(table[name])) problems.push(`definition ${name} differs from ${SCHEMAS_PATH}`);
  }
  return problems.sort();
}

test('the definition table equals SCHEMAS.md $defs, definition for definition', () => {
  assert.deepEqual(compare(frozen, DEFS), []);
  assert.deepEqual(Object.keys(DEFS).sort(), frozenNames);
  assert.equal(Object.keys(DEFS).length, 75);
});

test('SCHEMAS.md declared counts match its own JSON, and the table matches both', () => {
  const objects = objectDefs(frozen);
  const fields = Object.values(objects).reduce((sum, spec) => sum + Object.keys(spec.properties).length, 0);
  const required = Object.values(objects).reduce((sum, spec) => sum + (spec.required ?? []).length, 0);

  assert.equal(Object.keys(objects).length, 63);
  assert.equal(fields, 427);
  assert.equal(required, 423);

  const shipped = objectDefs(DEFS);
  const shippedFields = Object.values(shipped).reduce((sum, spec) => sum + Object.keys(spec.properties).length, 0);
  const shippedRequired = Object.values(shipped).reduce((sum, spec) => sum + (spec.required ?? []).length, 0);
  assert.equal(Object.keys(shipped).length, 63);
  assert.equal(shippedFields, 427);
  assert.equal(shippedRequired, 423);
});

test('every object agrees on property names, required set and per-field type expression', () => {
  for (const [name, spec] of Object.entries(objectDefs(frozen))) {
    const shipped = DEFS[name];
    assert.ok(shipped, `${name} is absent from the table`);
    assert.deepEqual(Object.keys(shipped.properties).sort(), Object.keys(spec.properties).sort(), `${name} property set`);
    assert.deepEqual([...shipped.required].sort(), [...spec.required].sort(), `${name} required set`);
    for (const field of Object.keys(spec.properties)) {
      assert.equal(typeExpression(shipped.properties[field]), typeExpression(spec.properties[field]), `${name}.${field} type`);
    }
  }
});

test('the codec vocabulary is exactly the frozen document vocabulary', () => {
  const used = new Set();
  const walk = (node) => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    for (const [keyword, value] of Object.entries(node)) {
      if (keyword === 'properties') used.add(keyword);
      if (keyword === '$defs' || keyword === 'properties') {
        Object.values(value).forEach(walk);
        continue;
      }
      used.add(keyword);
      if (Array.isArray(value)) value.forEach(walk);
      else walk(value);
    }
  };
  walk({ $defs: frozen });

  const declared = new Set([...ASSERTION_KEYWORDS, ...ANNOTATION_KEYWORDS]);
  assert.deepEqual([...used].sort(), [...declared].sort());
});

test('the root oneOf names every envelope the shipped table can decode', () => {
  const envelopes = schemaBundle.oneOf.map((entry) => entry.$ref.slice('#/$defs/'.length));
  assert.equal(envelopes.length, 20);
  assert.equal(new Set(envelopes).size, 20);
  for (const name of envelopes) assert.ok(name in DEFS, `root oneOf names ${name}`);
});

test('error codes and retry classes match ERRORS.md and the frozen ErrorCode enum', () => {
  const rows = [...readFileSync(ERRORS_PATH, 'utf8').matchAll(/^\| (EFK_[A-Z0-9_]+) \| (.+) \| ([a-z-]+) \|$/gm)];
  assert.equal(rows.length, 58);
  assert.deepEqual([...ERROR_CODES].sort(), rows.map((row) => row[1]).sort());
  assert.deepEqual([...ERROR_CODES].sort(), [...frozen.ErrorCode.enum].sort());
  assert.equal(new Set(ERROR_CODES).size, 58);
  for (const [, code, , retry] of rows) assert.equal(RETRY_POLICY[code], retry, `${code} retry class`);
  assert.deepEqual([...new Set(Object.values(RETRY_POLICY))].sort(), [...frozen.ErrorEnvelope.properties.retry.enum].sort());
});

test('the version surface is derived from the frozen document', () => {
  assert.deepEqual([...SUPPORTED_SCHEMA_VERSIONS], frozen.ProtocolVersion.properties.schemaVersion.enum);
  assert.ok(SUPPORTED_SCHEMA_VERSIONS.includes(CURRENT_SCHEMA_VERSION));
  assert.equal(`urn:evofence:runtime:${CURRENT_SCHEMA_VERSION}`, schemaBundle.$id);
});

test('negative control: the comparator reports an injected field, so it is not a tautology', () => {
  const mutated = structuredClone(frozen);
  mutated.TaskContract.properties.zzzInjected = { type: 'string' };
  mutated.ProtocolVersion.properties.schemaVersion.enum = ['1.0.0'];
  delete mutated.Event.properties.payload;
  assert.deepEqual(compare(mutated, DEFS), [
    `definition Event differs from ${SCHEMAS_PATH}`,
    `definition ProtocolVersion differs from ${SCHEMAS_PATH}`,
    `definition TaskContract differs from ${SCHEMAS_PATH}`,
  ]);
  assert.deepEqual(compare({ ...frozen, Extra: { type: 'string' } }, DEFS), ['definition Extra is absent from the shipped table']);
  const reduced = structuredClone(DEFS);
  delete reduced.SessionView;
  assert.deepEqual(compare(frozen, reduced), ['definition SessionView is absent from the shipped table']);
});
