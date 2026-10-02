import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createMemoryArtifactStore, createMemoryEventStore } from '../dist/storage/index.js';
import { canonical, storeOk, storeFail } from '../dist/kernel/store/index.js';
import { emptyRegistry, stageRevision, revisionDigest, recordDecision, qualification } from '../dist/learning/assets/index.js';
import { createPromotionService } from '../dist/learning/promotion/index.js';

const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const protocol = { namespace: 'evofence.runtime/1', schemaVersion: '1.1.0' };
const assetProtocol = { namespace: 'evofence.assets/1', schemaVersion: '1.0.0' };
const actor = (actorId, kind = 'kernel') => ({ actorId, kind, identityRef: null });
const unwrap = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const denied = (result, code) => { assert.equal(result.ok, false, JSON.stringify(result)); assert.equal(result.error.code, code); };

async function fixture({ count = 2, pointers = 1, evaluationExpiry = null } = {}) {
  let ordinal = 0, now = 20;
  const digest = { digest: hash }, artifacts = createMemoryArtifactStore({ digest });
  const journal = createMemoryEventStore({ digest });
  unwrap(journal.createSession({ sessionId: 'promotion-session', epoch: 1, protocol }));
  const issuers = { candidate: actor('candidate-service', 'evaluator'), promotion: actor('promotion-service'),
    activation: actor('activation-service'), revocation: actor('permission-root') };
  const hostIssuer = actor('fixture-host-adapter', 'host-adapter');
  const registryPorts = { digest, artifacts, issuers, authorize: () => storeOk(true) };
  function artifact(bytes, name = 'Material', overrides = {}) {
    const ref = { protocol, id: `artifact-${++ordinal}`, digest: hash(bytes), producer: actor('fixture-source'), binding: null,
      schema: { name, version: '1.1.0', digest: hash(name) }, location: `fixture:${ordinal}`, visibility: 'internal',
      expiresAt: null, partition: 'train', ...overrides };
    unwrap(artifacts.put(ref, bytes)); return ref;
  }
  const source = artifact('read-only training source'), manifest = artifact('fixture manifest', 'HostManifest');
  const payload = artifact('fixture model payload', 'ModelPayload'), protocolRef = artifact('fixture protocol', 'EvaluationProtocol');
  const model = { providerModel: 'fixture/model', reasoningRequested: 'high', reasoningGuarantee: 'payload-only', payloadRef: payload };
  const scope = { workspaceRef: null, readResources: ['repo'], writeResources: ['project-staging'], artifactScopes: ['assets'], trustDomain: 'same-user' };
  const context = { hostId: 'fixture-host', hostVersion: '1', hostManifestRef: manifest, hostSessionId: 'host-session',
    model, repoId: 'repo', baseDigest: hash('base'), taskId: 'task-1', scope, at: 20 };
  let registry = emptyRegistry();
  const revisions = [], evaluations = [];
  for (let n = 1; n <= count; n++) {
    const revision = { category: 'strategy', createdAt: 10,
      compatibility: { hosts: [{ hostId: context.hostId, version: context.hostVersion, manifestRef: manifest }], models: [model],
        repositories: [{ repoId: context.repoId, baseDigest: context.baseDigest }], taskIds: ['task-1', 'task-2'], protocolRef },
      candidate: { protocol: assetProtocol, asset: { protocol: assetProtocol, assetId: 'strategy', revision: n, digest: hash('placeholder'), scope, qualificationRef: null },
        kind: 'memory', contentRefs: [artifact(`usable strategy version ${n}`)], sourceTraces: [source], dependencies: [],
        hypothesis: 'Fixture hypothesis, not a measured capability claim.', qualification: 'staged', evaluationRef: null, expiresAt: null, revocationRef: null } };
    revision.candidate.asset.digest = revisionDigest(revision, digest);
    registry = unwrap(stageRevision(registry, revision, registryPorts));
    const judgement = { cellStatus: 'complete', look: 'CONFIRMATORY_LOOK', verdict: 'positive', protocolRef,
      analysisRef: source, costBasis: 'measured-usage-estimate', guardrailCost: 'passed', guardrailWall: 'passed', guardrailTruncation: 'passed' };
    const evaluation = { evaluationId: `evaluation-${n}`, candidate: revision.candidate.asset, baseDigest: context.baseDigest,
      dependencyRefs: [], protocolRef, dataSplitRefs: [source], hostManifestRefs: [manifest], modelBindings: [model],
      requiredJudgements: [judgement], usageComplete: true, evidenceRefs: [source] };
    const evaluationRef = artifact(canonical(evaluation), 'EvaluationReceipt', { producer: actor('independent-evaluator', 'evaluator'), visibility: 'private', expiresAt: evaluationExpiry });
    const candidateDecision = { protocol, decisionId: `candidate-${n}`, kind: 'candidate', outcome: 'validated',
      inputs: revision.candidate.contentRefs, contractRef: null, taskEvidenceRef: null, evaluationReceiptRef: evaluationRef,
      activationReceiptRef: null, evaluatorVersion: 'fixture/1', evaluationProtocolRef: protocolRef, reasons: [], evidenceRefs: [],
      feedbackVisibility: 'internal', issuer: issuers.candidate, capabilityJudgement: judgement };
    const decisionRef = artifact(canonical(candidateDecision), 'DecisionRecord', { producer: issuers.candidate, visibility: 'private' });
    registry = unwrap(recordDecision(registry, { asset: revision.candidate.asset, decisionRef, context, at: 20 }, registryPorts));
    revisions.push(revision); evaluations.push({ receipt: evaluation, ref: evaluationRef });
  }
  const root = { grantId: 'root-grant', rootAuthorityRef: 'root-authority', parentGrantRef: null, actor: issuers.revocation,
    sessionId: 'promotion-session', nodeIds: ['activation-node'], scope, capabilities: ['asset.promote', 'host.activate', 'asset.revoke'],
    maxDelegationDepth: 3, expiresAt: 1000, revocationEpoch: 0, approvalRef: null };
  const rules = { ruleId: 'preauthorized', authorizationRef: 'host-grant', hostSessionId: context.hostSessionId,
    assets: revisions.map(r => r.candidate.asset), allowTemporary: false,
    authority: { revokedEpoch: 0, root, parent: { ...root, grantId: 'parent-grant', parentGrantRef: root.grantId }, task: scope,
      node: { nodeId: 'activation-node', scope, capabilities: ['asset.promote', 'host.activate', 'asset.revoke'] } } };
  const grant = { grantId: 'host-grant', rootAuthorityRef: 'root-authority', scope,
    budget: { poolId: 'fixture-pool', category: 'development', authorizationRef: null, maxRequests: 0, maxInputTokens: 0,
      maxOutputTokens: 0, maxUsdMicros: 0, maxWallMs: 100, maxConcurrentRequests: 1, priceRef: null, missingUsagePolicy: 'retain-reservation' },
    issuedEpoch: 1, expiresAt: 1000, remainingDepth: 1, maxConcurrency: 1, revocationEpoch: 0, revoked: false };
  const settings = { rule: rules, grant, idle: true, capabilities: { nativeSessionBinding: { status: 'verified' }, settledAndIdle: { status: 'verified' } },
    outcome: 'active', receiptChange: null, beforeExecute: null, observationChange: null, beforeReceipt: null };
  const calls = { observe: 0, execute: 0, reconcile: 0, maxConcurrent: 0 };
  const receipts = new Map(), snapshots = new Map();
  let concurrent = 0;
  function actualReceipt(effect, status = settings.outcome) {
    const previous = effect.payload.previousSnapshot;
    const target = effect.inputRefs.find(r => r.schema.name === 'HostSnapshot');
    const next = status === 'active' ? target ?? artifact(`host applied ${effect.effectId}`, 'HostSnapshot') : null;
    const activation = { protocol, asset: effect.payload.assetRef, hostSessionId: effect.binding.hostSessionId,
      scope, previousSnapshot: previous, newSnapshot: next, actualStatus: status, authorizationRef: effect.authorityRef,
      evaluationRef: evaluations.find(e => e.receipt.candidate.digest === effect.payload.assetRef.digest).ref };
    if (settings.receiptChange) settings.receiptChange(activation);
    const ref = artifact(canonical(activation), 'ActivationReceipt', { producer: hostIssuer });
    const receipt = { protocol, receiptId: `receipt-${++ordinal}`, effectId: effect.effectId, hostInvocationId: `invocation:${effect.effectId}`, binding: effect.binding,
      status: status === 'active' ? 'completed' : status, artifactRefs: [ref], usage: [],
      observability: ['fixture-actual-snapshot'], error: status === 'failed' ? storeFail('EFK_ACTIVATION_UNCONFIRMED', 'fixture activation failed').error : null };
    if (settings.beforeReceipt) settings.beforeReceipt(receipt);
    if (status === 'active') snapshots.set(effect.payload.assetRef.assetId, next);
    receipts.set(effect.effectId, receipt); return receipt;
  }
  const host = {
    async observe() { calls.observe++; if (settings.observationChange) settings.observationChange();
      return storeOk({ host: 'fixture-host', idle: settings.idle, capabilities: settings.capabilities, cancellation: 'unknown',
        recovery: 'unknown', isolation: 'same-user', boardOwners: [] }); },
    async execute({ effect }) {
      calls.execute++; concurrent++; calls.maxConcurrent = Math.max(calls.maxConcurrent, concurrent);
      try { if (settings.beforeExecute) await settings.beforeExecute(effect); return storeOk(actualReceipt(effect)); }
      finally { concurrent--; }
    },
    async reconcile({ targetIds }) { calls.reconcile++; return storeOk(targetIds.map(effectId => {
      const receipt = receipts.get(effectId);
      return { effectId, verdict: receipt && receipt.status !== 'unknown' ? 'resolved' : 'unknown', receipt: receipt ?? null, error: null };
    })); },
    async cancel() { return storeFail('EFK_CAPABILITY_UNSUPPORTED', 'fixture'); },
    async context() { return storeFail('EFK_CAPABILITY_UNSUPPORTED', 'fixture'); },
    async usage() { return storeFail('EFK_CAPABILITY_UNSUPPORTED', 'fixture'); },
  };
  const ports = { sessionId: 'promotion-session', journal, registry: registryPorts, host, clock: { now: () => now }, hostIssuer,
    policy: { rule: id => storeOk(id === 'preauthorized' ? settings.rule : null),
      grant: id => storeOk(id === 'host-grant' ? settings.grant : null),
      verifyLease(effect, at) {
        return effect.leases.every(l => l.epoch === effect.binding.epoch && l.expiresAt > at && l.fencingToken === 1) ?
          storeOk(true) : storeFail('EFK_LEASE_STALE', 'fixture stale lease');
      } } };
  const service = createPromotionService(ports);
  const initial = Array.from({ length: pointers }, (_, i) => ({ pointerId: `pointer-${i}`, version: 0, hostSessionId: context.hostSessionId,
    scope, active: null, promoted: null, snapshot: artifact(`base snapshot ${i}`, 'HostSnapshot') }));
  unwrap(await service.initialize(registry, initial));
  const state = () => unwrap(service.inspect());
  const pointer = (index = 0) => state().pointers[index];
  const input = (version = 1, index = 0, overrides = {}) => ({ requestId: `promote-${version}-${index}`, expected: pointer(index),
    asset: revisions[version - 1].candidate.asset, evaluationRefs: [evaluations[version - 1].ref], ruleId: 'preauthorized', temporary: false, context, ...overrides });
  function effect(record, overrides = {}) {
    const id = `effect:${record.promotionId}`;
    return { protocol, effectId: id, idempotencyKey: `idem:${id}`, binding: { sessionId: 'promotion-session', hostSessionId: context.hostSessionId,
      graph: { graphId: 'fixture-graph', revision: 1, digest: hash('graph') }, nodeId: 'activation-node', attemptId: `attempt:${id}`,
      attemptOrdinal: 1, epoch: 1, baseDigest: context.baseDigest }, authorityRef: 'host-grant', reservationRef: null,
      leases: [{ resourceId: 'assets', ownerClaimId: `claim:${id}`, epoch: 1, fencingToken: 1, expiresAt: 1000 }],
      inputRefs: record.targetSnapshot === null ? [] : [record.targetSnapshot], deadline: 900, kind: 'host.activate',
      payload: { context: null, toolName: null, argumentsRef: null, graphRef: null, targetIds: [], assetRef: record.asset,
        previousSnapshot: record.previous.snapshot, deliveryGuarantee: 'none' }, ...overrides };
  }
  const promote = async (version = 1) => unwrap(await service.promote(input(version)));
  const activate = async record => unwrap(await service.activate({ promotionId: record.promotionId, effect: effect(record) }));
  return { service, ports, state, pointer, input, effect, promote, activate, settings, calls, artifact, revisions, evaluations,
    artifacts, registryPorts, receipts, actualReceipt, context, setNow: value => { now = value; } };
}

