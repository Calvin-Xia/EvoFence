/**
 * Runtime behaviour of the identity brands, the version surface, and the single error envelope.
 * The document-level checks (codes vs `ERRORS.md`, versions vs `$defs`) live in
 * `schema-drift.test.ts`; this file only exercises what the shipped functions do.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ASSET_NAMESPACE,
  CURRENT_SCHEMA_VERSION,
  ERROR_CODES,
  RETRY_POLICY,
  RUNTIME_NAMESPACE,
  SUPPORTED_SCHEMA_VERSIONS,
  asDigest,
  asInstant,
  brand,
  fail,
  gateRuntimeVersion,
  isSupportedSchemaVersion,
  offersVersion,
} from '../dist/protocol/index.js';

test('identity brands are erased at runtime and carry no state', () => {
  assert.equal(brand('attempt-1'), 'attempt-1');
  assert.equal(typeof brand('attempt-1'), 'string');
  assert.equal(JSON.stringify(brand('attempt-1')), '"attempt-1"');
  assert.equal(asDigest(`sha256:${'0'.repeat(64)}`), `sha256:${'0'.repeat(64)}`);
  assert.equal(asInstant(1_700_000_000_000), 1_700_000_000_000);
  assert.equal(typeof asInstant(1), 'number');
});

test('namespaces and the accepted version set come from the frozen table', () => {
  assert.equal(RUNTIME_NAMESPACE, 'evofence.runtime/1');
  assert.equal(ASSET_NAMESPACE, 'evofence.assets/1');
  assert.deepEqual([...SUPPORTED_SCHEMA_VERSIONS], ['1.0.0', '1.1.0']);
  assert.equal(CURRENT_SCHEMA_VERSION, '1.1.0');
  assert.equal(isSupportedSchemaVersion('1.0.0'), true);
  assert.equal(isSupportedSchemaVersion('1.2.0'), false);
});

test('the version gate accepts only the exact runtime pair', () => {
  assert.equal(gateRuntimeVersion({ namespace: 'evofence.runtime/1', schemaVersion: '1.1.0' }), 'ok');
  assert.equal(gateRuntimeVersion({ namespace: 'evofence.runtime/1', schemaVersion: '2.0.0' }), 'unsupported');
  assert.equal(gateRuntimeVersion({ namespace: 'evofence.assets/1', schemaVersion: '1.0.0' }), 'unsupported');
});

test('compatibleProtocols is matched exactly: no ranges, no implicit newer-is-fine', () => {
  const runtime10 = { namespace: RUNTIME_NAMESPACE, schemaVersion: '1.0.0' };
  const runtime11 = { namespace: RUNTIME_NAMESPACE, schemaVersion: '1.1.0' };
  assert.equal(offersVersion([runtime10], runtime10), true);
  assert.equal(offersVersion([runtime10], runtime11), false);
  assert.equal(offersVersion([runtime10, runtime11], runtime11), true);
  assert.equal(offersVersion([], runtime11), false);
});

test('fail() attaches the frozen retry class and defaults to internal visibility', () => {
  assert.deepEqual(fail('EFK_EFFECT_UNKNOWN', 'no receipt'), {
    code: 'EFK_EFFECT_UNKNOWN',
    message: 'no receipt',
    retry: 'after-reconcile',
    refs: [],
    visibility: 'internal',
  });
  assert.deepEqual(fail('EFK_PROTOCOL_UNSUPPORTED', 'namespace', ['session-1'], 'private'), {
    code: 'EFK_PROTOCOL_UNSUPPORTED',
    message: 'namespace',
    retry: 'never',
    refs: ['session-1'],
    visibility: 'private',
  });
});

test('every code has a retry class covering the four frozen classes', () => {
  assert.equal(ERROR_CODES.length, 58);
  assert.equal(new Set(ERROR_CODES).size, 58);
  assert.deepEqual([...new Set(Object.values(RETRY_POLICY))].sort(), [
    'after-authorization',
    'after-reconcile',
    'after-refresh',
    'never',
  ]);
  for (const code of ERROR_CODES) assert.ok(RETRY_POLICY[code], `${code} has no retry class`);
});
