/**
 * Codec behaviour at the boundary: what the protocol layer accepts and, more importantly, what it
 * refuses. Every rejection is a typed result — `{ ok: false, error }` with a frozen `EFK_*` code —
 * never a throw, never a silently trimmed object.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { decode, decodeProtocolVersion, decodeRuntimeVersion } from '../dist/protocol/index.js';

const ok = (result) => {
  assert.equal(result.ok, true, `expected success, got ${JSON.stringify(result.error)}`);
  return result.value;
};

/** A minimal valid `ArtifactRef`; several object fixtures need a non-null artifact somewhere. */
const validArtifact = {
  protocol: { namespace: 'evofence.runtime/1', schemaVersion: '1.1.0' },
  id: 'artifact-1',
  digest: `sha256:${'9'.repeat(64)}`,
  producer: { actorId: 'kernel-1', kind: 'kernel', identityRef: null },
  binding: null,
  schema: { name: 'TaskEvidenceReport', version: '1.1.0', digest: `sha256:${'8'.repeat(64)}` },
  location: 'artifact://evidence-1',
  visibility: 'internal',
  expiresAt: null,
  partition: 'not-evaluation',
};
const rejects = (result, code) => {
  assert.equal(result.ok, false, 'expected a typed rejection');
  assert.equal(result.error.code, code);
  return result.error.message;
};

test('unknown field is rejected, not stripped (DoD 1)', () => {
  const message = rejects(decode('ProtocolVersion', { namespace: 'evofence.runtime/1', schemaVersion: '1.1.0', extra: 1 }), 'EFK_SCHEMA_INVALID');
  assert.match(message, /unknown field "extra"/);
  const nested = rejects(
    decode('NodeStateEntry', { nodeId: 'n1', attemptOrdinal: 1, epoch: 1, state: 'ready', sinceSequence: 0, spare: null }),
    'EFK_SCHEMA_INVALID',
  );
  assert.match(nested, /unknown field "spare"/);
});

test('missing required field and explicit null are different things', () => {
  rejects(decode('NodeStateEntry', { nodeId: 'n1', attemptOrdinal: 1, epoch: 1, state: 'ready' }), 'EFK_SCHEMA_INVALID');
  const nulled = rejects(
    decode('NodeStateEntry', { nodeId: 'n1', attemptOrdinal: 1, epoch: 1, state: 'ready', sinceSequence: null }),
    'EFK_SCHEMA_INVALID',
  );
  assert.match(nulled, /NodeStateEntry\.sinceSequence: expected safe integer, got null/);
  assert.equal(ok(decode('ActorRef', { actorId: 'a1', kind: 'kernel', identityRef: null })).identityRef, null);
});

test('scalars: enum, const, pattern, bounds and safe integers', () => {
  assert.equal(ok(decode('Id', 'attempt.7:01')), 'attempt.7:01');
  assert.match(rejects(decode('Id', 'bad/id'), 'EFK_SCHEMA_INVALID'), /does not match/);
  assert.equal(ok(decode('Digest', `sha256:${'a'.repeat(64)}`)), `sha256:${'a'.repeat(64)}`);
  rejects(decode('Digest', `sha256:${'A'.repeat(64)}`), 'EFK_SCHEMA_INVALID');
  assert.equal(ok(decode('Count', 0)), 0);
  rejects(decode('Count', -1), 'EFK_SCHEMA_INVALID');
  rejects(decode('PositiveCount', 0), 'EFK_SCHEMA_INVALID');
  rejects(decode('Instant', 2 ** 53), 'EFK_SCHEMA_INVALID');
  assert.equal(ok(decode('Visibility', 'held-out')), 'held-out');
  rejects(decode('Visibility', 'hidden'), 'EFK_SCHEMA_INVALID');
  assert.equal(ok(decode('NodeState', 'cancelling')), 'cancelling');
  rejects(decode('NodeState', 'done'), 'EFK_SCHEMA_INVALID');
});