test('cp1 promotion commits its unique evaluation and qualified registry atomically, without host activation', async () => {
  const f = await fixture(), old = f.pointer(), record = await f.promote();
  assert.equal(record.status, 'promoted'); assert.equal(record.mode, 'promotion');
  assert.equal(f.pointer().version, 1); assert.deepEqual(f.pointer().snapshot, old.snapshot);
  assert.equal(f.pointer().active, null); assert.equal(f.calls.execute, 0);
  assert.equal(unwrap(qualification(f.state().registry, record.asset, f.context)).state, 'promoted');
  assert.deepEqual(record.evaluationRef, f.evaluations[0].ref);
});

test('DoD1 rejects missing and ambiguous evaluation without consuming the pointer', async () => {
  const f = await fixture(), before = canonical(f.state());
  const absent = f.input(); delete absent.evaluationRefs;
  denied(await f.service.promote(absent), 'EFK_ASSET_QUALIFICATION_INVALID');
  for (const evaluationRefs of [[], [f.evaluations[0].ref, f.evaluations[1].ref], [f.evaluations[0].ref, f.evaluations[0].ref]]) {
    denied(await f.service.promote(f.input(1, 0, { evaluationRefs })), 'EFK_ASSET_QUALIFICATION_INVALID');
    assert.equal(canonical(f.state()), before);
  }
});

