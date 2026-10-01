// Shared flat-test fixtures. All product imports are from the current dist build.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DEFS } from '../dist/protocol/index.js';
import { createMemoryEventStore, createMemoryArtifactStore, canonical } from '../dist/storage/index.js';
import { deriveAuthority } from '../dist/kernel/policy/index.js';
import { createFakeHost, PI_CAPABILITIES } from '../dist/runtime/host-port/index.js';
import { createSessionService, planRound, bindingFor } from '../dist/runtime/session/index.js';
import { idFor } from '../dist/runtime/session/journal.js';
import { node, graph, compiled, budgetPolicy, PROTOCOL } from './l2-scheduler-fixtures.mjs';
export { node, graph, PROTOCOL, canonical, bindingFor };
export const digestPort = { digest: bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
export function value(result) {
  assert.equal(result.ok, true, JSON.stringify(result.error));
  return result.value;
}
export function usage(requestId, overrides = {}) {
  return { requestId, source: 'provider', inputUncached: 10, cacheRead: 0, cacheWrite: 0, output: 3,
    reasoning: 1, total: 13, estimatedUsdMicros: 37, invoiceUsdMicros: null, complete: true, evidenceRefs: [], ...overrides };
}
export function harness(options = {}) {
  const spec = options.spec ?? graph({ nodes: [node('nA', { terminal: true })] });
  const graphPlan = compiled(spec);
  const script = { outcomes: {}, reconcile: {}, usage: {}, cancelConfirmed: {}, ...options.script };
  const scope = { workspaceRef: null, readResources: spec.resourcePolicy.map(p => p.resourceId),
    writeResources: spec.resourcePolicy.map(p => p.resourceId), artifactScopes: [], trustDomain: 'same-user' };
  const budget = budgetPolicy({ maxRequests: 8, maxConcurrentRequests: 4, ...options.budget });
  const grant = { grantId: 'grant-1', rootAuthorityRef: 'root-1', scope, budget, issuedEpoch: 1,
    expiresAt: 10000, remainingDepth: 2, maxConcurrency: 4, revocationEpoch: 0, revoked: false };
  const seed = { sessionId: 's-runtime', graph: graphPlan,
    graphRef: { graphId: spec.graphId, revision: spec.revision, digest: digestPort.digest(canonical(spec)) },
    policy: budget, reservePerRequest: 100, grants: [grant], operations: Object.fromEntries(spec.nodes.map(n => [n.nodeId, {
      kind: 'host.agent', inputRefs: [], payload: { context: n.contextPlan, toolName: null, argumentsRef: null,
        graphRef: null, targetIds: [], assetRef: null, previousSnapshot: null, deliveryGuarantee: 'none' },
    }])) };
  let now = 1000;
  const calls = { clock: 0, observe: 0, execute: 0, reconcile: 0, evaluate: 0, resume: 0, inspect: 0 };
  const clock = { now: () => { calls.clock++; return now; } };
  const store = createMemoryEventStore({ digest: digestPort });
  const artifacts = createMemoryArtifactStore({ digest: digestPort });
  const guarantee = status => ({ status, coverage: [], evidenceRefs: [] });
  const fake = createFakeHost({ host: 'runtime-fake', clock, capabilities: PI_CAPABILITIES,
    cancellation: guarantee(options.cancelStatus ?? 'partial'), recovery: guarantee('verified'), isolation: guarantee('partial'), script });
  const host = { ...fake,
    observe: async id => { calls.observe++; return fake.observe(id); },
    execute: async authorized => { calls.execute++; return fake.execute(authorized); },
    reconcile: async request => { calls.reconcile++; return fake.reconcile(request); },
  };
  const root = { grantId: 'root-1', rootAuthorityRef: 'root-1', parentGrantRef: null,
    actor: { actorId: 'user', kind: 'kernel', identityRef: null }, sessionId: seed.sessionId,
    nodeIds: spec.nodes.map(n => n.nodeId), scope, capabilities: ['host.agent'], maxDelegationDepth: 3,
    expiresAt: 10000, revocationEpoch: 0, approvalRef: null };
  const policy = {
    inspect: (_seed, n, _binding, at) => {
      calls.inspect++;
      return { policy: { policyId: 'risk-1', evolutionMode: 'optional', evolutionCapabilities: [],
        requireTrustDomain: 'same-user', requireCompleteUsage: options.requireCompleteUsage ?? false },
      authority: deriveAuthority({ now: at, revokedEpoch: options.revokedEpoch ?? 0, root, parent: root,
        task: scope, node: { nodeId: n.nodeId, scope, capabilities: ['host.agent'] } }),
      negotiation: { ok: true, value: { status: options.negotiationStatus ?? 'executable', taskDigest: seed.graphRef.digest,
        manifestDigest: seed.graphRef.digest, satisfied: [], gaps: [], selectedAlternatives: [], approvalRefs: [] } } };
    },
    resume: (_seed, _state, request) => {
      calls.resume++;
      if (options.resumeError) return { ok: false, error: options.resumeError };
      return request.manifestRef.digest === seed.graphRef.digest
        ? { ok: true, value: undefined }
        : { ok: false, error: { code: 'EFK_SOURCE_PIN_DRIFT', message: 'manifest drift', refs: [], visibility: 'internal', retry: 'after-refresh' } };
    },
  };
  function persist(id, name, data, binding = null, producer = { actorId: 'kernel', kind: 'kernel', identityRef: null }) {
    const bytes = canonical(data);
    const ref = { protocol: PROTOCOL, id, digest: digestPort.digest(bytes), producer, binding,
      schema: { name, version: '1.1.0', digest: digestPort.digest(canonical(DEFS[name] ?? { name })) },
      location: `test:${id}`, visibility: 'internal', expiresAt: null, partition: 'not-evaluation' };
    value(artifacts.put(ref, bytes));
    return ref;
  }
  const issuer = { actorId: 'task-evaluator', kind: 'evaluator', identityRef: null };
  const evaluator = { issuer,
    evaluateTask: async (_seed, state, receipt) => {
      calls.evaluate++;
      const receiptRef = state.events.find(e => e.type === 'receipt.applied' && e.payload.objectRef.id === receipt.receiptId).payload.objectRef;
      const evidence = { contractRef: spec.taskContractRef, binding: receipt.binding, privateTestsPassed: true,
        requiredOutcomesMet: receipt.status === 'completed', branchReport: [], artifactRefs: receipt.artifactRefs,
        actualDiffRef: null, runStatus: receipt.status === 'completed' ? 'completed' : 'incomplete', usageComplete: true, privacyChecked: true };
      const evidenceRef = persist(`evidence:${receipt.binding.attemptId}`, 'TaskEvidenceReport', evidence, receipt.binding, issuer);
      const decision = { protocol: PROTOCOL, decisionId: `decision:${receipt.binding.attemptId}`, kind: 'task',
        inputs: [receiptRef], contractRef: spec.taskContractRef, taskEvidenceRef: evidenceRef,
        evaluationReceiptRef: null, activationReceiptRef: null, evaluatorVersion: 'fixture/1', evaluationProtocolRef: null,
        outcome: options.evaluateOutcome ?? (receipt.status === 'completed' ? 'completed' : 'failed'), reasons: ['fixture-result'],
        evidenceRefs: [evidenceRef], feedbackVisibility: 'internal', issuer, capabilityJudgement: null };
      return { ok: true, value: options.transformDecision ? options.transformDecision(decision) : decision };
    } };
  const ports = { store, artifacts, host, clock, digest: digestPort, policy, evaluator,
    leaseTtlMs: 5000, effectTtlMs: 5000, maxConcurrentAgents: 2, depth: 0, maxDepth: 3 };
  const service = createSessionService(ports);
  value(service.create({ ...seed, epoch: 1, protocol: PROTOCOL }));
  function round(state = value(service.read(seed.sessionId))) {
    const admissions = Object.fromEntries(spec.nodes.map(n => [n.nodeId, policy.inspect(seed, n, bindingFor(state, seed, n.nodeId), now)]));
    return value(planRound(state, seed, { ...ports, now }, admissions, 'plan-1'));
  }
  function planOnly() {
    const state = value(service.read(seed.sessionId));
    const batch = round(state);
    value(store.append({ sessionId: seed.sessionId, requestId: 'plan-1', expectedRevision: state.revision, epoch: state.epoch, ...batch }));
    return batch.effects;
  }
  return { ports, service, seed, store, artifacts, fake, host, script, calls, round, planOnly, persist, root,
    setNow: time => { now = time; }, read: () => value(service.read(seed.sessionId)),
    step: () => service.step(seed.sessionId), effectId: nodeId => `effect:${idFor(ports, 'round', [seed.sessionId, 2])}:n${spec.nodes.findIndex(n => n.nodeId === nodeId)}`,
    requestId: nodeId => `node${spec.nodes.findIndex(n => n.nodeId === nodeId)}:a1:e1`,
    receipt: (effect, overrides = {}) => ({ protocol: PROTOCOL, receiptId: `webhook:${effect.effectId}`,
      effectId: effect.effectId, hostInvocationId: `invoke:${effect.effectId}`, binding: effect.binding,
      status: 'completed', artifactRefs: [], usage: [], observability: ['native-result'], error: null, ...overrides }) };
}
