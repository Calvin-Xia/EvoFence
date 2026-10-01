/** Regression evidence for review M1-M4 and N1-N3; every test is flat. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createMemoryArtifactStore } from '../dist/storage/index.js';
import { decode } from '../dist/protocol/index.js';
import {
  admitArtifact, bindingMismatches, checkBinding, defaultReportRefs, isRestrictedPartition,
  partitionFeedback, readArtifact, verifyForConsumer, withheldReason,
} from '../dist/kernel/artifacts/index.js';

const digestPort = { digest: (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
const digest = (seed) => digestPort.digest(seed);
const schema = { name: 'TaskEvidenceReport', version: '1.1.0', digest: digest('schema') };
const binding = (over = {}) => ({
  sessionId: 'session-1', hostSessionId: null,
  graph: { graphId: 'graph-1', revision: 7, digest: digest('graph') },
  nodeId: 'node-1', attemptId: 'attempt-1', attemptOrdinal: 1, epoch: 3,
  baseDigest: digest('base'), ...over,
});
const expectation = (over = {}) => ({ productKind: 'node-product', schema, binding: binding(over) });
const artifact = (id, over = {}) => ({
  protocol: { namespace: 'evofence.runtime/1', schemaVersion: '1.1.0' },
  id, digest: digest(id), producer: { actorId: 'kernel-1', kind: 'kernel', identityRef: null },
  binding: binding(), schema, location: `artifact://${id}`, visibility: 'internal',
  expiresAt: null, partition: 'train', ...over,
});
const ok = (result) => {
  assert.equal(result.ok, true, JSON.stringify(result.error));
  return result.value;
};
const err = (result, code) => {
  assert.equal(result.ok, false, 'expected typed rejection');
  assert.equal(result.error.code, code);
  return result.error;
};
function storeWith(refs = []) {
  const store = createMemoryArtifactStore({ digest: digestPort });
  for (const ref of refs) ok(store.put(ref, ref.id));
  return store;
}
function noReads() {
  const calls = [];
  return {
    calls, ids: () => [],
    put: () => { throw new Error('rejected material must not be written'); },
    get: (ref) => { calls.push(ref.id); throw new Error('rejected material must not be read'); },
  };
}
const assetRequest = (contentRefs, sourceTraces, revokedDependencies = []) => ({
  role: 'asset', contentRefs, sourceTraces, revokedDependencies, at: 0,
});

test('M1: stale binding rejection is independent of missing or stored bytes for both bound consumers', () => {
  const ref = artifact('stale-result', { binding: binding({ baseDigest: digest('old-base') }) });
  for (const role of ['workspace', 'evaluator']) {
    const request = { role, refs: [ref], expectation: expectation(), at: 0 };
    const absent = err(verifyForConsumer(request, storeWith()), 'EFK_ARTIFACT_BINDING_MISMATCH');
    const present = err(verifyForConsumer(request, storeWith([ref])), 'EFK_ARTIFACT_BINDING_MISMATCH');
    assert.deepEqual(absent, present);
    const spy = noReads();
    err(verifyForConsumer(request, spy), 'EFK_ARTIFACT_BINDING_MISMATCH');
    assert.deepEqual(spy.calls, []);
  }
});

test('M1: producer and every schema axis reject before retrieving bytes for both bound consumers', () => {
  const badRefs = [
    artifact('bad-producer', { producer: { actorId: 'human-1', kind: 'human', identityRef: null } }),
    ...[
      { name: 'OtherReport' }, { version: '1.2.0' }, { digest: digest('other-schema') },
    ].map((over, index) => artifact(`bad-schema-${index}`, { schema: { ...schema, ...over } })),
  ];
  for (const role of ['workspace', 'evaluator']) {
    for (const ref of badRefs) {
      const request = { role, refs: [ref], expectation: expectation(), at: 0 };
      const absent = err(verifyForConsumer(request, storeWith()), 'EFK_ARTIFACT_BINDING_MISMATCH');
      assert.deepEqual(err(verifyForConsumer(request, storeWith([ref])), 'EFK_ARTIFACT_BINDING_MISMATCH'), absent);
      const spy = noReads();
      err(verifyForConsumer(request, spy), 'EFK_ARTIFACT_BINDING_MISMATCH');
      assert.deepEqual(spy.calls, []);
    }
  }
});

test('M1: privacy still precedes expiry, producer, schema and binding refusal', () => {
  const ref = artifact('withheld-stale', {
    visibility: 'held-out', partition: 'held-out', expiresAt: 0,
    binding: binding({ baseDigest: digest('old-base') }),
    schema: { ...schema, version: '1.2.0' },
    producer: { actorId: 'human-1', kind: 'human', identityRef: null },
  });
  const spy = noReads();
  err(verifyForConsumer({ role: 'workspace', refs: [ref], expectation: expectation(), at: 0 }, spy), 'EFK_PRIVACY_VIOLATION');
  assert.deepEqual(spy.calls, []);
});

test('M2: revoked qualification rejects before any material read regardless of store state', () => {
  const content = artifact('asset-content');
  const trace = artifact('asset-trace');
  const request = assetRequest([content], [trace], ['revoked-dep']);
  const absent = err(verifyForConsumer(request, storeWith()), 'EFK_ASSET_QUALIFICATION_INVALID');
  assert.deepEqual(err(verifyForConsumer(request, storeWith([content, trace])), 'EFK_ASSET_QUALIFICATION_INVALID'), absent);
  const spy = noReads();
  err(verifyForConsumer(request, spy), 'EFK_ASSET_QUALIFICATION_INVALID');
  const forbidden = artifact('forbidden', { visibility: 'final', partition: 'final', expiresAt: 0 });
  err(verifyForConsumer(assetRequest([forbidden], [forbidden], ['revoked-dep']), spy), 'EFK_ASSET_QUALIFICATION_INVALID');
  err(verifyForConsumer(assetRequest([], [], ['revoked-dep']), spy), 'EFK_ASSET_QUALIFICATION_INVALID');
  assert.deepEqual(spy.calls, []);
});

test('M3: unknown visibility and partition enums are typed failures at report and classification entries', () => {
  const badEnums = [
    { visibility: 'secret-tier' }, { partition: 'holdout' },
    { visibility: '__proto__' }, { partition: 'constructor' },
    { visibility: 'toString', partition: '__proto__' },
    { visibility: 'private', partition: 'holdout' },
  ];
  for (const over of badEnums) {
    const ref = artifact('malformed', over);
    err(defaultReportRefs([artifact('reportable'), ref]), 'EFK_SCHEMA_INVALID');
    for (const audience of ['author', 'evaluator', 'report', 'asset-staging']) {
      err(partitionFeedback([artifact('reportable'), ref], audience), 'EFK_SCHEMA_INVALID');
      err(withheldReason(ref, audience), 'EFK_SCHEMA_INVALID');
    }
    err(isRestrictedPartition(ref), 'EFK_SCHEMA_INVALID');
    assert.equal('value' in defaultReportRefs([ref]), false, 'a refused report exposes no partial partition');
  }
});

test('M3: malformed enums reject without relying on a store codec in direct and consumer reads', () => {
  for (const over of [{ visibility: 'secret-tier' }, { partition: 'holdout' }]) {
    const ref = artifact('malformed', over);
    const spy = noReads();
    for (const audience of ['author', 'evaluator', 'report', 'asset-staging']) {
      err(readArtifact(ref, audience, 0, spy), 'EFK_SCHEMA_INVALID');
    }
    for (const role of ['workspace', 'evaluator']) {
      err(verifyForConsumer({ role, refs: [ref], expectation: expectation(), at: 0 }, spy), 'EFK_SCHEMA_INVALID');
    }
    err(verifyForConsumer(assetRequest([ref], [artifact('trace')]), spy), 'EFK_SCHEMA_INVALID');
    assert.deepEqual(spy.calls, []);
    const content = artifact('content');
    err(verifyForConsumer(assetRequest([content], [ref]), storeWith([content])), 'EFK_SCHEMA_INVALID');
  }
});

test('M4: either empty material list and both empty lists reject before any asset read', () => {
  const content = artifact('content');
  const trace = artifact('trace');
  for (const [contents, traces] of [[[], []], [[], [trace]], [[content], []]]) {
    const spy = noReads();
    const request = assetRequest(contents, traces);
    const absent = err(verifyForConsumer(request, storeWith()), 'EFK_SCHEMA_INVALID');
    assert.deepEqual(err(verifyForConsumer(request, storeWith([content, trace])), 'EFK_SCHEMA_INVALID'), absent);
    err(verifyForConsumer(request, spy), 'EFK_SCHEMA_INVALID');
    assert.deepEqual(spy.calls, []);
  }
  assert.equal(ok(verifyForConsumer(assetRequest([content], [trace]), storeWith([content, trace]))).evidence.length, 2);
});

test('N1: exact expiry refuses before bytes and before consumer binding, while null never expires', () => {
  const ref = artifact('expires-now', { expiresAt: 10 });
  const store = storeWith([ref]);
  assert.equal(ok(readArtifact(ref, 'author', 9, store)), ref.id);
  const spy = noReads();
  err(readArtifact(ref, 'author', 10, spy), 'EFK_ARTIFACT_UNAVAILABLE');
  for (const role of ['workspace', 'evaluator']) {
    err(verifyForConsumer({ role, refs: [ref], expectation: expectation({ baseDigest: digest('different') }), at: 10 }, spy), 'EFK_ARTIFACT_UNAVAILABLE');
  }
  assert.deepEqual(spy.calls, []);
  const timeless = artifact('no-expiry');
  assert.equal(ok(readArtifact(timeless, 'author', Number.MAX_SAFE_INTEGER, storeWith([timeless]))), timeless.id);
});

test('N2: kernel and host sessions must match on writer and bound consumer paths', () => {
  for (const over of [{ sessionId: 'session-2' }, { hostSessionId: 'host-2' }]) {
    const ref = artifact('different-session', { binding: binding(over) });
    ok(decode('Binding', ref.binding));
    assert.deepEqual(bindingMismatches(ref.binding, binding()), Object.keys(over));
    err(checkBinding(ref, expectation()), 'EFK_ARTIFACT_BINDING_MISMATCH');
    const spy = noReads();
    err(admitArtifact({ ref, bytes: ref.id, expectation: expectation() }, spy), 'EFK_ARTIFACT_BINDING_MISMATCH');
    for (const role of ['workspace', 'evaluator']) {
      err(verifyForConsumer({ role, refs: [ref], expectation: expectation(), at: 0 }, spy), 'EFK_ARTIFACT_BINDING_MISMATCH');
    }
    assert.deepEqual(spy.calls, []);
  }
});

test('N2: hostSessionId preserves frozen null and string semantics in both directions', () => {
  for (const hostSessionId of [null, 'host-1']) {
    const ref = artifact('session-bound', { binding: binding({ hostSessionId }) });
    ok(decode('Binding', ref.binding));
    ok(checkBinding(ref, expectation({ hostSessionId })));
    const other = hostSessionId === null ? 'host-1' : null;
    err(checkBinding(ref, expectation({ hostSessionId: other })), 'EFK_ARTIFACT_BINDING_MISMATCH');
    const sourceExpectation = { ...expectation({ hostSessionId: other }), productKind: 'pre-source' };
    err(checkBinding(ref, sourceExpectation), 'EFK_ARTIFACT_BINDING_MISMATCH');
  }
});

test('N3: privacy refusals contain no withheld id, locator or digest for any restricted audience', () => {
  for (const over of [{ visibility: 'private' }, { visibility: 'held-out' }, { partition: 'held-out' }, { partition: 'final' }]) {
    const ref = artifact('withheld-identity-42', over);
    const spy = noReads();
    const refusals = ['author', 'report', 'asset-staging'].map((audience) => readArtifact(ref, audience, 0, spy));
    refusals.push(verifyForConsumer({ role: 'workspace', refs: [ref], expectation: expectation(), at: 0 }, spy));
    for (const refusal of refusals) {
      const failure = err(refusal, 'EFK_PRIVACY_VIOLATION');
      assert.deepEqual(failure.refs, []);
      const rendered = JSON.stringify(refusal);
      for (const forbidden of [ref.id, ref.location, ref.digest]) assert.equal(rendered.includes(forbidden), false);
    }
    assert.deepEqual(spy.calls, []);
  }
});

test('N3: asset protocol refusals contain no restricted material identity in message or refs', () => {
  for (const partition of ['held-out', 'final']) {
    const ref = artifact('restricted-identity-42', { partition });
    const content = artifact('content');
    const trace = artifact('trace');
    const refusals = [
      verifyForConsumer(assetRequest([ref], [trace]), noReads()),
      verifyForConsumer(assetRequest([content], [ref]), storeWith([content])),
    ];
    for (const refusal of refusals) {
      const failure = err(refusal, 'EFK_EVALUATION_PROTOCOL_MISMATCH');
      assert.deepEqual(failure.refs, []);
      for (const forbidden of [ref.id, ref.location, ref.digest]) assert.equal(JSON.stringify(refusal).includes(forbidden), false);
    }
  }
});