test('DoD1 expired evaluation cannot promote even with authorization', async () => {
  const f = await fixture({ evaluationExpiry: 30 }); f.setNow(30);
  denied(await f.service.promote(f.input()), 'EFK_ASSET_EXPIRED'); assert.equal(f.pointer().version, 0);
});

test('DoD1 substituted evaluation, missing bytes and wrong codec are typed refusals', async () => {
  const f = await fixture();
  denied(await f.service.promote(f.input(1, 0, { evaluationRefs: [f.evaluations[1].ref] })), 'EFK_ASSET_QUALIFICATION_INVALID');
  const missing = { ...f.evaluations[0].ref, id: 'unavailable' };
  denied(await f.service.promote(f.input(1, 0, { evaluationRefs: [missing] })), 'EFK_ARTIFACT_UNAVAILABLE');
  const wrong = { ...f.evaluations[0].ref, schema: { ...f.evaluations[0].ref.schema, name: 'Material' } };
  denied(await f.service.promote(f.input(1, 0, { evaluationRefs: [wrong] })), 'EFK_ARTIFACT_BINDING_MISMATCH');
  assert.equal(f.pointer().version, 0);
});

for (const [name, change, code] of [
  ['missing', f => { f.settings.rule = null; }, 'EFK_AUTHORITY_DENIED'],
  ['expired', f => { f.settings.rule.authority.root.expiresAt = 20; }, 'EFK_GRANT_EXPIRED'],
  ['revoked', f => { f.settings.rule.authority.revokedEpoch = 1; }, 'EFK_GRANT_REVOKED'],
  ['wrong asset', f => { f.settings.rule.assets = []; }, 'EFK_AUTHORITY_DENIED'],
  ['scope', f => { f.settings.rule.authority.parent.scope = { ...f.context.scope, writeResources: [] }; }, 'EFK_AUTHORITY_DENIED'],
  ['depth', f => { f.settings.rule.authority.parent.maxDelegationDepth = 0; }, 'EFK_AUTHORITY_DENIED'],
  ['capability', f => { f.settings.rule.authority.root.capabilities = []; }, 'EFK_AUTHORITY_DENIED'],
]) test(`DoD1 authorization ${name} refuses promotion`, async () => {
  const f = await fixture(); change(f); denied(await f.service.promote(f.input()), code); assert.equal(f.pointer().version, 0);
});

