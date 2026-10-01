import assert from 'node:assert/strict';
import { harness, value, canonical, usage } from './harness.mjs';
import { graph, node, edge } from './fixtures.mjs';
import { planRound, bindingFor } from '../../dist/runtime/session/index.js';
import { claimNode, grantLease, emptyState } from '../../dist/kernel/scheduler/index.js';
export function planOnly(h, commandId = 'verification-plan') {
  const state = h.read(), admissions = Object.fromEntries(h.seed.graph.spec.nodes.map(n =>
    [n.nodeId, h.ports.policy.inspect(h.seed, n, bindingFor(state, h.seed, n.nodeId), 1000)]));
  const batch = value(planRound(state, h.seed, { ...h.ports, now: 1000 }, admissions, commandId));
  const request = { sessionId: h.seed.sessionId, requestId: commandId, expectedRevision: state.revision, epoch: state.epoch, ...batch };
  return { batch, request };
}
const writerSpec = () => graph({ nodes: ['one', 'two'].map(id => node(id, { terminal: true,
  resources: { exclusive: ['writer'], shared: [] } })),
  resourcePolicy: [{ resourceId: 'writer', mode: 'exclusive', maxHolders: 1 }] });
export async function concurrency() {
  const h = harness('concurrency', { spec: writerSpec() });
  h.start();
  const { request, batch } = planOnly(h);
  assert.equal(batch.effects.length, 1, 'exclusive resource admits one attempt');
  const competitors = await Promise.all(['first', 'second'].map(requestId => Promise.resolve().then(() =>
    h.ports.store.append({ ...request, requestId }))));
  assert.equal(competitors.filter(r => r.ok).length, 1);
  h.recordError('CAS-losing-planner', competitors.find(r => !r.ok), 'EFK_REVISION_CONFLICT', request);
  const [effect] = h.effects();
  const revision = h.read().revision;
  const claims = await Promise.all(['dispatch-one', 'dispatch-two'].map(claimId => Promise.resolve().then(() =>
    h.ports.store.dispatchEffect(h.seed.sessionId, { expectedRevision: revision, epoch: 1, effectId: effect.effectId, claimId }))));
  assert.equal(claims.filter(r => r.ok).length, 1);
  h.recordError('dispatch-losing-claim', claims.find(r => !r.ok), 'EFK_CLAIM_CONFLICT', { effectId: effect.effectId, revision });
  const state = h.checkpoint('one-writer-one-claim');
  assert.equal(state.scheduler.claims.length, 1);
  assert.equal(state.scheduler.leases.grants.length, 1);
  assert.equal(state.budget.reservations.length, 1);
  const [lease] = state.scheduler.leases.grants;
  const requestLease = { resourceId: 'writer', mode: 'exclusive', maxHolders: 1,
    ownerClaimId: 'other-attempt', epoch: 1, ttlMs: 5000 };
  const refused = grantLease(state.scheduler.leases, requestLease, 1000);
  assert.equal(refused.verdict, 'capacity');
  assert.equal(refused.error, null, 'capacity contention is a deferral, not an invented error code');
  h.log.push({ port: 'scheduler.grantLease', request: requestLease, result: refused });
  assert.equal(canonical(refused.table), canonical(state.scheduler.leases));
  const fresh = emptyState();
  const first = claimNode(fresh, effect.binding, 1000, fresh.revision);
  const second = claimNode(first.state, effect.binding, 1000, first.state.revision);
  h.recordError('same-attempt-second-owner', second, 'EFK_CLAIM_CONFLICT', effect.binding);
  assert.equal(second.state.claims.length, 1);
  // Real application dispatch fence, not a replica of lease comparison logic.
  h.setNow(7000);
  value(await h.step()); // The already claimed unknown effect must not be resent.
  assert.equal(h.calls.execute, 1); // only the second node, after writer expiry
  const late = h.receipt(effect, { usage: [usage(effect.reservationRef)] });
  assert.equal(value(h.service.receive(h.seed.sessionId, late)).disposition, 'archived');
  assert.equal(h.read().nodeStates.find(n => n.nodeId === effect.binding.nodeId).state, 'leased');
  assert.equal(h.read().budget.reservations.length, 1);
  assert.ok(h.effect('two').leases[0].fencingToken > lease.fencingToken);
  h.checkpoint('expired-writer-replacement-fencing');
  return h.finish();
}
export async function cancellation() {
  const h = harness('cancellation', { automaticUsage: false });
  h.start();
  const execute = h.ports.host.execute;
  h.ports.host = { ...h.ports.host, execute: async a => { h.script.outcomes[a.effect.effectId] = 'unknown'; return execute(a); } };
  value(await h.step());
  h.checkpoint('execution-unknown');
  const request = { commandId: 'cancel-unconfirmed', expectedRevision: h.read().revision, reason: 'user-stop' };
  const report = value(await h.service.cancel(h.seed.sessionId, request));
  h.recordError('cancel-without-native-ack', report, 'EFK_CANCEL_UNCONFIRMED', request);
  assert.equal(report.status, 'unknown');
  const s = h.checkpoint('cancel-unconfirmed-retains-unknown');
  assert.equal(s.dispatchMode, 'cancelling');
  assert.equal(s.cancellation, 'unconfirmed');
  assert.equal(s.nodeStates[0].state, 'unknown');
  assert.equal(s.budget.reservations.length, 1);
  assert.equal(s.budget.settlements.length, 0);
  const calls = h.calls.execute;
  value(await h.service.cancel(h.seed.sessionId, request));
  h.restart();
  value(await h.step());
  assert.equal(h.calls.execute, calls);
  assert.ok(h.read().unknownEffectIds.includes(h.effect('work').effectId));
  h.checkpoint('cancel-replay-no-resend');
  return h.finish();
}
export async function budget() {
  const spec = graph({ nodes: [node('one'), node('two', { terminal: true })], typedEdges: [edge('wait', 'dependency', 'one', 'two')] });
  const h = harness('budget', { spec, budget: { maxUsdMicros: 200, maxRequests: 2, maxConcurrentRequests: 1 } });
  h.start();
  h.control.metering.one = { complete: false, estimatedUsdMicros: 0 };
  value(await h.step());
  const held = h.checkpoint('incomplete-usage-holds-reservation');
  assert.equal(held.budget.reservations.length, 1);
  assert.equal(held.budget.reservations[0].reservedMicros, 100);
  assert.equal(held.budget.settlements.length, 0);
  value(await h.evaluate('one'));
  const effect = h.effect('one'), receipt = h.fake.receiptFor(effect.effectId);
  const before = h.read().budget;
  const deferred = value(await h.step());
  assert.equal(deferred.dispatchAttempted.length, 0, 'waiting consumer wakes before its dispatch round');
  h.log.push({ port: 'session.step', reason: 'dependency-wake', result: deferred });
  h.recordError('concurrent-cap-blocks-new-reservation', await h.step(), 'EFK_BUDGET_EXHAUSTED', { maxConcurrentRequests: 1, outstanding: 1 });
  assert.equal(h.calls.execute, 1);
  assert.equal(canonical(h.read().budget), canonical(before));
  value(h.service.receive(h.seed.sessionId, { ...receipt, receiptId: 'meter-complete', usage: [usage(effect.reservationRef, { estimatedUsdMicros: 237 })] }));
  const settled = h.checkpoint('complete-usage-settles-not-reservation');
  assert.equal(settled.budget.reservations.length, 0);
  assert.equal(settled.budget.settlements[0].micros, 237, 'actual overspend is measured, not hidden by refusal');
  h.recordError('actual-spend-exceeds-ledger-cap', { error: settled.usageIssues.find(e => e.code === 'EFK_BUDGET_EXHAUSTED') },
    'EFK_BUDGET_EXHAUSTED', { capMicros: 200, measuredMicros: 237 });
  h.recordError('overspent-policy-blocks-next-request', await h.step(), 'EFK_BUDGET_EXHAUSTED', { capMicros: 200, settledMicros: 237 });
  const conflict = { ...receipt, receiptId: 'meter-conflict', usage: [usage(effect.reservationRef, { estimatedUsdMicros: 99 })] };
  h.recordError('metering-conflict', h.service.receive(h.seed.sessionId, conflict), 'EFK_USAGE_CONFLICT', conflict);
  assert.equal(h.read().budget.settlements[0].micros, 237);
  value(h.service.receive(h.seed.sessionId, { ...receipt, receiptId: 'meter-repeat', usage: [usage(effect.reservationRef, { estimatedUsdMicros: 237 })] }));
  assert.equal(h.read().budget.settlements.length, 1);
  h.checkpoint('duplicate-metering-once');
  return h.finish();
}
