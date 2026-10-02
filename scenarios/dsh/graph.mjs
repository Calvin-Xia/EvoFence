import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { DEFS } from '../../dist/protocol/index.js';
import { compileGraph, applyGraphPatch } from '../../dist/kernel/graph/index.js';
import { deriveAuthority } from '../../dist/kernel/policy/index.js';
import { canonical, createMemoryArtifactStore, createMemoryEventStore } from '../../dist/storage/index.js';
import { createSessionService, planRound, bindingFor } from '../../dist/runtime/session/index.js';
import { verifyEffect } from '../../dist/runtime/host-port/index.js';
import { config, evidence, digest, value, record, writeJson } from './io.mjs';
import { policy, clock } from './native.mjs';
import { taskState } from './task-tools.mjs';

export const protocol = { namespace: 'evofence.runtime/1', schemaVersion: '1.1.0' };
const context = { inputRefs: [], maxTokens: 4096, preserveHostResources: true, isolation: 'current' };
export const scope = { workspaceRef: null, readResources: ['source', 'tests', 'integrationWriter'],
  writeResources: ['source', 'tests', 'integrationWriter'], artifactScopes: [], trustDomain: 'same-user' };
export function grant() {
  return { grantId: 'scenario-grant', rootAuthorityRef: 'scenario-root', scope, budget: policy,
    issuedEpoch: 1, expiresAt: Date.now() + 7200000, remainingDepth: 1, maxConcurrency: 2, revocationEpoch: 0, revoked: false };
}
export function node(id, resource = null, terminal = false) {
  return { nodeId: id, kind: 'agent', inputRefs: [], outputSchemas: [], loop: null, subgraph: null,
    contextPlan: context, toolRequirements: [], modelRequirements: { providerModel: null, reasoningRequested: null,
      reasoningGuarantee: 'payload-only', payloadRef: null }, resources: { exclusive: resource === null ? [] : [resource], shared: [] },
    termination: { maxAttempts: 3, maxActiveWallMs: 1800000, cancelMode: 'stop-and-confirm', unknownPolicy: 'reconcile', excludeHumanWait: true },
    terminal, requiredBranches: [] };
}
const edge = (from, to, type = 'dependency', when = null) => ({ edgeId: `${from}:${to}`, type, from, to, when,
  artifact: null, expect: null, maxAttempts: type === 'repair' ? 2 : null, relation: null });