test('cp1 online temporary strategy cannot become permanent without explicit preauthorization', async () => {
  const f = await fixture(); denied(await f.service.promote(f.input(1, 0, { temporary: true })), 'EFK_AUTHORITY_DENIED');
  assert.equal(f.pointer().promoted, null);
  f.settings.rule.allowTemporary = true;
  assert.equal(unwrap(await f.service.promote(f.input(1, 0, { temporary: true }))).status, 'promoted');
});

test('cp1 CAS binds old pointer, revision, digest, scope and snapshot', async () => {
  const f = await fixture();
  for (const change of [p => { p.version++; }, p => { p.scope.writeResources = ['outside']; },
    p => { p.snapshot = f.artifact('other snapshot', 'HostSnapshot'); }, p => { p.promoted = f.revisions[1].candidate.asset; }]) {
    const expected = structuredClone(f.pointer()); change(expected);
    denied(await f.service.promote(f.input(1, 0, { expected })), 'EFK_REVISION_CONFLICT');
  }
  const stale = f.input(); await f.promote();
  denied(await f.service.promote({ ...stale, requestId: 'different-writer' }), 'EFK_REVISION_CONFLICT');
});

test('cp1 independent pointer commits serialize without losing either update', async () => {
  const f = await fixture({ pointers: 2 });
  const inputs = [f.input(1, 0), f.input(2, 1)];
  const records = await Promise.all(inputs.map(input => f.service.promote(input))); records.forEach(unwrap);
  assert.deepEqual(f.state().pointers.map(p => [p.version, p.promoted.revision]), [[1, 1], [1, 2]]);
  assert.equal(f.state().promotions.length, 2);
});

test('cp1 competing writers on the same pointer have one winner and one CAS refusal', async () => {
  const f = await fixture(), second = createPromotionService(f.ports), a = f.input(), b = f.input(2);
  const results = await Promise.all([f.service.promote(a), second.promote(b)]);
  assert.equal(results.filter(r => r.ok).length, 1); denied(results.find(r => !r.ok), 'EFK_REVISION_CONFLICT');
  assert.equal(f.pointer().version, 1); assert.equal(f.state().promotions.length, 1);
});

test('cp3 duplicate promotion is stable and changed-content replay is rejected', async () => {
  const f = await fixture(), input = f.input(), first = unwrap(await f.service.promote(input));
  const journal = unwrap(f.ports.journal.exportSession(f.ports.sessionId));
  assert.deepEqual(unwrap(await f.service.promote(input)), first);
  assert.equal(unwrap(f.ports.journal.exportSession(f.ports.sessionId)).revision, journal.revision);
  denied(await f.service.promote({ ...input, temporary: true }), 'EFK_IDEMPOTENCY_COLLISION');
});

