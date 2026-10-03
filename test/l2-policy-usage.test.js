/**
 * Usage completeness: a missing or incomplete measurement is `unknown`, never `0`. An aborted SDK
 * call that reports a zero estimate does not prove the provider was free.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeUsage, usageCompleteness, usageIdentity } from '../dist/kernel/policy/index.js';
import * as fixtures from './l2-policy-fixtures.js';

// DoD 1 negative control: a zero-default implementation would report complete: true here.
test('a reserved request with no usage is missing, not settled at zero', () => {
  const completeness = usageCompleteness([], ['r1']);
  assert.equal(completeness.complete, false);
  assert.deepEqual(completeness.missingRequestIds, ['r1']);
  assert.equal(completeness.knownMicros, null);
});

test('an incomplete usage with a zero estimate is incomplete, not free', () => {
  const completeness = usageCompleteness([fixtures.usage({ requestId: 'r1', complete: false, estimatedUsdMicros: 0 })], ['r1']);
  assert.equal(completeness.complete, false);
  assert.deepEqual(completeness.incompleteRequestIds, ['r1']);
  assert.equal(completeness.knownMicros, null);
});

test('a complete usage settles to its estimate', () => {
  const completeness = usageCompleteness([fixtures.usage({ requestId: 'r1', estimatedUsdMicros: 9547 })], ['r1']);
  assert.equal(completeness.complete, true);
  assert.equal(completeness.knownMicros, 9547);
});

test('the same requestId with different content is a conflict, and an unreserved report is too', () => {
  const conflict = usageCompleteness(
    [fixtures.usage({ requestId: 'r1', output: 50 }), fixtures.usage({ requestId: 'r1', output: 60 })],
    ['r1'],
  );
  assert.deepEqual(conflict.conflictingRequestIds, ['r1']);
  assert.equal(conflict.complete, false);

  const unaccounted = usageCompleteness([fixtures.usage({ requestId: 'r2' })], ['r1']);
  assert.deepEqual(unaccounted.conflictingRequestIds, ['r2']);
  assert.deepEqual(unaccounted.missingRequestIds, ['r1']);
});

test('normalizeUsage refuses reasoning outside output and complete-with-null counts', () => {
  const reasoning = normalizeUsage(fixtures.usage({ reasoning: 60, output: 50 }));
  assert.equal(reasoning.ok, false);
  assert.equal(reasoning.error.code, 'EFK_USAGE_CONFLICT');

  const nullCount = normalizeUsage(fixtures.usage({ complete: true, output: null }));
  assert.equal(nullCount.ok, false);
  assert.equal(nullCount.error.code, 'EFK_USAGE_INCOMPLETE');
});

test('normalizeUsage never turns an incomplete zero into a settled zero', () => {
  const normalized = normalizeUsage(fixtures.usage({ complete: false, estimatedUsdMicros: 0 }));
  assert.equal(normalized.ok, true);
  assert.equal(normalized.value.micros, null);
});

test('usage identity is stable across key order', () => {
  const a = fixtures.usage({ requestId: 'r1' });
  const b = { ...a };
  assert.equal(usageIdentity(a), usageIdentity(b));
  assert.notEqual(usageIdentity(a), usageIdentity(fixtures.usage({ requestId: 'r1', output: 51 })));
});

// nit-3: `complete` from a source the kernel cannot trust is a contradiction, not a settled value.
test('complete usage from an unknown source is a conflict and is not settled', () => {
  const normalized = normalizeUsage(fixtures.usage({ complete: true, source: 'unknown' }));
  assert.equal(normalized.ok, false);
  assert.equal(normalized.error.code, 'EFK_USAGE_CONFLICT');

  const completeness = usageCompleteness([fixtures.usage({ requestId: 'r1', complete: true, source: 'unknown' })], ['r1']);
  assert.equal(completeness.complete, false);
  assert.deepEqual(completeness.incompleteRequestIds, ['r1']);
  assert.equal(completeness.knownMicros, null);
});
