import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createMemoryArtifactStore, createMemoryEventStore } from '../dist/storage/index.js';
import { canonical, storeOk, storeFail } from '../dist/kernel/store/index.js';
import { emptyRegistry, stageRevision, revisionDigest, recordDecision, qualification } from '../dist/learning/assets/index.js';
import { createPromotionService } from '../dist/learning/promotion/index.js';
import { createRevocationService } from '../dist/evaluation/revocation/index.js';

const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const protocol = { namespace: 'evofence.runtime/1', schemaVersion: '1.1.0' };
const assetProtocol = { namespace: 'evofence.assets/1', schemaVersion: '1.0.0' };
const actor = (actorId, kind = 'kernel') => ({ actorId, kind, identityRef: null });
const unwrap = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const denied = (result, code) => { assert.equal(result.ok, false, JSON.stringify(result)); assert.equal(result.error.code, code); };

export async function fixture({ count = 2, pointers = 1, evaluationExpiry = null, dependencies = {}, staged = [], candidateExpiry = null } = {}) {
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
        kind: 'memory', contentRefs: [artifact(`usable strategy version ${n}`)], sourceTraces: [source], dependencies: (dependencies[n] ?? []).map(i => revisions[i - 1].candidate.asset),
        hypothesis: 'Fixture hypothesis, not a measured capability claim.', qualification: 'staged', evaluationRef: null, expiresAt: candidateExpiry, revocationRef: null } };
    revision.candidate.asset.digest = revisionDigest(revision, digest);
    registry = unwrap(stageRevision(registry, revision, registryPorts));
    const judgement = { cellStatus: 'complete', look: 'CONFIRMATORY_LOOK', verdict: 'positive', protocolRef,
      analysisRef: source, costBasis: 'measured-usage-estimate', guardrailCost: 'passed', guardrailWall: 'passed', guardrailTruncation: 'passed' };
    const evaluation = { evaluationId: `evaluation-${n}`, candidate: revision.candidate.asset, baseDigest: context.baseDigest,
      dependencyRefs: revision.candidate.dependencies, protocolRef, dataSplitRefs: [source], hostManifestRefs: [manifest], modelBindings: [model],
      requiredJudgements: [judgement], usageComplete: true, evidenceRefs: [source] };
    const evaluationRef = artifact(canonical(evaluation), 'EvaluationReceipt', { producer: actor('independent-evaluator', 'evaluator'), visibility: 'private', expiresAt: evaluationExpiry });
    const candidateDecision = { protocol, decisionId: `candidate-${n}`, kind: 'candidate', outcome: 'validated',
      inputs: revision.candidate.contentRefs, contractRef: null, taskEvidenceRef: null, evaluationReceiptRef: evaluationRef,
      activationReceiptRef: null, evaluatorVersion: 'fixture/1', evaluationProtocolRef: protocolRef, reasons: [], evidenceRefs: [],
      feedbackVisibility: 'internal', issuer: issuers.candidate, capabilityJudgement: judgement };
    const decisionRef = artifact(canonical(candidateDecision), 'DecisionRecord', { producer: issuers.candidate, visibility: 'private' });
    if (!staged.includes(n)) registry = unwrap(recordDecision(registry, { asset: revision.candidate.asset, decisionRef, context, at: 20 }, registryPorts));
    revisions.push(revision); evaluations.push({ receipt: evaluation, ref: evaluationRef });
  }
  const root = { grantId: 'root-grant', rootAuthorityRef: 'root-authority', parentGrantRef: null, actor: issuers.revocation,
    sessionId: 'promotion-session', nodeIds: ['activation-node'], scope, capabilities: ['asset.promote', 'host.activate', 'asset.revoke', 'host.cancel'],
    maxDelegationDepth: 3, expiresAt: 1000, revocationEpoch: 0, approvalRef: null };
  const rules = { ruleId: 'preauthorized', authorizationRef: 'host-grant', hostSessionId: context.hostSessionId,
    assets: revisions.map(r => r.candidate.asset), allowTemporary: false,
    authority: { revokedEpoch: 0, root, parent: { ...root, grantId: 'parent-grant', parentGrantRef: root.grantId }, task: scope,
      node: { nodeId: 'activation-node', scope, capabilities: ['asset.promote', 'host.activate', 'asset.revoke', 'host.cancel'] } } };
  const grant = { grantId: 'host-grant', rootAuthorityRef: 'root-authority', scope,
    budget: { poolId: 'fixture-pool', category: 'development', authorizationRef: null, maxRequests: 0, maxInputTokens: 0,
      maxOutputTokens: 0, maxUsdMicros: 0, maxWallMs: 100, maxConcurrentRequests: 1, priceRef: null, missingUsagePolicy: 'retain-reservation' },
    issuedEpoch: 1, expiresAt: 1000, remainingDepth: 1, maxConcurrency: 1, revocationEpoch: 0, revoked: false };
  const settings = { rule: rules, grant, idle: true, capabilities: { nativeSessionBinding: { status: 'verified' }, settledAndIdle: { status: 'verified' } },
    outcome: 'active', receiptChange: null, beforeExecute: null, observationChange: null, beforeReceipt: null };
  const calls = { observe: 0, execute: 0, reconcile: 0, cancel: 0, maxConcurrent: 0 };
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
    async cancel({ targetIds }) { calls.cancel++; return storeOk({ status: 'cancelled', targets: targetIds.map(targetId => ({ targetId, confirmation: 'native-ack', observability: ['fixture-ack'] })), error: null }); },
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