test('arrays: minItems and uniqueItems', () => {
  const base = { sessionId: 's1', revision: 0, epoch: 1, taskRef: { taskId: 't', version: 1, digest: `sha256:${'b'.repeat(64)}` }, graphRef: { graphId: 'g', revision: 0, digest: `sha256:${'c'.repeat(64)}` }, manifestRef: null, nodeBindings: [], nodeStates: [], unknownEffectIds: [], lastSequence: null, dispatchMode: 'active' };
  rejects(decode('SessionView', base), 'EFK_SCHEMA_INVALID');
  const entry = { nodeId: 'n1', attemptOrdinal: 1, epoch: 1, state: 'ready', sinceSequence: 0 };
  const valid = ok(decode('SessionView', { ...base, manifestRef: { protocol: { namespace: 'evofence.runtime/1', schemaVersion: '1.1.0' }, id: 'm', digest: `sha256:${'d'.repeat(64)}`, producer: { actorId: 'k', kind: 'kernel', identityRef: null }, binding: null, schema: { name: 'HostManifest', version: '1.1.0', digest: `sha256:${'e'.repeat(64)}` }, location: 'artifact://m', visibility: 'internal', expiresAt: null, partition: 'not-evaluation' }, nodeStates: [entry] }));
  assert.equal(valid.nodeStates.length, 1);
  const duplicate = rejects(decode('SessionView', { ...base, manifestRef: valid.manifestRef, nodeStates: [entry, { ...entry }] }), 'EFK_SCHEMA_INVALID');
  assert.match(duplicate, /duplicate item/);
});

test('anyOf: ref-or-null unions and at-least-one-branch nodes', () => {
  assert.equal(ok(decode('ActorRef', { actorId: 'a', kind: 'human', identityRef: null })).identityRef, null);
  rejects(decode('ActorRef', { actorId: 'a', kind: 'human', identityRef: { id: 'x' } }), 'EFK_SCHEMA_INVALID');
  rejects(decode('Predicate', { op: 'eq', path: 'outcome', value: [], children: [] }), 'EFK_SCHEMA_INVALID');
  assert.equal(ok(decode('Predicate', { op: 'true', path: null, value: null, children: [] })).op, 'true');
});

test('allOf if/then: the CommandPayload discriminator picks exactly one field set', () => {
  const pause = { kind: 'session.pause', task: null, graph: null, patch: null, binding: null, objectRef: null, manifestRef: null, reason: 'operator' };
  assert.equal(ok(decode('CommandPayload', pause)).kind, 'session.pause');

  const wrongSlot = rejects(decode('CommandPayload', { ...pause, binding: { sessionId: 's' } }), 'EFK_SCHEMA_INVALID');
  assert.match(wrongSlot, /CommandPayload\.binding: no anyOf branch matched/);
  rejects(decode('CommandPayload', { ...pause, reason: null }), 'EFK_SCHEMA_INVALID');
  rejects(decode('CommandPayload', { ...pause, kind: 'not.a.command' }), 'EFK_SCHEMA_INVALID');

  const createMissingTask = rejects(decode('CommandPayload', { ...pause, kind: 'session.create' }), 'EFK_SCHEMA_INVALID');
  assert.match(createMissingTask, /task/);

  const revoke = { kind: 'asset.revoke', task: null, graph: null, patch: null, binding: null, objectRef: validArtifact, manifestRef: null, reason: 'retired' };
  assert.equal(ok(decode('CommandPayload', revoke)).kind, 'asset.revoke');
  rejects(decode('CommandPayload', { ...revoke, reason: null }), 'EFK_SCHEMA_INVALID');
});

test('allOf if/then: ResourcePolicy ties maxHolders to exclusive mode', () => {
  assert.equal(ok(decode('ResourcePolicy', { resourceId: 'integrationWriter', mode: 'exclusive', maxHolders: 1 })).mode, 'exclusive');
  const wrong = rejects(decode('ResourcePolicy', { resourceId: 'integrationWriter', mode: 'exclusive', maxHolders: 2 }), 'EFK_SCHEMA_INVALID');
  assert.match(wrong, /maxHolders/);
  assert.equal(ok(decode('ResourcePolicy', { resourceId: 'workspaceRead', mode: 'shared', maxHolders: 4 })).maxHolders, 4);
});

test('allOf required-anyOf: a loop needs at least two bound kinds', () => {
  const loop = { bodyNodeIds: ['n1'], stop: ['body-success'], carry: [] };
  assert.equal(ok(decode('LoopSpec', { ...loop, maxIterations: 3, maxDepth: 2 })).maxIterations, 3);
  assert.equal(ok(decode('LoopSpec', { ...loop, maxWallClock: 1000, maxTokensOrCost: { tokens: null, usdMicros: 5 } })).maxWallClock, 1000);
  rejects(decode('LoopSpec', { ...loop, maxIterations: 3 }), 'EFK_SCHEMA_INVALID');
  rejects(decode('LoopSpec', { ...loop }), 'EFK_SCHEMA_INVALID');
});

