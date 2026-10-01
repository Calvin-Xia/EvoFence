/**
 * l2_artifact_port cp2 — the access partition (A13 + `PrivacyPolicy`) and expiry semantics.
 *
 * Visibility and source partition are independent axes, so each one alone can withhold a reference.
 * The withheld side of a partition is a count, never an id: A13 forbids the executor-visible path
 * from containing the reference at all.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { createMemoryArtifactStore } from '../dist/storage/index.js';
import {
  defaultReportRefs,
  partitionFeedback,
  readArtifact,
  visibilityCeiling,
  withheldReason,
} from '../dist/storage/artifacts/index.js';

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

function artifact(id, over = {}) {
  const { content = id, ...rest } = over;
  return {
    protocol: PROTOCOL,
    id,
    digest: DIGEST(content),
    producer: { actorId: 'kernel-1', kind: 'kernel', identityRef: null },
    binding: null,
    schema: { name: 'TaskEvidenceReport', version: '1.1.0', digest: DIGEST('schema') },
    location: `artifact://${id}`,
    visibility: 'internal',
    expiresAt: null,
    partition: 'not-evaluation',
    ...rest,
  };
}

test('each audience has the documented information ceiling', () => {
  assert.equal(visibilityCeiling('author'), 'internal');
  assert.equal(visibilityCeiling('report'), 'internal');
  assert.equal(visibilityCeiling('asset-staging'), 'internal');
  assert.equal(visibilityCeiling('evaluator'), 'final');
});

test('an author-facing audience is withheld from private, held-out and final artifacts', () => {
  for (const audience of ['author', 'report', 'asset-staging']) {
    for (const visibility of ['private', 'held-out', 'final']) {
      assert.equal(ok(withheldReason(artifact('art-1', { visibility }), audience)), 'visibility', `${audience}/${visibility}`);
    }
    for (const visibility of ['public', 'internal']) {
      assert.equal(ok(withheldReason(artifact('art-1', { visibility }), audience)), 'none', `${audience}/${visibility}`);
    }
  }
});

test('a held-out or final source partition is withheld from an author even at internal visibility', () => {
  assert.equal(ok(withheldReason(artifact('art-1', { partition: 'held-out' }), 'author')), 'partition');
  assert.equal(ok(withheldReason(artifact('art-1', { partition: 'final' }), 'report')), 'partition');
  assert.equal(ok(withheldReason(artifact('art-1', { partition: 'train' }), 'author')), 'none');
  assert.equal(ok(withheldReason(artifact('art-1', { partition: 'dev' }), 'author')), 'none');
});

test('the evaluator audience withholds nothing', () => {
  for (const visibility of ['public', 'internal', 'private', 'held-out', 'final']) {
    for (const partition of ['train', 'dev', 'held-out', 'final', 'not-evaluation']) {
      assert.equal(ok(withheldReason(artifact('art-1', { visibility, partition }), 'evaluator')), 'none');
    }
  }
});

test('the default report carries the author-visible references and counts the rest by reason', () => {
  const refs = [
    artifact('reportable', { visibility: 'internal' }),
    artifact('secret', { visibility: 'private' }),
    artifact('holdout', { visibility: 'internal', partition: 'held-out' }),
    artifact('final', { visibility: 'final' }),
  ];
  const partition = ok(defaultReportRefs(refs));
  assert.equal(partition.audience, 'report');
  assert.deepEqual(partition.visible.map((ref) => ref.id), ['reportable']);
  assert.equal(partition.withheldVisibility, 2);
  assert.equal(partition.withheldPartition, 1);
});

test('the sensitive trace does not appear in the default report, not even by id', () => {
  const refs = [
    artifact('reportable', { visibility: 'internal' }),
    artifact('heldout-repo-42-patch', { visibility: 'held-out', partition: 'held-out', location: 'artifact://private/heldout-repo-42-patch' }),
  ];
  const rendered = JSON.stringify(ok(defaultReportRefs(refs)));
  assert.doesNotMatch(rendered, /heldout-repo-42-patch/);
  assert.doesNotMatch(rendered, /private\/heldout/);
  assert.match(rendered, /reportable/);
});

test('partitionFeedback keeps some references for the evaluator that it withholds from the author', () => {
  const refs = [
    artifact('train-1', { partition: 'train' }),
    artifact('heldout-1', { visibility: 'held-out', partition: 'held-out' }),
  ];
  assert.deepEqual(ok(partitionFeedback(refs, 'author')).visible.map((ref) => ref.id), ['train-1']);
  assert.deepEqual(ok(partitionFeedback(refs, 'evaluator')).visible.map((ref) => ref.id), ['train-1', 'heldout-1']);
});

test('a held-out reference is a privacy violation for the author and readable by the evaluator', () => {
  const store = createMemoryArtifactStore({ digest: digestPort });
  const ref = artifact('heldout-1', { content: 'held-out evidence', visibility: 'held-out', partition: 'held-out' });
  ok(store.put(ref, 'held-out evidence'));
  err(readArtifact(ref, 'author', 0, store), 'EFK_PRIVACY_VIOLATION', 'author');
  err(readArtifact(ref, 'asset-staging', 0, store), 'EFK_PRIVACY_VIOLATION', 'asset-staging');
  assert.equal(ok(readArtifact(ref, 'evaluator', 0, store)), 'held-out evidence');
});

test('a partition-only restriction is also a privacy violation for the author', () => {
  const store = createMemoryArtifactStore({ digest: digestPort });
  const ref = artifact('final-1', { content: 'final evidence', visibility: 'internal', partition: 'final' });
  ok(store.put(ref, 'final evidence'));
  err(readArtifact(ref, 'author', 0, store), 'EFK_PRIVACY_VIOLATION', 'author');
  assert.equal(ok(readArtifact(ref, 'evaluator', 0, store)), 'final evidence');
});
