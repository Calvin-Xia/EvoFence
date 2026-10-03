/**
 * l2_state_store — the ArtifactStore reference implementation: content addressing, immutability and
 * the S01 boundary rules that decide what may enter the store at all.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { createMemoryArtifactStore } from '../dist/storage/index.js';

const PROTOCOL = { namespace: 'evofence.runtime/1', schemaVersion: '1.1.0' };
const digestPort = {
  digest: (bytes) => `sha256:${createHash('sha256').update(bytes, 'utf8').digest('hex')}`,
};

const ok = (result, what) => {
  assert.equal(result.ok, true, `${what ?? 'call'} expected success, got ${JSON.stringify(result.error)}`);
  return result.value;
};
const err = (result, code, what) => {
  assert.equal(result.ok, false, `${what ?? 'call'} expected a typed rejection`);
  assert.equal(result.error.code, code);
  return result.error;
};

function artifactRef(id, bytes, over = {}) {
  return {
    protocol: PROTOCOL,
    id,
    digest: digestPort.digest(bytes),
    producer: { actorId: 'kernel-1', kind: 'kernel', identityRef: null },
    binding: null,
    schema: { name: 'TaskEvidenceReport', version: '1.1.0', digest: digestPort.digest('schema') },
    location: `artifact://${id}`,
    visibility: 'internal',
    expiresAt: null,
    partition: 'not-evaluation',
    ...over,
  };
}

test('put/get round-trips bytes and reports an identical re-put as duplicate', () => {
  const store = createMemoryArtifactStore({ digest: digestPort });
  const ref = artifactRef('art-1', 'hello');
  assert.equal(ok(store.put(ref, 'hello')).disposition, 'stored');
  assert.equal(ok(store.get(ref)), 'hello');
  assert.equal(ok(store.put(ref, 'hello')).disposition, 'duplicate');
  assert.deepEqual(store.ids(), ['art-1']);
});

test('bytes that do not hash to the reference digest are refused', () => {
  const store = createMemoryArtifactStore({ digest: digestPort });
  err(store.put(artifactRef('art-1', 'hello'), 'tampered'), 'EFK_ARTIFACT_DIGEST_MISMATCH');
  assert.deepEqual(store.ids(), []);
});

test('an artifact id is immutable: the same id with another digest is refused, never overwritten', () => {
  const store = createMemoryArtifactStore({ digest: digestPort });
  const first = artifactRef('art-1', 'one');
  ok(store.put(first, 'one'));
  err(store.put(artifactRef('art-1', 'two'), 'two'), 'EFK_ARTIFACT_DIGEST_MISMATCH');
  assert.equal(ok(store.get(first)), 'one');
});

test('a missing artifact is unavailable and a re-bound digest is a binding mismatch', () => {
  const store = createMemoryArtifactStore({ digest: digestPort });
  const ref = artifactRef('art-1', 'hello');
  err(store.get(ref), 'EFK_ARTIFACT_UNAVAILABLE');
  ok(store.put(ref, 'hello'));
  err(store.get({ ...ref, digest: digestPort.digest('something else') }), 'EFK_ARTIFACT_BINDING_MISMATCH');
});

test('a credential in the locator is a privacy violation (S01)', () => {
  const store = createMemoryArtifactStore({ digest: digestPort });
  const ref = artifactRef('art-1', 'hello', { location: 'https://user:pass@example.test/artifact' });
  err(store.put(ref, 'hello'), 'EFK_PRIVACY_VIOLATION');
});

test('content over 1 MiB and malformed references are refused at the boundary (S01)', () => {
  const store = createMemoryArtifactStore({ digest: digestPort });
  const huge = 'a'.repeat(1024 * 1024 + 1);
  err(store.put(artifactRef('art-1', huge), huge), 'EFK_SCHEMA_INVALID');
  err(store.put({ ...artifactRef('art-2', 'x'), extra: true }, 'x'), 'EFK_SCHEMA_INVALID');
});

test('negative control: the digest check is not a no-op', () => {
  const store = createMemoryArtifactStore({ digest: digestPort });
  const ref = artifactRef('art-1', 'hello');
  err(store.put(ref, 'goodbye'), 'EFK_ARTIFACT_DIGEST_MISMATCH');
  assert.equal(ok(store.put(ref, 'hello')).disposition, 'stored', 'the correct bytes must still be accepted');
});
