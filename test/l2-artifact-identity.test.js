/**
 * l2_artifact_port cp1 — producer attribution, the expected schema version, and the read path that
 * never substitutes a reference summary for content.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { createMemoryArtifactStore } from '../dist/storage/index.js';
import { admitArtifact, attributeProducer, checkAvailability, matchSchema, readArtifact } from '../dist/kernel/artifacts/index.js';

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

function artifact(id, over = {}) {
  const { content = id, ...rest } = over;
  return {
    protocol: PROTOCOL,
    id,
    digest: DIGEST(content),
    producer: { actorId: 'kernel-1', kind: 'kernel', identityRef: null },
    binding: null,
    schema: { ...SCHEMA },
    location: `artifact://${id}`,
    visibility: 'internal',
    expiresAt: null,
    partition: 'not-evaluation',
    ...rest,
  };
}

function spyStore() {
  const calls = [];
  return {
    calls,
    put: (ref, bytes) => {
      calls.push(['put', ref.id, bytes]);
      return { ok: true, value: { disposition: 'stored' } };
    },
    get: (ref) => {
      calls.push(['get', ref.id]);
      throw new Error('the store must not be consulted for a withheld reference');
    },
    ids: () => [],
  };
}

test('a kernel producer is attributable and returned unchanged', () => {
  const ref = artifact('art-1');
  assert.deepEqual(ok(attributeProducer(ref)), ref.producer);
});

test('a human producer with no verified identity reference cannot be attributed', () => {
  const ref = artifact('art-1', { producer: { actorId: 'human-1', kind: 'human', identityRef: null } });
  err(attributeProducer(ref), 'EFK_ARTIFACT_BINDING_MISMATCH', 'unattributable human producer');
});

test('a human producer carrying a verified identity reference is attributable', () => {
  const identity = artifact('identity-1');
  const ref = artifact('art-1', { producer: { actorId: 'human-1', kind: 'human', identityRef: identity } });
  assert.equal(ok(attributeProducer(ref)).actorId, 'human-1');
});

test('the declared schema triple must match the expected name, version and digest', () => {
  const ref = artifact('art-1');
  assert.equal(ok(matchSchema(ref, { ...SCHEMA })).version, '1.1.0');
  err(matchSchema(ref, { ...SCHEMA, name: 'OtherReport' }), 'EFK_ARTIFACT_BINDING_MISMATCH', 'name');
  err(matchSchema(ref, { ...SCHEMA, version: '1.2.0' }), 'EFK_ARTIFACT_BINDING_MISMATCH', 'version');
  err(matchSchema(ref, { ...SCHEMA, digest: DIGEST('other-schema') }), 'EFK_ARTIFACT_BINDING_MISMATCH', 'digest');
});

test('readArtifact resolves the real bytes through the injected store', () => {
  const store = createMemoryArtifactStore({ digest: digestPort });
  const ref = artifact('art-1', { content: 'evidence-bytes' });
  ok(store.put(ref, 'evidence-bytes'));
  assert.equal(ok(readArtifact(ref, 'author', 0, store)), 'evidence-bytes');
});

test('a reference whose content is not stored is unavailable, never answered from its own summary', () => {
  const store = createMemoryArtifactStore({ digest: digestPort });
  const ref = artifact('art-missing');
  const failure = err(readArtifact(ref, 'author', 0, store), 'EFK_ARTIFACT_UNAVAILABLE');
  assert.match(failure.message, /art-missing/);
});

test('an expired reference is unavailable even while the store still holds its bytes', () => {
  const store = createMemoryArtifactStore({ digest: digestPort });
  const ref = artifact('art-1', { content: 'evidence-bytes', expiresAt: 1000 });
  ok(store.put(ref, 'evidence-bytes'));
  assert.equal(ok(checkAvailability(ref, 999)).id, 'art-1');
  err(checkAvailability(ref, 1000), 'EFK_ARTIFACT_UNAVAILABLE', 'exact expiry instant is expired');
  err(readArtifact(ref, 'author', 5000, store), 'EFK_ARTIFACT_UNAVAILABLE', 'expired read');
});

test('a withheld reference is refused before the store is consulted', () => {
  const store = spyStore();
  const ref = artifact('art-heldout', { visibility: 'held-out', partition: 'held-out' });
  err(readArtifact(ref, 'author', 0, store), 'EFK_PRIVACY_VIOLATION', 'author reading held-out');
  assert.deepEqual(store.calls, []);
});

test('the store boundary refusals propagate unchanged: digest mismatch and a malformed reference', () => {
  const store = createMemoryArtifactStore({ digest: digestPort });
  const ref = artifact('art-1', { content: 'declared-bytes' });
  const expectation = { productKind: 'pre-source', schema: { ...SCHEMA }, binding: null };
  err(admitArtifact({ ref, bytes: 'tampered-bytes', expectation }, store), 'EFK_ARTIFACT_DIGEST_MISMATCH', 'bytes vs digest');
  err(admitArtifact({ ref: { ...ref, extra: true }, bytes: 'declared-bytes', expectation }, store), 'EFK_SCHEMA_INVALID', 'malformed ref');
  assert.deepEqual(store.ids(), []);
});