test('cp2 safe-point activation follows committed outbox intention and claim', async () => {
  const f = await fixture(), record = await f.promote();
  f.settings.beforeExecute = effect => {
    const journal = unwrap(f.ports.journal.exportSession(f.ports.sessionId));
    assert.equal(journal.effects.length, 1); assert.equal(journal.effects[0].effectId, effect.effectId);
    assert.equal(unwrap(f.ports.journal.outbox(f.ports.sessionId)).entries[0].state, 'dispatched');
    assert.equal(f.state().promotions[0].status, 'pending');
  };
  const active = await f.activate(record);
  assert.equal(active.status, 'active'); assert.deepEqual(f.pointer().snapshot, active.activation.newSnapshot);
  assert.equal(unwrap(qualification(f.state().registry, record.asset, f.context)).usable, true);
  assert.equal(f.calls.execute, 1);
});

test('cp2 idle alone cannot activate; busy and unsupported hosts refuse before dispatch', async () => {
  const f = await fixture(), record = await f.promote(), request = { promotionId: record.promotionId, effect: f.effect(record) };
  f.settings.idle = false; denied(await f.service.activate(request), 'EFK_ACTIVATION_NOT_SETTLED');
  f.settings.idle = true; f.settings.capabilities = {}; denied(await f.service.activate(request), 'EFK_CAPABILITY_UNSUPPORTED');
  assert.equal(f.calls.execute, 0); assert.equal(f.state().promotions[0].status, 'promoted');
});

test('cp2 grant revocation, scope and lease expiry are checked at the actual safe point', async () => {
  for (const [change, code] of [
    [f => { f.settings.grant.revoked = true; }, 'EFK_GRANT_REVOKED'],
    [f => { f.settings.grant.scope = { ...f.context.scope, writeResources: [] }; }, 'EFK_AUTHORITY_DENIED'],
    [f => { f.setNow(1000); }, 'EFK_GRANT_EXPIRED'],
  ]) {
    const f = await fixture(), record = await f.promote(); f.settings.observationChange = () => change(f);
    denied(await f.service.activate({ promotionId: record.promotionId, effect: f.effect(record) }), code); assert.equal(f.calls.execute, 0);
  }
  const f = await fixture(), record = await f.promote(), effect = f.effect(record); effect.leases[0].expiresAt = 20;
  denied(await f.service.activate({ promotionId: record.promotionId, effect }), 'EFK_LEASE_STALE');
});

test('cp2 activation effect cannot substitute session, asset, snapshot, base or authorization', async () => {
  const f = await fixture(), record = await f.promote();
  for (const change of [e => { e.binding.hostSessionId = 'other'; }, e => { e.payload.assetRef = f.revisions[1].candidate.asset; },
    e => { e.payload.previousSnapshot = f.artifact('wrong snapshot', 'HostSnapshot'); }, e => { e.binding.baseDigest = hash('wrong'); },
    e => { e.authorityRef = 'other'; }]) {
    const effect = f.effect(record); change(effect);
    denied(await f.service.activate({ promotionId: record.promotionId, effect }), 'EFK_ARTIFACT_BINDING_MISMATCH');
  }
  assert.equal(f.calls.execute, 0);
});

test('DoD2 failed host activation retains usable old snapshot and exact next-task versions', async () => {
  const f = await fixture(), first = await f.activate(await f.promote(1)), old = f.pointer();
  const second = await f.promote(2); f.settings.outcome = 'failed';
  const failed = await f.activate(second); assert.equal(failed.status, 'failed');
  assert.deepEqual(f.pointer().snapshot, old.snapshot); assert.deepEqual(f.pointer().active, first.asset);
  assert.equal(unwrap(f.artifacts.get(f.pointer().snapshot)), unwrap(f.artifacts.get(first.activation.newSnapshot)));
  assert.equal(unwrap(qualification(f.state().registry, first.asset, f.context)).usable, true);
  const next = unwrap(f.service.activatedVersions({ ...f.context, taskId: 'task-2' }));
  assert.deepEqual(next.map(v => [v.asset.assetId, v.asset.revision, v.asset.digest]), [['strategy', 1, first.asset.digest]]);
  assert.deepEqual(next[0].snapshot, first.activation.newSnapshot);
  assert.equal(unwrap(f.artifacts.get(f.revisions[0].candidate.contentRefs[0])), 'usable strategy version 1');
});

test('DoD2 completed activation lists only the exact current version for the next task', async () => {
  const f = await fixture(); await f.activate(await f.promote(1)); const second = await f.activate(await f.promote(2));
  const next = unwrap(f.service.activatedVersions({ ...f.context, taskId: 'task-2' }));
  assert.deepEqual(next.map(v => v.asset.revision), [2]); assert.deepEqual(next[0].snapshot, second.activation.newSnapshot);
  assert.deepEqual(unwrap(f.service.activatedVersions({ ...f.context, hostSessionId: 'other' })), []);
  assert.deepEqual(unwrap(f.service.activatedVersions({ ...f.context, taskId: 'unqualified' })), []);
});