export function spec(id, nodes, edges = []) {
  return { protocol, graphId: id, revision: 1,
    taskContractRef: { taskId: 'dual-host-limit-v1', version: 1, digest: digest(fs.readFileSync(config.contract)) },
    nodes, typedEdges: edges, requiredJoins: [], resourcePolicy: ['source', 'tests', 'integrationWriter'].map(resourceId => ({ resourceId, mode: 'exclusive', maxHolders: 1 })),
    graphLimits: { maxNodes: 16, maxConcurrentAgents: 2, maxDepth: 3, maxAttempts: 3 }, abandonedBranches: [] };
}
export function graphRef(graph) { return { graphId: graph.graphId, revision: graph.revision, digest: digest(canonical(graph.spec)) }; }
export function makeEffect(id, ref, nativeId, g) {
  return { protocol, effectId: id, idempotencyKey: id, binding: { sessionId: 'dsh-scenario', hostSessionId: nativeId,
    graph: ref, nodeId: id, attemptId: `${id}:a1`, attemptOrdinal: 1, epoch: 1, baseDigest: null },
    authorityRef: g.grantId, reservationRef: `reservation:${id}`, leases: [], inputRefs: [], deadline: g.expiresAt - 1000,
    kind: 'host.agent', payload: { context, toolName: null, argumentsRef: null, graphRef: null, targetIds: [],
      assetRef: null, previousSnapshot: null, deliveryGuarantee: 'none' } };
}
export function childPlan(a, role) {
  const ref = a.effect.payload.graphRef;
  const request = { grantId: `child-grant:${a.effect.effectId}`, scope: { ...scope,
    writeResources: role === 'logic' ? ['source'] : role === 'tests' ? ['tests'] : [] },
    budget: { ...policy, maxRequests: 60, maxConcurrentRequests: 1 }, expiresAt: a.effect.deadline - 1,
    remainingDepth: 0, maxConcurrency: 1 };
  const phases = role === 'logic' || role === 'tests' ? ['inspect', 'implement'] : ['verify'];
  const effects = phases.map(phase => {
    const e = makeEffect(`${role}:${phase}:${a.effect.effectId}`, ref, null, { ...a.grant, grantId: request.grantId });
    e.binding.nodeId = phase;
    e.deadline = request.expiresAt - 1; e.reservationRef = a.effect.reservationRef; return e;
  });
  return { request, capabilities: ['host.agent'], effects };
}
export function dynamicGraph() {
  assert(taskState.plan !== null, 'real parent decompose must precede dynamic expansion');
  const baseResult = compileGraph(spec('dsh-scenario-graph', [node('placeholder', null, true)]));
  assert(baseResult.ok, JSON.stringify(baseResult.error));
  const patch = { protocol, graphId: 'dsh-scenario-graph', expectedRevision: 1,
    adds: [node('logic', 'source'), node('tests', 'tests'), node('integrate', 'integrationWriter'),
      node('verify'), node('repair', 'integrationWriter'), node('finish', null, true)], changes: [], removals: ['placeholder'],
    typedEdges: [edge('logic', 'integrate'), edge('tests', 'integrate'), edge('integrate', 'verify'),
      edge('verify', 'repair', 'repair', { op: 'eq', path: 'outcome', value: 'repair', children: [] }), edge('repair', 'finish')],
    abandonedBranches: [], reason: `Expand bounded task from real inspection: ${taskState.plan.anchors.join('; ')}`,
    authorityRef: 'scenario-grant' };
  const result = applyGraphPatch(baseResult.graph, patch, { authority: { grantRefs: ['scenario-grant'], nodeIds: null, capabilities: ['host.agent', 'host.delegate'] } });
  assert(result.ok, JSON.stringify(result.error));
  writeJson(path.join(evidence, 'dynamic-graph.json'), { before: baseResult.graph.spec, patch, after: result.graph.spec, diff: result.diff });
  record('dynamic-graph-accepted', { from: result.fromRevision, to: result.toRevision, added: result.diff.addedNodes });
  return result.graph;
}
export function createKernel(graph, host, g, stageComplete, seedOnly = false) {
  const digestPort = { digest }, store = createMemoryEventStore({ digest: digestPort }), artifacts = createMemoryArtifactStore({ digest: digestPort });
  const ref = graphRef(graph), rootGrant = { grantId: 'scenario-root', rootAuthorityRef: 'scenario-root', parentGrantRef: null,
    actor: { actorId: 'scenario-user', kind: 'kernel', identityRef: null }, sessionId: 'dsh-scenario', nodeIds: graph.spec.nodes.map(n => n.nodeId),
    scope, capabilities: ['host.agent', 'host.delegate'], maxDelegationDepth: 2, expiresAt: g.expiresAt,
    revocationEpoch: 0, approvalRef: null };
  const operations = Object.fromEntries(graph.spec.nodes.map(n => {
    const e = makeEffect(n.nodeId, ref, null, g);
    if (['logic', 'tests', 'verify', 'finish'].includes(n.nodeId)) {
      const worker = n.nodeId === 'logic' || n.nodeId === 'tests';
      const child = compileGraph(spec(`child:${n.nodeId}`, worker ? [node('inspect'), node('implement', null, true)] : [node('verify', null, true)],
        worker ? [edge('inspect', 'implement')] : []));
      assert(child.ok, JSON.stringify(child.error));
      e.kind = 'host.delegate'; e.payload = { ...e.payload, graphRef: graphRef(child.graph), context: { ...context, isolation: 'fresh' } };
      writeJson(path.join(evidence, `child-graph-${n.nodeId}.json`), child.graph.spec);
    }
    return [n.nodeId, { kind: e.kind, payload: e.payload, inputRefs: [] }];
  }));
  const seed = { sessionId: 'dsh-scenario', graph, graphRef: ref, policy, reservePerRequest: 1000000, grants: [g], operations };
  if (seedOnly) return { seed };
  const issuer = { actorId: 'scenario-evidence-evaluator', kind: 'evaluator', identityRef: null };
  const evaluator = { issuer, async evaluateTask(s, state, receipt) {
    const n = receipt.binding.nodeId, outcome = n === 'verify' ? 'repair' : 'completed';
    const completed = stageComplete(n); assert(completed, `missing actual stage evidence: ${n}`);
    const receiptRef = state.events.find(e => e.type === 'receipt.applied' && e.payload.objectRef.id === receipt.receiptId).payload.objectRef;
    const report = { contractRef: graph.spec.taskContractRef, binding: receipt.binding, privateTestsPassed: n !== 'verify',
      requiredOutcomesMet: n !== 'verify', branchReport: [], artifactRefs: receipt.artifactRefs, actualDiffRef: null,
      runStatus: n === 'verify' ? 'incomplete' : 'completed', usageComplete: receipt.usage.every(u => u.complete), privacyChecked: true };
    const bytes = canonical(report), evidenceRef = { protocol, id: `stage-evidence:${receipt.effectId}`, digest: digest(bytes), producer: issuer,
      binding: receipt.binding, schema: { name: 'TaskEvidenceReport', version: '1.1.0', digest: digest(canonical(DEFS.TaskEvidenceReport)) },
      location: `scenario:${n}`, visibility: 'internal', expiresAt: null, partition: 'not-evaluation' };
    value(artifacts.put(evidenceRef, bytes));
    return { ok: true, value: { protocol, decisionId: `stage-decision:${receipt.effectId}`, kind: 'task', inputs: [receiptRef],
      contractRef: graph.spec.taskContractRef, taskEvidenceRef: evidenceRef, evaluationReceiptRef: null, activationReceiptRef: null,
      evaluatorVersion: 'scenario-observation/1', evaluationProtocolRef: null, outcome,
      reasons: [n === 'verify' ? 'real-injected-test-failure' : 'observed-required-stage-actions'], evidenceRefs: [evidenceRef],
      feedbackVisibility: 'internal', issuer, capabilityJudgement: null } };
  } };
  const ports = { store, artifacts, host, clock, digest: digestPort, evaluator, leaseTtlMs: 1800000, effectTtlMs: 1800000,
    maxConcurrentAgents: 2, depth: 0, maxDepth: 3, policy: {
      inspect(s, n, _binding, now) { return { policy: { policyId: 'scenario-policy', evolutionMode: 'optional', evolutionCapabilities: [], requireTrustDomain: 'same-user', requireCompleteUsage: true },
        authority: deriveAuthority({ now, revokedEpoch: 0, root: rootGrant, parent: rootGrant, task: scope,
          node: { nodeId: n.nodeId, scope, capabilities: ['host.agent', 'host.delegate'] } }),
        negotiation: { ok: true, value: { status: 'executable', taskDigest: ref.digest, manifestDigest: ref.digest,
          satisfied: [], gaps: [], selectedAlternatives: [], approvalRefs: [] } } }; },
      resume: () => ({ ok: true, value: undefined }) } };
  const service = createSessionService(ports);
  const journalFile = path.join(evidence, 'kernel-journal.json');
  const restored = fs.existsSync(journalFile) ? JSON.parse(fs.readFileSync(journalFile)) : null;
  if (restored === null) value(service.create({ ...seed, epoch: 1, protocol }));
  else { value(store.restoreSession(restored)); value(service.open(seed)); }
  function snapshot() { writeJson(path.join(evidence, 'kernel-journal.json'), value(store.exportSession(seed.sessionId))); }
  return { service, seed, ports, snapshot,
    async restoreArtifacts() {
      const state = value(service.read(seed.sessionId));
      for (const e of state.events) {
        const r = e.payload.objectRef;
        if (r === null) continue;
        if (artifacts.ids().includes(r.id)) { value(artifacts.get(r)); continue; }
        let bytes;
        if (e.type === 'graph.accepted') bytes = canonical(graph.spec);
        else if (e.type === 'budget.changed') bytes = canonical({ graphRef: seed.graphRef, policy: seed.policy,
          reservePerRequest: seed.reservePerRequest, operations: seed.operations, grants: seed.grants });
        else if (e.type === 'receipt.applied') bytes = canonical(state.receipts[r.id]);
        else if (e.type === 'decision.recorded') {
          const receiptEvent = state.events.find(x => x.type === 'receipt.applied' && x.payload.binding.nodeId === e.payload.binding.nodeId);
          const decision = value(await evaluator.evaluateTask(seed, state, state.receipts[receiptEvent.payload.objectRef.id]));
          bytes = canonical(decision);
        } else if (e.type === 'host.observed') bytes = canonical(value(await host.observe(seed.sessionId)));
        else throw new Error(`unsupported restore object event: ${e.type}`);
        // Restore uses the original digest; any changed bytes fail in the actual ArtifactStore.
        value(artifacts.put(r, bytes));
      }
      record('kernel-restored', { revision: state.revision, effects: Object.keys(state.effects), receipts: Object.keys(state.receipts) });
    },
    async parallelWorkers() {
      const state = value(service.read(seed.sessionId)), now = clock.now();
      const admissions = Object.fromEntries(graph.spec.nodes.map(n => [n.nodeId, ports.policy.inspect(seed, n, bindingFor(state, seed, n.nodeId), now)]));
      const batch = value(planRound(state, seed, { ...ports, now }, admissions, 'scenario-parallel-round'));
      assert.deepEqual(batch.effects.map(e => e.binding.nodeId).sort(), ['logic', 'tests']);
      value(store.append({ sessionId: seed.sessionId, requestId: 'scenario-parallel-round', expectedRevision: state.revision,
        epoch: state.epoch, ...batch })); snapshot();
      const authorizations = batch.effects.map(e => {
        const current = value(service.read(seed.sessionId));
        value(store.dispatchEffect(seed.sessionId, { expectedRevision: current.revision, epoch: current.epoch,
          effectId: e.effectId, claimId: `dispatch:${e.effectId}` }));
        return value(verifyEffect(e, { grants: [g], now: clock.now() }));
      });
      snapshot(); record('parallel-dispatch', { effectIds: batch.effects.map(e => e.effectId) });
      // Host execution seam consumes the kernel's committed independent claims. No second scheduler.
      const receipts = await Promise.all(authorizations.map(a => host.execute(a).then(value)));
      for (const receipt of receipts) { assert.equal(receipt.status, 'completed', JSON.stringify(receipt.error));
        value(service.receive(seed.sessionId, receipt)); value(await service.evaluate(seed.sessionId, receipt.effectId)); snapshot(); }
      return receipts;
    },
    async step() {
      let report = value(await service.step(seed.sessionId)); snapshot();
      if (report.dispatchAttempted.length === 0) {
        const state = value(service.read(seed.sessionId)), last = state.events.at(-1);
        assert.equal(last.type, 'node.transition', 'no actual wake transition');
        assert.equal(last.payload.before, 'waiting'); assert.equal(last.payload.after, 'pending');
        record('kernel-wake-round', { nodeId: last.payload.binding.nodeId, revision: state.revision });
        report = value(await service.step(seed.sessionId)); snapshot();
      }
      for (const receiptId of report.appliedReceipts) {
        const r = value(service.read(seed.sessionId)).receipts[receiptId];
        assert.equal(r.status, 'completed', JSON.stringify(r.error));
        value(await service.evaluate(seed.sessionId, r.effectId)); snapshot();
      }
      assert(report.dispatchAttempted.length > 0, 'graph unexpectedly stalled'); return report;
    } };
}