export { unwrap, denied, hash };
export async function revocationFixture(options = {}) {
  const f = await fixture(options), monitorIssuer = actor('quality-monitor', 'evaluator');
  const attested = new Set(), inventory = new Map();
  const monitoring = { policy: { minimums: { task_success: 0.8 }, maxAgeMs: 100, requireQuality: false }, verifies: 0 };
  const revocationPorts = { promotion: f.ports, monitorIssuer,
    signalInventory: asset => storeOk(inventory.get(asset.revision) ?? []),
    verifySignal(ref) { monitoring.verifies++; return attested.has(canonical(ref)) ? storeOk(true) : storeFail('EFK_AUTHORITY_DENIED', 'unattested signal'); },
    policy: () => storeOk(monitoring.policy), restoreEffect: record => storeOk(f.effect(record)) };
  function signal(version = 2, changes = {}, metadata = {}) {
    const value = { asset: f.revisions[version - 1].candidate.asset, context: f.context, source: 'dev',
      metric: 'task_success', value: 0.4, measuredAt: 20, ...changes };
    const ref = f.artifact(canonical(value), 'QualitySignal', { producer: monitorIssuer, partition: 'dev', visibility: 'private', ...metadata });
    attested.add(canonical(ref)); inventory.set(version, [...(inventory.get(version) ?? []), ref]); return ref;
  }
  const revocation = createRevocationService(revocationPorts);
  const request = (version = 2, signalRefs, changes = {}) => {
    if (signalRefs === undefined) { signal(version); signalRefs = inventory.get(version); }
    return { requestId: 'regression-1', asset: f.revisions[version - 1].candidate.asset,
      context: f.context, ruleId: 'preauthorized', signalRefs, ...changes };
  };
  async function ordinary(service = revocation) {
    return service.runOrdinary(f.context, async view => {
      const receipt = { protocol, receiptId: 'ordinary-receipt', effectId: 'ordinary-tool', hostInvocationId: 'ordinary-invocation',
        binding: {}, status: 'completed', artifactRefs: [], usage: [], observability: ['ordinary-host-tool'], error: null };
      const original = f.ports.host.execute;
      f.ports.host.execute = async authorized => authorized.effect.effectId === 'ordinary-tool' ? storeOk(receipt) : original(authorized);
      const actual = await f.ports.host.execute({ effect: { effectId: 'ordinary-tool', kind: 'host.tool' }, grant: f.settings.grant });
      f.ports.host.execute = original;
      return actual.ok ? storeOk({ view, receipt: actual.value }) : actual;
    });
  }
  return { ...f, revocation, revocationPorts, monitoring, signal, request, ordinary };
}