test('a $ref sibling keyword is applied, not skipped', () => {
  const bound = { tokens: null, usdMicros: 0 };
  const loop = { bodyNodeIds: ['n1'], stop: ['body-success'], carry: [], maxWallClock: 1, maxTokensOrCost: bound };
  const message = rejects(decode('LoopSpec', loop), 'EFK_SCHEMA_INVALID');
  assert.match(message, /below minimum 1/);
  assert.equal(ok(decode('LoopSpec', { ...loop, maxTokensOrCost: { tokens: 1, usdMicros: null } })).maxTokensOrCost.tokens, 1);
});

test('not: kind-specific decision inputs must be present, not null', () => {
  const base = { protocol: { namespace: 'evofence.runtime/1', schemaVersion: '1.1.0' }, decisionId: 'd1', inputs: [validArtifact], contractRef: null, taskEvidenceRef: null, evaluationReceiptRef: null, activationReceiptRef: null, evaluatorVersion: '1', evaluationProtocolRef: null, outcome: 'completed', reasons: [], evidenceRefs: [], feedbackVisibility: 'internal', issuer: { actorId: 'e', kind: 'evaluator', identityRef: null }, capabilityJudgement: null };
  const noKind = rejects(decode('DecisionRecord', base), 'EFK_SCHEMA_INVALID');
  assert.match(noKind, /missing required field "kind"/);

  const taskKind = { ...base, kind: 'task' };
  rejects(decode('DecisionRecord', taskKind), 'EFK_SCHEMA_INVALID');
  rejects(decode('DecisionRecord', { ...taskKind, contractRef: { taskId: 't', version: 1, digest: `sha256:${'f'.repeat(64)}` } }), 'EFK_SCHEMA_INVALID');
  const completed = ok(
    decode('DecisionRecord', {
      ...taskKind,
      contractRef: { taskId: 't', version: 1, digest: `sha256:${'f'.repeat(64)}` },
      taskEvidenceRef: validArtifact,
      outcome: 'failed',
    }),
  );
  assert.equal(completed.outcome, 'failed');

  const activation = rejects(decode('DecisionRecord', { ...base, kind: 'activation', outcome: 'completed' }), 'EFK_SCHEMA_INVALID');
  assert.match(activation, /outcome/);
  const activationNull = rejects(decode('DecisionRecord', { ...base, kind: 'activation', outcome: 'active' }), 'EFK_SCHEMA_INVALID');
  assert.match(activationNull, /activationReceiptRef/);
  assert.equal(ok(decode('DecisionRecord', { ...base, kind: 'activation', outcome: 'active', activationReceiptRef: validArtifact })).kind, 'activation');
});

test('maps: HostManifest.capabilities keys are Ids and values are observations', () => {
  const manifest = {
    protocol: { namespace: 'evofence.runtime/1', schemaVersion: '1.1.0' },
    manifestId: 'm1',
    identity: { host: 'pi', vendor: null, version: '0.87.1', pinRef: { file: 'a.json', pointer: '/x', sha256: `sha256:${'a'.repeat(64)}`, kind: 'native-fixture', claim: 'c' } },
    compatibleProtocols: [{ namespace: 'evofence.runtime/1', schemaVersion: '1.1.0' }],
    capabilities: { nativeSessionBinding: { status: 'verified', evidenceRefs: [], scope: { operations: [], coverage: [], hostVersion: '0.87.1', providerModel: null, trustDomain: 'same-user' }, verifiedSubset: [], limitations: [] } },
    model: null,
    usageSources: [],
    cancel: { status: 'verified', coverage: [], evidenceRefs: [] },
    recovery: { status: 'partial', coverage: [], evidenceRefs: [] },
    isolation: { status: 'absent', coverage: [], evidenceRefs: [] },
    hostSpecific: { probeStatus: null, homeObservationRef: null, integrationCompatibility: 'unknown', rawManifestRef: { file: 'a.json', pointer: '/y', sha256: `sha256:${'a'.repeat(64)}`, kind: 'native-disk', claim: 'c' }, noteRefs: [] },
  };
  assert.equal(ok(decode('HostManifest', manifest)).identity.version, '0.87.1');
  rejects(decode('HostManifest', { ...manifest, capabilities: { 'bad key': manifest.capabilities.nativeSessionBinding } }), 'EFK_SCHEMA_INVALID');
  rejects(decode('HostManifest', { ...manifest, capabilities: { nativeSessionBinding: { status: 'maybe' } } }), 'EFK_SCHEMA_INVALID');
});