test('cp3 activation replay is idempotent and cannot issue a second host call', async () => {
  const f = await fixture(), record = await f.promote(), request = { promotionId: record.promotionId, effect: f.effect(record) };
  const active = unwrap(await f.service.activate(request));
  assert.deepEqual(unwrap(await f.service.activate(request)), active);
  assert.deepEqual(unwrap(await f.service.reconcile(record.promotionId)), active); assert.equal(f.calls.execute, 1);
  denied(await f.service.activate({ ...request, effect: { ...request.effect, effectId: 'changed' } }), 'EFK_IDEMPOTENCY_COLLISION');
});

test('cp3 actual host success followed by pointer-CAS failure reconciles from retained journal receipt', async () => {
  const f = await fixture(), record = await f.promote(), append = f.ports.journal.append.bind(f.ports.journal);
  let failOnce = true;
  f.ports.journal.append = request => request.events.some(e => e.causedBy.startsWith('settle:')) && failOnce ?
    (failOnce = false, storeFail('EFK_REVISION_CONFLICT', 'injected final CAS failure')) : append(request);
  denied(await f.service.activate({ promotionId: record.promotionId, effect: f.effect(record) }), 'EFK_REVISION_CONFLICT');
  assert.equal(f.pointer().active, null); assert.equal(f.state().promotions[0].status, 'pending');
  const restoredJournal = createMemoryEventStore({ digest: f.registryPorts.digest });
  unwrap(restoredJournal.restoreSession(unwrap(f.ports.journal.exportSession(f.ports.sessionId))));
  const restarted = createPromotionService({ ...f.ports, journal: restoredJournal });
  const active = unwrap(await restarted.reconcile(record.promotionId)); assert.equal(active.status, 'active');
  assert.equal(f.calls.execute, 1); assert.equal(f.calls.reconcile, 0);
  assert.equal(unwrap(restarted.activatedVersions(f.context))[0].asset.revision, 1);
});

test('cp3 receipt-persistence failure reconciles through HostPort without redispatch', async () => {
  const f = await fixture(), record = await f.promote(), apply = f.ports.journal.applyReceipt.bind(f.ports.journal);
  f.ports.journal.applyReceipt = () => storeFail('EFK_REVISION_CONFLICT', 'injected receipt CAS failure');
  denied(await f.service.activate({ promotionId: record.promotionId, effect: f.effect(record) }), 'EFK_REVISION_CONFLICT');
  f.ports.journal.applyReceipt = apply;
  const recovered = unwrap(await createPromotionService(f.ports).reconcile(record.promotionId));
  assert.equal(recovered.status, 'active'); assert.equal(f.calls.reconcile, 1); assert.equal(f.calls.execute, 1);
});

test('cp3 unknown host outcome preserves old pointer and blocks next task and other session writes', async () => {
  const f = await fixture({ pointers: 2 }), record = await f.promote(); f.settings.outcome = 'unknown';
  denied(await f.service.activate({ promotionId: record.promotionId, effect: f.effect(record) }), 'EFK_ACTIVATION_UNCONFIRMED');
  denied(await f.service.reconcile(record.promotionId), 'EFK_ACTIVATION_UNCONFIRMED');
  denied(f.service.activatedVersions(f.context), 'EFK_ACTIVATION_UNCONFIRMED');
  denied(await f.service.promote(f.input(2, 1)), 'EFK_ACTIVATION_UNCONFIRMED');
  denied(await f.service.activate({ promotionId: record.promotionId, effect: f.effect(record) }), 'EFK_ACTIVATION_UNCONFIRMED');
  assert.equal(f.pointer().active, null); assert.equal(f.calls.execute, 1);
  f.actualReceipt(f.effect(record), 'active');
  assert.equal(unwrap(await f.service.reconcile(record.promotionId)).status, 'active');
});

test('cp3 mismatched host activation receipt cannot change the pointer', async () => {
  for (const change of [a => { a.authorizationRef = 'forged'; }, a => { a.hostSessionId = 'other'; },
    a => { a.previousSnapshot = a.newSnapshot; }, a => { a.scope.writeResources = []; }]) {
    const f = await fixture(), record = await f.promote(); f.settings.receiptChange = change;
    denied(await f.service.activate({ promotionId: record.promotionId, effect: f.effect(record) }), 'EFK_ARTIFACT_BINDING_MISMATCH');
    assert.equal(f.pointer().active, null);
  }
});

