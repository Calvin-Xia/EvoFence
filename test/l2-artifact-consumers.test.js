/**
 * l2_artifact_port cp3 — the single consumer entry (`verifyForConsumer`) for workspace, evaluator
 * and asset, and the frozen error matrix each of their failure paths produces.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { createMemoryArtifactStore } from '../dist/storage/index.js';
import { ERROR_CODES } from '../dist/protocol/index.js';
import { ARTIFACT_ERROR_MATRIX, verifyForConsumer } from '../dist/storage/artifacts/index.js';

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

const nodeProduct = (bindingOver = {}) => ({ productKind: 'node-product', schema: { ...SCHEMA }, binding: binding(bindingOver) });

function storeWith(refs) {
  const store = createMemoryArtifactStore({ digest: digestPort });
  for (const [ref, bytes] of refs) {
    const stored = store.put(ref, bytes);
    assert.equal(stored.ok, true, `fixture ${ref.id} must store: ${JSON.stringify(stored.error)}`);
  }
  return store;
}

test('the workspace consumer admits a bound attempt artifact and receives its bytes', () => {
  const ref = artifact('art-1', { content: 'diff-bytes' });
  const admission = ok(verifyForConsumer({ role: 'workspace', refs: [ref], expectation: nodeProduct(), at: 0 }, storeWith([[ref, 'diff-bytes']])));
  assert.equal(admission.role, 'workspace');
  assert.equal(admission.audience, 'author');
  assert.deepEqual(admission.evidence, [{ ref, bytes: 'diff-bytes' }]);
});

test('the workspace consumer refuses a result bound to a superseded base instead of admitting it', () => {
  const ref = artifact('art-1', { content: 'stale', binding: binding({ baseDigest: DIGEST('base-v1') }) });
  err(
    verifyForConsumer({ role: 'workspace', refs: [ref], expectation: nodeProduct({ baseDigest: DIGEST('base-v2') }), at: 0 }, storeWith([[ref, 'stale']])),
    'EFK_ARTIFACT_BINDING_MISMATCH',
  );
});

test('the workspace consumer cannot read held-out evidence', () => {
  const ref = artifact('heldout-1', { content: 'held-out', visibility: 'held-out', partition: 'held-out' });
  err(
    verifyForConsumer({ role: 'workspace', refs: [ref], expectation: nodeProduct(), at: 0 }, storeWith([[ref, 'held-out']])),
    'EFK_PRIVACY_VIOLATION',
  );
});

test('the evaluator consumer reads held-out evidence, which is its subject matter', () => {
  const ref = artifact('heldout-1', { content: 'held-out', visibility: 'held-out', partition: 'held-out' });
  const admission = ok(
    verifyForConsumer({ role: 'evaluator', refs: [ref], expectation: nodeProduct(), at: 0 }, storeWith([[ref, 'held-out']])),
  );
  assert.equal(admission.audience, 'evaluator');
  assert.equal(admission.evidence[0].bytes, 'held-out');
});

test('the evaluator consumer refuses an artifact whose schema is not the expected version', () => {
  const ref = artifact('art-1', { content: 'evidence', schema: { name: 'TaskEvidenceReport', version: '1.2.0', digest: DIGEST('schema') } });
  err(
    verifyForConsumer({ role: 'evaluator', refs: [ref], expectation: nodeProduct(), at: 0 }, storeWith([[ref, 'evidence']])),
    'EFK_ARTIFACT_BINDING_MISMATCH',
  );
});

test('the asset consumer admits train source traces and content references with their bytes', () => {
  const content = artifact('asset-content', { content: 'skill', partition: 'train' });
  const trace = artifact('asset-trace', { content: 'trace', partition: 'train' });
  const admission = ok(
    verifyForConsumer(
      { role: 'asset', contentRefs: [content], sourceTraces: [trace], revokedDependencies: [], at: 0 },
      storeWith([[content, 'skill'], [trace, 'trace']]),
    ),
  );
  assert.equal(admission.audience, 'asset-staging');
  assert.deepEqual(admission.evidence.map((item) => item.bytes), ['skill', 'trace']);
});

test('an asset source trace that is not from train is an evaluation protocol mismatch', () => {
  const content = artifact('asset-content', { partition: 'train' });
  const trace = artifact('dev-trace', { content: 'trace', partition: 'dev' });
  err(
    verifyForConsumer({ role: 'asset', contentRefs: [content], sourceTraces: [trace], revokedDependencies: [], at: 0 }, storeWith([[content, content.id], [trace, 'trace']])),
    'EFK_EVALUATION_PROTOCOL_MISMATCH',
  );
});

test('asset content from held-out or final never becomes asset material', () => {
  const trace = artifact('train-trace', { partition: 'train' });
  for (const partition of ['held-out', 'final']) {
    const ref = artifact(`content-${partition}`, { content: 'x', partition });
    err(
      verifyForConsumer({ role: 'asset', contentRefs: [ref], sourceTraces: [trace], revokedDependencies: [], at: 0 }, storeWith([[ref, 'x']])),
      'EFK_EVALUATION_PROTOCOL_MISMATCH',
      partition,
    );
  }
});

test('private asset material is a privacy violation for the asset-staging audience', () => {
  const trace = artifact('train-trace', { partition: 'train' });
  const ref = artifact('private-content', { content: 'secret', visibility: 'private', partition: 'train' });
  err(
    verifyForConsumer({ role: 'asset', contentRefs: [ref], sourceTraces: [trace], revokedDependencies: [], at: 0 }, storeWith([[ref, 'secret']])),
    'EFK_PRIVACY_VIOLATION',
  );
});

test('a revoked dependency invalidates the asset qualification', () => {
  const content = artifact('asset-content', { content: 'skill', partition: 'train' });
  const trace = artifact('asset-trace', { content: 'trace', partition: 'train' });
  const failure = err(
    verifyForConsumer(
      { role: 'asset', contentRefs: [content], sourceTraces: [trace], revokedDependencies: ['dep-1'], at: 0 },
      storeWith([[content, 'skill'], [trace, 'trace']]),
    ),
    'EFK_ASSET_QUALIFICATION_INVALID',
  );
  assert.deepEqual(failure.refs, ['dep-1']);
});

test('an expired reference is unavailable to every consumer', () => {
  const ref = artifact('expired-1', { content: 'evidence', expiresAt: 10 });
  err(
    verifyForConsumer({ role: 'evaluator', refs: [ref], expectation: nodeProduct(), at: 10 }, storeWith([[ref, 'evidence']])),
    'EFK_ARTIFACT_UNAVAILABLE',
  );
});

test('the error matrix names only frozen codes and covers every code this lane can return', () => {
  const reported = Object.keys(ARTIFACT_ERROR_MATRIX);
  for (const code of reported) {
    assert.equal(ERROR_CODES.includes(code), true, `${code} is not a frozen ErrorCode`);
    assert.equal(ARTIFACT_ERROR_MATRIX[code].length > 0, true, `${code} has no documented trigger`);
  }
  assert.deepEqual(reported.sort(), [
    'EFK_ARTIFACT_BINDING_MISMATCH',
    'EFK_ARTIFACT_DIGEST_MISMATCH',
    'EFK_ARTIFACT_UNAVAILABLE',
    'EFK_ASSET_QUALIFICATION_INVALID',
    'EFK_EVALUATION_PROTOCOL_MISMATCH',
    'EFK_PRIVACY_VIOLATION',
    'EFK_SCHEMA_INVALID',
  ]);
});
