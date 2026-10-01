/**
 * l2_artifact_port cp1 — attempt binding (S09): graph, node, attempt, epoch and base revision must
 * match, and a result computed against a superseded base is refused before it is committed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { createMemoryArtifactStore } from '../dist/storage/index.js';
import { admitArtifact, bindingMismatches, checkBinding } from '../dist/kernel/artifacts/index.js';

const PROTOCOL = { namespace: 'evofence.runtime/1', schemaVersion: '1.1.0' };
const digestPort = {
  digest: (bytes) => `sha256:${createHash('sha256').update(bytes, 'utf8').digest('hex')}`,
};
const DIGEST = (seed) => digestPort.digest(String(seed));

const ok = (result, what) => {
  assert.equal(result.ok, true, `${what ?? 'call'} expected success, got ${JSON.stringify(result.error)}`);
  return result.value;
};
const err = (result, code, what) => {
  assert.equal(result.ok, false, `${what ?? 'call'} expected a typed rejection`);
  assert.equal(result.error.code, code, `${what ?? 'call'} rejected with ${result.error.code}`);
  return result.error;
};

const SCHEMA = { name: 'TaskEvidenceReport', version: '1.1.0', digest: DIGEST('schema') };

function binding(over = {}) {
  return {
    sessionId: 'session-1',
    hostSessionId: null,
    graph: { graphId: 'graph-1', revision: 7, digest: DIGEST('graph') },
    nodeId: 'node-1',
    attemptId: 'attempt-1',
    attemptOrdinal: 1,
    epoch: 3,
    baseDigest: DIGEST('base'),
    ...over,
  };
}

function artifact(id, over = {}) {
  const { content = id, ...rest } = over;
  return {
    protocol: PROTOCOL,
    id,
    digest: DIGEST(content),
    producer: { actorId: 'kernel-1', kind: 'kernel', identityRef: null },
    binding: binding(),
    schema: { ...SCHEMA },
    location: `artifact://${id}`,
    visibility: 'internal',
    expiresAt: null,
    partition: 'not-evaluation',
    ...rest,
  };
}

const nodeProduct = (optionOver = {}, bindingOver = {}) => ({
  productKind: 'node-product',
  schema: { ...SCHEMA },
  binding: binding(bindingOver),
  ...optionOver,
});

test('a reference bound to the consuming attempt passes and reports its binding', () => {
  const ref = artifact('art-1');
  const bound = ok(checkBinding(ref, nodeProduct()));
  assert.equal(bound.baseDigest, DIGEST('base'));
  assert.deepEqual(bindingMismatches(bound, binding()), []);
});

test('a node product with no binding at all is refused', () => {
  const ref = artifact('art-1', { binding: null });
  const failure = err(checkBinding(ref, nodeProduct()), 'EFK_ARTIFACT_BINDING_MISMATCH');
  assert.match(failure.message, /carries no attempt binding/);
});

test('every binding field is checked, and the refusal names the fields that disagree', () => {
  const cases = {
    'graph.graphId': { graph: { graphId: 'graph-2', revision: 7, digest: DIGEST('graph') } },
    'graph.revision': { graph: { graphId: 'graph-1', revision: 8, digest: DIGEST('graph') } },
    'graph.digest': { graph: { graphId: 'graph-1', revision: 7, digest: DIGEST('other-graph') } },
    nodeId: { nodeId: 'node-2' },
    attemptId: { attemptId: 'attempt-2' },
    attemptOrdinal: { attemptOrdinal: 2 },
    epoch: { epoch: 4 },
    baseDigest: { baseDigest: DIGEST('other-base') },
  };
  for (const [field, over] of Object.entries(cases)) {
    const ref = artifact('art-1', { binding: binding(over) });
    const failure = err(checkBinding(ref, nodeProduct()), 'EFK_ARTIFACT_BINDING_MISMATCH', field);
    assert.match(failure.message, new RegExp(field.replace('.', '\\.')), `${field} must be named`);
  }
});

test('a result computed against a superseded base is refused', () => {
  const ref = artifact('art-old-base', { binding: binding({ baseDigest: DIGEST('base-v1') }) });
  const failure = err(checkBinding(ref, nodeProduct({}, { baseDigest: DIGEST('base-v2') })), 'EFK_ARTIFACT_BINDING_MISMATCH');
  assert.match(failure.message, /baseDigest/);
});

test('the superseded-base result never reaches the store, so nothing is committed', () => {
  const store = createMemoryArtifactStore({ digest: digestPort });
  const stale = artifact('art-old-base', { content: 'stale-result', binding: binding({ baseDigest: DIGEST('base-v1') }) });
  err(admitArtifact({ ref: stale, bytes: 'stale-result', expectation: nodeProduct({}, { baseDigest: DIGEST('base-v2') }) }, store), 'EFK_ARTIFACT_BINDING_MISMATCH');
  assert.deepEqual(store.ids(), [], 'a refused submission must leave no artifact behind');

  const current = artifact('art-current', { content: 'current-result', binding: binding({ baseDigest: DIGEST('base-v2') }) });
  const stored = ok(admitArtifact({ ref: current, bytes: 'current-result', expectation: nodeProduct({}, { baseDigest: DIGEST('base-v2') }) }, store));
  assert.equal(stored.disposition, 'stored');
  assert.equal(ok(store.get(current)), 'current-result');
});

test('a pre-source snapshot may carry no binding and asserts nothing', () => {
  const ref = artifact('snapshot-1', { binding: null });
  const expectation = { productKind: 'pre-source', schema: { ...SCHEMA }, binding: null };
  assert.equal(checkBinding(ref, expectation).ok, true);
  assert.equal(ok(checkBinding(ref, expectation)), null);
});

test('a pre-source snapshot bound by a consuming command must match that binding', () => {
  const ref = artifact('snapshot-1', { binding: null });
  const expectation = { productKind: 'pre-source', schema: { ...SCHEMA }, binding: binding() };
  err(checkBinding(ref, expectation), 'EFK_ARTIFACT_BINDING_MISMATCH', 'unbound snapshot under a bound expectation');
  ok(checkBinding(artifact('snapshot-1'), expectation));
});

test('the declared schema version is checked on the writer path too', () => {
  const store = createMemoryArtifactStore({ digest: digestPort });
  const ref = artifact('art-1', { content: 'x', schema: { name: 'TaskEvidenceReport', version: '1.2.0', digest: DIGEST('schema') } });
  err(admitArtifact({ ref, bytes: 'x', expectation: nodeProduct() }, store), 'EFK_ARTIFACT_BINDING_MISMATCH', 'schema version');
  assert.deepEqual(store.ids(), []);
});