test('cp3 activation receipt must be unique and independently host-attributed', async () => {
  for (const [change, code] of [
    [r => { r.artifactRefs = []; }, 'EFK_ACTIVATION_UNCONFIRMED'],
    [r => { r.artifactRefs = [...r.artifactRefs, r.artifactRefs[0]]; }, 'EFK_SCHEMA_INVALID'],
    [r => { r.artifactRefs[0] = { ...r.artifactRefs[0], producer: actor('other', 'host-adapter') }; }, 'EFK_DECISION_AUTHORITY_DENIED'],
  ]) {
    const f = await fixture(), record = await f.promote(); f.settings.beforeReceipt = change;
    denied(await f.service.activate({ promotionId: record.promotionId, effect: f.effect(record) }), code); assert.equal(f.pointer().active, null);
  }
});

test('cp3 revoke new revision and restore a previously verified snapshot via a new host receipt', async () => {
  const f = await fixture(), first = await f.activate(await f.promote(1)), second = await f.activate(await f.promote(2));
  const evidenceRef = f.artifact('observed regression fixture', 'RevocationEvidence', { producer: f.registryPorts.issuers.revocation });
  unwrap(await f.service.revoke({ asset: second.asset, evidenceRef, authorizationRef: 'host-grant', at: 20 }, 'preauthorized', f.context));
  assert.equal(unwrap(qualification(f.state().registry, second.asset, f.context)).eligible, false);
  const rollback = unwrap(await f.service.rollback({ requestId: 'rollback-1', expected: f.pointer(), targetPromotionId: first.promotionId,
    ruleId: 'preauthorized', context: f.context }));
  const restored = await f.activate(rollback); assert.equal(restored.mode, 'rollback');
  assert.deepEqual(restored.activation.previousSnapshot, second.activation.newSnapshot);
  assert.deepEqual(restored.activation.newSnapshot, first.activation.newSnapshot);
  const activationDecision = JSON.parse(unwrap(f.artifacts.get(restored.activationDecisionRef)));
  assert.equal(activationDecision.kind, 'activation'); assert.equal(activationDecision.outcome, 'active');
  assert.deepEqual(activationDecision.activationReceiptRef, restored.activationRef);
  assert.deepEqual(f.pointer().snapshot, first.activation.newSnapshot);
  assert.deepEqual(unwrap(f.service.activatedVersions({ ...f.context, taskId: 'task-2' })).map(v => v.asset.revision), [1]);
  assert.equal(f.calls.execute, 3);
});

test('cp3 rollback cannot name an unconfirmed, revoked, expired or wrong-scope snapshot', async () => {
  const f = await fixture(), first = await f.promote();
  const input = () => ({ requestId: 'rollback-invalid', expected: f.pointer(), targetPromotionId: first.promotionId, ruleId: 'preauthorized', context: f.context });
  denied(await f.service.rollback(input()), 'EFK_ASSET_QUALIFICATION_INVALID');
  await f.activate(first);
  denied(await f.service.rollback({ ...input(), context: { ...f.context, hostSessionId: 'other' } }), 'EFK_ARTIFACT_BINDING_MISMATCH');
  const evidenceRef = f.artifact('revoked', 'RevocationEvidence', { producer: f.registryPorts.issuers.revocation });
  unwrap(await f.service.revoke({ asset: first.asset, evidenceRef, authorizationRef: 'host-grant', at: 20 }, 'preauthorized', f.context));
  denied(await f.service.rollback(input()), 'EFK_ASSET_QUALIFICATION_INVALID');
});

test('cp3 failed rollback retains the current actual snapshot', async () => {
  const f = await fixture(), first = await f.activate(await f.promote(1)), second = await f.activate(await f.promote(2));
  const rollback = unwrap(await f.service.rollback({ requestId: 'rollback-fails', expected: f.pointer(), targetPromotionId: first.promotionId,
    ruleId: 'preauthorized', context: f.context }));
  f.settings.outcome = 'failed'; assert.equal((await f.activate(rollback)).status, 'failed');
  assert.deepEqual(f.pointer().snapshot, second.activation.newSnapshot); assert.equal(f.pointer().active.revision, 2);
});

test('cp3 committed but undispatched intention can resume safely after a dispatch-CAS failure', async () => {
  const f = await fixture(), record = await f.promote(), dispatch = f.ports.journal.dispatchEffect.bind(f.ports.journal);
  f.ports.journal.dispatchEffect = () => storeFail('EFK_REVISION_CONFLICT', 'injected dispatch failure');
  denied(await f.service.activate({ promotionId: record.promotionId, effect: f.effect(record) }), 'EFK_REVISION_CONFLICT');
  assert.equal(f.calls.execute, 0); assert.equal(f.state().promotions[0].status, 'pending');
  f.ports.journal.dispatchEffect = dispatch;
  assert.equal(unwrap(await createPromotionService(f.ports).reconcile(record.promotionId)).status, 'active');
  assert.equal(f.calls.execute, 1); assert.equal(unwrap(f.ports.journal.exportSession(f.ports.sessionId)).effects.length, 1);
});

