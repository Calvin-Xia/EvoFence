import assert from 'node:assert/strict';
import { harness, value, canonical, usage } from './harness.mjs';
import { graph, node, edge, predicate, digest } from './fixtures.mjs';
import { delegate } from '../../dist/runtime/host-port/index.js';
export async function ordinary() {
  const outputSchema = { name: 'BuildOutput', version: '1.1.0', digest: digest.digest(canonical({ name: 'BuildOutput' })) };
  const h = harness('ordinary', { spec: graph({ nodes: [node('work', { terminal: true, outputSchemas: [outputSchema],
    resources: { exclusive: ['writer'], shared: [] } })],
    resourcePolicy: [{ resourceId: 'writer', mode: 'exclusive', maxHolders: 1 }] }) });
  const created = h.start();
  assert.equal(created.schemaVersion, '1.1.0');
  h.checkpoint('create-accepted');
  const execute = h.ports.host.execute;
  h.ports.host = { ...h.ports.host, execute: async authorized => {
    const ref = h.persisted(`output:${authorized.effect.binding.attemptId}`, 'BuildOutput', { result: 'built' },
      authorized.effect.binding, { actorId: 'host', kind: 'host-adapter', identityRef: null });
    h.script.artifacts[authorized.effect.effectId] = [ref];
    return execute(authorized);
  } };
  const result = value(await h.step());
  assert.equal(result.dispatchAttempted.length, 1);
  assert.equal(result.appliedReceipts.length, 1);
  const s = h.checkpoint('receipt-applied-verifying');
  assert.equal(s.nodeStates[0].state, 'verifying', 'host completion must wait for evaluation');
  assert.equal(h.calls.evaluate, 0);
  assert.equal(s.budget.reservations.length, 0);
  assert.equal(s.budget.settlements[0].micros, 37);
  const intention = h.log.find(x => x.port === 'EventStore.append' && x.request.effects.length === 1);
  assert.equal(intention.result.ok, true);
  const revision = intention.result.value.revision;
  assert.ok(s.events.some(e => e.type === 'effect.intended' && e.revision === revision));
  assert.ok(s.events.some(e => e.type === 'node.transition' && e.payload.after === 'leased' && e.revision === revision));
  const receipt = h.fake.receiptFor(h.effect('work').effectId);
  const before = s.revision;
  assert.equal(value(h.service.receive(h.seed.sessionId, receipt)).disposition, 'duplicate');
  assert.equal(h.read().revision, before);
  value(await h.evaluate('work'));
  const judged = h.checkpoint('registered-evaluation-succeeded');
  assert.equal(judged.nodeStates[0].state, 'succeeded');
  assert.equal(judged.events.filter(e => e.type === 'decision.recorded').length, 1);
  assert.equal(judged.outbox.entries[0].state, 'resolved');
  h.restart();
  h.checkpoint('close-export-restore-equal');
  assert.equal(h.calls.execute, 1);
  return h.finish();
}
export async function repair() {
  const h = harness('repair', { spec: graph({ nodes: [node('work'), node('fix', { terminal: true })],
    typedEdges: [edge('repair-edge', 'repair', 'work', 'fix', {
      when: predicate('eq', 'decision.outcome', 'repair'), maxAttempts: 2 })] }) });
  h.control.evaluation.work = 'repair';
  h.start();
  value(await h.step());
  assert.equal(h.calls.execute, 1, 'repair target cannot run before decision');
  const old = h.effect('work');
  value(await h.evaluate('work'));
  const failed = h.checkpoint('private-test-failure-repair-created');
  assert.equal(failed.nodeStates.find(n => n.nodeId === 'work').state, 'failed');
  assert.equal(failed.nodeStates.find(n => n.nodeId === 'fix').attemptOrdinal, 2);
  assert.equal(failed.nodeStates.find(n => n.nodeId === 'fix').state, 'pending');
  const evidence = h.finish().artifacts.find(x => x.ref.id === `evidence:${old.binding.attemptId}`);
  assert.equal(JSON.parse(evidence.bytes).privateTestsPassed, false);
  value(await h.step());
  assert.equal(h.effect('fix').binding.attemptOrdinal, 2);
  assert.notEqual(h.effect('fix').binding.attemptId, old.binding.attemptId);
  value(await h.evaluate('fix'));
  const done = h.checkpoint('repair-task-completed-failure-preserved');
  assert.equal(done.nodeStates.find(n => n.nodeId === 'work').state, 'failed');
  assert.equal(done.nodeStates.find(n => n.nodeId === 'fix').state, 'succeeded');
  assert.equal(done.budget.settlements.length, 2);
  h.restart();
  return h.finish();
}
export async function delegation() {
  const h = harness('delegation');
  const childGraph = graph({ graphId: 'g-child', nodes: [node('child-work', { terminal: true })] });
  const childRef = { graphId: childGraph.graphId, revision: 1, digest: digest.digest(canonical(childGraph)) };
  const request = { grantId: 'child-grant', scope: h.parentGrant.scope, budget: h.parentGrant.budget,
    expiresAt: 9000, remainingDepth: 1, maxConcurrency: 1 };
  const child = value(delegate(h.parentGrant, request, 1000));
  assert.equal(child.rootAuthorityRef, h.parentGrant.rootAuthorityRef);
  assert.equal(child.budget.poolId, h.seed.policy.poolId);
  assert.ok(child.remainingDepth < h.parentGrant.remainingDepth);
  h.seed.grants = [child];
  h.seed.operations.work = { ...h.seed.operations.work, kind: 'host.delegate',
    payload: { ...h.seed.operations.work.payload, graphRef: childRef } };
  h.start();
  h.persisted('child-plan', 'GraphSpec', childGraph);
  value(await h.step());
  const delegated = h.checkpoint('dynamic-delegate-effect-receipt');
  const effect = h.effect('work');
  assert.equal(effect.kind, 'host.delegate');
  assert.equal(effect.authorityRef, child.grantId);
  assert.equal(canonical(effect.payload.graphRef), canonical(childRef));
  assert.equal(delegated.nodeStates[0].state, 'verifying');
  assert.equal(delegated.budget.settlements.length, 1);
  value(await h.evaluate('work'));
  assert.equal(h.checkpoint('delegation-evaluated').nodeStates[0].state, 'succeeded');
  const expanded = { ...request, scope: { ...request.scope, writeResources: ['outside-root'] } };
  h.recordError('child-scope-widening', delegate(h.parentGrant, expanded, 1000), 'EFK_AUTHORITY_DENIED', expanded);
  return h.finish();
}