test('unknown protocol version is a protocol error, a malformed envelope is a schema error', () => {
  assert.equal(decodeRuntimeVersion({ namespace: 'evofence.runtime/1', schemaVersion: '1.1.0' }).version, '1.1.0');
  assert.equal(decodeRuntimeVersion({ namespace: 'evofence.runtime/1', schemaVersion: '1.0.0' }).version, '1.0.0');
  assert.match(rejects(decodeProtocolVersion({ namespace: 'evofence.runtime/2', schemaVersion: '1.1.0' }), 'EFK_PROTOCOL_UNSUPPORTED'), /namespace/);
  assert.match(rejects(decodeProtocolVersion({ namespace: 'evofence.runtime/1', schemaVersion: '2.0.0' }), 'EFK_PROTOCOL_UNSUPPORTED'), /schemaVersion/);
  assert.match(rejects(decodeProtocolVersion({ schemaVersion: '1.1.0' }), 'EFK_SCHEMA_INVALID'), /missing required field "namespace"/);
  assert.match(rejects(decodeProtocolVersion({ namespace: 'evofence.runtime/1', schemaVersion: '1.1.0', v: 1 }), 'EFK_SCHEMA_INVALID'), /unknown field "v"/);
  assert.equal(decodeRuntimeVersion({ namespace: 'evofence.assets/1', schemaVersion: '1.0.0' }).ok, false);
});

test('a nested envelope reports an unknown version pair as a protocol error (S02)', () => {
  const stale = rejects(decode('Command', { protocol: { namespace: 'evofence.runtime/1', schemaVersion: '9.9.9' } }), 'EFK_PROTOCOL_UNSUPPORTED');
  assert.match(stale, /Command\.protocol/);
  rejects(decode('Command', { protocol: { namespace: 'evofence.runtime/2', schemaVersion: '1.1.0' } }), 'EFK_PROTOCOL_UNSUPPORTED');
  // A structurally broken pair is still a schema error, and a definition without a `protocol`
  // property is untouched by the gate.
  rejects(decode('Command', { protocol: { namespace: 'evofence.runtime/1' } }), 'EFK_SCHEMA_INVALID');
  const noProtocolProperty = rejects(
    decode('NodeStateEntry', { nodeId: 'n1', attemptOrdinal: 1, epoch: 1, state: 'ready', sinceSequence: 0, protocol: { namespace: 'evofence.runtime/1', schemaVersion: '9.9.9' } }),
    'EFK_SCHEMA_INVALID',
  );
  assert.match(noProtocolProperty, /unknown field "protocol"/);
});

/** Required fields: protocol, assetId, revision, digest, scope, qualificationRef. */
const validAssetRef = {
  protocol: { namespace: 'evofence.assets/1', schemaVersion: '1.0.0' },
  assetId: 'asset.1',
  revision: 1,
  digest: `sha256:${'7'.repeat(64)}`,
  scope: { workspaceRef: null, readResources: [], writeResources: [], artifactScopes: [], trustDomain: 'same-user' },
  qualificationRef: null,
};

test('asset envelopes are gated against their own version pair, not the runtime one', () => {
  assert.equal(ok(decode('AssetRef', validAssetRef)).assetId, 'asset.1');
  assert.equal(ok(decode('AssetRef', { ...validAssetRef, protocol: { namespace: 'evofence.assets/1', schemaVersion: '1.0.0' } })).revision, 1);

  const wrongNamespace = rejects(
    decode('AssetRef', { ...validAssetRef, protocol: { namespace: 'evofence.runtime/1', schemaVersion: '1.0.0' } }),
    'EFK_PROTOCOL_UNSUPPORTED',
  );
  assert.match(wrongNamespace, /AssetRef\.protocol\.namespace/);
  rejects(decode('AssetRef', { ...validAssetRef, protocol: { namespace: 'evofence.assets/1', schemaVersion: '1.1.0' } }), 'EFK_PROTOCOL_UNSUPPORTED');
  const missingField = rejects(decode('AssetRef', { ...validAssetRef, protocol: { namespace: 'evofence.assets/1' } }), 'EFK_SCHEMA_INVALID');
  assert.match(missingField, /AssetRef\.protocol/);

  // The runtime pair stays rejected as an asset pair: the two domains never share an enumeration.
  rejects(decode('CapabilityAsset', { protocol: { namespace: 'evofence.runtime/1', schemaVersion: '1.1.0' } }), 'EFK_PROTOCOL_UNSUPPORTED');
});