test('cp3 concurrent reconcile applies a retained activation only once', async () => {
  const f = await fixture(), record = await f.promote(), apply = f.ports.journal.applyReceipt.bind(f.ports.journal);
  f.ports.journal.applyReceipt = () => storeFail('EFK_REVISION_CONFLICT', 'injected receipt failure');
  denied(await f.service.activate({ promotionId: record.promotionId, effect: f.effect(record) }), 'EFK_REVISION_CONFLICT');
  f.ports.journal.applyReceipt = apply;
  const services = [createPromotionService(f.ports), createPromotionService(f.ports)];
  const results = await Promise.all(services.map(s => s.reconcile(record.promotionId))); results.forEach(unwrap);
  assert.equal(f.state().registry.history.filter(e => e.state === 'active').length, 1);
  assert.equal(f.calls.execute, 1); assert.equal(f.state().promotions[0].status, 'active');
});

test('cp3 revoke during host application reconciles actual mutation and permits a verified compensating rollback', async () => {
  const f = await fixture(), first = await f.activate(await f.promote(1)), second = await f.promote(2);
  const otherWriter = createPromotionService(f.ports);
  f.settings.beforeExecute = async () => {
    const evidenceRef = f.artifact('revoke while effect was in flight', 'RevocationEvidence', { producer: f.registryPorts.issuers.revocation });
    unwrap(await otherWriter.revoke({ asset: second.asset, evidenceRef, authorizationRef: 'host-grant', at: 20 }, 'preauthorized', f.context));
  };
  denied(await f.service.activate({ promotionId: second.promotionId, effect: f.effect(second) }), 'EFK_ASSET_REVOKED');
  assert.equal(f.state().promotions.at(-1).status, 'applied-unqualified');
  assert.equal(f.pointer().active.revision, 2); denied(f.service.activatedVersions(f.context), 'EFK_ASSET_REVOKED');
  denied(await f.service.reconcile(second.promotionId), 'EFK_ASSET_REVOKED');
  assert.equal(unwrap(qualification(f.state().registry, second.asset, f.context)).eligible, false);
  f.settings.beforeExecute = null;
  const rollback = unwrap(await f.service.rollback({ requestId: 'compensate-revoked', expected: f.pointer(),
    targetPromotionId: first.promotionId, ruleId: 'preauthorized', context: f.context }));
  await f.activate(rollback);
  assert.deepEqual(unwrap(f.service.activatedVersions(f.context)).map(v => v.asset.revision), [1]);
  assert.deepEqual(f.pointer().snapshot, first.activation.newSnapshot);
});

test('cp2 expired qualification at the observed safe point refuses before execution', async () => {
  const f = await fixture({ evaluationExpiry: 30 }), record = await f.promote();
  f.settings.observationChange = () => f.setNow(30);
  denied(await f.service.activate({ promotionId: record.promotionId, effect: f.effect(record) }), 'EFK_ASSET_EXPIRED');
  assert.equal(f.calls.execute, 0);
});

test('cp2 expired deadline, missing lease and wrong kernel session refuse dispatch', async () => {
  const f = await fixture(), record = await f.promote();
  denied(await f.service.activate({ promotionId: record.promotionId, effect: f.effect(record, { deadline: 20 }) }), 'EFK_ACTIVATION_NOT_SETTLED');
  denied(await f.service.activate({ promotionId: record.promotionId, effect: f.effect(record, { leases: [] }) }), 'EFK_AUTHORITY_DENIED');
  const effect = f.effect(record); effect.binding.sessionId = 'other-kernel-session';
  denied(await f.service.activate({ promotionId: record.promotionId, effect }), 'EFK_ARTIFACT_BINDING_MISMATCH');
  assert.equal(f.calls.execute, 0);
});

test('cp3 stale attempt receipts and missing invocation identity cannot confirm activation', async () => {
  for (const [change, code] of [
    [r => { r.binding = { ...r.binding, attemptOrdinal: 2 }; }, 'EFK_RECEIPT_STALE'],
    [r => { r.hostInvocationId = null; }, 'EFK_ACTIVATION_UNCONFIRMED'],
  ]) {
    const f = await fixture(), record = await f.promote(); f.settings.beforeReceipt = change;
    denied(await f.service.activate({ promotionId: record.promotionId, effect: f.effect(record) }), code);
    assert.equal(f.pointer().active, null);
  }
});

test('cp1 service construction reads no injected ports and initialization cannot overwrite a live projection', async () => {
  const f = await fixture();
  const service = createPromotionService({ ...f.ports, clock: { now() { assert.fail('constructor read clock'); } },
    journal: new Proxy({}, { get() { assert.fail('constructor read journal'); } }) });
  assert.equal(typeof service.promote, 'function');
  denied(await f.service.initialize(emptyRegistry(), []), 'EFK_IDEMPOTENCY_COLLISION');
});
